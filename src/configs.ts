import { Bool, Field, Struct, UInt64 } from 'o1js';

export {
  MintConfig,
  BurnConfig,
  MintParams,
  BurnParams,
  DynamicProofConfig,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
  OperationKeys,
  EventTypes,
  ParameterTypes,
  FlagTypes,
};

/**
 * `OperationKeys` provides symbolic names for the different token operations
 * that can have associated side-loaded verification keys.
 *
 * This ensures type safety and improves readability when referencing
 * specific operations, for example, in the `VKeyMerkleMap` or when calling
 * methods like `updateSideLoadedVKeyHash`.
 *
 * @property Mint - Operation key for minting tokens (corresponds to Field(1)).
 * @property Burn - Operation key for burning tokens (corresponds to Field(2)).
 * @property Transfer - Operation key for transferring tokens (corresponds to Field(3)).
 * @property ApproveBase - Operation key for approving a forest of account updates (corresponds to Field(4)).
 */
const OperationKeys = {
  Mint: Field(1),
  Burn: Field(2),
  Transfer: Field(3),
  ApproveBase: Field(4),
};

/**
 * `EventTypes` provides symbolic names for different types of events.
 * Used in ConfigStructureUpdateEvent to distinguish between config and params updates.
 *
 * @property Config - Configuration structure updates (corresponds to Field(1)).
 * @property Params - Parameter structure updates (corresponds to Field(2)).
 */
const EventTypes = {
  Config: Field(1),
  Params: Field(2),
};

/**
 * `ParameterTypes` provides symbolic names for different parameter types.
 * Used in AmountValueUpdateEvent to identify which parameter was updated.
 *
 * @property FixedAmount - Fixed amount parameter (corresponds to Field(1)).
 * @property MinAmount - Minimum amount parameter (corresponds to Field(2)).
 * @property MaxAmount - Maximum amount parameter (corresponds to Field(3)).
 */
const ParameterTypes = {
  FixedAmount: Field(1),
  MinAmount: Field(2),
  MaxAmount: Field(3),
};

/**
 * `FlagTypes` provides symbolic names for different configuration flag types.
 * Used in ConfigFlagUpdateEvent to identify which boolean flag was updated.
 *
 * @property FixedAmount - Fixed amount configuration flag (corresponds to Field(1)).
 * @property RangedAmount - Ranged amount configuration flag (corresponds to Field(2)).
 * @property Unauthorized - Unauthorized access configuration flag (corresponds to Field(3)).
 */
const FlagTypes = {
  FixedAmount: Field(1),
  RangedAmount: Field(2),
  Unauthorized: Field(3),
};

/**
 * `AmountConfig` defines shared constraints for fixed and ranged value settings
 * used in minting and burning operations.
 *
 * @property unauthorized - If true, disables admin signature requirement.
 * @property fixedAmount - If true, restricts the operation to a fixed amount.
 * @property rangedAmount - If true, allows the operation to specify a ranged amount.
 */
class AmountConfig extends Struct({
  unauthorized: Bool,
  fixedAmount: Bool,
  rangedAmount: Bool,
}) {
  /**
   * Serializes the amount configuration into an array of 3 `Bool` bits.
   *
   * @returns An array of bits representing the configuration.
   */
  toBits(): Bool[] {
    return [this.unauthorized, this.fixedAmount, this.rangedAmount];
  }

  /**
   * Validates that exactly one burn mode is enabled; either fixed or ranged.
   *
   * @throws If both or neither `fixedAmount` and `rangedAmount` are enabled.
   */
  validate() {
    this.fixedAmount
      .toField()
      .add(this.rangedAmount.toField())
      .assertEquals(
        1,
        'Exactly one of the fixed or ranged amount options must be enabled!'
      );
  }

  /**
   * Packs two `AmountConfig` instances, typically mint and burn, into a single 6-bit `Field`.
   *
   * The first 3 bits represent the first config (mint), and the last 3 bits represent the second (burn).
   *
   * @param configs - An array of exactly two `AmountConfig` instances: [mint, burn].
   * @returns A packed `Field` combining both configs.
   */
  static packConfigs(configs: [AmountConfig, AmountConfig]): Field {
    if (configs.length !== 2)
      throw new Error('Expected exactly two configs: [mint, burn]');
    return Field.fromBits([...configs[0].toBits(), ...configs[1].toBits()]);
  }
}

/**
 * `MintConfig` defines the permission and constraint settings for minting tokens.
 *
 * @see {@link AmountConfig} for shared behavior and validation logic.
 */
