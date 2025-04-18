import { Bool, Field, Struct, UInt64 } from 'o1js';

export {
  MintConfig,
  BurnConfig,
  MintParams,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
};

/**
 * `MintConfig` defines the permission and constraint settings for minting tokens.
 *
 * This configuration determines whether a minting operation:
 * - requires authorization,
 * - allows minting a fixed amount, or
 * - supports minting a variable amount within a specified range.
 *
 * @property unauthorized - If true, disables the admin signature requirement, allowing any user to mint.
 * @property fixedAmount - If true, restricts minting to a fixed, predetermined amount (e.g., 200 tokens).
 * @property rangedAmount - If true, allows minting a variable amount within a specified range.
 */
class MintConfig extends Struct({
  unauthorized: Bool,
  fixedAmount: Bool,
  rangedAmount: Bool,
}) {
  /**
   * The default mint configuration.
   *
   * By default:
   * - Authorization is required (`unauthorized = false`)
   * - Fixed amount minting is disabled
   * - Ranged amount minting is enabled
   */
  static default = new this({
    unauthorized: Bool(false),
    fixedAmount: Bool(false),
    rangedAmount: Bool(true),
  });

  /**
   * Unpacks the `packedConfigs` field and returns only the `MintConfig` portion.
   *
   * The input `Field` is expected to encode both mint and burn configurations:
   * - Bits 0–2: represent the mint configuration (`unauthorized`, `fixedAmount`, `rangedAmount`)
   * - Bits 3–5: represent the burn configuration (ignored in this method)
   *
   * @param packedConfigs - A 6-bit `Field` containing both mint and burn configurations.
   * @returns A `MintConfig` instance constructed from the first 3 bits of the field.
   */
  static unpack(packedConfigs: Field) {
    const serializedMintConfig = packedConfigs.toBits(6).slice(0, 3);
    const [unauthorized, fixedAmount, rangedAmount] = serializedMintConfig;

    return new this({
      unauthorized,
      fixedAmount,
      rangedAmount,
    });
  }

  /**
   * Serializes the mint configuration into an array of 3 boolean bits.
   *
   * @returns An array of `Bool` bits representing this configuration.
   */
  toBits() {
    const { unauthorized, fixedAmount, rangedAmount } = this;

    const serializedMintConfig = [
      unauthorized.toField().toBits(1),
      fixedAmount.toField().toBits(1),
      rangedAmount.toField().toBits(1),
    ].flat();

    return serializedMintConfig;
  }

  /**
   * Updates the `packedConfigs` (containing both mint and burn configs)
   * by replacing the first 3 bits (mint config) with the bits from this instance.
   *
   * The last 3 bits (burn config) are preserved.
   *
   * @param packedConfigs - A `Field` containing both mint and burn configuration bits.
   * @returns A new `Field` with updated mint config and preserved burn config.
   */
  updatePackedConfigs(packedConfigs: Field) {
    const serializedConfigs = packedConfigs.toBits(6);
    const serializedMintConfig = this.toBits();

    const updatedPackedConfigs = Field.fromBits([
      ...serializedMintConfig,
      ...serializedConfigs.slice(3, 6),
    ]);

    return updatedPackedConfigs;
  }

  /**
   * Packs this mint configuration together with a provided burn configuration
   * into a single 6-bit `Field`.
   *
   * The first 3 bits represent the mint config, and the last 3 bits represent the burn config.
   *
   * @param burnConfig - The burn configuration to combine with this mint config.
   * @returns A packed `Field` containing both configs.
   */
  packConfigs(burnConfig: BurnConfig): Field {
    return Field.fromBits([...this.toBits(), ...burnConfig.toBits()]);
  }

  /**
   * Validates that exactly one minting mode is enabled—either fixed or ranged.
   *
   * @throws If both or neither `fixedAmount` and `rangedAmount` are enabled.
   */
  validate() {
    const { fixedAmount, rangedAmount } = this;
    fixedAmount
      .toField()
      .add(rangedAmount.toField())
      .assertEquals(
        1,
        'Exactly one of the fixed or ranged amount options must be enabled!'
      );
  }
}

/**
 * `BurnConfig` defines the permission and constraint settings for burning tokens.
 *
 * This configuration determines whether a burn operation:
 * - requires authorization,
 * - is restricted to a fixed amount, or
 * - supports a variable amount within a defined range.
 *
 * @property unauthorized - If true, disables the admin signature requirement, allowing any user to burn.
 * @property fixedAmount - If true, restricts burning to a fixed, predetermined amount (e.g., 200 tokens).
 * @property rangedAmount - If true, allows burning a variable amount within a specified range.
 */
