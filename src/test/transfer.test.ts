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
} from '../configs.js';
import {
  program,
  generateDummyDynamicProof,
  generateDynamicProof,
  generateDynamicProof2,
  SideloadedProof,
  program2,
} from '../side-loaded/program.eg.js';
import { TEST_ERROR_MESSAGES } from './constants.js';

const proofsEnabled = true;

describe('Fungible Token - Transfer Tests', () => {
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
    user2: Mina.TestPublicKey,
    user3: Mina.TestPublicKey;

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

    [deployer, user1, user2, user3] = localChain.testAccounts;
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

  async function testTransferTx(
    sender: PublicKey,
    receiver: PublicKey,
    transferAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string,
    numberOfAccounts = 1
  ) {
    try {
      const senderBalanceBefore = await tokenContract.getBalanceOf(sender);
      const receiverBalanceBefore = await tokenContract.getBalanceOf(receiver);
      const tx = await Mina.transaction({ sender, fee }, async () => {
        AccountUpdate.fundNewAccount(sender, numberOfAccounts);
        await tokenContract.transferCustomWithProof(
          sender,
          receiver,
          transferAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const senderBalanceAfter = await tokenContract.getBalanceOf(sender);
      const receiverBalanceAfter = await tokenContract.getBalanceOf(receiver);
      expect(senderBalanceAfter).toEqual(
        senderBalanceBefore.sub(transferAmount)
      );
      expect(receiverBalanceAfter).toEqual(
        receiverBalanceBefore.add(transferAmount)
      );

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
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

  async function testTransferSLTx(
    sender: PublicKey,
    receiver: PublicKey,
    transferAmount: UInt64,
    signers: PrivateKey[],
    proof?: SideloadedProof,
    vKey?: VerificationKey,
    vKeyMerkleMap?: VKeyMerkleMap,
    expectedErrorMessage?: string
  ) {
    try {
      const senderBalanceBefore = await tokenContract.getBalanceOf(sender);
      const receiverBalanceBefore = await tokenContract.getBalanceOf(receiver);
      const tx = await Mina.transaction({ sender: sender, fee }, async () => {
        await tokenContract.transferCustomWithProof(
          sender,
          receiver,
          transferAmount,
          proof ?? dummyProof,
          vKey ?? dummyVkey,
          vKeyMerkleMap ?? vKeyMap
        );
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const senderBalanceAfter = await tokenContract.getBalanceOf(sender);
      const receiverBalanceAfter = await tokenContract.getBalanceOf(receiver);
      expect(senderBalanceAfter).toEqual(
        senderBalanceBefore.sub(transferAmount)
      );
      expect(receiverBalanceAfter).toEqual(
        receiverBalanceBefore.add(transferAmount)
      );

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testTransferSideloadDisabledTx(
    sender: PublicKey,
    receiver: PublicKey,
    transferAmount: UInt64,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const senderBalanceBefore = await tokenContract.getBalanceOf(sender);
      const receiverBalanceBefore = await tokenContract.getBalanceOf(receiver);
      const tx = await Mina.transaction({ sender: sender, fee }, async () => {
        await tokenContract.transferCustom(sender, receiver, transferAmount);
      });
      await tx.prove();
      await tx.sign(signers).send().wait();

      const senderBalanceAfter = await tokenContract.getBalanceOf(sender);
      const receiverBalanceAfter = await tokenContract.getBalanceOf(receiver);
      expect(senderBalanceAfter).toEqual(
        senderBalanceBefore.sub(transferAmount)
      );
      expect(receiverBalanceAfter).toEqual(
        receiverBalanceBefore.add(transferAmount)
      );

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

  // SLV = Side-Loaded Verification
  describe('Transfer Operations - Sideload Disabled', () => {
    it('should do a transfer from user2 to user3', async () => {
      const transferAmount = UInt64.from(100);
      await testTransferTx(user2, user3, transferAmount, [user2.key]);
    });

    it('should do a transfer from user2 to user3 using sideload-disabled method', async () => {
      const transferAmount = UInt64.from(100);
      await testTransferSideloadDisabledTx(user2, user3, transferAmount, [
        user2.key,
      ]);
    });

    it('should reject a transaction not signed by the token holder', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage =
        TEST_ERROR_MESSAGES.INVALID_SIGNATURE_FEE_PAYER;
      await testTransferTx(
        user1,
        user3,
        transferAmount,
        [user3.key],
        expectedErrorMessage
      );
    });

    it('should reject a transaction not signed by the token holder using sideload-disabled method', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage = TEST_ERROR_MESSAGES.INVALID_SIGNATURE_FEE_PAYER;
      await testTransferSideloadDisabledTx(
        user1,
        user3,
        transferAmount,
        [user3.key],
        expectedErrorMessage
      );
    });

    it('should prevent transfers from account that\'s tracking circulation', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage =
        FungibleTokenErrors.noTransferFromCirculation;
      await testTransferTx(
        tokenA,
        user3,
        transferAmount,
        [user3.key],
        expectedErrorMessage
      );
    });

    it('should prevent transfers from account that\'s tracking circulation using sideload-disabled method', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage =
        FungibleTokenErrors.noTransferFromCirculation;
      await testTransferSideloadDisabledTx(
        tokenA,
        user3,
        transferAmount,
        [user3.key],
        expectedErrorMessage
      );
    });

    it('should prevent transfers to account that\'s tracking circulation', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage =
        FungibleTokenErrors.noTransferFromCirculation;
      await testTransferTx(
        user1,
        tokenA,
        transferAmount,
        [user3.key],
        expectedErrorMessage
      );
    });

    it('should prevent transfers to account that\'s tracking circulation using sideload-disabled method', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage =
        FungibleTokenErrors.noTransferFromCirculation;
      await testTransferSideloadDisabledTx(
        user1,
        tokenA,
        transferAmount,
        [user3.key],
        expectedErrorMessage
      );
    });
  });

  describe('Transfer Dynamic Proof Config Updates', () => {
    it('should reject transferDynamicProofConfig update when unauthorized by admin', async () => {
      try {
        let transferDynamicProofConfig = TransferDynamicProofConfig.default;
        transferDynamicProofConfig.shouldVerify = Bool(true);

        const updateTransferDynamicProofConfigTx = await Mina.transaction(
          { sender: user2, fee },
          async () => {
            await tokenContract.updateDynamicProofConfig(
              OperationKeys.Transfer,
              transferDynamicProofConfig
            );
          }
        );
        await updateTransferDynamicProofConfigTx.prove();
        await updateTransferDynamicProofConfigTx
          .sign([user2.key])
          .send()
          .wait();
      } catch (error: unknown) {
        const expectedErrorMessage = TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('should update transfer dynamic proof config: enable side-loaded verification', async () => {
      let transferDynamicProofConfig = TransferDynamicProofConfig.default;
      transferDynamicProofConfig.shouldVerify = Bool(true);

      const updateTransferDynamicProofConfigTx = await Mina.transaction(
        { sender: user2, fee },
        async () => {
          await tokenContract.updateDynamicProofConfig(
            OperationKeys.Transfer,
            transferDynamicProofConfig
          );
        }
      );
      await updateTransferDynamicProofConfigTx.prove();
      await updateTransferDynamicProofConfigTx
        .sign([user2.key, tokenAdmin.key])
        .send()
        .wait();
    });
  });

  describe('Side-loaded Verification Key Updates', () => {
    it('should reject updating sideloaded verification key hash: unauthorized by admin', async () => {
      const expectedErrorMessage = TEST_ERROR_MESSAGES.NO_AUTHORIZATION_PROVIDED;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.Transfer,
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
        Field(13),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject updating sideloaded verification key hash: non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(13n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        tamperedVKeyMap,
        OperationKeys.Transfer,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject transfer if vKeyHash was never updated', async () => {
      const expectedErrorMessage = FungibleTokenErrors.missingVKeyForOperation;

      await testTransferSLTx(
        user2,
        user3,
        UInt64.from(150),
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should update the sideloaded verification key hash for transfers', async () => {
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.Transfer,
        [user1.key, tokenAdmin.key]
      );
      vKeyMap.set(OperationKeys.Transfer, programVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });
  });

  describe('Side-loaded Transfer Operations', () => {
    it('should reject transfer with non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(6n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;

      await testTransferSLTx(
        user2,
        user3,
        UInt64.from(50),
        [user2.key],
        dummyProof,
        dummyVkey,
        tamperedVKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject transferSideloadDisabled when side-loading is enabled', async () => {
      const transferAmount = UInt64.from(100);
      const expectedErrorMessage =
        FungibleTokenErrors.noPermissionForSideloadDisabledOperation;
      await testTransferSideloadDisabledTx(
        user2,
        user3,
        transferAmount,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('should reject transfer with non-compliant vKey hash', async () => {
      const expectedErrorMessage = FungibleTokenErrors.invalidSideLoadedVKey;

      await testTransferSLTx(
        user2,
        user1,
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
      'should reject transfer with invalid proof',
      async () => {
        await program2.compile();
        const transferAmount = UInt64.from(150);
        const invalidProof = await generateDynamicProof2(
          tokenContract.deriveTokenId(),
          user1
        );

        const expectedErrorMessage = TEST_ERROR_MESSAGES.CONSTRAINT_UNSATISFIED;
        await testTransferSLTx(
          user1,
          deployer,
          transferAmount,
          [user1.key],
          invalidProof,
          programVkey,
          vKeyMap,
          expectedErrorMessage
        );
      }
    );

    it('should transfer with valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const transferAmount = UInt64.from(150);
      await testTransferSLTx(
        user2,
        user1,
        transferAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap
      );
    });

    it('should reject transfer for a non-compliant proof recipient', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      const transferAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.recipientMismatch;
      await testTransferSLTx(
        user1,
        user3,
        transferAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject transfer with invalid proof requireTokenIdMatch precondition', async () => {
      const dynamicProof = await generateDynamicProof(Field(1), user1);

      const transferAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.tokenIdMismatch;
      await testTransferSLTx(
        user1,
        user3,
        transferAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject transfer with invalid proof requireMinaBalanceMatch precondition', async () => {
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

      const transferAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.minaBalanceMismatch;
      await testTransferSLTx(
        user1,
        user3,
        transferAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject transfer with invalid proof requireCustomTokenBalanceMatch precondition', async () => {
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

      const transferAmount = UInt64.from(150);
      const expectedErrorMessage =
        FungibleTokenErrors.customTokenBalanceMismatch;
      await testTransferSLTx(
        user2,
        user3,
        transferAmount,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject transfer with invalid proof requireMinaNonceMatch precondition', async () => {
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

      const transferAmount = UInt64.from(150);
      const expectedErrorMessage = FungibleTokenErrors.minaNonceMismatch;
      await testTransferSLTx(
        user1,
        user3,
        transferAmount,
        [user1.key],
        dynamicProof,
        programVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });
  });
});
