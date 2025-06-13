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

//! Tests can take up to 15 minutes with `proofsEnabled: true`, and around 4 minutes when false.
const proofsEnabled = false;

describe('New Token Standard Mint Tests', () => {
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
      minAmount: UInt64.from(100),
      maxAmount: UInt64.from(1500),
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

  async function testInitializeTx(
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    invalidMintConfig?: MintConfig,
    invalidMintParams?: MintParams,
    invalidBurnConfig?: BurnConfig,
    invalidBurnParams?: BurnParams
  ) {
    try {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await tokenContract.initialize(
          tokenAdmin,
          UInt8.from(9),
          invalidMintConfig ?? MintConfig.default,
          invalidMintParams ?? mintParams,
          invalidBurnConfig ?? BurnConfig.default,
          invalidBurnParams ?? burnParams,
          MintDynamicProofConfig.default,
          BurnDynamicProofConfig.default,
          TransferDynamicProofConfig.default,
          UpdatesDynamicProofConfig.default
        );
      });
      await tx.prove();
      await tx.sign(signers).send();

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testMintTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 2
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, numberOfAccounts);
        await tokenContract.mintWithProof(
          user,
          mintAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testMintSideloadDisabledTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 2
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        AccountUpdate.fundNewAccount(user, numberOfAccounts);
        await tokenContract.mint(user, mintAmount);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateMintConfigTx(
    user: PublicKey,
    mintConfig: MintConfig,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateMintConfigTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateMintConfig(mintConfig);
        }
      );
      await updateMintConfigTx.prove();
      await updateMintConfigTx.sign(signers).send().wait();

      expect(
        MintConfig.unpack(tokenContract.packedAmountConfigs.get())
      ).toEqual(mintConfig);

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateMintParamsTx(
    user: PublicKey,
    mintParams: MintParams,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const updateMintParamsTx = await Mina.transaction(
        { sender: user, fee },
        async () => {
          await tokenContract.updateMintParams(mintParams);
        }
      );
      await updateMintParamsTx.prove();
      await updateMintParamsTx.sign(signers).send().wait();

      expect(tokenContract.packedMintParams.get()).toEqual(mintParams.pack());

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateMintParamsPropertyTx(
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
            await tokenContract.updateMintFixedAmount(value);
            break;
          case PARAMS_PROPERTIES.MIN_AMOUNT:
            await tokenContract.updateMintMinAmount(value);
            break;
          case PARAMS_PROPERTIES.MAX_AMOUNT:
            await tokenContract.updateMintMaxAmount(value);
            break;
        }
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedParams = tokenContract.packedMintParams.get();
      const params = MintParams.unpack(packedParams);
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

  async function updateMintConfigPropertyTx(
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
            await tokenContract.updateMintFixedAmountConfig(value);
            break;
          case CONFIG_PROPERTIES.RANGED_AMOUNT:
            await tokenContract.updateMintRangedAmountConfig(value);
            break;
          case CONFIG_PROPERTIES.UNAUTHORIZED:
            await tokenContract.updateMintUnauthorizedConfig(value);
            break;
        }
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);
      expect(mintConfigAfter[key]).toEqual(value);

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

  async function testMintSLTx(
    user: PublicKey,
    mintAmount: UInt64,
    signers: PrivateKey[],
    proof?: SideloadedProof,
    vKey?: VerificationKey,
    vKeyMerkleMap?: VKeyMerkleMap,
    expectedErrorMessage?: string
  ) {
    try {
      const userBalanceBefore = await tokenContract.getBalanceOf(user);
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.mintWithProof(
          user,
          mintAmount,
          proof ?? dummyProof,
          vKey ?? dummyVkey,
          vKeyMerkleMap ?? vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const userBalanceAfter = await tokenContract.getBalanceOf(user);
      expect(userBalanceAfter).toEqual(userBalanceBefore.add(mintAmount));

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function updateMintFixedAmountTx(
    user: PublicKey,
    value: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateMintFixedAmount(value);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedParams = tokenContract.packedMintParams.get();
      const params = MintParams.unpack(packedParams);
      expect(params.fixedAmount).toEqual(value);

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

  async function updateMintMinAmountTx(
    user: PublicKey,
    value: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateMintMinAmount(value);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedParams = tokenContract.packedMintParams.get();
      const params = MintParams.unpack(packedParams);
      expect(params.minAmount).toEqual(value);

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

  async function updateMintMaxAmountTx(
    user: PublicKey,
    value: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateMintMaxAmount(value);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedParams = tokenContract.packedMintParams.get();
      const params = MintParams.unpack(packedParams);
      expect(params.maxAmount).toEqual(value);

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

  async function updateMintFixedAmountConfigTx(
    user: PublicKey,
    value: Bool,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateMintFixedAmountConfig(value);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);
      expect(mintConfigAfter.fixedAmount).toEqual(value);

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

  async function updateMintRangedAmountConfigTx(
    user: PublicKey,
    value: Bool,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateMintRangedAmountConfig(value);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);
      expect(mintConfigAfter.rangedAmount).toEqual(value);

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

  async function updateMintUnauthorizedConfigTx(
    user: PublicKey,
    value: Bool,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const tx = await Mina.transaction({ sender: user, fee }, async () => {
        await tokenContract.updateMintUnauthorizedConfig(value);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);
      expect(mintConfigAfter.unauthorized).toEqual(value);

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

  describe('Deploy & initialize', () => {
    it('should deploy tokenA contract', async () => {
      const tx = await Mina.transaction({ sender: deployer, fee }, async () => {
        AccountUpdate.fundNewAccount(deployer);

        await tokenContract.deploy({
          symbol: 'tokA',
          src: 'https://github.com/o1-labs-XT/fungible-token-standard',
        });
      });

      tx.sign([deployer.key, tokenA.key]);

      await tx.prove();
      await tx.send();
    });

    it('should reject initialization when a signature from the token address is missing', async () => {
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.INVALID_SIGNATURE_ACCOUNT_UPDATE;
      await testInitializeTx([deployer.key], expectedErrorMessage);
    });

    it('should reject initialization with invalid mintConfig', async () => {
      const invalidMintConfig = new MintConfig({
        unauthorized: Bool(false),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage = ConfigErrors.invalidConfigValidation;
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        invalidMintConfig
      );
    });

    it('should reject initialization with invalid mintParams', async () => {
      const invalidMintParams = new MintParams({
        fixedAmount: UInt64.from(100),
        minAmount: UInt64.from(300),
        maxAmount: UInt64.from(100),
      });

      const expectedErrorMessage = ConfigErrors.invalidAmountRange;
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        undefined,
        invalidMintParams
      );
    });

    it('should reject initialization with invalid burnConfig', async () => {
      const invalidBurnConfig = new BurnConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage = ConfigErrors.invalidConfigValidation;
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        undefined,
        undefined,
        invalidBurnConfig
      );
    });

    it('should reject initialization with invalid burnParams', async () => {
      const invalidBurnParams = new BurnParams({
        fixedAmount: UInt64.from(200),
        minAmount: UInt64.from(240),
        maxAmount: UInt64.from(150),
      });

      const expectedErrorMessage = ConfigErrors.invalidAmountRange;
      await testInitializeTx(
        [deployer.key, tokenA.key],
        expectedErrorMessage,
        undefined,
        undefined,
        undefined,
        invalidBurnParams
      );
    });

    it('should initialize tokenA contract', async () => {
      await testInitializeTx([deployer.key, tokenA.key]);
    });

    //! Throws an error because the first `initialize` has set the permissions to impossible
    //! not because of the `provedState` precondition
    it('Should prevent calling `initialize()` a second time', async () => {
      const expectedErrorMessage =
        "Cannot update field 'permissions' because permission for this field is 'Impossible'";
      await testInitializeTx([deployer.key, tokenA.key], expectedErrorMessage);
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
  });

  describe('Mint Config: Default: Authorized/Ranged', () => {
    it('should mint an amount within the valid range: user', async () => {
      await testMintTx(user1, UInt64.from(200), [user1.key, tokenAdmin.key]);
    });

    it('should mint an amount within the valid range with mintSideloadDisabled', async () => {
      const mintAmount = UInt64.from(100);
      // User1 signs for the AU, tokenAdmin signs because default MintConfig is authorized
      await testMintSideloadDisabledTx(
        user1,
        mintAmount,
        [user1.key, tokenAdmin.key],
        '',
        2
      );
    });

    it('should reject minting an amount outside the valid range', async () => {
      await testMintTx(
        user1,
        UInt64.from(1100),
        [user1.key, tokenAdmin.key],
        FungibleTokenErrors.noPermissionToMint
      );
    });

    it('should reject minting amount outside the valid range with mintSideloadDisabled', async () => {
      // Attempt to mint an amount outside the default MintParams range (0-1000)
      const invalidMintAmount = UInt64.from(2000);
      await testMintSideloadDisabledTx(
        user1,
        invalidMintAmount,
        [user1.key, tokenAdmin.key],
        FungibleTokenErrors.noPermissionToMint
      );
    });

    it('should reject minting amount outside the valid range with mintSideloadDisabled', async () => {
      // Attempt to mint an amount outside the default MintParams range (0-1000)
      const invalidMintAmount = UInt64.from(2000);
      await testMintSideloadDisabledTx(
        user1,
        invalidMintAmount,
        [user1.key, tokenAdmin.key],
        FungibleTokenErrors.noPermissionToMint
      );
    });

    it('should reject minting to the circulating supply account', async () => {
      const expectedErrorMessage =
        FungibleTokenErrors.noTransferFromCirculation;
      try {
        const tx = await Mina.transaction({ sender: user2, fee }, async () => {
          AccountUpdate.fundNewAccount(user2, 2);
          await tokenContract.mintWithProof(
            tokenContract.address,
            UInt64.from(200),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        });
        await tx.prove();
        await tx.sign([user2.key, tokenAdmin.key]).send().wait();

        throw new Error('Test should have failed but didnt!');
      } catch (error: unknown) {
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('should reject minting to the circulation supply account with mintSideloadDisabled', async () => {
      const mintAmount = UInt64.from(100);
      await testMintSideloadDisabledTx(
        tokenContract.address, // recipient is the contract itself
        mintAmount,
        [deployer.key, tokenAdmin.key], // deployer funds and initiates, admin authorizes mint
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it('should reject unauthorized minting', async () => {
      await testMintTx(
        user1,
        UInt64.from(300),
        [user1.key],
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED
      );
    });

    it('should reject unauthorized minting with mintSideloadDisabled', async () => {
      // Attempt to mint without admin signature (default MintConfig is authorized)
      const mintAmount = UInt64.from(100);
      await testMintSideloadDisabledTx(
        user1,
        mintAmount,
        [user1.key], // Missing tokenAdmin.key
        'the required authorization was not provided or is invalid.'
      );
    });

    it('should reject unauthorized minting with mintSideloadDisabled', async () => {
      // Attempt to mint without admin signature (default MintConfig is authorized)
      const mintAmount = UInt64.from(100);
      await testMintSideloadDisabledTx(
        user1,
        mintAmount,
        [user1.key], // Missing tokenAdmin.key
        'the required authorization was not provided or is invalid.'
      );
    });
  });

  describe('Update Mint Config: Unauthorized/Fixed', () => {
    it('should reject mintConfig update when both range and fixed mint are enabled', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(true),
      });

      const expectedErrorMessage = ConfigErrors.invalidConfigValidation;
      await updateMintConfigTx(
        user1,
        mintConfig,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject mintConfig update when unauthorized by the admin', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateMintConfigTx(
        user2,
        mintConfig,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('should update packed mintConfig', async () => {
      const mintConfig = new MintConfig({
        unauthorized: Bool(false),
        fixedAmount: Bool(false),
        rangedAmount: Bool(true),
      });

      await updateMintConfigTx(user2, mintConfig, [user2.key, tokenAdmin.key]);
    });

    it('should reflect mint config updates in getAllConfigs()', async () => {
      const configsBefore = await tokenContract.getAllConfigs();

      // Update mint config to fixed amount
      const newMintConfig = new MintConfig({
        unauthorized: Bool(true),
        fixedAmount: Bool(true),
        rangedAmount: Bool(false),
      });

      await updateMintConfigTx(user2, newMintConfig, [
        user2.key,
        tokenAdmin.key,
      ]);

      const configsAfter = await tokenContract.getAllConfigs();

      expect(configsAfter[0]).not.toEqual(configsBefore[0]); // packedAmountConfigs
      expect(configsAfter[1]).toEqual(configsBefore[1]); // packedMintParams
      expect(configsAfter[2]).toEqual(configsBefore[2]); // packedBurnParams
      expect(configsAfter[3]).toEqual(configsBefore[3]); // packedDynamicProofConfigs

      const updatedMintConfig = MintConfig.unpack(configsAfter[0]);
      expect(updatedMintConfig.unauthorized).toEqual(Bool(true));
      expect(updatedMintConfig.fixedAmount).toEqual(Bool(true));
      expect(updatedMintConfig.rangedAmount).toEqual(Bool(false));
    });

    it('should update fixedAmount config via field-specific function', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const mintConfigBefore = MintConfig.unpack(packedConfigsBefore);
      const originalUnauthorized = mintConfigBefore.unauthorized;
      const originalRangedAmount = mintConfigBefore.rangedAmount;

      const newFixedAmountValue = Bool(true);
      await updateMintConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.FIXED_AMOUNT,
        newFixedAmountValue,
        [user2.key, tokenAdmin.key]
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);

      expect(mintConfigAfter.fixedAmount).toEqual(newFixedAmountValue);
      expect(mintConfigAfter.unauthorized).toEqual(originalUnauthorized);
      expect(mintConfigAfter.rangedAmount).toEqual(newFixedAmountValue.not());
    });

    it('should reject mint fixed amount config update via field-specific function when unauthorized by the admin', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const mintConfigBefore = MintConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = mintConfigBefore.fixedAmount;
      const originalRangedAmount = mintConfigBefore.rangedAmount;
      const originalUnauthorized = mintConfigBefore.unauthorized;

      const attemptFixedAmountValue = Bool(false);
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';

      await updateMintConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.FIXED_AMOUNT,
        attemptFixedAmountValue,
        [user2.key],
        expectedErrorMessage
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);

      expect(mintConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(mintConfigAfter.rangedAmount).toEqual(originalRangedAmount);
      expect(mintConfigAfter.unauthorized).toEqual(originalUnauthorized);
    });

    it('should update mint ranged amount config via field-specific function', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const mintConfigBefore = MintConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = mintConfigBefore.fixedAmount;
      const originalUnauthorized = mintConfigBefore.unauthorized;
      const newRangedAmountValue = Bool(false);
      await updateMintConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.RANGED_AMOUNT,
        newRangedAmountValue,
        [user2.key, tokenAdmin.key]
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);

      expect(mintConfigAfter.rangedAmount).toEqual(newRangedAmountValue);
      expect(mintConfigAfter.fixedAmount).toEqual(newRangedAmountValue.not());
      expect(mintConfigAfter.unauthorized).toEqual(originalUnauthorized);
    });

    it('should reject rangedAmount config update via field-specific function when unauthorized by the admin', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const mintConfigBefore = MintConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = mintConfigBefore.fixedAmount;
      const originalRangedAmount = mintConfigBefore.rangedAmount;
      const originalUnauthorized = mintConfigBefore.unauthorized;

      const attemptRangedAmountValue = Bool(true);
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';

      await updateMintConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.RANGED_AMOUNT,
        attemptRangedAmountValue,
        [user2.key],
        expectedErrorMessage
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);

      expect(mintConfigAfter.rangedAmount).toEqual(originalRangedAmount);
      expect(mintConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(mintConfigAfter.unauthorized).toEqual(originalUnauthorized);
    });

    it('should update mint unauthorized config via field-specific function', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const mintConfigBefore = MintConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = mintConfigBefore.fixedAmount;
      const originalRangedAmount = mintConfigBefore.rangedAmount;

      const newUnauthorizedValue = Bool(true);
      await updateMintConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.UNAUTHORIZED,
        newUnauthorizedValue,
        [user2.key, tokenAdmin.key]
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);

      expect(mintConfigAfter.unauthorized).toEqual(newUnauthorizedValue);
      expect(mintConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(mintConfigAfter.rangedAmount).toEqual(originalRangedAmount);
    });

    it('should reject unauthorized config update via field-specific function when unauthorized by the admin', async () => {
      const packedConfigsBefore = tokenContract.packedAmountConfigs.get();
      const mintConfigBefore = MintConfig.unpack(packedConfigsBefore);
      const originalFixedAmount = mintConfigBefore.fixedAmount;
      const originalRangedAmount = mintConfigBefore.rangedAmount;
      const originalUnauthorized = mintConfigBefore.unauthorized;

      const attemptUnauthorizedValue = Bool(true);
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';

      await updateMintConfigPropertyTx(
        user2,
        CONFIG_PROPERTIES.UNAUTHORIZED,
        attemptUnauthorizedValue,
        [user2.key],
        expectedErrorMessage
      );

      const packedConfigsAfter = tokenContract.packedAmountConfigs.get();
      const mintConfigAfter = MintConfig.unpack(packedConfigsAfter);

      expect(mintConfigAfter.unauthorized).toEqual(originalUnauthorized);
      expect(mintConfigAfter.fixedAmount).toEqual(originalFixedAmount);
      expect(mintConfigAfter.rangedAmount).toEqual(originalRangedAmount);
    });
  });

  describe('Update Mint Params', () => {
    it('should reject mintParams update given an invalid range', async () => {
      mintParams = new MintParams({
        fixedAmount: UInt64.from(200),
        minAmount: UInt64.from(500),
        maxAmount: UInt64.from(0),
      });

      const expectedErrorMessage = ConfigErrors.invalidAmountRange;
      await updateMintParamsTx(
        user2,
        mintParams,
        [user2.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject mintParams update when unauthorized by the admin', async () => {
      mintParams = new MintParams({
        fixedAmount: UInt64.from(300),
        minAmount: UInt64.from(100),
        maxAmount: UInt64.from(900),
      });

      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateMintParamsTx(
        user1,
        mintParams,
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should update packed mintParams', async () => {
      await updateMintParamsTx(user1, mintParams, [user1.key, tokenAdmin.key]);
    });

    it('should reflect mint params updates in getAllConfigs()', async () => {
      const configsBefore = await tokenContract.getAllConfigs();

      const newMintParams = new MintParams({
        fixedAmount: UInt64.from(500),
        minAmount: UInt64.from(200),
        maxAmount: UInt64.from(1500),
      });

      await updateMintParamsTx(user1, newMintParams, [
        user1.key,
        tokenAdmin.key,
      ]);

      const configsAfter = await tokenContract.getAllConfigs();

      expect(configsAfter[0]).toEqual(configsBefore[0]); // packedAmountConfigs
      expect(configsAfter[1]).not.toEqual(configsBefore[1]); // packedMintParams
      expect(configsAfter[2]).toEqual(configsBefore[2]); // packedBurnParams
      expect(configsAfter[3]).toEqual(configsBefore[3]); // packedDynamicProofConfigs

      const updatedMintParams = MintParams.unpack(configsAfter[1]);
      expect(updatedMintParams.fixedAmount).toEqual(UInt64.from(500));
      expect(updatedMintParams.minAmount).toEqual(UInt64.from(200));
      expect(updatedMintParams.maxAmount).toEqual(UInt64.from(1500));
    });

    it('should update mint fixed amount via field-specific function', async () => {
      const paramsBeforeUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalMinAmount = paramsBeforeUpdate.minAmount;
      const originalMaxAmount = paramsBeforeUpdate.maxAmount;

      const newFixedAmount = UInt64.from(600);
      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.FIXED_AMOUNT,
        newFixedAmount,
        [user1.key, tokenAdmin.key]
      );

      const paramsAfterUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterUpdate.fixedAmount).toEqual(newFixedAmount);
      expect(paramsAfterUpdate.minAmount).toEqual(originalMinAmount);
      expect(paramsAfterUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should reject mint fixed amount update via field-specific function when unauthorized by the admin', async () => {
      1;
      const paramsBeforeAttempt = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const fixedAmountBeforeAttempt = paramsBeforeAttempt.fixedAmount;
      const minAmountBeforeAttempt = paramsBeforeAttempt.minAmount;
      const maxAmountBeforeAttempt = paramsBeforeAttempt.maxAmount;

      const newFixedAmountAttempt = UInt64.from(750);
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';

      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.FIXED_AMOUNT,
        newFixedAmountAttempt,
        [user1.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(
        fixedAmountBeforeAttempt
      );
      expect(paramsAfterFailedUpdate.minAmount).toEqual(minAmountBeforeAttempt);
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(maxAmountBeforeAttempt);
    });

    it('should update mint min amount via field-specific function', async () => {
      const paramsBeforeUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalFixedAmount = paramsBeforeUpdate.fixedAmount;
      const originalMaxAmount = paramsBeforeUpdate.maxAmount;

      const newMinAmount = UInt64.from(50);
      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MIN_AMOUNT,
        newMinAmount,
        [user1.key, tokenAdmin.key]
      );

      const paramsAfterUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterUpdate.minAmount).toEqual(newMinAmount);
      expect(paramsAfterUpdate.fixedAmount).toEqual(originalFixedAmount); // Should not change
      expect(paramsAfterUpdate.maxAmount).toEqual(originalMaxAmount); // Should not change
    });

    it('should reject mint min amount update via field-specific function when unauthorized by the admin', async () => {
      const paramsBeforeAttempt = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const newMinAmountAttempt = UInt64.from(150);
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';

      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MIN_AMOUNT,
        newMinAmountAttempt,
        [user1.key], // No admin signature
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should reject mint min amount update via field-specific function when minAmount > maxAmount', async () => {
      const paramsBeforeAttempt = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const invalidNewMinAmount = originalMaxAmount.add(100);
      const expectedErrorMessage = ConfigErrors.invalidAmountRange;

      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MIN_AMOUNT,
        invalidNewMinAmount,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
    });

    it('should update mint max amount via field-specific function', async () => {
      const paramsBeforeUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalFixedAmount = paramsBeforeUpdate.fixedAmount;
      const originalMinAmount = paramsBeforeUpdate.minAmount;

      const newMaxAmount = UInt64.from(1200);
      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MAX_AMOUNT,
        newMaxAmount,
        [user1.key, tokenAdmin.key]
      );

      const paramsAfterUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterUpdate.maxAmount).toEqual(newMaxAmount);
      expect(paramsAfterUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterUpdate.minAmount).toEqual(originalMinAmount);
    });

    it('should reject mint max amount update via field-specific function when unauthorized by the admin', async () => {
      const paramsBeforeAttempt = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const newMaxAmountAttempt = UInt64.from(1300);
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';

      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MAX_AMOUNT,
        newMaxAmountAttempt,
        [user1.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
    });

    it('should reject mint max amount update via field-specific function when maxAmount < minAmount', async () => {
      const paramsBeforeAttempt = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      const originalFixedAmount = paramsBeforeAttempt.fixedAmount;
      const originalMinAmount = paramsBeforeAttempt.minAmount;
      const originalMaxAmount = paramsBeforeAttempt.maxAmount;

      const invalidNewMaxAmount = originalMinAmount.sub(10);
      const expectedErrorMessage = ConfigErrors.invalidAmountRange;

      await updateMintParamsPropertyTx(
        user1,
        PARAMS_PROPERTIES.MAX_AMOUNT,
        invalidNewMaxAmount,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );

      const paramsAfterFailedUpdate = MintParams.unpack(
        tokenContract.packedMintParams.get()
      );
      expect(paramsAfterFailedUpdate.maxAmount).toEqual(originalMaxAmount);
      expect(paramsAfterFailedUpdate.fixedAmount).toEqual(originalFixedAmount);
      expect(paramsAfterFailedUpdate.minAmount).toEqual(originalMinAmount);
    });
  });

  describe('Mint Config: Unauthorized/Fixed', () => {
    it('should allow minting without authorization', async () => {
      await testMintTx(user2, UInt64.from(600), [user2.key], undefined, 1);
    });

    it('should allow minting without authorization with mintSideloadDisabled', async () => {
      const mintAmount = UInt64.from(600);
      await testMintSideloadDisabledTx(user2, mintAmount, [user2.key], '');
    });

    it('should reject minting an amount different from the fixed value', async () => {
      await testMintTx(
        user1,
        UInt64.from(500),
        [user1.key],
        FungibleTokenErrors.noPermissionToMint
      );
    });

    it('should reject minting an amount different from the fixed value with mintSideloadDisabled', async () => {
      const wrongMintAmount = UInt64.from(55);
      await testMintSideloadDisabledTx(
        user1,
        wrongMintAmount,
        [user1.key],
        FungibleTokenErrors.noPermissionToMint
      );
    });

    it('should reject minting an amount different from the fixed value with mintSideloadDisabled', async () => {
      const wrongMintAmount = UInt64.from(55);
      await testMintSideloadDisabledTx(
        user1,
        wrongMintAmount,
        [user1.key],
        FungibleTokenErrors.noPermissionToMint
      );
    });
  });

  describe('Update Mint Dynamic Proof Config', () => {
    it('should reject mintDynamicProofConfig update when unauthorized by the admin', async () => {
      try {
        let mintDynamicProofConfig = MintDynamicProofConfig.default;
        mintDynamicProofConfig.shouldVerify = Bool(true);

        const updateMintDynamicProofConfigTx = await Mina.transaction(
          { sender: user2, fee },
          async () => {
            await tokenContract.updateMintDynamicProofConfig(
              mintDynamicProofConfig
            );
          }
        );
        await updateMintDynamicProofConfigTx.prove();
        await updateMintDynamicProofConfigTx.sign([user2.key]).send().wait();
      } catch (error: unknown) {
        const expectedErrorMessage =
          'the required authorization was not provided or is invalid';
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('update mint dynamic proof config: enable side-loaded verification', async () => {
      let mintDynamicProofConfig = MintDynamicProofConfig.default;
      mintDynamicProofConfig.shouldVerify = Bool(true);

      const updateMintDynamicProofConfigTx = await Mina.transaction(
        { sender: user2, fee },
        async () => {
          await tokenContract.updateMintDynamicProofConfig(
            mintDynamicProofConfig
          );
        }
      );
      await updateMintDynamicProofConfigTx.prove();
      await updateMintDynamicProofConfigTx
        .sign([user2.key, tokenAdmin.key])
        .send()
        .wait();
    });
  });

  describe('Update Side-loaded vKey Hash', () => {
    it('should reject updating side-loaded vKey hash: unauthorized by the admin', async () => {
      const expectedErrorMessage =
        'the required authorization was not provided or is invalid.';
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.Mint,
        [user1.key],
        expectedErrorMessage
      );
    });

    it('should reject updating side-loaded vKey hash: invalid operationKey', async () => {
      const expectedErrorMessage = FungibleTokenErrors.invalidOperationKey;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        Field(5),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject updating side-loaded vKey hash: non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        tamperedVKeyMap,
        OperationKeys.Mint,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject mint if vKeyHash was never updated', async () => {
      const expectedErrorMessage = FungibleTokenErrors.missingVKeyForOperation;

      await testMintSLTx(
        user2,
        UInt64.from(600),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should update the side-loaded vKey hash for mints', async () => {
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.Mint,
        [user1.key, tokenAdmin.key]
      );
      vKeyMap.set(OperationKeys.Mint, programVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });
  });

  // SLV = Side-Loaded Verification (enabled)
  describe('Mint Config: Unauthorized/Ranged/SLV Mint', () => {
    it('should reject mint given a non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;

      await testMintSLTx(
        user2,
        UInt64.from(600),
        [user2.key],
        dummyProof,
        dummyVkey,
        tamperedVKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given a non-compliant vKey hash', async () => {
      const expectedErrorMessage = FungibleTokenErrors.invalidSideLoadedVKey;

      await testMintSLTx(
        user2,
        UInt64.from(600),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! only passes when `proofsEnabled=true`
    (!proofsEnabled ? it.skip : it)(
      'should reject mint given an invalid proof',
      async () => {
        await program2.compile();
        const mintAmount = UInt64.from(600);
        const invalidProof = await generateDynamicProof2(
          tokenContract.deriveTokenId(),
          user1
        );

        const expectedErrorMessage = TEST_ERROR_MESSAGES.CONSTRAINT_UNSATISFIED;
        await testMintSLTx(
          user1,
          mintAmount,
          [user1.key],
          invalidProof,
          programVkey,
          vKeyMap,
          expectedErrorMessage
        );
      }
    );

    it('should mint given a valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const mintAmount = UInt64.from(600);
      await testMintSLTx(
        user2,
        mintAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap
      );
    });

    it('should reject mint for a non-compliant proof recipient', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = FungibleTokenErrors.recipientMismatch;
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireTokenIdMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(Field(1), user1);

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = FungibleTokenErrors.tokenIdMismatch;
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireMinaBalanceMatch precondition', async () => {
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

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = FungibleTokenErrors.minaBalanceMismatch;
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireCustomTokenBalanceMatch precondition', async () => {
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
            UInt64.from(100),
            dynamicProof,
            programVkey,
            vKeyMap
          );
        }
      );
      await burnTx.prove();
      await burnTx.sign([user1.key, user2.key]).send().wait();

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage =
        FungibleTokenErrors.customTokenBalanceMismatch;
      await testMintSLTx(
        user2,
        mintAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint given an invalid proof requireMinaNonceMatch precondition', async () => {
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

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = FungibleTokenErrors.minaNonceMismatch;
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! supposed to fail but didn't -> we might need to remove the token account nonce precondition
    it.skip('should reject mint given an invalid proof requireCustomTokenNonceMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      // user1 pays for tx fees to not get a "mina account balance mismatch" error
      // user2 transfer custom tokens to user1 to increase the nonce of his token account
      // user1 transfer custom tokens to user2 to conserve the the total token balance of user2
      const transfersTx = await Mina.transaction(
        { sender: user1, fee },
        async () => {
          await tokenContract.transferCustomWithProof(
            user1,
            user2,
            UInt64.from(100),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
          await tokenContract.transferCustomWithProof(
            user2,
            user1,
            UInt64.from(100),
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        }
      );

      await transfersTx.prove();
      transfersTx.sign([user1.key, user2.key]).send().wait();

      const mintAmount = UInt64.from(600);
      const expectedErrorMessage = 'Mismatch in MINA account nonce!';
      await testMintSLTx(
        user1,
        mintAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject mint when side-loaded verification is enabled with mintSideloadDisabled', async () => {
      const mintAmount = UInt64.from(100);
      await testMintSideloadDisabledTx(
        user1,
        mintAmount,
        [user1.key, tokenAdmin.key],
        FungibleTokenErrors.noPermissionForSideloadDisabledOperation
      );
    });
  });
});