class BurnConfig extends Struct({
  unauthorized: Bool,
  fixedAmount: Bool,
  rangedAmount: Bool,
}) {
  /**
   * The default burn configuration.
   *
   * By default:
   * - Authorization is not required (`unauthorized = true`)
   * - Fixed amount burning is disabled
   * - Ranged amount burning is enabled
   */
  static default = new this({
    unauthorized: Bool(true),
    fixedAmount: Bool(false),
    rangedAmount: Bool(true),
  });

  /**
   * Unpacks the `packedConfigs` field and returns only the `BurnConfig` portion.
   *
   * The input `Field` is expected to contain both mint and burn configurations:
   * - Bits 0–2: represent the mint config (ignored here)
   * - Bits 3–5: represent the burn config (`unauthorized`, `fixedAmount`, `rangedAmount`)
   *
   * @param packedConfigs - A `Field` containing 6 bits: 3 for mint config and 3 for burn config.
   * @returns A `BurnConfig` instance constructed from bits 3–5.
   */
  static unpack(packedConfigs: Field) {
    const serializedBurnConfig = packedConfigs.toBits(6).slice(3, 6);
    const [unauthorized, fixedAmount, rangedAmount] = serializedBurnConfig;

    return new this({
      unauthorized,
      fixedAmount,
      rangedAmount,
    });
  }

  /**
   * Serializes the burn configuration into an array of 3 `Bool` bits.
   *
   * @returns An array of bits representing the configuration.
   */
  toBits() {
    const { unauthorized, fixedAmount, rangedAmount } = this;

    const serializedAmountConfig = [
      unauthorized.toField().toBits(1),
      fixedAmount.toField().toBits(1),
      rangedAmount.toField().toBits(1),
    ].flat();

    return serializedAmountConfig;
  }

  /**
   * Updates the `packedConfigs` (containing both mint and burn configs)
   * by replacing the last 3 bits (mint config) with the bits from this instance.
   *
   * The first 3 bits (mint config) are preserved.
   *
   * @param packedConfigs - A `Field` containing both mint and burn configuration bits.
   * @returns A new `Field` with updated burn config and preserved mint config.
   */
  updatePackedConfigs(packedConfigs: Field) {
    const serializedConfigs = packedConfigs.toBits(6);
    const serializedBurnConfig = this.toBits();

    const updatedPackedConfigs = Field.fromBits([
      ...serializedConfigs.slice(0, 3),
      ...serializedBurnConfig,
    ]);

    return updatedPackedConfigs;
  }

  /**
   * Validates that exactly one burn mode is enabled—either fixed or ranged.
   *
   * @throws If both or neither `fixedAmount` and `rangedAmount` are enabled.
   */
  validate() {
    const { fixedAmount, rangedAmount } = this;
    fixedAmount
      .toField()
      .add(rangedAmount.toField())
      .assertEquals(
        1,
        'Exactly one of the fixed or ranged amount options must be enabled!'
      );
  }

  /**
   * Packs this burn configuration together with a provided mint configuration
   * into a single 6-bit `Field`.
   *
   * The first 3 bits represent the mint config, and the last 3 bits represent the burn config.
   *
   * @param mintConfig - The `MintConfig` instance to pack alongside this `BurnConfig`.
   * @returns A packed `Field` containing both mint and burn configs.
   */
  packConfigs(mintConfig: BurnConfig): Field {
    return Field.fromBits([...mintConfig.toBits(), ...this.toBits()]);
  }
}

/**
 * MintParams defines the parameters for token minting.
 *
 * @property fixedAmount - The fixed amount of tokens to mint, if applicable.
 * @property minAmount - The minimum number of tokens that can be minted in a ranged mint.
 * @property maxAmount - The maximum number of tokens that can be minted in a ranged mint.
 */
