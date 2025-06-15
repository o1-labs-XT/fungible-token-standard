import {
  Field,
  ZkProgram,
  Struct,
  Bool,
  Bytes,
  Hash,
  SmartContract,
  method,
  Permissions,
  DeployArgs,
  Crypto,
  createForeignCurve,
  createEcdsa,
  PublicKey,
  State,
  state,
  UInt64,
  AccountUpdate,
  Mina,
  PrivateKey,
  UInt8,
} from 'o1js';
import { FungibleToken } from '../FungibleTokenStandard.js';
import {
  BurnConfig,
  BurnDynamicProofConfig,
  BurnParams,
  MintConfig,
  MintDynamicProofConfig,
  MintParams,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
} from '../configs.js';
import { equal } from 'node:assert';

// ECDSA curve setup
export class Secp256k1 extends createForeignCurve(
  Crypto.CurveParams.Secp256k1
) {}
export class Ecdsa extends createEcdsa(Secp256k1) {}

/**
 * Public input for the combined ECDSA and Keccak verification ZkProgram.
 */
export class EcdsaAndKeccakProgramPublicInput extends Struct({
  signature: Ecdsa,
  publicKey: Secp256k1,
  message: Bytes(32),
  expectedKeccakHash: Bytes(32),
}) {}

/**
 * Public output for the combined verification ZkProgram.
 */
export class EcdsaAndKeccakProgramPublicOutput extends Struct({
  isValid: Bool,
}) {}

/**
 * ZkProgram that verifies both ECDSA signatures and Keccak hash preimages.
 */
export const EcdsaAndKeccakProgram = ZkProgram({
  name: 'ecdsa-keccak-verification',
  publicInput: EcdsaAndKeccakProgramPublicInput,
  publicOutput: EcdsaAndKeccakProgramPublicOutput,

  methods: {
    verifyEcdsaAndKeccak: {
      privateInputs: [Bytes(32)],
      async method(
        publicInput: EcdsaAndKeccakProgramPublicInput,
        keccakPreimage: Bytes
      ) {
        // Verify ECDSA signature
        const isEcdsaSignatureValid = publicInput.signature.verify(
          publicInput.message,
          publicInput.publicKey
        );

        // Verify Keccak hash preimage
        const computedKeccakHash = Hash.Keccak256.hash(keccakPreimage);
        for (let i = 0; i < 32; i++) {
          const expectedByte = publicInput.expectedKeccakHash.bytes[i];
          const computedByte = computedKeccakHash.bytes[i];
          expectedByte.assertEquals(
            computedByte,
            `Keccak byte mismatch at index ${i}`
          );
        }

        return {
          publicOutput: new EcdsaAndKeccakProgramPublicOutput({
            isValid: isEcdsaSignatureValid,
          }),
        };
      },
    },
  },
});

export class EcdsaAndKeccakProof extends ZkProgram.Proof(
  EcdsaAndKeccakProgram
) {}

/**
 * A SmartContract that verifies cryptographic proofs (ECDSA, Keccak)
 * as a condition for authorizing token operations.
 */
export class TokenManager extends SmartContract {
  @state(PublicKey) tokenAddress = State<PublicKey>();

  async deploy(args: DeployArgs & { tokenAddress: PublicKey }) {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      send: Permissions.proof(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
    });

    this.tokenAddress.set(args.tokenAddress);
  }

  @method
  async withdrawTokens(amount: UInt64, combinedProof: EcdsaAndKeccakProof) {
    combinedProof.verify();
    combinedProof.publicOutput.isValid.assertTrue(
      'ECDSA and Keccak verification failed'
    );

    const token = new FungibleToken(this.tokenAddress.getAndRequireEquals());
    const sender = this.sender.getUnconstrained();

    await token.transferCustom(this.address, sender, amount);
  }
}

// Set up local blockchain
const localChain = await Mina.LocalBlockchain({
  proofsEnabled: false,
  enforceTransactionLimits: false,
});
Mina.setActiveInstance(localChain);
const fee = 1e8;

// Test accounts and contract setup
const [deployer, alexa] = localChain.testAccounts;
const tokenContractKeyPair = PrivateKey.randomKeypair();
const managerContractKeyPair = PrivateKey.randomKeypair();
const tokenContractAddress = tokenContractKeyPair.publicKey;
const managerContractAddress = managerContractKeyPair.publicKey;

console.log(`
Deployer Public Key: ${deployer.toBase58()}
Alexa Public Key: ${alexa.toBase58()}
TokenContract Public Key: ${tokenContractAddress.toBase58()}
ManagerContract Public Key: ${managerContractAddress.toBase58()}
`);

console.log('Compiling contracts...');
await EcdsaAndKeccakProgram.compile();
await FungibleToken.compile();
await TokenManager.compile();

console.log('Deploying Fungible Token Contract');
const tokenContract = new FungibleToken(tokenContractAddress);

const deployTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 2);
    await tokenContract.deploy({
      symbol: 'TKN',
      src: 'https://github.com/o1-labs-XT/fungible-token-standard/blob/main/src/NewTokenStandard.ts',
    });

    await tokenContract.initialize(
      managerContractAddress,
      UInt8.from(9),
      MintConfig.default,
      new MintParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(20),
        maxAmount: UInt64.MAXINT(),
      }),
      BurnConfig.default,
      new BurnParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(20),
        maxAmount: UInt64.MAXINT(),
      }),
      MintDynamicProofConfig.default,
      BurnDynamicProofConfig.default,
      TransferDynamicProofConfig.default,
      UpdatesDynamicProofConfig.default
    );
  }
);