class MintConfig extends AmountConfig {
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
}

/**
 * `BurnConfig` defines the permission and constraint settings for burning tokens.
 *
 * @see {@link AmountConfig} for shared behavior and validation logic.
 */
class BurnConfig extends AmountConfig {
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
}

/**
 * `AmountParams` defines the shared structure for specifying token operation amounts,
 * supporting both fixed and ranged configurations.
 *
 * This class is extended by both {@link MintParams} and {@link BurnParams} to represent
 * the parameters for minting and burning tokens, respectively.
 *
 * @property fixedAmount - The fixed amount of tokens to process.
 * @property minAmount - The minimum value allowed in a ranged operation.
 * @property maxAmount - The maximum value allowed in a ranged operation.
 */
class AmountParams extends Struct({
  fixedAmount: UInt64,
  minAmount: UInt64,
  maxAmount: UInt64,
}) {
  /**
   * Packs the `AmountParams` instance into a single `Field`.
   *
   * Internally, this converts the `fixedAmount`, `minAmount`, and `maxAmount`
   * into 64-bit segments and concatenates them into a 192-bit field.
   *
   * @returns A packed `Field` representing the parameter values.
   */
  pack(): Field {
    return Field.fromBits(this.toBits());
  }

  /**
   * Converts the parameter values into a flat array of 192 bits.
   *
   * The bit layout is: [fixedAmount (64 bits), minAmount (64 bits), maxAmount (64 bits)].
   *
   * @returns An array of 192 `Bool` values.
   */
  toBits(): Bool[] {
    return [
      ...this.fixedAmount.toBits(),
      ...this.minAmount.toBits(),
      ...this.maxAmount.toBits(),
    ];
  }

  /**
   * Unpacks a Field value into an AmountParams instance.
   *
   * The packed Field is expected to be composed of three concatenated 64-bit segments representing:
   * - fixedAmount,
   * - minAmount, and
   * - maxAmount.
   *
   * Each segment is converted back into a UInt64 value.
   *
   * @param packedParams - The packed parameters as a Field.
   * @returns A new AmountParams instance with the unpacked fixed, minimum, and maximum amounts.
   */
  static unpack(packedParams: Field) {
    const bits = packedParams.toBits(64 * 3);
    return new this({
      fixedAmount: UInt64.fromBits(bits.slice(0, 64)),
      minAmount: UInt64.fromBits(bits.slice(64, 64 * 2)),
      maxAmount: UInt64.fromBits(bits.slice(64 * 2, 64 * 3)),
    });
  }

  /**
   * Validates that the burn range is correctly configured by asserting that
   * `minAmount` is less than `maxAmount`.
   *
   * @throws If `minAmount` is not less than `maxAmount`.
   */
  validate() {
    this.minAmount.assertLessThan(this.maxAmount, 'Invalid amount range!');
  }
}

/**
 * `MintParams` defines the parameters for token minting.
 *
 * Inherits all behavior from {@link AmountParams}, including serialization,
 * deserialization, and range validation.
 */
