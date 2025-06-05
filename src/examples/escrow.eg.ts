import { equal } from 'node:assert';
import {
  AccountUpdate,
  Bool,
  DeployArgs,
  method,
  Mina,
  Permissions,
  PrivateKey,
  PublicKey,
  SmartContract,
  State,
  state,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import {
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
} from '../configs.js';
import {
  generateDummyDynamicProof,
  SideloadedProof,
} from '../side-loaded/program.eg.js';
import { FungibleToken, VKeyMerkleMap } from '../FungibleTokenStandard.js';

export class TokenEscrow extends SmartContract {
  @state(PublicKey)
  tokenAddress = State<PublicKey>();
  @state(UInt64)
  total = State<UInt64>();
  @state(PublicKey)
  owner = State<PublicKey>();

  async deploy(
    args: DeployArgs & { tokenAddress: PublicKey; owner: PublicKey }
  ) {
    await super.deploy(args);

    this.tokenAddress.set(args.tokenAddress);
    this.total.set(UInt64.zero);
    this.owner.set(args.owner);
    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  @method
  async deposit(
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ) {
    proof.verifyIf(vk, Bool(false));
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);
    this.sender.getAndRequireSignature;
    await token.transferCustom(
      sender,
      this.address,
      amount,
      proof,
      vk,
      vKeyMap
    );

    const total = this.total.getAndRequireEquals();
    this.total.set(total.add(amount));
  }

  @method
  async withdraw(to: PublicKey, amount: UInt64) {
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    const sender = this.sender.getUnconstrained();
    const senderUpdate = AccountUpdate.createSigned(sender);
    senderUpdate.body.useFullCommitment = Bool(true);
    this.owner.getAndRequireEquals().assertEquals(sender);

    let receiverUpdate = this.send({ to: sender, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);

    const total = this.total.getAndRequireEquals();
    total.assertGreaterThanOrEqual(amount, 'insufficient balance');
    this.total.set(total.sub(amount));
  }
}

const localChain = await Mina.LocalBlockchain({
  proofsEnabled: false,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);

const fee = 1e8;

const [deployer, owner, alexa, billy, jackie] = localChain.testAccounts;
const tokenContractKeyPair = PrivateKey.randomKeypair();
const escrowContractKeyPair = PrivateKey.randomKeypair();
const admin = PrivateKey.randomKeypair();

console.log(`
Deployer Public Key: ${deployer.toBase58()}
Owner Public Key: ${owner.toBase58()}
Admin Public Key ${admin.publicKey.toBase58()}

TokenContract Public Key: ${escrowContractKeyPair.publicKey.toBase58()}
EscrowContract Public Key: ${escrowContractKeyPair.publicKey.toBase58()}
`);

const mintParams = MintParams.create(MintConfig.default, {
  minAmount: UInt64.from(1),
  maxAmount: UInt64.from(1000),
});
const burnParams = BurnParams.create(BurnConfig.default, {
  minAmount: UInt64.from(100),
  maxAmount: UInt64.from(1500),
});

const tokenContract = new FungibleToken(tokenContractKeyPair.publicKey);
const tokenId = tokenContract.deriveTokenId();
const escrowContract = new TokenEscrow(
  escrowContractKeyPair.publicKey,
  tokenId
);

console.log('Compiling contracts...');
await FungibleToken.compile();
await TokenEscrow.compile();

const vKeyMap = new VKeyMerkleMap();
const dummyVkey = await VerificationKey.dummy();
const dummyProof = await generateDummyDynamicProof(
  tokenContract.deriveTokenId(),
  deployer
);

console.log('Deploying Fungible Token Contract');
const deployTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 2);

    await tokenContract.deploy({
      symbol: 'DNB',
      src: 'https://github.com/o1-labs-XT/fungible-token-standard/blob/main/src/NewTokenStandard.ts',
    });

    await tokenContract.initialize(
      deployer,
      UInt8.from(9),
      MintConfig.default,
      mintParams,
      BurnConfig.default,
      burnParams,
      MintDynamicProofConfig.default,
      BurnDynamicProofConfig.default,
      TransferDynamicProofConfig.default,
      UpdatesDynamicProofConfig.default
    );
  }
);

await deployTx.prove();
deployTx.sign([deployer.key, tokenContractKeyPair.privateKey]);
const deployTxResult = await deployTx.send().then((v) => v.wait());
console.log(
  'Fungible Token Contract Deployment TX Result:',
  deployTxResult.toPretty()
);
equal(deployTxResult.status, 'included');

console.log('Deploying Escrow Contract');
const deployEscrowTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await escrowContract.deploy({
      tokenAddress: tokenContractKeyPair.publicKey,
      owner,
    });

    await tokenContract.approveAccountUpdateCustom(
      escrowContract.self,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);

await deployEscrowTx.prove();
deployEscrowTx.sign([
  deployer.key,
  escrowContractKeyPair.privateKey,
  tokenContractKeyPair.privateKey,
]);
const deployEscrowTxResult = await deployEscrowTx.send().then((v) => v.wait());
console.log(
  'Escrow Contract Deployment TX Result:',
  deployEscrowTxResult.toPretty()
);
equal(deployEscrowTxResult.status, 'included');