class MintParams extends Struct({
  fixedAmount: UInt64,
  minAmount: UInt64,
  maxAmount: UInt64,
}) {
  /**
   * Unpacks a Field value into a MintParams instance.
   *
   * The packed Field is expected to be composed of three concatenated 64-bit segments representing:
   * - fixedAmount,
   * - minAmount, and
   * - maxAmount.
   *
   * Each segment is converted back into a UInt64 value.
   *
   * @param packedMintParams - The packed mint parameters as a Field.
   * @returns A new MintParams instance with the unpacked fixed, minimum, and maximum amounts.
   */
  static unpack(packedMintParams: Field) {
    const serializedMintParams = packedMintParams.toBits(64 * 3);

    const fixedAmount = UInt64.fromBits(serializedMintParams.slice(0, 64));
    const minAmount = UInt64.fromBits(serializedMintParams.slice(64, 64 * 2));
    const maxAmount = UInt64.fromBits(
      serializedMintParams.slice(64 * 2, 64 * 3)
    );

    return new this({
      fixedAmount,
      minAmount,
      maxAmount,
    });
  }

  /**
   * Packs the mint parameters into a single Field value.
   *
   * Each mint parameter (fixedAmount, minAmount, and maxAmount) is converted into a 64-bit representation,
   * concatenated, and then assembled into one Field.
   *
   * @param mintParams - The mint parameters to pack.
   * @returns The packed mint parameters as a Field.
   */
  pack() {
    const { fixedAmount, minAmount, maxAmount } = this;
    const serializedMintParams = [
      fixedAmount.toBits(),
      minAmount.toBits(),
      maxAmount.toBits(),
    ].flat();

    const packedMintParams = Field.fromBits(serializedMintParams);

    return packedMintParams;
  }

  /**
   * Validates that the minting range is correctly configured by asserting that
   * `minAmount` is less than `maxAmount`.
   *
   * @throws If `minAmount` is not less than `maxAmount`.
   */
  validate() {
    const { minAmount, maxAmount } = this;
    minAmount.assertLessThan(maxAmount, 'Invalid mint range!');
  }
}

/**
 * MintParams defines the parameters for token minting.
 *
 * @property fixedAmount - The fixed amount of tokens to burn, if applicable.
 * @property minAmount - The minimum number of tokens that can be burned in a ranged mint.
 * @property maxAmount - The maximum number of tokens that can be burned in a ranged mint.
 */
class BurnParams extends Struct({
  fixedAmount: UInt64,
  minAmount: UInt64,
  maxAmount: UInt64,
}) {
  /**
   * Unpacks a Field value into a BurnParams instance.
   *
   * The packed Field is expected to be composed of three concatenated 64-bit segments representing:
   * - fixedAmount,
   * - minAmount, and
   * - maxAmount.
   *
   * Each segment is converted back into a UInt64 value.
   *
   * @param packedBurnParams - The packed burn parameters as a Field.
   * @returns A new BurnParams instance with the unpacked fixed, minimum, and maximum amounts.
   */
  static unpack(packedBurnParams: Field) {
    const serializedBurnParams = packedBurnParams.toBits(64 * 3);

    const fixedAmount = UInt64.fromBits(serializedBurnParams.slice(0, 64));
    const minAmount = UInt64.fromBits(serializedBurnParams.slice(64, 64 * 2));
    const maxAmount = UInt64.fromBits(
      serializedBurnParams.slice(64 * 2, 64 * 3)
    );

    return new this({
      fixedAmount,
      minAmount,
      maxAmount,
    });
  }

  /**
   * Packs the burn parameters into a single Field value.
   *
   * Each burn parameter (fixedAmount, minAmount, and maxAmount) is converted into a 64-bit representation,
   * concatenated, and then assembled into one Field.
   *
   * @param burnParams - The burn parameters to pack.
   * @returns The packed burn parameters as a Field.
   */
  pack() {
    const { fixedAmount, minAmount, maxAmount } = this;
    const serializedBurnParams = [
      fixedAmount.toBits(),
      minAmount.toBits(),
      maxAmount.toBits(),
    ].flat();

    const packedBurnParams = Field.fromBits(serializedBurnParams);

    return packedBurnParams;
  }

  /**
   * Validates that the burn range is correctly configured by asserting that
   * `minAmount` is less than `maxAmount`.
   *
   * @throws If `minAmount` is not less than `maxAmount`.
   */
  validate() {
    const { minAmount, maxAmount } = this;
    minAmount.assertLessThan(maxAmount, 'Invalid burn range!');
  }
}