class MintParams extends AmountParams {
  /**
   * Creates a new `MintParams` instance, ensuring consistency with the provided `MintConfig`.
   *
   * This factory method validates the `MintConfig` and initializes the `MintParams`
   * fields (`fixedAmount`, `minAmount`, `maxAmount`) based on whether the config
   * specifies a fixed or ranged amount minting.
   *
   * - If `config.fixedAmount` is true, `data.fixedAmount` is used, and `minAmount`/`maxAmount`
   *   are set to 0 and 1 respectively (to pass `AmountParams.validate` if called).
   * - If `config.rangedAmount` is true, `data.minAmount` and `data.maxAmount` are used,
   *   and `fixedAmount` is set to 0.
   *
   * @param config - The `MintConfig` to adhere to.
   * @param data - An object containing the amount values.
   *   - `fixedAmount` (optional): The amount for fixed-amount minting. Required if `config.fixedAmount` is true.
   *   - `minAmount` (optional): The minimum amount for ranged-amount minting. Required if `config.rangedAmount` is true.
   *   - `maxAmount` (optional): The maximum amount for ranged-amount minting. Required if `config.rangedAmount` is true.
   * @returns A new `MintParams` instance.
   * @throws If `config` is invalid (e.g., both fixed and ranged are true).
   * @throws If required `data` fields are missing for the specified config mode.
   */
  static create(
    config: MintConfig,
    data: { fixedAmount?: UInt64; minAmount?: UInt64; maxAmount?: UInt64 }
  ): MintParams {
    config.validate();

    let initData: { fixedAmount: UInt64; minAmount: UInt64; maxAmount: UInt64 };

    if (config.fixedAmount.toBoolean()) {
      if (data.fixedAmount === undefined) {
        throw new Error(
          'MintConfig requires a fixed amount, but no `fixedAmount` was provided in params data.'
        );
      }
      if (data.minAmount !== undefined || data.maxAmount !== undefined) {
        throw new Error(
          'MintConfig requires a fixed amount; `minAmount` and `maxAmount` should not be provided in params data.'
        );
      }
      initData = {
        fixedAmount: data.fixedAmount,
        minAmount: UInt64.from(0),
        maxAmount: UInt64.from(1),
      };
    } else {
      if (data.minAmount === undefined || data.maxAmount === undefined) {
        throw new Error(
          'MintConfig requires a ranged amount, but `minAmount` or `maxAmount` was not provided in params data.'
        );
      }
      if (data.fixedAmount !== undefined) {
        throw new Error(
          'MintConfig requires a ranged amount; `fixedAmount` should not be provided in params data.'
        );
      }
      initData = {
        fixedAmount: UInt64.from(0),
        minAmount: data.minAmount,
        maxAmount: data.maxAmount,
      };
      initData.minAmount.assertLessThan(
        initData.maxAmount,
        'Invalid amount range!'
      );
    }

    const paramsInstance = new MintParams(initData);
    return paramsInstance;
  }
}

/**
 * `BurnParams` defines the parameters for token burning.
 *
 * Inherits all behavior from {@link AmountParams}, including serialization,
 * deserialization, and range validation.
 */
class BurnParams extends AmountParams {
  /**
   * Creates a new `BurnParams` instance, ensuring consistency with the provided `BurnConfig`.
   *
   * This factory method validates the `BurnConfig` and initializes the `BurnParams`
   * fields (`fixedAmount`, `minAmount`, `maxAmount`) based on whether the config
   * specifies a fixed or ranged amount burning.
   *
   * - If `config.fixedAmount` is true, `data.fixedAmount` is used, and `minAmount`/`maxAmount`
   *   are set to 0 and 1 respectively (to pass `AmountParams.validate` if called).
   * - If `config.rangedAmount` is true, `data.minAmount` and `data.maxAmount` are used,
   *   and `fixedAmount` is set to 0.
   *
   * @param config - The `BurnConfig` to adhere to.
   * @param data - An object containing the amount values.
   *   - `fixedAmount` (optional): The amount for fixed-amount burning. Required if `config.fixedAmount` is true.
   *   - `minAmount` (optional): The minimum amount for ranged-amount burning. Required if `config.rangedAmount` is true.
   *   - `maxAmount` (optional): The maximum amount for ranged-amount burning. Required if `config.rangedAmount` is true.
   * @returns A new `BurnParams` instance.
   * @throws If `config` is invalid (e.g., both fixed and ranged are true).
   * @throws If required `data` fields are missing for the specified config mode.
   */
  static create(
    config: BurnConfig,
    data: { fixedAmount?: UInt64; minAmount?: UInt64; maxAmount?: UInt64 }
  ): BurnParams {
    config.validate();

    let initData: { fixedAmount: UInt64; minAmount: UInt64; maxAmount: UInt64 };

    if (config.fixedAmount.toBoolean()) {
      if (data.fixedAmount === undefined) {
        throw new Error(
          'BurnConfig requires a fixed amount, but no `fixedAmount` was provided in params data.'
        );
      }
      if (data.minAmount !== undefined || data.maxAmount !== undefined) {
        throw new Error(
          'BurnConfig requires a fixed amount; `minAmount` and `maxAmount` should not be provided in params data.'
        );
      }
      initData = {
        fixedAmount: data.fixedAmount,
        minAmount: UInt64.from(0),
        maxAmount: UInt64.from(1),
      };
    } else {
      if (data.minAmount === undefined || data.maxAmount === undefined) {
        throw new Error(
          'BurnConfig requires a ranged amount, but `minAmount` or `maxAmount` was not provided in params data.'
        );
      }
      if (data.fixedAmount !== undefined) {
        throw new Error(
          'BurnConfig requires a ranged amount; `fixedAmount` should not be provided in params data.'
        );
      }
      initData = {
        fixedAmount: UInt64.from(0),
        minAmount: data.minAmount,
        maxAmount: data.maxAmount,
      };
      initData.minAmount.assertLessThan(
        initData.maxAmount,
        'Invalid amount range!'
      );
    }

    const paramsInstance = new BurnParams(initData);
    return paramsInstance;
  }
}

