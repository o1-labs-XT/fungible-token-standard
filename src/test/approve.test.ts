import {
  AccountUpdate,
  Bool,
  Field,
  Int64,
  Mina,
  PrivateKey,
  PublicKey,
  UInt64,
  UInt8,
  VerificationKey,
  Permissions,
  AccountUpdateForest,
  ZkProgram,
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
  PublicInputs,
  PublicOutputs,
} from '../side-loaded/program.eg.js';
import { TEST_ERROR_MESSAGES } from './constants.js';

const proofsEnabled = false;

describe('New Token Standard ApproveBase Tests', () => {
  let tokenAdmin: Mina.TestPublicKey, tokenA: Mina.TestPublicKey;

  let fee: number,
    tokenContract: FungibleToken,
    mintParams: MintParams,
    burnParams: BurnParams,
    vKeyMap: VKeyMerkleMap,
    dummyVkey: VerificationKey,
    dummyProof: SideloadedProof,
    programVkey: VerificationKey,
    pausedVkey: VerificationKey,
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
    pausedVkey = (await pauseProgram.compile()).verificationKey;

    fee = 1e8;
  });

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

  async function testApproveBaseSLTx(
    sender: PublicKey,
    receiver: PublicKey,
    signers: PrivateKey[],
    proof?: SideloadedProof,
    vKey?: VerificationKey,
    vKeyMerkleMap?: VKeyMerkleMap,
    expectedErrorMessage?: string
  ) {
    try {
      const senderBalanceBefore = await tokenContract.getBalanceOf(sender);
      const receiverBalanceBefore = await tokenContract.getBalanceOf(receiver);

      const sendAmount = UInt64.from(50);
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();

      const updateReceive = AccountUpdate.create(
        receiver,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee,
        },
        async () => {
          await tokenContract.approveAccountUpdatesCustomWithProof(
            [updateSend, updateReceive],
            proof ?? dummyProof,
            vKey ?? dummyVkey,
            vKeyMerkleMap ?? vKeyMap
          );
        }
      );
      await tx.sign(signers).prove();
      await tx.send();

      const senderBalanceAfter = await tokenContract.getBalanceOf(sender);
      const receiverBalanceAfter = await tokenContract.getBalanceOf(receiver);
      expect(senderBalanceAfter).toEqual(senderBalanceBefore.sub(sendAmount));
      expect(receiverBalanceAfter).toEqual(
        receiverBalanceBefore.add(sendAmount)
      );

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  async function testApproveSideloadDisabledTx(
    sender: PublicKey,
    receiver: PublicKey,
    signers: PrivateKey[],
    expectedErrorMessage?: string
  ) {
    try {
      const senderBalanceBefore = await tokenContract.getBalanceOf(sender);
      const receiverBalanceBefore = await tokenContract.getBalanceOf(receiver);

      const sendAmount = UInt64.from(50);
      const updateSend = AccountUpdate.createSigned(
        sender,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();

      const updateReceive = AccountUpdate.create(
        receiver,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const tx = await Mina.transaction(
        {
          sender: sender,
          fee,
        },
        async () => {
          await tokenContract.approveAccountUpdatesCustom([
            updateSend,
            updateReceive,
          ]);
        }
      );
      await tx.sign(signers).prove();
      await tx.send();

      const senderBalanceAfter = await tokenContract.getBalanceOf(sender);
      const receiverBalanceAfter = await tokenContract.getBalanceOf(receiver);
      expect(senderBalanceAfter).toEqual(senderBalanceBefore.sub(sendAmount));
      expect(receiverBalanceAfter).toEqual(
        receiverBalanceBefore.add(sendAmount)
      );

      if (expectedErrorMessage)
        throw new Error('Test should have failed but didnt!');
    } catch (error: unknown) {
      expect((error as Error).message).toContain(expectedErrorMessage);
    }
  }

  describe('Deploy & initialize', () => {
    it('should deploy tokenA contract', async () => {
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

    it('should initialize tokenA contract', async () => {
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
  describe('ApproveBase: SLV disabled', () => {
    it('should do a transfer from user2 to user3', async () => {
      const transferAmount = UInt64.from(100);
      const senderBalanceBefore = await tokenContract.getBalanceOf(user2);
      const receiverBalanceBefore = await tokenContract.getBalanceOf(user3);
      const tx = await Mina.transaction({ sender: user2, fee }, async () => {
        AccountUpdate.fundNewAccount(user2, 1);
        await tokenContract.transferCustomWithProof(
          user2,
          user3,
          transferAmount,
          dummyProof,
          dummyVkey,
          vKeyMap
        );
      });
      await tx.prove();
      await tx.sign([user2.key]).send().wait();

      const senderBalanceAfter = await tokenContract.getBalanceOf(user2);
      const receiverBalanceAfter = await tokenContract.getBalanceOf(user3);
      expect(senderBalanceAfter).toEqual(
        senderBalanceBefore.sub(transferAmount)
      );
      expect(receiverBalanceAfter).toEqual(
        receiverBalanceBefore.add(transferAmount)
      );
    });

    it('should do a transaction constructed manually, approved by the token contract', async () => {
      const initialBalanceSender = (
        await tokenContract.getBalanceOf(user2)
      ).toBigInt();
      const initialBalanceReceiver = (
        await tokenContract.getBalanceOf(user3)
      ).toBigInt();
      const initialCirculating = (
        await tokenContract.getCirculating()
      ).toBigInt();

      const sendAmount = UInt64.from(50);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();

      const updateReceive = AccountUpdate.create(
        user3,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const tx = await Mina.transaction(
        {
          sender: deployer,
          fee,
        },
        async () => {
          await tokenContract.approveAccountUpdatesCustomWithProof(
            [updateSend, updateReceive],
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        }
      );
      await tx.sign([user2.key, deployer.key]).prove();
      await tx.send();

      expect((await tokenContract.getBalanceOf(user2)).toBigInt()).toEqual(
        initialBalanceSender - sendAmount.toBigInt()
      );
      expect((await tokenContract.getBalanceOf(user3)).toBigInt()).toEqual(
        initialBalanceReceiver + sendAmount.toBigInt()
      );
      expect((await tokenContract.getCirculating()).toBigInt()).toEqual(
        initialCirculating
      );
    });

    it('should reject flash-minting transactions', async () => {
      const sendAmount = UInt64.from(50);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);
      updateReceive;
      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustomWithProof(
              [updateReceive, updateSend],
              dummyProof,
              dummyVkey,
              vKeyMap
            );
          }
        );
      };
      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.flashMinting
      );
    });

    it('should reject unbalanced transactions', async () => {
      const sendAmount = UInt64.from(1);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount).mul(2);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(deployer, async () => {
          await tokenContract.approveAccountUpdatesCustomWithProof(
            [updateSend, updateReceive],
            dummyProof,
            dummyVkey,
            vKeyMap
          );
        });
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.flashMinting
      );
    });

    it('rejects transactions with mismatched tokens', async () => {
      const sendAmount = UInt64.from(10);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(user1, Field(1));
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            AccountUpdate.fundNewAccount(user2, 1);
            await tokenContract.approveAccountUpdatesCustomWithProof(
              [updateSend, updateReceive],
              dummyProof,
              dummyVkey,
              vKeyMap
            );
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.unbalancedTransaction
      );
    });

    it("Should reject manually constructed transfers from the account that's tracking circulation", async () => {
      const sendAmount = UInt64.from(10);

      const updateSend = AccountUpdate.createSigned(
        tokenA,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustomWithProof(
              [updateSend, updateReceive],
              dummyProof,
              dummyVkey,
              vKeyMap
            );
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it("Should reject manually constructed transfers to the account that's tracking circulation", async () => {
      const sendAmount = UInt64.from(10);

      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        tokenA,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustomWithProof(
              [updateSend, updateReceive],
              dummyProof,
              dummyVkey,
              vKeyMap
            );
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it('should do a transaction constructed manually with approveSideloadDisabled', async () => {
      const sendAmount = UInt64.from(10);

      const updateSend = AccountUpdate.createSigned(
        tokenA,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustom([
              updateSend,
              updateReceive,
            ]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it('should reject flash-minting transactions with approveSideloadDisabled', async () => {
      const sendAmount = UInt64.from(50);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);
      updateReceive;
      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustom([
              updateReceive,
              updateSend,
            ]);
          }
        );
      };
      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.flashMinting
      );
    });

    it('should reject unbalanced transactions with approveSideloadDisabled', async () => {
      const sendAmount = UInt64.from(1);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount).mul(2);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(deployer, async () => {
          await tokenContract.approveAccountUpdatesCustom([
            updateSend,
            updateReceive,
          ]);
        });
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.flashMinting
      );
    });

    it('rejects transactions with mismatched tokens with approveSideloadDisabled', async () => {
      const sendAmount = UInt64.from(10);
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(user1, Field(1));
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            AccountUpdate.fundNewAccount(user2, 1);
            await tokenContract.approveAccountUpdatesCustom([
              updateSend,
              updateReceive,
            ]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.unbalancedTransaction
      );
    });

    it("Should reject manually constructed transfers from the account that's tracking circulation with approveSideloadDisabled", async () => {
      const sendAmount = UInt64.from(10);

      const updateSend = AccountUpdate.createSigned(
        tokenA,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        user1,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustom([
              updateSend,
              updateReceive,
            ]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });

    it("Should reject manually constructed transfers to the account that's tracking circulation with approveSideloadDisabled", async () => {
      const sendAmount = UInt64.from(10);

      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.balanceChange = Int64.fromUnsigned(sendAmount).neg();
      const updateReceive = AccountUpdate.create(
        tokenA,
        tokenContract.deriveTokenId()
      );
      updateReceive.balanceChange = Int64.fromUnsigned(sendAmount);

      const approveAccountUpdatesTx = async () => {
        await Mina.transaction(
          {
            sender: deployer,
            fee,
          },
          async () => {
            await tokenContract.approveAccountUpdatesCustom([
              updateSend,
              updateReceive,
            ]);
          }
        );
      };

      expect(approveAccountUpdatesTx).rejects.toThrowError(
        FungibleTokenErrors.noTransferFromCirculation
      );
    });
  });

  describe('account permissions', () => {
    it("should reject a transaction that's changing the account permission for receive", async () => {
      const permissions = Mina.getAccount(
        user2,
        tokenContract.deriveTokenId()
      ).permissions;
      permissions.receive = Permissions.impossible();
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.account.permissions.set(permissions);

      const approveBaseTx = async () => {
        await Mina.transaction(
          {
            sender: user2,
            fee,
          },
          async () => {
            await tokenContract.approveBaseCustomWithProof(
              AccountUpdateForest.fromFlatArray([updateSend]),
              dummyProof,
              dummyVkey,
              vKeyMap
            );
          }
        );
      };

      expect(approveBaseTx).rejects.toThrowError(
        FungibleTokenErrors.noPermissionChangeAllowed
      );
    });
    it("should reject a transaction that's changing the account permission for receive with approveBaseSideloadDisabled", async () => {
      const permissions = Mina.getAccount(
        user2,
        tokenContract.deriveTokenId()
      ).permissions;
      permissions.receive = Permissions.impossible();
      const updateSend = AccountUpdate.createSigned(
        user2,
        tokenContract.deriveTokenId()
      );
      updateSend.account.permissions.set(permissions);

      const approveBaseTx = async () => {
        await Mina.transaction(
          {
            sender: user2,
            fee,
          },
          async () => {
            await tokenContract.approveBaseCustom(
              AccountUpdateForest.fromFlatArray([updateSend])
            );
          }
        );
      };

      expect(approveBaseTx).rejects.toThrowError(
        FungibleTokenErrors.noPermissionChangeAllowed
      );
    });
  });

  describe('Update Updates Dynamic Proof Config', () => {
    it('should reject updatesDynamicProofConfig update when unauthorized by the admin', async () => {
      try {
        let updatesDynamicProofConfig = UpdatesDynamicProofConfig.default;
        updatesDynamicProofConfig.shouldVerify = Bool(true);

        const updateUpdatesDynamicProofConfigTx = await Mina.transaction(
          { sender: user2, fee },
          async () => {
            await tokenContract.updateDynamicProofConfig(
              OperationKeys.ApproveBase,
              updatesDynamicProofConfig
            );
          }
        );
        await updateUpdatesDynamicProofConfigTx.prove();
        await updateUpdatesDynamicProofConfigTx.sign([user2.key]).send().wait();
      } catch (error: unknown) {
        const expectedErrorMessage =
          'the required authorization was not provided or is invalid';
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });

    it('update updates dynamic proof config: enable side-loaded verification', async () => {
      let updatesDynamicProofConfig = UpdatesDynamicProofConfig.default;
      updatesDynamicProofConfig.shouldVerify = Bool(true);

      const updateUpdatesDynamicProofConfigTx = await Mina.transaction(
        { sender: user2, fee },
        async () => {
          await tokenContract.updateDynamicProofConfig(
            OperationKeys.ApproveBase,
            updatesDynamicProofConfig
          );
        }
      );
      await updateUpdatesDynamicProofConfigTx.prove();
      await updateUpdatesDynamicProofConfigTx
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
        OperationKeys.ApproveBase,
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
        Field(14),
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject updating side-loaded vKey hash: non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(14n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        tamperedVKeyMap,
        OperationKeys.ApproveBase,
        [user1.key, tokenAdmin.key],
        expectedErrorMessage
      );
    });

    it('should reject approveBase if vKeyHash was never updated', async () => {
      const expectedErrorMessage = FungibleTokenErrors.missingVKeyForOperation;

      await testApproveBaseSLTx(
        user2,
        user3,
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    it('should update the side-loaded vKey hash for updates', async () => {
      await updateSLVkeyHashTx(
        user1,
        programVkey,
        vKeyMap,
        OperationKeys.ApproveBase,
        [user1.key, tokenAdmin.key]
      );
      vKeyMap.set(OperationKeys.ApproveBase, programVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });
  });

  describe('ApproveBase: SLV enabled', () => {
    it('should reject approveBase given a non-compliant vKeyMap', async () => {
      let tamperedVKeyMap = vKeyMap.clone();
      tamperedVKeyMap.insert(8n, Field.random());

      const expectedErrorMessage = FungibleTokenErrors.vKeyMapOutOfSync;

      await testApproveBaseSLTx(
        user2,
        user3,
        [user2.key],
        dummyProof,
        dummyVkey,
        tamperedVKeyMap,
        expectedErrorMessage
      );
    });

    it('should reject approveSideloadDisabled when side-loading is enabled', async () => {
      const expectedErrorMessage =
        FungibleTokenErrors.noPermissionForSideloadDisabledOperation;
      await testApproveSideloadDisabledTx(
        user2,
        user3,
        [user2.key],
        expectedErrorMessage
      );
    });

    it('should reject approveBase given a non-compliant vKey hash', async () => {
      const expectedErrorMessage = FungibleTokenErrors.invalidSideLoadedVKey;
      await testApproveBaseSLTx(
        user2,
        user1,
        [user2.key],
        dummyProof,
        dummyVkey,
        vKeyMap,
        expectedErrorMessage
      );
    });

    //! only passes when `proofsEnabled=true`
    (!proofsEnabled ? test.skip : it)(
      'should reject approveBase given an invalid proof',
      async () => {
        await program2.compile();
        const invalidProof = await generateDynamicProof2(
          tokenContract.deriveTokenId(),
          user1
        );

        const expectedErrorMessage = TEST_ERROR_MESSAGES.CONSTRAINT_UNSATISFIED;
        await testApproveBaseSLTx(
          user1,
          deployer,
          [user1.key],
          invalidProof,
          programVkey,
          vKeyMap,
          expectedErrorMessage
        );
      }
    );

    it('should approve updates given a valid proof', async () => {
      const dynamicProof = await generateDynamicProof(
        tokenContract.deriveTokenId(),
        user2
      );

      await testApproveBaseSLTx(
        user2,
        user1,
        [user2.key],
        dynamicProof,
        programVkey,
        vKeyMap
      );
    });

    it('should update the side-loaded vKey hash for updates to pause the method', async () => {
      await updateSLVkeyHashTx(
        user1,
        pausedVkey,
        vKeyMap,
        OperationKeys.ApproveBase,
        [user1.key, tokenAdmin.key]
      );
      vKeyMap.set(OperationKeys.ApproveBase, pausedVkey.hash);
      expect(tokenContract.vKeyMapRoot.get()).toEqual(vKeyMap.root);
    });

    it('should reject generating a paused proof as the constraint is always unsatisfied', async () => {
      const expectedErrorMessage = TEST_ERROR_MESSAGES.PAUSED_METHOD;
      try {
        const pausedProof = await generatePauseProof(
          tokenContract.deriveTokenId(),
          PublicKey.empty()
        );

        await testApproveBaseSLTx(
          user2,
          user1,
          [user2.key],
          pausedProof,
          pausedVkey,
          vKeyMap
        );
        throw new Error('Test should have failed but didnt!');
      } catch (error: unknown) {
        expect((error as Error).message).toContain(expectedErrorMessage);
      }
    });
  });
});

const pauseProgram = ZkProgram({
  name: 'paused-updates',
  publicInput: PublicInputs,
  publicOutput: PublicOutputs,
  methods: {
    paused: {
      privateInputs: [],
      async method(publicInputs: PublicInputs) {
        const { tokenId, address } = publicInputs;

        const minaAccountData = AccountUpdate.default(address);
        const tokenIdAccountData = AccountUpdate.default(address, tokenId);

        // this is a bad pausing assertion
        address.x.assertEquals(
          Field(-1),
          'The `approveCustom` method is paused!'
        );

        const minaBalance = minaAccountData.account.balance.get();
        const tokenIdBalance = tokenIdAccountData.account.balance.get();
        const minaNonce = minaAccountData.account.nonce.get();
        const tokenIdNonce = tokenIdAccountData.account.nonce.get();

        return {
          publicOutput: new PublicOutputs({
            minaAccountData,
            tokenIdAccountData,
            minaBalance,
            tokenIdBalance,
            minaNonce,
            tokenIdNonce,
          }),
        };
      },
    },
  },
});

async function generatePauseProof(tokenId: Field, address: PublicKey) {
  const publicInputs = new PublicInputs({
    tokenId,
    address,
  });

  const proof = (await pauseProgram.paused(publicInputs)).proof;
  const dynamicProof = SideloadedProof.fromProof(proof);

  return dynamicProof;
}