/**
 * `MintDynamicProofConfig` defines constraints for verifying side-loaded proofs during mint operations.
 *
 * This configuration dictates whether some checks are enforced and various elements captured during proof generation
 * must match the corresponding values at verification time.
 *
 * @property shouldVerify - When true, a side-loaded proof is verified during the process.
 * @property requireTokenIdMatch - Enforces that the token ID in the public input must match the token ID in the public output.
 * @property requireMinaBalanceMatch - Enforces that the MINA balance captured during proof generation matches the balance read at verification.
 * @property requireCustomTokenBalanceMatch - Enforces that the custom token balance captured during proof generation matches the balance read at verification.
 * @property requireMinaNonceMatch - Enforces that the MINA account nonce remains consistent between proof generation and verification.
 * @property requireCustomTokenNonceMatch - Enforces that the custom token account nonce remains consistent between proof generation and verification.
 */
class MintDynamicProofConfig extends Struct({
  shouldVerify: Bool,
  requireTokenIdMatch: Bool,
  requireMinaBalanceMatch: Bool,
  requireCustomTokenBalanceMatch: Bool,
  requireMinaNonceMatch: Bool,
  requireCustomTokenNonceMatch: Bool,
}) {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Token ID matching is enforced.
   * - MINA balance matching is not enforced.
   * - Custom token balance matching is not enforced.
   * - MINA nonce matching is not enforced.
   * - Custom token nonce matching is enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(true),
    requireCustomTokenBalanceMatch: Bool(true),
    requireMinaNonceMatch: Bool(true),
    requireCustomTokenNonceMatch: Bool(true),
  });

  /**
   * Unpacks the `packedDynamicProofConfigs1 and extracts the first 6 bits to construct a `MintDynamicProofConfig` instance.
   *
   * Assumes the input field contains both mint and burn dynamic proof configs:
   * - Bits 0–5: represent the mint config flags (used here).
   * - Bits 6–11: represent the burn config flags (ignored here).
   *
   * @param packedDynamicProofConfigs - A `Field` containing 12 bits (mint + burn proof configs).
   * @returns A `MintDynamicProofConfig` instance.
   */
  static unpack(packedDynamicProofConfigs: Field) {
    const serializedMintDynamicProofConfig = packedDynamicProofConfigs
      .toBits(12)
      .slice(0, 6);

    const [
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    ] = serializedMintDynamicProofConfig;

    return new this({
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    });
  }

  /**
   * Serializes the dynamic proof configuration into an array of 6 `Bool` bits (one per flag).
   *
   * @returns A flattened array of 6 bits representing the configuration flags.
   */
  toBits() {
    const {
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    } = this;

    const serializedDynamicProofConfig = [
      shouldVerify.toField().toBits(1),
      requireTokenIdMatch.toField().toBits(1),
      requireMinaBalanceMatch.toField().toBits(1),
      requireCustomTokenBalanceMatch.toField().toBits(1),
      requireMinaNonceMatch.toField().toBits(1),
      requireCustomTokenNonceMatch.toField().toBits(1),
    ].flat();

    return serializedDynamicProofConfig;
  }

  /**
   * Updates the `packedDynamicProofConfigs` containing both mint and burn dynamic proof configs.
   * Replaces the first 6 bits (mint config) with the current config, while preserving the last 6 bits (burn config).
   *
   * @param packedDynamicProofConfigs - A `Field` with both mint and burn dynamic proof configs.
   * @returns A new packed `Field` with the mint config updated.
   */
  updatePackedConfigs(packedDynamicProofConfigs: Field) {
    const serializedConfigs = packedDynamicProofConfigs.toBits(12);
    const serializedMintDynamicProofConfig = this.toBits();

    const updatedPackedConfigs = Field.fromBits([
      ...serializedMintDynamicProofConfig,
      ...serializedConfigs.slice(6, 12),
    ]);

    return updatedPackedConfigs;
  }

  /**
   * Packs this mint dynamic proof configuration together with a burn dynamic proof configuration
   * into a single 12-bit `Field`.
   *
   * @param burnDynamicProofConfig - A `BurnDynamicProofConfig` instance to combine with this config.
   * @returns A `Field` containing 12 bits (6 mint + 6 burn).
   */
  packConfigs(burnDynamicProofConfig: BurnDynamicProofConfig) {
    const serializedDynamicProofConfig = this.toBits();
    const packedDynamicProofConfigs = Field.fromBits([
      ...serializedDynamicProofConfig,
      ...burnDynamicProofConfig.toBits(),
    ]);

    return packedDynamicProofConfigs;
  }
}

