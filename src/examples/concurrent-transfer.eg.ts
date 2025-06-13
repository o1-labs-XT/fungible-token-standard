import {
  AccountUpdate,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
  VerificationKey,
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
} from '../configs.js';
import {
  generateDummyDynamicProof,
  SideloadedProof,
} from '../side-loaded/program.eg.js';

const url = 'https://api.minascan.io/node/devnet/v1/graphql';
const fee = 1e8;

type KeyPair = { publicKey: PublicKey; privateKey: PrivateKey };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getInferredNonce(publicKey: string) {
  const query = `
  query {
    account(publicKey: "${publicKey}") {
      inferredNonce
    }
  }`;

  const json = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ operationName: null, query, variables: {} }),
    headers: { 'Content-Type': 'application/json' },
  }).then((v) => v.json());
  return Number(json.data.account.inferredNonce);
}

async function sendNoWait(
  feepayer: KeyPair,
  from: KeyPair,
  to: PublicKey,
  amount: number,
  payCreationFee: boolean
) {
  const nonce = await getInferredNonce(feepayer.publicKey.toBase58());
  console.log('feepayer nonce:', nonce);
  const transferTx = await Mina.transaction(
    {
      sender: feepayer.publicKey,
      fee,
      nonce,
    },
    async () => {
      if (payCreationFee) {
        AccountUpdate.fundNewAccount(feepayer.publicKey, 1);
      }
      await token.transferCustom(from.publicKey, to, new UInt64(amount));
    }
  );
  await transferTx.prove();

  transferTx.sign([from.privateKey, feepayer.privateKey]);
  const result = await transferTx.send();
  console.log('Transfer tx:', result.hash);

  // 3 sec for node to update nonce
  await sleep(3000);
}

Mina.setActiveInstance(Mina.Network(url));

const feePayerKey = PrivateKey.fromBase58(
  'EKE5nJtRFYVWqrCfdpqJqKKdt2Sskf5Co2q8CWJKEGSg71ZXzES7'
);
const [contract, feepayer, alexa, billy, jackie, admin] = [
  keypair(),
  {
    privateKey: feePayerKey,
    publicKey: feePayerKey.toPublicKey(),
  },
  keypair(),
  keypair(),
  keypair(),
  keypair(),
];

printKeyPairs({ alexa, billy, jackie, contract, admin, feepayer });

await FungibleToken.compile();
const token = new FungibleToken(contract.publicKey);

const vKeyMap = new VKeyMerkleMap();
const dummyVkey = await VerificationKey.dummy();
const dummyProof: SideloadedProof = await generateDummyDynamicProof(
  token.deriveTokenId(),
  alexa.publicKey
);

const mintParams = MintParams.create(MintConfig.default, {
  minAmount: UInt64.from(1),
  maxAmount: UInt64.from(100e9),
});
const burnParams = BurnParams.create(BurnConfig.default, {
  minAmount: UInt64.from(1),
  maxAmount: UInt64.from(100e9),
});

console.log('Deploying token contract.');
let nonce = await getInferredNonce(feepayer.publicKey.toBase58());
const deployTx = await Mina.transaction(
  {
    sender: feepayer.publicKey,
    fee,
    nonce,
  },
  async () => {
    AccountUpdate.fundNewAccount(feepayer.publicKey, 2);
    await token.deploy({
      symbol: 'DNB',
      src: 'https://github.com/o1-labs-XT/fungible-token-contract/blob/main/src/FungibleTokenContract.ts',
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
deployTx.sign([feepayer.privateKey, contract.privateKey, admin.privateKey]);
const deployTxResult = await deployTx.send().then((v) => v.wait());
console.log('Deploy tx:', deployTxResult.hash);

console.log('Minting new tokens to Alexa.');
const mintTx = await Mina.transaction(
  {
    sender: feepayer.publicKey,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(feepayer.publicKey, 2);
    await token.mint(alexa.publicKey, new UInt64(100e9));
  }
);
await mintTx.prove();
mintTx.sign([feepayer.privateKey, admin.privateKey]);
const mintTxResult = await mintTx.send();
console.log('Mint tx:', mintTxResult.hash);
await mintTxResult.wait();

console.log('[1] Transferring tokens from Alexa to Billy');
const transferTx1 = await Mina.transaction(
  {
    sender: feepayer.publicKey,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(feepayer.publicKey, 1);
    await token.transferCustom(
      alexa.publicKey,
      billy.publicKey,
      new UInt64(5e9)
    );
  }
);
await transferTx1.prove();
transferTx1.sign([alexa.privateKey, feepayer.privateKey]);
const transferTxResult1 = await transferTx1.send();
console.log('Transfer 1 tx:', transferTxResult1.hash);
await transferTxResult1.wait();

console.log('Transferring from Alexa and Billy to Jackie (concurrently)');
await sendNoWait(feepayer, alexa, jackie.publicKey, 1e9, true);
await sendNoWait(feepayer, billy, jackie.publicKey, 1e9, false);
await sendNoWait(feepayer, alexa, jackie.publicKey, 1e9, false);
await sendNoWait(feepayer, billy, jackie.publicKey, 1e9, false);
await sendNoWait(feepayer, alexa, jackie.publicKey, 1e9, false);
await sendNoWait(feepayer, billy, jackie.publicKey, 1e9, false);

function keypair(base58Key?: string): KeyPair {
  base58Key ??= PrivateKey.random().toBase58();
  let privateKey = PrivateKey.fromBase58(base58Key);
  return { publicKey: privateKey.toPublicKey(), privateKey };
}

function printKeyPairs(keyPairs: Record<string, KeyPair>) {
  for (let [name, keypair] of Object.entries(keyPairs)) {
    console.log(
      `${name} ${keypair.publicKey.toBase58()} ${keypair.privateKey.toBase58()}`
    );
  }
}