console.log('Minting new tokens to Alexa.');
const mintAlexaTx = await Mina.transaction(
  { sender: deployer, fee },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await tokenContract.mint(
      alexa,
      mintParams.maxAmount,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await mintAlexaTx.prove();
mintAlexaTx.sign([deployer.key]);
const mintAlexaTxResult = await mintAlexaTx.send().then((v) => v.wait());
console.log('Mint tx result:', mintAlexaTxResult.toPretty());
equal(mintAlexaTxResult.status, 'included');

console.log('Minting new tokens to Billy.');
const mintBillyTx = await Mina.transaction(
  { sender: deployer, fee },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await tokenContract.mint(
      billy,
      mintParams.maxAmount,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await mintBillyTx.prove();
mintBillyTx.sign([deployer.key]);
const mintBillyTxResult = await mintBillyTx.send().then((v) => v.wait());
console.log('Mint tx result:', mintBillyTxResult.toPretty());
equal(mintBillyTxResult.status, 'included');

console.log('Alexa deposits tokens to the escrow.');
const depositTx1 = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await escrowContract.deposit(
      new UInt64(100),
      dummyProof,
      dummyVkey,
      vKeyMap
    );
    await tokenContract.approveAccountUpdateCustom(
      escrowContract.self,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await depositTx1.prove();
depositTx1.sign([alexa.key]);
const depositTxResult1 = await depositTx1.send().then((v) => v.wait());
console.log('Deposit tx result 1:', depositTxResult1.toPretty());
equal(depositTxResult1.status, 'included');

const escrowBalanceAfterDeposit1 = (
  await tokenContract.getBalanceOf(escrowContractKeyPair.publicKey)
).toBigInt();
console.log('Escrow balance after 1st deposit:', escrowBalanceAfterDeposit1);
equal(escrowBalanceAfterDeposit1, BigInt(100));

console.log('Billy deposits tokens to the escrow.');
const depositTx2 = await Mina.transaction(
  {
    sender: billy,
    fee,
  },
  async () => {
    await escrowContract.deposit(
      new UInt64(50),
      dummyProof,
      dummyVkey,
      vKeyMap
    );
    await tokenContract.approveAccountUpdateCustom(
      escrowContract.self,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await depositTx2.prove();
depositTx2.sign([billy.key]);
const depositTxResult2 = await depositTx2.send().then((v) => v.wait());
console.log('Deposit tx result 2:', depositTxResult2.toPretty());
equal(depositTxResult2.status, 'included');

const escrowBalanceAfterDeposit2 = (
  await tokenContract.getBalanceOf(escrowContractKeyPair.publicKey)
).toBigInt();
console.log('Escrow balance after 2nd deposit:', escrowBalanceAfterDeposit2);
equal(escrowBalanceAfterDeposit2, BigInt(150));

const escrowTotalAfterDeposits = escrowContract.total.get();
equal(escrowTotalAfterDeposits.toBigInt(), escrowBalanceAfterDeposit2);

console.log('Escrow owner withdraws portion of tokens to Jackie.');
const withdrawTx = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(owner, 1);
    await escrowContract.withdraw(jackie, new UInt64(25));
    await tokenContract.approveAccountUpdateCustom(
      escrowContract.self,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await withdrawTx.prove();
withdrawTx.sign([owner.key]);
const withdrawTxResult = await withdrawTx.send().then((v) => v.wait());
console.log('Withdraw tx result:', withdrawTxResult.toPretty());
equal(withdrawTxResult.status, 'included');

const escrowBalanceAfterWithdraw = (
  await tokenContract.getBalanceOf(escrowContractKeyPair.publicKey)
).toBigInt();
console.log('Escrow balance after withdraw:', escrowBalanceAfterWithdraw);
equal(escrowBalanceAfterWithdraw, BigInt(125));

console.log(
  'Jackie should fail to withdraw all remaining in escrow contract tokens directly without using escrow contract.'
);
const directWithdrawTx = await Mina.transaction(
  {
    sender: jackie,
    fee,
  },
  async () => {
    await tokenContract.transferCustom(
      escrowContractKeyPair.publicKey,
      jackie,
      new UInt64(10),
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await directWithdrawTx.prove();
directWithdrawTx.sign([jackie.key, escrowContractKeyPair.privateKey]);
const directWithdrawTxResult = await directWithdrawTx.safeSend();
console.log('Direct Withdraw tx status:', directWithdrawTxResult.status);
equal(directWithdrawTxResult.status, 'rejected');

const escrowBalanceAfterDirectWithdraw = (
  await tokenContract.getBalanceOf(escrowContractKeyPair.publicKey)
).toBigInt();
console.log(
  'Escrow balance after the attempt of direct withdraw:',
  escrowBalanceAfterDirectWithdraw
);
equal(escrowBalanceAfterDirectWithdraw, BigInt(125));

const escrowTotalAfterWithdraw = escrowContract.total.get();
equal(escrowTotalAfterWithdraw.toBigInt(), escrowBalanceAfterWithdraw);