/**
 * `BurnDynamicProofConfig` defines constraints for verifying side-loaded proofs during burn operations.
 *
 * This configuration dictates whether some checks are enforced and various elements captured during proof generation
 * must match the corresponding values at verification time.
 *
 * @property shouldVerify - When true, a side-loaded proof is verified during the process.
 * @property requireTokenIdMatch - Enforces that the token ID in the public input must match the token ID in the public output.
 * @property requireMinaBalanceMatch - Enforces that the MINA balance captured during proof generation matches the balance read at verification.
 * @property requireCustomTokenBalanceMatch - Enforces that the custom token balance captured during proof generation matches the balance read at verification.
 * @property requireMinaNonceMatch - Enforces that the MINA account nonce remains consistent between proof generation and verification.
 * @property requireCustomTokenNonceMatch - Enforces that the custom token account nonce remains consistent between proof generation and verification.
 */
class BurnDynamicProofConfig extends Struct({
  shouldVerify: Bool,
  requireTokenIdMatch: Bool,
  requireMinaBalanceMatch: Bool,
  requireCustomTokenBalanceMatch: Bool,
  requireMinaNonceMatch: Bool,
  requireCustomTokenNonceMatch: Bool,
}) {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Token ID matching is enforced.
   * - MINA balance matching is not enforced.
   * - Custom token balance matching is not enforced.
   * - MINA nonce matching is not enforced.
   * - Custom token nonce matching is enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(true),
    requireCustomTokenBalanceMatch: Bool(true),
    requireMinaNonceMatch: Bool(true),
    requireCustomTokenNonceMatch: Bool(true),
  });

  /**
   * Unpacks the `packedDynamicProofConfigs` and extracts the last 6 bits to construct a `BurnDynamicProofConfig` instance.
   *
   * Assumes the input field contains both mint and burn dynamic proof configs:
   * - Bits 0–5: represent the mint config (ignored here).
   * - Bits 6–11: represent the burn config flags (used here).
   *
   * @param packedDynamicProofConfigs - A `Field` containing 12 bits (6 mint + 6 burn).
   * @returns A `BurnDynamicProofConfig` instance.
   */
  static unpack(packedDynamicProofConfigs: Field) {
    const serializedBurnDynamicProofConfig = packedDynamicProofConfigs
      .toBits(12)
      .slice(6, 12);

    const [
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    ] = serializedBurnDynamicProofConfig;

    return new this({
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    });
  }

  /**
   * Serializes the dynamic proof configuration into an array of 6 `Bool` bits (one per flag).
   *
   * @returns A flattened array of 6 bits representing the configuration flags.
   */
  toBits() {
    const {
      shouldVerify,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    } = this;

    const serializedDynamicProofConfig = [
      shouldVerify.toField().toBits(1),
      requireTokenIdMatch.toField().toBits(1),
      requireMinaBalanceMatch.toField().toBits(1),
      requireCustomTokenBalanceMatch.toField().toBits(1),
      requireMinaNonceMatch.toField().toBits(1),
      requireCustomTokenNonceMatch.toField().toBits(1),
    ].flat();

    return serializedDynamicProofConfig;
  }

  /**
   * Updates the `packedDynamicProofConfigs` containing both mint and burn dynamic proof configs.
   * Replaces the last 6 bits (burn config) with the current config, while preserving the first 6 bits (mint config).
   *
   * @param packedDynamicProofConfigs - A `Field` with both mint and burn dynamic proof configs.
   * @returns A new `Field` with the burn config updated.
   */
  updatePackedConfigs(packedDynamicProofConfigs: Field) {
    const serializedConfigs = packedDynamicProofConfigs.toBits(12);
    const serializedBurnDynamicProofConfig = this.toBits();

    const updatedPackedConfigs = Field.fromBits([
      ...serializedConfigs.slice(0, 6),
      ...serializedBurnDynamicProofConfig,
    ]);

    return updatedPackedConfigs;
  }

  /**
   * Packs this burn dynamic proof configuration together with a mint dynamic proof configuration
   * into a single 12-bit `Field`.
   *
   * @param mintDynamicProofConfig - A `MintDynamicProofConfig` instance to combine with this config.
   * @returns A `Field` containing 12 bits (6 mint + 6 burn).
   */
  packConfigs(mintDynamicProofConfig: MintDynamicProofConfig) {
    const serializedDynamicProofConfig = this.toBits();
    const packedDynamicProofConfigs = Field.fromBits([
      ...mintDynamicProofConfig.toBits(),
      ...serializedDynamicProofConfig,
    ]);

    return packedDynamicProofConfigs;
  }
}
