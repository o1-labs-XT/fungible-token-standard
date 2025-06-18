import {
  AccountUpdate,
  Bool,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
  VerificationKey,
} from 'o1js';
import {
  FungibleToken,
  FungibleTokenErrors,
  VKeyMerkleMap,
} from '../FungibleTokenContract.js';
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
  ConfigErrors,
  ParameterTypes,
  FlagTypes,
  DynamicProofConfig,
} from '../configs.js';
import {
  program,
  generateDummyDynamicProof,
  generateDynamicProof,
  generateDynamicProof2,
  SideloadedProof,
  program2,
} from '../side-loaded/program.eg.js';
import {
  CONFIG_PROPERTIES,
  PARAMS_PROPERTIES,
  ConfigProperty,
  ParamsProperty,
  TEST_ERROR_MESSAGES,
} from './constants.js';

const proofsEnabled = true;

describe('Fungible Token - Burn Tests', () => {
  let tokenAdmin: Mina.TestPublicKey, tokenA: Mina.TestPublicKey;

  let fee: number,
    tokenContract: FungibleToken,
    mintParams: MintParams,
    burnParams: BurnParams,
    vKeyMap: VKeyMerkleMap,
    dummyVkey: VerificationKey,
    dummyProof: SideloadedProof,
    programVkey: VerificationKey,
    deployer: Mina.TestPublicKey,
    user1: Mina.TestPublicKey,
    user2: Mina.TestPublicKey;

  beforeAll(async () => {
    if (proofsEnabled) {
      await FungibleToken.compile();
    }

    const localChain = await Mina.LocalBlockchain({
      proofsEnabled,
      enforceTransactionLimits: false,
    });

    Mina.setActiveInstance(localChain);

    [tokenAdmin, tokenA] = Mina.TestPublicKey.random(7);

    [deployer, user1, user2] = localChain.testAccounts;
    tokenContract = new FungibleToken(tokenA);

    mintParams = MintParams.create(MintConfig.default, {
      minAmount: UInt64.from(0),
      maxAmount: UInt64.from(1000),
    });

    burnParams = BurnParams.create(BurnConfig.default, {
      minAmount: UInt64.from(50),
      maxAmount: UInt64.from(500),
    });

    vKeyMap = new VKeyMerkleMap();
    dummyVkey = await VerificationKey.dummy();
    dummyProof = await generateDummyDynamicProof(
      tokenContract.deriveTokenId(),
      user1
    );
    programVkey = (await program.compile()).verificationKey;
    fee = 1e8;
  });

  async function testBurnTx(
    user: PublicKey,
    burnAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 2
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, numberOfAccounts);
        await tokenContract.burnWithProof(
          user,
          burnAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.sub(burnAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnConfigTx(
    user: PublicKey,
    burnConfig: BurnConfig,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateBurnConfigTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateBurnConfig(burnConfig);
        }
      );
      await updateBurnConfigTx.prove();
      await updateBurnConfigTx.sign(signers).send().wait();

      expect(
        BurnConfig.unpack(tokenContract.packedAmountConfigs.get())
      ).toEqual(burnConfig);

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnParamsTx(
    user: PublicKey,
    burnParams: BurnParams,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateBurnParamsTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateBurnParams(burnParams);
        }
      );
      await updateBurnParamsTx.prove();
      await updateBurnParamsTx.sign(signers).send().wait();

      expect(tokenContract.packedBurnParams.get()).toEqual(burnParams.pack());

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnParamsPropertyTx(
    user: PublicKey,
    key: ParamsProperty,
    value: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        switch (key) {
          case PARAMS_PROPERTIES.FIXED_AMOUNT:
            await tokenContract.updateAmountParameter(
              OperationKeys.Burn,
              ParameterTypes.FixedAmount,
              value
            );
            break;
          case PARAMS_PROPERTIES.MIN_AMOUNT:
            await tokenContract.updateAmountParameter(
              OperationKeys.Burn,
              ParameterTypes.MinAmount,
              value
            );
            break;
          case PARAMS_PROPERTIES.MAX_AMOUNT:
            await tokenContract.updateAmountParameter(
              OperationKeys.Burn,
              ParameterTypes.MaxAmount,
              value
            );
            break;
        }
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedParams = tokenContract.packedBurnParams.get();
      const params = BurnParams.unpack(packedParams);
      expect(params[key]).toEqual(value);

      if (expectedErrorMessage) {
        throw new Error(
          `Test should have failed with '${expectedErrorMessage}' but didnt!`
        );
      }
    } catch (error: unknown) {
      if (!expectedErrorMessage) throw error;
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnConfigPropertyTx(
    user: PublicKey,
    key: ConfigProperty,
    value: Bool,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        switch (key) {
          case CONFIG_PROPERTIES.FIXED_AMOUNT:
            await tokenContract.updateConfigFlag(
              OperationKeys.Burn,
              FlagTypes.FixedAmount,
              value
            );
            break;
          case CONFIG_PROPERTIES.RANGED_AMOUNT:
            await tokenContract.updateConfigFlag(
              OperationKeys.Burn,
              FlagTypes.RangedAmount,
              value
            );
            break;
          case CONFIG_PROPERTIES.UNAUTHORIZED:
            await tokenContract.updateConfigFlag(
              OperationKeys.Burn,
              FlagTypes.Unauthorized,
              value
            );
            break;
        }
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);
      expect(burnConfigAfter[key]).toEqual(value);

      if (expectedErrorMessage) {
        throw new Error(
          `Test should have failed with '${expectedErrorMessage}' but didnt!`
        );
      }
    } catch (error: unknown) {
      if (!expectedErrorMessage) throw error;
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateBurnDynamicProofConfigTx(
    user: PublicKey,
    config: DynamicProofConfig,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateDynamicProofConfig(
          OperationKeys.Burn,
          config
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      if (expectedErrorMessage) {
        throw new Error(
          `Test should have failed with '${expectedErrorMessage}' but didnt!`
        );
      }
    } catch (error: unknown) {
      if (!expectedErrorMessage) throw error;
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateSLVkeyHashTx(
    sender: PublicKey,
    vKey: VerificationKey,
    vKeyMap: VKeyMerkleMap,
    operationKey: Field,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateVkeyTx = await Mina.transaction({ sender, fee }, async () => {
        await tokenContract.updateSideLoadedVKeyHash(
          vKey,
          vKeyMap,
          operationKey
        );
      });
      await updateVkeyTx.prove();
      await updateVkeyTx.sign(signers).send().wait();

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testBurnSLTx(
    user: PublicKey,
    burnAmount: UInt64,
    signers: PrivateKey[],
    proof?: SideloadedProof,
    vKey?: VerificationKey,
    vKeyMerkleMap?: VKeyMerkleMap,
    expectedErrorMessage?: string
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.burnWithProof(
          user,
          burnAmount,
          proof ?? dummyProof,
          vKey ?? dummyVkey,
          vKeyMerkleMap ?? vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.sub(burnAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testBurnSideloadDisabledTx(
    user: PublicKey,
    burnAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 2
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, numberOfAccounts);
        await tokenContract.burn(user, burnAmount);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.sub(burnAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  describe('Contract Deployment and Initialization', () => {
    it('should deploy token contract successfully', async () => {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);

        await tokenContract.deploy({
          symbol: 'tokA',
          src: 'https://github.com/o1-labs-XT/fungible-token-contract',
        });
      });

      tx.sign([deployer.key, tokenA.key]);

      await tx.prove();
      await tx.send();
    });

    it('should initialize token contract successfully', async () => {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await tokenContract.initialize(
          tokenAdmin,
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
      });
      await tx.prove();
      await tx.sign([deployer.key, tokenA.key]).send();
    });

    it('should return all configs after initialization', async () => {
      const configs = await tokenContract.getAllConfigs();

      expect(configs).toHaveLength(4);
      expect(configs[0]).toBeInstanceOf(Field);
      expect(configs[1]).toBeInstanceOf(Field);
      expect(configs[2]).toBeInstanceOf(Field);
      expect(configs[3]).toBeInstanceOf(Field);

      const [
        packedAmountConfigs,
        packedMintParams,
        packedBurnParams,
        packedDynamicProofConfigs,
      ] = configs;

      const mintConfig = MintConfig.unpack(packedAmountConfigs);
      const burnConfig = BurnConfig.unpack(packedAmountConfigs);
      const unpackedMintParams = MintParams.unpack(packedMintParams);
      const unpackedBurnParams = BurnParams.unpack(packedBurnParams);

      expect(mintConfig.unauthorized).toEqual(Bool(false));
      expect(mintConfig.fixedAmount).toEqual(Bool(false));
      expect(mintConfig.rangedAmount).toEqual(Bool(true));

      expect(burnConfig.unauthorized).toEqual(Bool(true));
      expect(burnConfig.fixedAmount).toEqual(Bool(false));
      expect(burnConfig.rangedAmount).toEqual(Bool(true));

      expect(unpackedMintParams.minAmount).toEqual(mintParams.minAmount);
      expect(unpackedMintParams.maxAmount).toEqual(mintParams.maxAmount);
      expect(unpackedBurnParams.minAmount).toEqual(burnParams.minAmount);
      expect(unpackedBurnParams.maxAmount).toEqual(burnParams.maxAmount);
    });

    it('should mint for user1 and user2', async () => {
      const mintAmount = UInt64.from(1000);
      const tx = await Mina.transaction({ sender: user1, fee }, async () => {
        AccountUpdate.fundNewAccount(user1, 3);
        await tokenContract.mintWithProof(
          user1,
          mintAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );

        await tokenContract.mintWithProof(
          user2,
          mintAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign([user1.key, tokenAdmin.key]).send().wait();
    });
  });

  describe('Burn Operations - Default Config (Unauthorized/Ranged)', () => {
    it('should allow burning without authorization', async () => {
      await testBurnTx(user2, UInt64.from(100), [user2.key], undefined, 0);
    });

    it('should allow burning without authorization using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user2,
        UInt64.from(100),
        [user2.key],
        undefined,
        0
      );
    });

    it('should burn amount within valid range: user', async () => {
      await testBurnTx(user1, UInt64.from(50), [user1.key], undefined, 0);
    });

    it('should burn amount within valid range using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user1,
        UInt64.from(50),
        [user1.key],
        undefined,
        0
      );
    });

    it('should reject burning amount outside valid range', async () => {
      await testBurnTx(
        user1,
        UInt64.from(700),
        [user1.key],
        FungibleTokenErrors.noPermissionToBurn
      );
    });

    it('should reject burning amount outside valid range using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user1,
        UInt64.from(700),
        [user1.key],
        FungibleTokenErrors.noPermissionToBurn
      );
    });

    it('should reject burning amount outside valid range using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user1,
        UInt64.from(700),
        [user1.key],
        FungibleTokenErrors.noPermissionToBurn
      );
    });

    it('should reject burning from circulating supply account', async () => {
      const expectedErrorMessage =
        FungibleTokenErrors.noTransferFromCirculation;
      try {
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          AccountUpdate.fundNewAccount(user2, 2);
          await tokenContract.burnWithProof(
            tokenContract.address,
            UInt64.from(100),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        });
        await tx.prove();
        await tx.sign([user2.key]).send().wait();

        throw new Error('Test should have failed but didnt!');
      } catch (error: unknown) {
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('should reject burning from circulating supply account using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        tokenContract.address,
        UInt64.from(100),
        [user2.key],
        FungibleTokenErrors.noTransferFromCirculation
      );
    });
  });

  describe('Burn Config Updates - Unauthorized/Fixed Mode', () => {
    it('should reject burn config update when both range and fixed burn are enabled', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage = ConfigErrors.invalidConfigValidation;
      await updateBurnConfigTx(
        user1,
        burnConfig,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    //! should test authorized burns
    it('should reject burn config update when unauthorized by admin', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateBurnConfigTx(
        user2,
        burnConfig,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('should update packed burnConfig', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(false),
        fixedAmount: Bool(false),
        rangedAmount: Bool(true),
      });

      await updateBurnConfigTx(user2, burnConfig, [user2.key, tokenAdmin.key]);
    });

    it('should reflect burn config updates in getAllConfigs()', async () => {
      const configsBefore = await tokenContract.getAllConfigs();

      const newBurnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateBurnConfigTx(user2, newBurnConfig, [
        user2.key,
        tokenAdmin.key,
      ]);

      const configsAfter = await tokenContract.getAllConfigs();

      expect(configsAfter[0]).not.toEqual(configsBefore[0]); // packedAmountConfigs
      expect(configsAfter[1]).toEqual(configsBefore[1]); // packedMintParams
      expect(configsAfter[2]).toEqual(configsBefore[2]); // packedBurnParams
      expect(configsAfter[3]).toEqual(configsBefore[3]); // packedDynamicProofConfigs

      const updatedBurnConfig = BurnConfig.unpack(configsAfter[0]);
      expect(updatedBurnConfig.unauthorized).toEqual(Bool(true));
      expect(updatedBurnConfig.fixedAmount).toEqual(Bool(true));
      expect(updatedBurnConfig.rangedAmount).toEqual(Bool(false));
    });

    it('should update burn fixedAmount config via field-specific function', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const burnConfigBefore = BurnConfig.unpack(packedConfigsBefore);
      const originalUnauthorized = burnConfigBefore.unauthorized;

      const newFixedAmountValue = Bool(true);
      await updateBurnConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.FIXED_AMOUNT,
        newFixedAmountValue,
        [user2.key, tokenAdmin.key]
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);

      expect(burnConfigAfter.fixedAmount).toEqual(newFixedAmountValue);
      expect(burnConfigAfter.unauthorized).toEqual(originalUnauthorized);
      expect(burnConfigAfter.rangedAmount).toEqual(newFixedAmountValue.not());
    });

    it('should reject burn fixed amount config update via field-specific function when unauthorized by admin', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const burnConfigBefore = BurnConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = burnConfigBefore.fixedAmount;
      const originalRangedAmount = burnConfigBefore.rangedAmount;
      const originalUnauthorized = burnConfigBefore.unauthorized;

      const attemptFixedAmountValue = Bool(true);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;

      await updateBurnConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.FIXED_AMOUNT,
        attemptFixedAmountValue,
        [user2.key],
        expectedErrorMessage
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);

      expect(burnConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(burnConfigAfter.rangedAmount).toEqual(originalRangedAmount);
      expect(burnConfigAfter.unauthorized).toEqual(originalUnauthorized);
    });

    it('should update burn ranged amount config via field-specific function', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const burnConfigBefore = BurnConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = burnConfigBefore.fixedAmount;
      const originalUnauthorized = burnConfigBefore.unauthorized;
      const newRangedAmountValue = Bool(false);
      await updateBurnConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.RANGED_AMOUNT,
        newRangedAmountValue,
        [user2.key, tokenAdmin.key]
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);

      expect(burnConfigAfter.rangedAmount).toEqual(newRangedAmountValue);
      expect(burnConfigAfter.fixedAmount).toEqual(newRangedAmountValue.not());
      expect(burnConfigAfter.unauthorized).toEqual(originalUnauthorized);
    });

    it('should reject rangedAmount config update via field-specific function when unauthorized by admin', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const burnConfigBefore = BurnConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = burnConfigBefore.fixedAmount;
      const originalRangedAmount = burnConfigBefore.rangedAmount;
      const originalUnauthorized = burnConfigBefore.unauthorized;

      const attemptRangedAmountValue = Bool(true);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;

      await updateBurnConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.RANGED_AMOUNT,
        attemptRangedAmountValue,
        [user2.key],
        expectedErrorMessage
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);

      expect(burnConfigAfter.rangedAmount).toEqual(originalRangedAmount);
      expect(burnConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(burnConfigAfter.unauthorized).toEqual(originalUnauthorized);
    });

    it('should update burn unauthorized config via field-specific function', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const burnConfigBefore = BurnConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = burnConfigBefore.fixedAmount;
      const originalRangedAmount = burnConfigBefore.rangedAmount;

      const newUnauthorizedValue = Bool(true);
      await updateBurnConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.UNAUTHORIZED,
        newUnauthorizedValue,
        [user2.key, tokenAdmin.key]
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);

      expect(burnConfigAfter.unauthorized).toEqual(newUnauthorizedValue);
      expect(burnConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(burnConfigAfter.rangedAmount).toEqual(originalRangedAmount);
    });

    it('should reject unauthorized config update via field-specific function when unauthorized by admin', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const burnConfigBefore = BurnConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = burnConfigBefore.fixedAmount;
      const originalRangedAmount = burnConfigBefore.rangedAmount;
      const originalUnauthorized = burnConfigBefore.unauthorized;

      const attemptUnauthorizedValue = Bool(false);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;

      await updateBurnConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.UNAUTHORIZED,
        attemptUnauthorizedValue,
        [user2.key],
        expectedErrorMessage
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const burnConfigAfter = BurnConfig.unpack(packedConfigsAfter);

      expect(burnConfigAfter.unauthorized).toEqual(originalUnauthorized);
      expect(burnConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(burnConfigAfter.rangedAmount).toEqual(originalRangedAmount);
    });
  });

  describe('Burn Parameter Updates', () => {
    it('should reject burn params update with invalid range', async () => {
      burnParams = new BurnParams({
        fixedAmount: UInt64.from(300),
        minAmount: UInt64.from(100),
        maxAmount: UInt64.from(50),
      });

      const expectedErrorMessage = ConfigErrors.invalidAmountRange;
      await updateBurnParamsTx(
        user2,
        burnParams,
        [user2.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject burn params update when unauthorized by admin', async () => {
      burnParams = new BurnParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(50),
        maxAmount: UInt64.from(600),
      });

      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateBurnParamsTx(
        user1,
        burnParams,
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should update packed burnParams', async () => {
      await updateBurnParamsTx(user1, burnParams, [user1.key, tokenAdmin.key]);
    });

    it('should reflect burn params updates in getAllConfigs()', async () => {
      const configsBefore = await tokenContract.getAllConfigs();

      const newBurnParams = new BurnParams({
        fixedAmount: UInt64.from(300),
        minAmount: UInt64.from(100),
        maxAmount: UInt64.from(800),
      });

      await updateBurnParamsTx(user1, newBurnParams, [
        user1.key,
        tokenAdmin.key,
      ]);

      const configsAfter = await tokenContract.getAllConfigs();
      expect(configsAfter[0]).toEqual(configsBefore[0]); // packedAmountConfigs
      expect(configsAfter[1]).toEqual(configsBefore[1]); // packedMintParams
      expect(configsAfter[2]).not.toEqual(configsBefore[2]); // packedBurnParams
      expect(configsAfter[3]).toEqual(configsBefore[3]); // packedDynamicProofConfigs

      const updatedBurnParams = BurnParams.unpack(configsAfter[2]);
      expect(updatedBurnParams.fixedAmount).toEqual(newBurnParams.fixedAmount);
      expect(updatedBurnParams.minAmount).toEqual(newBurnParams.minAmount);
      expect(updatedBurnParams.maxAmount).toEqual(newBurnParams.maxAmount);
    });

    it('should update burn fixed amount via field-specific function', async () => {
      const paramsBeforeUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalMinAmount = paramsBeforeUpdate.minAmount;
      const originalMaxAmount = paramsBeforeUpdate.maxAmount;

      const newFixedAmount = UInt64.from(150);
      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.FIXED_AMOUNT,
        newFixedAmount,
        [user1.key, tokenAdmin.key]
      );

      const paramsAfterUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterUpdate.fixedAmount).toEqual(newFixedAmount);
      expect(paramsAfterUpdate.minAmount).toEqual(originalMinAmount);
      expect(paramsAfterUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should reject burn fixed amount update via field-specific function when unauthorized by admin', async () => {
      const paramsBeforeAttempt = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const fixedAmountBeforeAttempt = paramsBeforeAttempt.fixedAmount;
      const minAmountBeforeAttempt = paramsBeforeAttempt.minAmount;
      const maxAmountBeforeAttempt = paramsBeforeAttempt.maxAmount;

      const newFixedAmountAttempt = UInt64.from(750);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;

      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.FIXED_AMOUNT,
        newFixedAmountAttempt,
        [user1.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(
        fixedAmountBeforeAttempt
      );
      expect(paramsAfterFailedUpdate.minAmount).toEqual(minAmountBeforeAttempt);
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(maxAmountBeforeAttempt);
    });

    it('should update burn min amount via field-specific function', async () => {
      const paramsBeforeUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalFixedAmount = paramsBeforeUpdate.fixedAmount;
      const originalMaxAmount = paramsBeforeUpdate.maxAmount;

      const newMinAmount = UInt64.from(100);
      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MIN_AMOUNT,
        newMinAmount,
        [user1.key, tokenAdmin.key]
      );

      const paramsAfterUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterUpdate.minAmount).toEqual(newMinAmount);
      expect(paramsAfterUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should reject burn min amount update via field-specific function when unauthorized by admin', async () => {
      const paramsBeforeAttempt = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const newMinAmountAttempt = UInt64.from(150);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;

      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MIN_AMOUNT,
        newMinAmountAttempt,
        [user1.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should reject burn min amount update via field-specific function when minAmount > maxAmount', async () => {
      const paramsBeforeAttempt = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const invalidNewMinAmount = originalMaxAmount.add(100);
      const expectedErrorMessage = ConfigErrors.invalidAmountRange;

      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MIN_AMOUNT,
        invalidNewMinAmount,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should update burn max amount via field-specific function', async () => {
      const paramsBeforeUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalFixedAmount = paramsBeforeUpdate.fixedAmount;
      const originalMinAmount = paramsBeforeUpdate.minAmount;

      const newMaxAmount = UInt64.from(850);
      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MAX_AMOUNT,
        newMaxAmount,
        [user1.key, tokenAdmin.key]
      );

      const paramsAfterUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterUpdate.maxAmount).toEqual(newMaxAmount);
      expect(paramsAfterUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterUpdate.minAmount).toEqual(originalMinAmount);
    });

    it('should reject burn max amount update via field-specific function when unauthorized by admin', async () => {
      const paramsBeforeAttempt = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const newMaxAmountAttempt = UInt64.from(1300);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;

      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MAX_AMOUNT,
        newMaxAmountAttempt,
        [user1.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
    });

    it('should reject burn max amount update via field-specific function when maxAmount < minAmount', async () => {
      const paramsBeforeAttempt = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const invalidNewMaxAmount = originalMinAmount.sub(10);
      const expectedErrorMessage = ConfigErrors.invalidAmountRange;

      await updateBurnParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MAX_AMOUNT,
        invalidNewMaxAmount,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = BurnParams.unpack(
        tokenContract.packedBurnParams.get()
      );
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
    });
  });

  // burn fixed amount is set to 150
  describe('Burn Operations - Unauthorized/Fixed Mode', () => {
    it('should reject burning amount different from fixed value', async () => {
      await testBurnTx(
        user1,
        UInt64.from(50),
        [user1.key],
        FungibleTokenErrors.noPermissionToBurn,
        0
      );
    });

    it('should reject burning amount different from fixed value using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user1,
        UInt64.from(50),
        [user1.key],
        FungibleTokenErrors.noPermissionToBurn,
        0
      );
    });

    it('should reject burning amount different from fixed value using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user1,
        UInt64.from(50),
        [user1.key],
        FungibleTokenErrors.noPermissionToBurn,
        0
      );
    });

    it('should only burn amount equal to fixed value', async () => {
      await testBurnTx(user2, UInt64.from(150), [user2.key], undefined, 0);
    });

    it('should only burn amount equal to fixed value using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user2,
        UInt64.from(150),
        [user2.key],
        undefined,
        0
      );
    });
  });

  describe('Burn Operations - Authorized/Fixed Mode', () => {
    it('update burn config to enforce admin authorization', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(false),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateBurnConfigTx(user2, burnConfig, [user2.key, tokenAdmin.key]);
    });

    it('should reject unauthorized burning', async () => {
      await testBurnTx(
        user1,
        UInt64.from(150),
        [user1.key],
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED
      );
    });

    it('should update burn config again to disable admin authorization', async () => {
      const burnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateBurnConfigTx(user2, burnConfig, [user2.key, tokenAdmin.key]);
    });
  });

  describe('Dynamic Proof Config Updates', () => {
    it('should reject burnDynamicProofConfig update when unauthorized by admin', async () => {
      let burnDynamicProofConfig = BurnDynamicProofConfig.default;
      burnDynamicProofConfig.shouldVerify = Bool(true);

      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateBurnDynamicProofConfigTx(
        user2,
        burnDynamicProofConfig,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('update burn dynamic proof config: enable side-loaded verification', async () => {
      let burnDynamicProofConfig = BurnDynamicProofConfig.default;
      burnDynamicProofConfig.shouldVerify = Bool(true);

      await updateBurnDynamicProofConfigTx(user2, burnDynamicProofConfig, [
        user2.key,
        tokenAdmin.key,
      ]);
    });
  });

  describe('Side-loaded Verification Key Updates', () => {
    it('should reject updating sideloaded verification key hash: unauthorized by admin', async () => {
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.Burn,
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should reject updating sideloaded verification key hash: invalid operationKey', async () => {
      const expectedErrorMessage = FungibleTokenErrors.invalidOperationKey;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        Field(10),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject updating sideloaded verification key hash: non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(11n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        tamperedVKeyMap,
        OperationKeys.Burn,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject burn if vKeyHash was never updated', async () => {
      const expectedErrorMessage = FungibleTokenErrors.missingVKeyForOperation;

      await testBurnSLTx(
        user2,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should update the sideloaded verification key hash for burns', async () => {
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.Burn,
        [user1.key, tokenAdmin.key]
      );
      vKeyMap.set(OperationKeys.Burn, programVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });
  });

  // SLV = Side-Loaded Verification (enabled)
  describe('Side-loaded Burn Operations - Unauthorized/Fixed Mode', () => {
    it('should reject burn with non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;

      await testBurnSLTx(
        user2,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        tamperedVKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn with non-compliant vKey hash', async () => {
      const expectedErrorMessage = FungibleTokenErrors.invalidSideLoadedVKey;

      await testBurnSLTx(
        user2,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! only passes when `proofsEnabled=true`
    (!proofsEnabled ? test.skip : it)(
      'should reject burn with invalid proof',
      async () => {
        await program2.compile();
        const burnAmount = UInt64.from(150);
        const invalidProof = await generateDynamicProof2(
          tokenContract.deriveTokenId(),
          user1
        );

        const expectedErrorMessage = TEST_ERROR_MESSAGES.CONSTRAINT_UNSATISFIED;
        await testBurnSLTx(
          user1,
          burnAmount,
          [user1.key],
          invalidProof,
          programVkey,
          vKeyMap,
          expectedErrorMessage
        );
      }
    );

    it('should burn with valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const burnAmount = UInt64.from(150);
      await testBurnSLTx(
        user2,
        burnAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap
      );
    });

    it('should reject burn using sideload-disabled method', async () => {
      await testBurnSideloadDisabledTx(
        user1,
        UInt64.from(150),
        [user1.key],
        FungibleTokenErrors.noPermissionForSideloadDisabledOperation
      );
    });

    it('should reject burn for a non-compliant proof recipient', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.recipientMismatch;
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn with invalid proof requireTokenIdMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(Field(1), user1);

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.tokenIdMismatch;
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn with invalid proof requireMinaBalanceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user1
      );

      const sendMinaTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          const sendUpdate = AccountUpdate.createSigned(user1);
          sendUpdate.send({
            to: deployer,
            amount: UInt64.from(1e9),
          });
        }
      );
      sendMinaTx.prove();
      sendMinaTx.sign([user1.key]).send().wait();

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.minaBalanceMismatch;
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn with invalid proof requireCustomTokenBalanceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      // user1 pays for tx fees to not get a "mina account balance mismatch" error
      // we burn tokens for user2 to change the custom token balance and test the precondition
      const burnTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.burnWithProof(
            user2,
            UInt64.from(150),
            dynamicProof,
            programVkey,
            vKeyMap
          );
        }
      );
      await burnTx.prove();
      await burnTx.sign([user1.key, user2.key]).send().wait();

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage =
        FungibleTokenErrors.customTokenBalanceMismatch;
      await testBurnSLTx(
        user2,
        burnAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject burn with invalid proof requireMinaNonceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user1
      );

      // user1 pays for tx fees to increase the nonce of his mina account
      // user2 sends the fee amount to user1 to conserve the balance of the mina account
      const sendTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          const sendUpdate = AccountUpdate.createSigned(user2);
          sendUpdate.send({
            to: user1,
            amount: fee,
          });
        }
      );

      await sendTx.prove();
      await sendTx.sign([user1.key, user2.key]).send().wait();

      const burnAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.minaNonceMismatch;
      await testBurnSLTx(
        user1,
        burnAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });
  });
});