deployTx.sign([deployer.key, tokenContractKeyPair.privateKey]);
await deployTx.prove();
const deployTxResult = await deployTx.send().then((v) => v.wait());
console.log(
  'Fungible Token Contract Deployment TX Result:',
  deployTxResult.toPretty()
);
equal(deployTxResult.status, 'included');

console.log('Deploying Token Manager Contract');
const managerContract = new TokenManager(managerContractAddress);
const deployManagerTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await managerContract.deploy({ tokenAddress: tokenContractAddress });
  }
);

deployManagerTx.sign([deployer.key, managerContractKeyPair.privateKey]);
await deployManagerTx.prove();
const deployManagerTxResult = await deployManagerTx
  .send()
  .then((v) => v.wait());
console.log(
  'Token Manager Contract Deployment TX Result:',
  deployManagerTxResult.toPretty()
);
equal(deployManagerTxResult.status, 'included');

const managerAfterInit = tokenContract.admin.getAndRequireEquals();
equal(
  managerAfterInit.toBase58(),
  managerContractAddress.toBase58(),
  'Token Manager was not set as admin during token initialization.'
);

console.log('Minting initial tokens to Token Manager.');
const initialMintAmount = UInt64.MAXINT();
const managerBalanceBeforeMint = await tokenContract.getBalanceOf(
  managerContractAddress
);
console.log(
  'Manager balance before mint:',
  managerBalanceBeforeMint.toBigInt()
);

const mintTx = await Mina.transaction(
  {
    sender: deployer,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(deployer, 1);
    await tokenContract.mint(managerContractAddress, initialMintAmount);
  }
);

mintTx.sign([deployer.key, managerContractKeyPair.privateKey]);
await mintTx.prove();
const mintTxResult = await mintTx.send().then((v) => v.wait());
console.log('Mint tx result:', mintTxResult.toPretty());
equal(mintTxResult.status, 'included');

const managerBalanceAfterMint = await tokenContract.getBalanceOf(
  managerContractAddress
);
console.log('Manager balance after mint:', managerBalanceAfterMint.toBigInt());
equal(
  managerBalanceAfterMint.toBigInt(),
  initialMintAmount.toBigInt(),
  'Manager balance after mint is incorrect.'
);

console.log('Alexa withdraws tokens by providing proofs.');
const withdrawalAmount = UInt64.from(50);

// Prepare ECDSA signature
const alexaSecp256k1PrivateKey = Secp256k1.Scalar.random();
const alexaSecp256k1PublicKey = Secp256k1.generator.scale(
  alexaSecp256k1PrivateKey
);

const ecdsaMessage = 'Hello World!';
const ecdsaMessageBytes = Bytes(32).fromString(ecdsaMessage);

const alexaEcdsaSignature = Ecdsa.sign(
  ecdsaMessageBytes.toBytes(),
  alexaSecp256k1PrivateKey.toBigInt()
);
console.log('ECDSA signature prepared');

// Prepare Keccak hash verification
const keccakPreimageString = 'Alice and Bob...';
const keccakPreimage = Bytes(32).fromString(keccakPreimageString);
const expectedKeccakHash = Hash.Keccak256.hash(keccakPreimage);
console.log('Keccak preimage prepared');

// Generate combined proof
const combinedProofInput = new EcdsaAndKeccakProgramPublicInput({
  signature: alexaEcdsaSignature,
  publicKey: alexaSecp256k1PublicKey,
  message: ecdsaMessageBytes,
  expectedKeccakHash: expectedKeccakHash,
});

const ecdsaAndKeccakResult = await EcdsaAndKeccakProgram.verifyEcdsaAndKeccak(
  combinedProofInput,
  keccakPreimage
);
const alexaCombinedProof = ecdsaAndKeccakResult.proof;
console.log('Combined ECDSA and Keccak proof generated');

const alexaBalanceBeforeWithdraw = await tokenContract.getBalanceOf(alexa);
console.log(
  'Alexa balance before withdrawal:',
  alexaBalanceBeforeWithdraw.toBigInt()
);

const managerBalanceBeforeWithdraw = await tokenContract.getBalanceOf(
  managerContractAddress
);
console.log(
  'Manager balance before withdrawal:',
  managerBalanceBeforeWithdraw.toBigInt()
);

const withdrawTx = await Mina.transaction(
  {
    sender: alexa,
    fee,
  },
  async () => {
    AccountUpdate.fundNewAccount(alexa);
    await managerContract.withdrawTokens(withdrawalAmount, alexaCombinedProof);
  }
);

withdrawTx.sign([alexa.key, managerContractKeyPair.privateKey]);
await withdrawTx.prove();
const withdrawTxResult = await withdrawTx.send().then((v) => v.wait());
console.log('Withdraw tx result:', withdrawTxResult.toPretty());
equal(withdrawTxResult.status, 'included');

const alexaBalanceAfterWithdraw = await tokenContract.getBalanceOf(alexa);
console.log(
  'Alexa balance after withdrawal:',
  alexaBalanceAfterWithdraw.toBigInt()
);
const managerBalanceAfterWithdraw = await tokenContract.getBalanceOf(
  managerContractAddress
);
console.log(
  'Manager balance after withdrawal:',
  managerBalanceAfterWithdraw.toBigInt()
);

equal(
  alexaBalanceAfterWithdraw.toBigInt(),
  withdrawalAmount.toBigInt(),
  'Alexa balance after withdrawal is incorrect.'
);
equal(
  managerBalanceAfterWithdraw.toBigInt(),
  managerBalanceBeforeWithdraw.toBigInt() - withdrawalAmount.toBigInt(),
  'Manager balance after withdrawal is incorrect.'
);
