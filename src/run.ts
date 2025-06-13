import { equal } from 'node:assert';
import { AccountUpdate, Bool, Mina, PrivateKey, UInt64, UInt8 } from 'o1js';
import { FungibleToken, VKeyMerkleMap } from './FungibleTokenContract.js';
import {
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
} from './configs.js';
import {
  generateDummyDynamicProof,
  program,
} from './side-loaded/program.eg.js';

const localChain = await Mina.LocalBlockchain({
  proofsEnabled: false,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);
const fee = 1e8;

const [deployer, owner, alexa] = localChain.testAccounts;
const contract = PrivateKey.randomKeypair();
const admin = PrivateKey.randomKeypair();

const token = new FungibleToken(contract.publicKey);

const vKey = (await program.compile()).verificationKey;
const vKeyMap = new VKeyMerkleMap();

const dummyProof = await generateDummyDynamicProof(
  token.deriveTokenId(),
  alexa
);

const mintParams = MintParams.create(MintConfig.default, {
  minAmount: UInt64.from(0),
  maxAmount: UInt64.from(1000),
});
const burnParams = BurnParams.create(BurnConfig.default, {
  minAmount: UInt64.from(100),
  maxAmount: UInt64.from(1500),
});

// ----------------------- DEPLOY --------------------------------
console.log('Deploying token contract.');
const deployTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 2);
    await token.deploy({
      symbol: 'abc',
      src: 'https://github.com/MinaFoundation/mina-fungible-token/blob/main/FungibleToken.ts',
    });
    await token.initialize(
      admin.publicKey,
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
deployTx.sign([deployer.key, contract.privateKey]);
const deployTxResult = await deployTx.send().then((v) => v.wait());
console.log('Deploy tx result:', deployTxResult.toPretty());
equal(deployTxResult.status, 'included');

// ----------------------- MINT IN RANGE::AUTHORIZED::ALEXA --------------------------------
const alexaBalanceBeforeMint = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance before mint:', alexaBalanceBeforeMint);
equal(alexaBalanceBeforeMint, 0n);

console.log('Minting new tokens to Alexa.');
const mintTx = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(owner, 2);
    await token.mintWithProof(
      alexa,
      new UInt64(300),
      dummyProof,
      vKey,
      vKeyMap
    );
  }
);
// console.log(mintTx.toPretty().length, mintTx.toPretty());
await mintTx.prove();
mintTx.sign([owner.key, admin.privateKey]);
const mintTxResult = await mintTx.send().then((v) => v.wait());
console.log(
  'Mint tx result:',
  mintTxResult.toPretty().length,
  mintTxResult.toPretty()
);

const alexaBalanceAfterMint = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint:', alexaBalanceAfterMint);
equal(alexaBalanceAfterMint, 300n);

// ----------------------- UPDATE MINT CONFIG::AUTHORIZED::PUBLIC::FIXED --------------------------------
console.log('updatng the mint config...');
const updateMintConfigTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.updateMintConfig(
      new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      })
    );
  }
);
await updateMintConfigTx.prove();
await updateMintConfigTx.sign([alexa.key, admin.privateKey]).send().wait();
console.log(
  updateMintConfigTx.toPretty().length,
  updateMintConfigTx.toPretty()
);

// ----------------------- MINT FIXED::PUBLIC::ALEXA --------------------------------
console.log('Minting new tokens again to Alexa');
const mintTx2 = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    await token.mintWithProof(
      alexa,
      new UInt64(200),
      dummyProof,
      vKey,
      vKeyMap
    );
  }
);
await mintTx2.prove();
mintTx2.sign([owner.key]);
const mintTxResult2 = await mintTx2.send().then((v) => v.wait());
console.log(
  'Mint tx2 result:',
  mintTxResult2.toPretty().length,
  mintTxResult2.toPretty()
);

const alexaBalanceAfterMint2 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after second mint:', alexaBalanceAfterMint2);
equal(alexaBalanceAfterMint2, 500n);
