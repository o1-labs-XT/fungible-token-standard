import { equal } from 'node:assert';
import {
  Field,
  Mina,
  Bytes,
  Crypto,
  createEcdsa,
  createForeignCurve,
  Hash,
} from 'o1js';

import {
  EcdsaProgram,
  KeccakProgram,
  CounterProgram,
  generateEcdsaProof,
  generateKeccakProof,
  generateCounterProof,
} from './sideloaded-zkprograms.js';

import { MyFavoriteZkApp } from './sideloaded-verifier-zkapp.js';

/**
 * This example showcases the side-loaded proof verification functionality:
 * 1. Deploys a verifier contract that can verify ECDSA and Keccak proofs
 * 2. Generates and verifies an ECDSA signature proof
 * 3. Generates and verifies a Keccak hash preimage proof
 * 4. Updates contract state after successful verification
 */

// ---------------------------- Setup Local Blockchain ----------------------------
const localChain = await Mina.LocalBlockchain({
  proofsEnabled: false,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);
const fee = 1e8;

// Setup test accounts
const [deployer, zkAppPrivateKey, alice] = localChain.testAccounts;
const zkApp = new MyFavoriteZkApp(zkAppPrivateKey.key.toPublicKey());

// ---------------------------- Compile Programs ----------------------------
console.log('Compiling ZkPrograms and generating verification keys...');
const ecdsaVerificationKey = (await EcdsaProgram.compile()).verificationKey;
const keccakVerificationKey = (await KeccakProgram.compile()).verificationKey;
const counterVerificationKey = (await CounterProgram.compile()).verificationKey;
const verifierContractKey = (await MyFavoriteZkApp.compile()).verificationKey;

// Log verification key hashes for reference
console.log('ECDSA verification key hash:', ecdsaVerificationKey.hash.toBigInt());
console.log('Keccak verification key hash:', keccakVerificationKey.hash.toBigInt());
console.log('Counter verification key hash:', counterVerificationKey.hash.toBigInt());
console.log('MyFavoriteZkApp verification key hash:', verifierContractKey.hash.toBigInt());

// Log addresses for reference
console.log('Deployer Address:', deployer.toBase58());
console.log('Deployer Address as Field:', deployer.toFields()[0].toBigInt());
console.log('MyFavoriteZkApp Address:', zkAppPrivateKey.key.toPublicKey().toBase58());
console.log(
  'MyFavoriteZkApp Address as Field:',
  zkAppPrivateKey.key.toPublicKey().toFields()[0].toBigInt()
);
console.log('Alice Address:', alice.toBase58());
console.log('Alice Address as Field:', alice.toFields()[0].toBigInt());

// ---------------------------- Deploy MyFavoriteZkApp ----------------------------
console.log('Deploying the verifier contract...');
const deployTx = await Mina.transaction({ sender: deployer, fee }, async () => {
  await zkApp.deploy({ owner: deployer });
});
await deployTx.prove();
await deployTx.sign([deployer.key, zkAppPrivateKey.key]).send();
console.log('Contract deployed successfully');

// ---------------------------- Generate ECDSA Proof ----------------------------
console.log('Setting up ECDSA signature');
// Setup Secp256k1 curve and ECDSA implementation
class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}
class Ecdsa extends createEcdsa(Secp256k1) {}

// Generate key pair and sign a message
const signerPrivateKey = Secp256k1.Scalar.random();
const signerPublicKey = Secp256k1.generator.scale(signerPrivateKey);

const messageToSign = 'Hello, Mina!';
const messageBytes = Bytes(32).fromString(messageToSign);
const signature = Ecdsa.sign(
  messageBytes.toBytes(),
  signerPrivateKey.toBigInt()
);

// Generate proof of valid signature
console.log('Generating ECDSA proof...');
const ecdsaProof = await generateEcdsaProof(
  messageBytes,
  signerPublicKey,
  signature
);

// ---------------------------- Generate Keccak Proof ----------------------------
console.log('Generating Keccak preimage hash proof...');
const secretPreimage = 'Secret value';
const preimageBytes = Bytes(32).fromString(secretPreimage);
const preimageHash = Hash.Keccak256.hash(preimageBytes);
const keccakProof = await generateKeccakProof(preimageHash, preimageBytes);

// ---------------------------- Setup Verification Keys ----------------------------
console.log('Setting up verification keys in the contract...');
const setupVkTx = await Mina.transaction(
  { sender: deployer, fee },
  async () => {
    await zkApp.updateVerificationKeys(
      ecdsaVerificationKey,
      keccakVerificationKey
    );
  }
);
await setupVkTx.prove();
await setupVkTx.sign([deployer.key]).send();

// ---------------------------- Read Initial State ----------------------------
console.log('Reading initial contract state...');
const initialValue = await zkApp.protectedValue.get();
console.log('Initial protected value:', initialValue.toBigInt());

// ---------------------------- Update Contract State ----------------------------
console.log('Updating contract state with verified proofs...');
const newProtectedValue = Field(555);

const updateTx = await Mina.transaction({ sender: deployer, fee }, async () => {
  await zkApp.updateValue(
    newProtectedValue,
    ecdsaProof,
    keccakProof,
    ecdsaVerificationKey,
    keccakVerificationKey
  );
});
await updateTx.prove();
const updateTxResult = await updateTx.sign([deployer.key]).send().then((v) => v.wait());
equal(updateTxResult.status, 'included');

// ---------------------------- Read Updated State ----------------------------
console.log('Reading updated contract state...');
const updatedValue = await zkApp.protectedValue.get();
console.log('Updated protected value:', updatedValue.toBigInt());
equal(updatedValue.toBigInt(), BigInt(555), 'Protected value should be updated to 555');
