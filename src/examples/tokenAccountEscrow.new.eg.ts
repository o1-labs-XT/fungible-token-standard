import { equal } from 'node:assert';
import {
  SmartContract,
  state,
  State,
  method,
  DeployArgs,
  Permissions,
  PublicKey,
  UInt64,
  Bool,
  AccountUpdate,
  VerificationKey,
  Mina,
  PrivateKey,
  UInt8,
} from 'o1js';
import { FungibleToken, VKeyMerkleMap } from '../NewTokenStandard.js';
import {
  generateDummyDynamicProof,
  SideloadedProof,
} from '../side-loaded/program.eg.js';
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

export class TokenAccountEscrow extends SmartContract {
  @state(PublicKey) tokenAddress = State<PublicKey>();
  @state(PublicKey) owner = State<PublicKey>();

  async deploy(
    args: DeployArgs & { tokenAddress: PublicKey; owner: PublicKey }
  ) {
    await super.deploy(args);
    this.tokenAddress.set(args.tokenAddress);
    this.owner.set(args.owner);

    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });
  }

  @method async deposit(
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ) {
    proof.verifyIf(vk, Bool(false));
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    token.deriveTokenId().assertEquals(this.tokenId);

    const sender = this.sender.getUnconstrained();
    const senderTokenAccount = AccountUpdate.createSigned(sender, tokenId);
    senderTokenAccount.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;

    senderTokenAccount.body.useFullCommitment = Bool(true);
    senderTokenAccount.update.appState[0].isSome = Bool(true);
    senderTokenAccount.update.appState[0].value = amount.value;

    await token.transferCustom(
      sender,
      this.address,
      amount,
      proof,
      vk,
      vKeyMap
    );
  }

  @method async withdraw(amount: UInt64) {
    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    const tokenId = token.deriveTokenId();

    const sender = this.sender.getUnconstrained();
    const userTokenAccount = AccountUpdate.createSigned(sender, tokenId);
    userTokenAccount.body.useFullCommitment = Bool(true);
    const currentBalance = userTokenAccount.update.appState[0].value;
    currentBalance.assertGreaterThanOrEqual(
      amount.value,
      'Insufficient balance'
    );
    userTokenAccount.update.appState[0].isSome = Bool(true);
    userTokenAccount.update.appState[0].value = currentBalance.sub(
      amount.value
    );

    let receiverUpdate = this.send({ to: sender, amount });
    receiverUpdate.body.mayUseToken =
      AccountUpdate.MayUseToken.InheritFromParent;
    receiverUpdate.body.useFullCommitment = Bool(true);
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

console.log(`
Deployer Public Key: ${deployer.toBase58()}
Owner Public Key: ${owner.toBase58()}
Alexa Public Key: ${alexa.toBase58()}
Billy Public Key: ${billy.toBase58()}
Jackie Public Key: ${jackie.toBase58()}

TokenContract Public Key: ${tokenContractKeyPair.publicKey.toBase58()}
EscrowContract Public Key: ${escrowContractKeyPair.publicKey.toBase58()}
`);

const mintParams = new MintParams({
  fixedAmount: UInt64.from(200),
  minAmount: UInt64.from(1),
  maxAmount: UInt64.from(1000),
});
const burnParams = new BurnParams({
  fixedAmount: UInt64.from(500),
  minAmount: UInt64.from(100),
  maxAmount: UInt64.from(1500),
});

const tokenContract = new FungibleToken(tokenContractKeyPair.publicKey);
const tokenId = tokenContract.deriveTokenId();
const escrowContract = new TokenAccountEscrow(
  escrowContractKeyPair.publicKey,
  tokenId
);

console.log('Compiling contracts...');
// await FungibleToken.compile();
// await TokenAccountEscrow.compile();

const vKeyMap = new VKeyMerkleMap();
const dummyVkey = await VerificationKey.dummy();
const dummyProof = await generateDummyDynamicProof(
  tokenContract.deriveTokenId(),
  alexa
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
      symbol: 'wETH',
      src: 'https://github.com/o1-labs-XT/fungible-token-standard/blob/main/src/NewTokenStandard.ts',
    });

    await tokenContract.initialize(
      deployer,
      UInt8.from(9), // Normally to match ETH's decimals, this should be 18. We use it as 9 for simplicity.
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
      owner: deployer,
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

console.log('Alexa deposits tokens to the escrow.');
const depositTx1 = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await escrowContract.deposit(
      new UInt64(150),
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
console.log(depositTx1.toPretty());
const depositTxResult1 = await depositTx1.send().then((v) => v.wait());
console.log('Deposit tx result 1:', depositTxResult1.toPretty());
equal(depositTxResult1.status, 'included');

const escrowBalanceAfterDeposit1 = (
  await tokenContract.getBalanceOf(escrowContractKeyPair.publicKey)
).toBigInt();
console.log('Escrow balance after 1st deposit:', escrowBalanceAfterDeposit1);
equal(escrowBalanceAfterDeposit1, BigInt(150));

console.log(
  'Alexa should fail to withdraw all remaining in escrow contract tokens directly without using escrow contract.'
);
const directWithdrawTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await tokenContract.transferCustom(
      escrowContractKeyPair.publicKey,
      jackie,
      new UInt64(150),
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
await directWithdrawTx.prove();
directWithdrawTx.sign([alexa.key, escrowContractKeyPair.privateKey]);
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
equal(escrowBalanceAfterDirectWithdraw, BigInt(150));

console.log('Owner should fail to withdraw escrow contract tokens');
const ownerWithdrawTx = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    await escrowContract.withdraw(new UInt64(25));
    await tokenContract.approveAccountUpdateCustom(
      escrowContract.self,
      dummyProof,
      dummyVkey,
      vKeyMap
    );
  }
);
ownerWithdrawTx.prove();
ownerWithdrawTx.sign([owner.key]);
const ownerWithdrawTxResult = await ownerWithdrawTx.safeSend();
console.log("Owner Withdraw tx status:", ownerWithdrawTxResult.status);
console.log(ownerWithdrawTxResult.toPretty());
equal(ownerWithdrawTxResult.status, 'rejected')