import { AccountUpdate, Mina, PrivateKey, UInt8, UInt64, Bool } from 'o1js';
import { FungibleToken } from '../FungibleTokenContract.js';
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
import { equal } from 'node:assert';

// Set up local blockchain
const localChain = await Mina.LocalBlockchain({
  proofsEnabled: false,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);

const fee = 1e8;

// Test accounts and contract setup
const [deployer, owner, admin, alexa, billy] = localChain.testAccounts;
const contractKeypair = PrivateKey.randomKeypair();

console.log(`
Deployer Public Key: ${deployer.toBase58()}
Owner Public Key: ${owner.toBase58()}
Admin Public Key: ${admin.toBase58()}
Contract Public Key: ${contractKeypair.publicKey.toBase58()}
`);

const token = new FungibleToken(contractKeypair.publicKey);

// Configure mint and burn parameters
const mintParams = MintParams.create(MintConfig.default, {
  minAmount: UInt64.from(1),
  maxAmount: UInt64.from(1000),
});

// Create a burn configuration that explicitly allows unauthorized burning
const burnConfig = new BurnConfig({
  unauthorized: Bool(true), // Allow burning without admin signature
  fixedAmount: Bool(false),
  rangedAmount: Bool(true),
});

const burnParams = BurnParams.create(burnConfig, {
  minAmount: UInt64.from(100),
  maxAmount: UInt64.from(1500),
});

console.log('Compiling contracts...');
await FungibleToken.compile();

// Deploy the token contract
console.log('Deploying token contract...');
const deployTx = await Mina.transaction({ sender: deployer, fee }, async () => {
  AccountUpdate.fundNewAccount(deployer, 2);

  await token.deploy({
    symbol: 'DNB',
    src: 'https://github.com/o1-labs-XT/fungible-token-contract/blob/main/src/FungibleTokenContract.ts',
  });

  await token.initialize(
    admin,
    UInt8.from(9),
    MintConfig.default,
    mintParams,
    burnConfig,
    burnParams,
    MintDynamicProofConfig.default,
    BurnDynamicProofConfig.default,
    TransferDynamicProofConfig.default,
    UpdatesDynamicProofConfig.default
  );
});

await deployTx.prove();
deployTx.sign([deployer.key, contractKeypair.privateKey]);
const deployTxResult = await deployTx.send().then((v) => v.wait());
console.log('Deploy tx result:', deployTxResult.toPretty());
equal(deployTxResult.status, 'included');

// Check Alexa's initial balance
const alexaInitialBalance = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa initial balance:', alexaInitialBalance);
equal(alexaInitialBalance, 0n);

// Mint tokens to Alexa
console.log('Minting tokens to Alexa...');
const mintTx = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(owner, 1);
    await token.mint(alexa, mintParams.maxAmount);
  }
);

await mintTx.prove();
mintTx.sign([owner.key, admin.key]);
const mintTxResult = await mintTx.send().then((v) => v.wait());
console.log('Mint tx result:', mintTxResult.toPretty());
equal(mintTxResult.status, 'included');

const alexaBalanceAfterMint = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint:', alexaBalanceAfterMint);
equal(alexaBalanceAfterMint, 1000n);

// Check Billy's initial balance
const billyInitialBalance = await token.getBalanceOf(billy);
console.log('Billy initial balance:', billyInitialBalance.toBigInt());
equal(billyInitialBalance.toBigInt(), 0n);

// Transfer tokens from Alexa to Billy
console.log('Transferring tokens from Alexa to Billy...');
const transferTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(alexa, 1);
    await token.transferCustom(alexa, billy, mintParams.maxAmount);
  }
);

await transferTx.prove();
transferTx.sign([alexa.key]);
const transferTxResult = await transferTx.send().then((v) => v.wait());
console.log('Transfer tx result:', transferTxResult.toPretty());
equal(transferTxResult.status, 'included');

const alexaBalanceAfterTransfer = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after transfer:', alexaBalanceAfterTransfer);
equal(alexaBalanceAfterTransfer, 0n);

const billyBalanceAfterTransfer = (await token.getBalanceOf(billy)).toBigInt();
console.log('Billy balance after transfer:', billyBalanceAfterTransfer);
equal(billyBalanceAfterTransfer, mintParams.maxAmount.toBigInt());

// Burn some of Billy's tokens
console.log("Burning Billy's tokens...");
const burnAmount = UInt64.from(150); // Use an amount within the burn range (100-1500)
const burnTx = await Mina.transaction(
  {
    sender: billy,
    fee,
  },
  async () => {
    await token.burn(billy, burnAmount);
  }
);

await burnTx.prove();
burnTx.sign([billy.key]);
const burnTxResult = await burnTx.send().then((v) => v.wait());
console.log('Burn tx result:', burnTxResult.toPretty());
equal(burnTxResult.status, 'included');

const billyFinalBalance = (await token.getBalanceOf(billy)).toBigInt();
console.log('Billy final balance:', billyFinalBalance);
equal(
  billyFinalBalance,
  mintParams.maxAmount.toBigInt() - burnAmount.toBigInt()
);
