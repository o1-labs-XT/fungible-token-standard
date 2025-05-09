/**
 * This module demonstrates the use of side-loaded verification keys in o1js,
 * a powerful feature that enables dynamic verification of proofs without requiring
 * the verification keys to be hardcoded into the circuit.
 *
 * Side-loading allows zkApps to:
 * 1. Verify proofs from different circuits without recompilation
 * 2. Update which proofs they accept without deploying new contracts
 * 3. Create more flexible and modular zero-knowledge applications
 *
 * The module includes three example programs:
 * - ECDSA signature verification
 * - Keccak hash preimage verification
 * - Simple counter increment
 *
 * Each program demonstrates how to:
 * 1. Define a ZkProgram for proof generation
 * 2. Create a DynamicProof subclass for side-loading
 * 3. Provide helper functions for proof generation
 *
 * NOTE: In the case of DynamicProofs, the circuit makes no assertions about the
 * verificationKey used on its own. This is the responsibility of the application
 * developer and should always implement appropriate checks. This pattern differs
 * a lot from the usage of normal Proof, where the verification key is baked into
 * the compiled circuit.
 */

import {
  Field,
  Bytes,
  Hash,
  Struct,
  ZkProgram,
  Bool,
  DynamicProof,
  Crypto,
  createForeignCurve,
  createEcdsa,
  Provable,
  UInt8,
  FeatureFlags,
} from 'o1js';

export {
  EcdsaProgram,
  KeccakProgram,
  CounterProgram,
  generateEcdsaProof,
  generateKeccakProof,
  generateCounterProof,
  EcdsaSideloadedProof,
  KeccakSideloadedProof,
  CounterSideloadedProof,
};

/**
 * Secp256k1 curve implementation for ECDSA operations
 */
class Secp256k1 extends createForeignCurve(Crypto.CurveParams.Secp256k1) {}

/**
 * ECDSA implementation using Secp256k1 curve
 */
class Ecdsa extends createEcdsa(Secp256k1) {}

/**
 * Input structure for ECDSA verification
 * @property message - 32-byte message that was signed
 * @property publicKey - Secp256k1 public key of the signer
 * @property signature - ECDSA signature to verify
 */
class EcdsaPublicInput extends Struct({
  message: Bytes(32),
  publicKey: Secp256k1,
  signature: Ecdsa,
}) {}

/**
 * Output structure for ECDSA verification
 * @property isValid - Boolean indicating if signature is valid
 * @property publicKey - Public key used in verification
 */
class EcdsaPublicOutput extends Struct({
  isValid: Bool,
  publicKey: Secp256k1,
}) {}

/**
 * Input structure for Keccak hash verification
 * @property hash - 32-byte Keccak hash to verify against
 */
class KeccakPublicInput extends Struct({
  hash: Bytes(32),
}) {}

/**
 * Output structure for Keccak hash verification
 * @property isValid - Boolean indicating if preimage matches hash
 */
class KeccakPublicOutput extends Struct({
  isValid: Bool,
}) {}

/**
 * ZkProgram for verifying ECDSA signatures
 * This program takes a message, public key and signature as input
 * and verifies the signature's validity
 */
const EcdsaProgram = ZkProgram({
  name: 'ecdsa-verify',
  publicInput: EcdsaPublicInput,
  publicOutput: EcdsaPublicOutput,
  methods: {
    verify: {
      privateInputs: [],
      async method(publicInput: EcdsaPublicInput) {
        const { message, publicKey, signature } = publicInput;
        const isValid = signature.verify(message, publicKey);
        return {
          publicOutput: new EcdsaPublicOutput({
            isValid,
            publicKey,
          }),
        };
      },
    },
  },
});

/**
 * ZkProgram for verifying Keccak hash preimages
 * This program takes a hash and preimage as input and verifies
 * that the preimage hashes to the expected value
 */
