import {
  SmartContract,
  state,
  State,
  method,
  Field,
  PublicKey,
  VerificationKey,
  DeployArgs,
  Permissions,
} from 'o1js';

import {
  EcdsaSideloadedProof,
  KeccakSideloadedProof,
} from './sideloaded-zkprograms.js';

export { SideloadedProofVerifierZkApp };

class SideloadedProofVerifierZkApp extends SmartContract {
  @state(PublicKey) contractOwner = State<PublicKey>();
  @state(Field) protectedValue = State<Field>();
  // Verification key hashes for side-loaded proofs
  @state(Field) ecdsaVerificationKeyHash = State<Field>();
  @state(Field) keccakVerificationKeyHash = State<Field>();

  async deploy(args: DeployArgs & { owner: PublicKey }) {
    await super.deploy(args);

    // Initialize contract state
    this.protectedValue.set(Field(333));
    this.contractOwner.set(args.owner);

    // Set default permissions
    this.account.permissions.set({
      ...Permissions.default(),
    });
  }

  /**
   * Updates the protected value after verifying both ECDSA and Keccak proofs
   */
  @method async updateValue(
    newProtectedValue: Field,
    ecdsaProof: EcdsaSideloadedProof,
    keccakProof: KeccakSideloadedProof,
    ecdsaVerificationKey: VerificationKey,
    keccakVerificationKey: VerificationKey
  ) {
    // Verify ECDSA verification key against stored hash
    const storedEcdsaKeyHash =
      this.ecdsaVerificationKeyHash.getAndRequireEquals();
    ecdsaVerificationKey.hash.assertEquals(storedEcdsaKeyHash);

    // Verify Keccak verification key against stored hash
    const storedKeccakKeyHash =
      this.keccakVerificationKeyHash.getAndRequireEquals();
    keccakVerificationKey.hash.assertEquals(storedKeccakKeyHash);

    // Verify ECDSA proof
    ecdsaProof.verify(ecdsaVerificationKey);
    ecdsaProof.publicOutput.isValid.assertTrue(
      'ECDSA signature verification failed'
    );

    // Get ECDSA proof's public key from output
    const signerPublicKey = ecdsaProof.publicOutput.publicKey;
    // TODO: You can use the signer's public key here for additional checks
    // For example: verify if the signer is authorized, maintain a list of trusted signers, etc.

    // Verify Keccak proof
    keccakProof.verify(keccakVerificationKey);
    keccakProof.publicOutput.isValid.assertTrue(
      'Keccak hash verification failed'
    );

    // Get Keccak proof's expected hash from input
    const expectedKeccakHash = keccakProof.publicInput.hash;
    // TODO: You can use the hash here for additional checks
    // For example: verify if the hash matches some expected value, store it for future reference, etc.

    // Update the protected value after all verifications pass
    this.protectedValue.set(newProtectedValue);
  }

  /**
   * Retrieves the current protected value
   */
  @method async getProtectedValue(): Promise<void> {
    this.protectedValue.getAndRequireEquals();
  }

  /**
   * Updates the verification key hashes for both ECDSA and Keccak proofs
   * Only callable by the contract owner
   */
  @method async updateVerificationKeys(
    newEcdsaVerificationKey: VerificationKey,
    newKeccakVerificationKey: VerificationKey
  ) {
    // Verify caller is the contract owner
    const currentOwner = this.contractOwner.getAndRequireEquals();
    const caller = this.sender.getAndRequireSignature();
    currentOwner.assertEquals(caller);

    // Update verification key hashes
    this.ecdsaVerificationKeyHash.set(newEcdsaVerificationKey.hash);
    this.keccakVerificationKeyHash.set(newKeccakVerificationKey.hash);
  }
}