/**
 * `DynamicProofConfig` defines a generic configuration to control and verify constraints for side-loaded proofs in token operations.
 *
 * Each instance specifies whether certain checks are enforced and whether specific data captured during proof generation must match their values at verification.
 * This class serves as a base for `mint`, `burn`, `transfer`, and `updates` dynamic proof configurations, each represented by exactly 6 bits within a packed 24-bit Field.
 *
 * @property shouldVerify - Enables or disables verification of side-loaded proofs.
 * @property requireRecipientMatch - Ensures that the recipient address in the proof's public input matches the recipient specified in the token method call.
 * @property requireTokenIdMatch - Ensures token ID consistency between proof generation and verification.
 * @property requireMinaBalanceMatch - Ensures MINA balance consistency between proof generation and verification.
 * @property requireCustomTokenBalanceMatch - Ensures custom token balance consistency between proof generation and verification.
 * @property requireMinaNonceMatch - Ensures MINA account nonce consistency between proof generation and verification.
 * @property requireCustomTokenNonceMatch - Ensures custom token account nonce consistency between proof generation and verification.
 */
class DynamicProofConfig extends Struct({
  shouldVerify: Bool,
  requireRecipientMatch: Bool,
  requireTokenIdMatch: Bool,
  requireMinaBalanceMatch: Bool,
  requireCustomTokenBalanceMatch: Bool,
  requireMinaNonceMatch: Bool,
  requireCustomTokenNonceMatch: Bool,
}) {
  /**
   * Serializes the dynamic proof configuration into an array of 6 `Bool` bits (one per flag).
   * @returns An array of 6 bits representing the configuration flags.
   */
  toBits(): Bool[] {
    return [
      this.shouldVerify,
      this.requireRecipientMatch,
      this.requireTokenIdMatch,
      this.requireMinaBalanceMatch,
      this.requireCustomTokenBalanceMatch,
      this.requireMinaNonceMatch,
      this.requireCustomTokenNonceMatch,
    ];
  }

  /**
   * Unpacks a specific 6-bit segment from a 24-bit packed configuration.
   * @param packedConfigs - The 24-bit packed Field.
   * @param configIndex - Index of the config (0: mint, 1: burn, 2: transfer, 3: updates).
   * @returns A DynamicProofConfig instance.
   */
  static unpack(packedConfigs: Field, configIndex: number) {
    const start = configIndex * 7;
    const bits = packedConfigs.toBits(28).slice(start, start + 7);

    return new this({
      shouldVerify: bits[0],
      requireRecipientMatch: bits[1],
      requireTokenIdMatch: bits[2],
      requireMinaBalanceMatch: bits[3],
      requireCustomTokenBalanceMatch: bits[4],
      requireMinaNonceMatch: bits[5],
      requireCustomTokenNonceMatch: bits[6],
    });
  }

  /**
   * Updates a specific 6-bit segment within a packed 24-bit configuration.
   * @param packedConfigs - The original 24-bit packed Field.
   * @param configIndex - Index of the config to update (0: mint, 1: burn, 2: transfer, 3: updates).
   * @returns Updated 24-bit packed Field.
   */
  updatePackedConfigs(packedConfigs: Field, configIndex: number): Field {
    const bits = packedConfigs.toBits(28);
    const start = configIndex * 7;
    const updatedBits = [
      ...bits.slice(0, start),
      ...this.toBits(),
      ...bits.slice(start + 7),
    ];

    return Field.fromBits(updatedBits);
  }

  /**
   * Packs multiple DynamicProofConfig instances into a single 24-bit packed Field.
   * @param configs - Array of exactly four DynamicProofConfig instances [mint, burn, transfer, updates].
   * @returns Packed 24-bit Field.
   */
  static packConfigs(configs: DynamicProofConfig[]): Field {
    if (configs.length !== 4) throw new Error('Exactly 4 configs required.');

    const bits = configs.flatMap((config) => config.toBits());
    return Field.fromBits(bits);
  }
}

/**
 * `MintDynamicProofConfig` specializes `DynamicProofConfig` specifically for mint operations.
 *
 * Uses the first 6-bit segment (bits 0–5) of the packed 24-bit field.
 *
 * See {@link DynamicProofConfig} for detailed property explanations and usage.
 */
