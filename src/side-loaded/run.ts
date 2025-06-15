import { equal } from 'node:assert';
import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  Provable,
  UInt64,
  UInt8,
} from 'o1js';
import { FungibleToken, VKeyMerkleMap } from '../FungibleTokenContract.js';
import {
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
  OperationKeys,
} from '../configs.js';
import {
  program,
  generateDummyDynamicProof,
  generateDynamicProof,
} from './program.eg.js';

// const cs = await FungibleToken.analyzeMethods();
// console.log(cs);

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

// 4185797382523560386307881027368447066967585209309211872358080091069402725399
const scVkey = (await FungibleToken.compile()).verificationKey;
Provable.log('FTS verification key: ', scVkey.hash);

// 28601859585317876844971055556684855811670354347630700621724962653324656992162
const vKey = (await program.compile()).verificationKey;
Provable.log('Program verification key: ', vKey.hash);

let vKeyMap = new VKeyMerkleMap();

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

// ----------------------------- Generate Dummy Dynamic Proof -----------------------------------------

const dynamicDummyProof = await generateDummyDynamicProof(
  token.deriveTokenId(),
  alexa
);

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
    Provable.log('mina token id: ', AccountUpdate.default(owner).tokenId);
    await token.mintWithProof(
      alexa,
      new UInt64(300),
      dynamicDummyProof,
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

// ----------------------- UPDATE MINT CONFIG::AUTHORIZED::FIXED::VERIFY --------------------------------
console.log('updating the mint config...');
const updateMintConfigTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.updateMintConfig(
      new MintConfig({
        unauthorized: Bool(false),
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
// ----------------------- UPDATE DYNAMIC PROOF CONFIG ----------------------------
let mintDynamicProofConfig = MintDynamicProofConfig.default;
mintDynamicProofConfig.shouldVerify = Bool(true);

const updateMintDynamicProofConfigTx = await Mina.transaction(
  { sender: alexa, fee },
  async () => {
    await token.updateDynamicProofConfig(
      OperationKeys.Mint,
      mintDynamicProofConfig
    );
  }
);
await updateMintDynamicProofConfigTx.prove();
await updateMintDynamicProofConfigTx
  .sign([alexa.key, admin.privateKey])
  .send()
  .wait();
// ----------------------- UPDATE SIDE-LOADED VKEY --------------------------------
console.log('updating the side-loaded vkey...');
const updateVkeyTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.updateSideLoadedVKeyHash(vKey, vKeyMap, OperationKeys.Mint);
  }
);
await updateVkeyTx.prove();
await updateVkeyTx.sign([alexa.key, admin.privateKey]).send().wait();
console.log(updateVkeyTx.toPretty().length, updateVkeyTx.toPretty());
vKeyMap.set(Field(1), vKey.hash);

// ----------------------------- Generate Dynamic Proof -----------------------------------------

const dynamicProof = await generateDynamicProof(token.deriveTokenId(), alexa);

// ----------------------- MINT IN RANGE::AUTHORIZED::ALEXA::VKEY --------------------------------

const alexaBalanceBeforeMint2 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance before mint2:', alexaBalanceBeforeMint2);
equal(alexaBalanceBeforeMint2, 300n);

console.log('Minting new tokens to Alexa.');
const mintTx2 = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    await token.mintWithProof(
      alexa,
      new UInt64(200),
      dynamicProof,
      vKey,
      vKeyMap
    );
  }
);
// console.log(mintTx.toPretty().length, mintTx.toPretty());
await mintTx2.prove();
mintTx2.sign([alexa.key, admin.privateKey]);
const mintTxResult2 = await mintTx2.send().then((v) => v.wait());
console.log(
  'Mint tx result:',
  mintTxResult2.toPretty().length,
  mintTxResult2.toPretty()
);

const alexaBalanceAfterMint2 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint2:', alexaBalanceAfterMint2);
equal(alexaBalanceAfterMint2, 500n);

// ----------------------- UPDATE DYNAMIC PROOF CONFIG::AUTHORIZED
//                         ::IGNORE::{requireMinaBalanceMatch, requireCustomTokenBalanceMatch, requireMinaNonceMatch} --------------------------------
const flexibleDynamicProofConfig = new MintDynamicProofConfig({
  shouldVerify: Bool(true),
  requireRecipientMatch: Bool(true),
  requireTokenIdMatch: Bool(true),
  requireMinaBalanceMatch: Bool(false),
  requireCustomTokenBalanceMatch: Bool(false),
  requireMinaNonceMatch: Bool(false),
  requireCustomTokenNonceMatch: Bool(true),
});

console.log('updating the dynamic proof config...');
const updateDynamicProofConfigTx = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    await token.updateDynamicProofConfig(
      OperationKeys.Mint,
      flexibleDynamicProofConfig
    );
  }
);
await updateDynamicProofConfigTx.prove();
await updateDynamicProofConfigTx
  .sign([owner.key, admin.privateKey])
  .send()
  .wait();
console.log(
  updateDynamicProofConfigTx.toPretty().length,
  updateDynamicProofConfigTx.toPretty()
);

// ----------------------- MINT IN RANGE::AUTHORIZED::ALEXA::VKEY::IGNORE BALANCE/NONCE --------------------------------
const alexaBalanceBeforeMint3 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance before mint3:', alexaBalanceBeforeMint3);
equal(alexaBalanceBeforeMint3, 500n);

console.log('Minting new tokens to Alexa.');
const mintTx3 = await Mina.transaction(
  {
    sender: owner,
    fee,
  },
  async () => {
    // the proof is being reused here!
    //! it would have failed if we didn't update the config to a more flexible one
    await token.mintWithProof(
      alexa,
      new UInt64(200),
      dynamicProof,
      vKey,
      vKeyMap
    );
  }
);
// console.log(mintTx.toPretty().length, mintTx.toPretty());
await mintTx3.prove();
mintTx3.sign([owner.key, admin.privateKey]);
const mintTxResult3 = await mintTx3.send().then((v) => v.wait());
console.log(
  'Mint tx result:',
  mintTxResult3.toPretty().length,
  mintTxResult3.toPretty()
);

const alexaBalanceAfterMint3 = (await token.getBalanceOf(alexa)).toBigInt();
console.log('Alexa balance after mint3:', alexaBalanceAfterMint3);
equal(alexaBalanceAfterMint3, 700n);