const KeccakProgram = ZkProgram({
  name: 'keccak-preimage',
  publicInput: KeccakPublicInput,
  publicOutput: KeccakPublicOutput,
  methods: {
    verifyPreimage: {
      privateInputs: [Bytes(32)],
      async method(publicInput: KeccakPublicInput, preimage: Bytes) {
        const computedHash = Hash.Keccak256.hash(preimage);

        // Convert both hashes to provable arrays for comparison
        const expectedBytes = Provable.Array(UInt8, 32).empty();
        const computedBytes = Provable.Array(UInt8, 32).empty();

        // Fill arrays with hash bytes
        for (let i = 0; i < 32; i++) {
          expectedBytes[i] = publicInput.hash.bytes[i];
          computedBytes[i] = computedHash.bytes[i];
        }

        // Compare all bytes
        let isValid = Bool(true);
        for (let i = 0; i < 32; i++) {
          expectedBytes[i].assertEquals(computedBytes[i]);
        }

        return {
          publicOutput: new KeccakPublicOutput({
            isValid,
          }),
        };
      },
    },
  },
});

/**
 * Simple counter program that increments a Field value
 * Used as a basic example of side-loaded proof verification
 */
const CounterProgram = ZkProgram({
  name: 'counter',
  publicInput: Field,
  publicOutput: Field,
  methods: {
    baseCase: {
      privateInputs: [],
      async method(publicInput: Field) {
        return {
          publicOutput: publicInput.add(Field.from(1)),
        };
      },
    },
  },
});

/**
 * DynamicProof subclass for Counter program
 * Enables side-loaded verification of counter increment proofs
 */
class CounterSideloadedProof extends DynamicProof<Field, Field> {
  static publicInputType = Field;
  static publicOutputType = Field;
  static maxProofsVerified = 0 as const;
  static featureFlags = FeatureFlags.allMaybe;
}

/**
 * DynamicProof subclass for ECDSA verification
 * Enables side-loaded verification of ECDSA signature proofs
 */
class EcdsaSideloadedProof extends DynamicProof<
  EcdsaPublicInput,
  EcdsaPublicOutput
> {
  static publicInputType = EcdsaPublicInput;
  static publicOutputType = EcdsaPublicOutput;
  static maxProofsVerified = 0 as const;
  static featureFlags = FeatureFlags.allMaybe;
}

/**
 * DynamicProof subclass for Keccak hash verification
 * Enables side-loaded verification of Keccak preimage proofs
 */
class KeccakSideloadedProof extends DynamicProof<
  KeccakPublicInput,
  KeccakPublicOutput
> {
  static publicInputType = KeccakPublicInput;
  static publicOutputType = KeccakPublicOutput;
  static maxProofsVerified = 0 as const;
  static featureFlags = FeatureFlags.allMaybe;
}

/**
 * Generates a proof of ECDSA signature verification
 * @param message - The message that was signed
 * @param publicKey - The signer's public key
 * @param signature - The ECDSA signature to verify
 * @returns A DynamicProof that can be side-loaded and verified
 */
async function generateEcdsaProof(
  message: Bytes,
  publicKey: Secp256k1,
  signature: Ecdsa
) {
  const input = new EcdsaPublicInput({
    message,
    publicKey,
    signature,
  });
  const proof = (await EcdsaProgram.verify(input)).proof;
  const dynamicProof = EcdsaSideloadedProof.fromProof(proof);

  return dynamicProof;
}

/**
 * Generates a proof of Keccak hash preimage verification
 * @param expectedHash - The hash to verify against
 * @param preimage - The preimage that should hash to expectedHash
 * @returns A DynamicProof that can be side-loaded and verified
 */
async function generateKeccakProof(expectedHash: Bytes, preimage: Bytes) {
  const input = new KeccakPublicInput({
    hash: expectedHash,
  });

  const proof = (await KeccakProgram.verifyPreimage(input, preimage)).proof;
  const dynamicProof = KeccakSideloadedProof.fromProof(proof);

  return dynamicProof;
}

/**
 * Generates a proof of counter increment
 * @param value - The Field value to increment
 * @returns A DynamicProof that can be side-loaded and verified
 */
async function generateCounterProof(value: Field) {
  const proof = (await CounterProgram.baseCase(value)).proof;
  const dynamicProof = CounterSideloadedProof.fromProof(proof);

  return dynamicProof;
}