class MintDynamicProofConfig extends DynamicProofConfig {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Recipient matching is enforced.
   * - Token ID matching is enforced.
   * - MINA balance matching is enforced.
   * - Custom token balance matching is enforced.
   * - MINA nonce matching is enforced.
   * - Custom token nonce matching is enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireRecipientMatch: Bool(true),
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(true),
    requireCustomTokenBalanceMatch: Bool(true),
    requireMinaNonceMatch: Bool(true),
    requireCustomTokenNonceMatch: Bool(true),
  });

  static unpack(packedConfigs: Field) {
    return super.unpack(packedConfigs, 0);
  }

  updatePackedConfigs(packedConfigs: Field) {
    return super.updatePackedConfigs(packedConfigs, 0);
  }
}

/**
 * `BrunDynamicProofConfig` specializes `DynamicProofConfig` specifically for burn operations.
 *
 * Uses the second 6-bit segment (bits 6–11) of the packed 24-bit field.
 *
 * See {@link DynamicProofConfig} for detailed property explanations and usage.
 */
class BurnDynamicProofConfig extends DynamicProofConfig {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Recipient matching is enforced.
   * - Token ID matching is enforced.
   * - MINA balance matching is enforced.
   * - Custom token balance matching is enforced.
   * - MINA nonce matching is enforced.
   * - Custom token nonce matching is not enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireRecipientMatch: Bool(true),
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(true),
    requireCustomTokenBalanceMatch: Bool(true),
    requireMinaNonceMatch: Bool(true),
    requireCustomTokenNonceMatch: Bool(false),
  });

  static unpack(packedConfigs: Field) {
    return super.unpack(packedConfigs, 1);
  }

  updatePackedConfigs(packedConfigs: Field) {
    return super.updatePackedConfigs(packedConfigs, 1);
  }
}

/**
 * `TransferDynamicProofConfig` specializes `DynamicProofConfig` specifically for transfer operations.
 *
 * Uses the third 6-bit segment (bits 12–17) of the packed 24-bit field.
 *
 * See {@link DynamicProofConfig} for detailed property explanations and usage.
 */
class TransferDynamicProofConfig extends DynamicProofConfig {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Recipient matching is enforced.
   * - Token ID matching is enforced.
   * - MINA balance matching is enforced.
   * - Custom token balance matching is enforced.
   * - MINA nonce matching is enforced.
   * - Custom token nonce matching is not enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireRecipientMatch: Bool(true),
    requireTokenIdMatch: Bool(true),
    requireMinaBalanceMatch: Bool(true),
    requireCustomTokenBalanceMatch: Bool(true),
    requireMinaNonceMatch: Bool(true),
    requireCustomTokenNonceMatch: Bool(false),
  });

  static unpack(packedConfigs: Field) {
    return super.unpack(packedConfigs, 2);
  }

  updatePackedConfigs(packedConfigs: Field) {
    return super.updatePackedConfigs(packedConfigs, 2);
  }
}

/**
 * `UpdatesDynamicProofConfig` specializes `DynamicProofConfig` specifically for approveUpdates operations.
 *
 * Uses the fourth 6-bit segment (bits 18–23) of the packed 24-bit field.
 *
 * See {@link DynamicProofConfig} for detailed property explanations and usage.
 */
class UpdatesDynamicProofConfig extends DynamicProofConfig {
  /**
   * The default dynamic proof configuration.
   *
   * By default:
   * - Side-loaded proof verification (shouldVerify) is disabled.
   * - Recipient matching is not enforced.
   * - Token ID matching is not enforced.
   * - MINA balance matching is not enforced.
   * - Custom token balance matching is not enforced.
   * - MINA nonce matching is not enforced.
   * - Custom token nonce matching is not enforced.
   */
  static default = new this({
    shouldVerify: Bool(false),
    requireRecipientMatch: Bool(false),
    requireTokenIdMatch: Bool(false),
    requireMinaBalanceMatch: Bool(false),
    requireCustomTokenBalanceMatch: Bool(false),
    requireMinaNonceMatch: Bool(false),
    requireCustomTokenNonceMatch: Bool(false),
  });

  static unpack(packedConfigs: Field) {
    return super.unpack(packedConfigs, 3);
  }

  updatePackedConfigs(packedConfigs: Field) {
    return super.updatePackedConfigs(packedConfigs, 3);
  }
}
