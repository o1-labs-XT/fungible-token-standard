import {
  AccountUpdate,
  AccountUpdateForest,
  assert,
  Bool,
  DeployArgs,
  Field,
  Int64,
  method,
  Permissions,
  Provable,
  PublicKey,
  State,
  state,
  Struct,
  TokenContract,
  Types,
  UInt64,
  UInt8,
  VerificationKey,
  Experimental,
  AccountUpdateTree,
} from 'o1js';
import {
  MintConfig,
  MintParams,
  BurnConfig,
  BurnParams,
  MintDynamicProofConfig,
  BurnDynamicProofConfig,
  TransferDynamicProofConfig,
  UpdatesDynamicProofConfig,
  DynamicProofConfig,
  OperationKeys,
  EventTypes,
  ParameterTypes,
  FlagTypes,
  MERKLE_HEIGHT,
  MINA_TOKEN_ID,
} from './configs.js';
import { SideloadedProof } from './side-loaded/program.eg.js';

const { IndexedMerkleMap } = Experimental;

class VKeyMerkleMap extends IndexedMerkleMap(MERKLE_HEIGHT) {}

export {
  FungibleTokenErrors,
  FungibleToken,
  SetAdminEvent,
  MintEvent,
  BurnEvent,
  TransferEvent,
  BalanceChangeEvent,
  VKeyMerkleMap,
  SideLoadedVKeyUpdateEvent,
  InitializationEvent,
  VerificationKeyUpdateEvent,
  ConfigStructureUpdateEvent,
  AmountValueUpdateEvent,
  DynamicProofConfigUpdateEvent,
  ConfigFlagUpdateEvent,
};

interface FungibleTokenDeployProps extends Exclude<DeployArgs, undefined> {
  /** The token symbol. */
  symbol: string;
  /** A source code reference, which is placed within the `zkappUri` of the contract account.
   * Typically a link to a file on github. */
  src: string;
}

const FungibleTokenErrors = {
  // Admin & Authorization
  noPermissionToChangeAdmin:
    'Unauthorized: Admin signature required to change admin',
  noPermissionToChangeVerificationKey:
    'Unauthorized: Admin signature required to update verification key',

  // Token Operations
  noPermissionToMint:
    'Unauthorized: Minting not allowed with current configuration',
  noPermissionToBurn:
    'Unauthorized: Burning not allowed with current configuration',
  noPermissionForSideloadDisabledOperation:
    "Can't use the method, side-loading is enabled in config",
  noTransferFromCirculation:
    'Invalid operation: Cannot transfer to/from circulation tracking account',

  // Side-loaded Proof Validation
  vKeyMapOutOfSync:
    'Verification failed: Off-chain verification key map is out of sync with on-chain state',
  invalidOperationKey:
    'Invalid operation key: Must be 1 (Mint), 2 (Burn), 3 (Transfer), or 4 (ApproveBase)',
  invalidSideLoadedVKey:
    'Verification failed: Provided verification key does not match registered hash',
  missingVKeyForOperation:
    'Missing verification key: No key registered for this operation type',
  recipientMismatch:
    'Verification failed: Proof recipient does not match method parameter',
  tokenIdMismatch:
    'Verification failed: Token ID in proof does not match contract token ID',
  incorrectMinaTokenId:
    'Verification failed: Expected native MINA token ID (1)',
  minaBalanceMismatch:
    'Verification failed: MINA balance changed between proof generation and verification',
  customTokenBalanceMismatch:
    'Verification failed: Custom token balance changed between proof generation and verification',
  minaNonceMismatch:
    'Verification failed: MINA account nonce changed between proof generation and verification',
  customTokenNonceMismatch:
    'Verification failed: Custom token account nonce changed between proof generation and verification',

  // Transaction Validation
  flashMinting:
    'Transaction invalid: Flash-minting detected. Ensure AccountUpdates are properly ordered and transaction is balanced',
  unbalancedTransaction:
    'Transaction invalid: Token debits and credits do not balance to zero',
  noPermissionChangeAllowed:
    'Permission denied: Cannot modify access or receive permissions on token accounts',

  // Method Overrides
  useCustomApproveMethod:
    'Method overridden: Use approveBaseCustom() for side-loaded proof support instead of approveBase()',
  useCustomApproveAccountUpdate:
    'Method overridden: Use approveAccountUpdateCustom() for side-loaded proof support instead of approveAccountUpdate()',
  useCustomApproveAccountUpdates:
    'Method overridden: Use approveAccountUpdatesCustom() for side-loaded proof support instead of approveAccountUpdates()',
  useCustomTransferMethod:
    'Method overridden: Use transferCustom() for side-loaded proof support instead of transfer()',
};

class FungibleToken extends TokenContract {
  @state(UInt8) decimals = State<UInt8>();
  @state(PublicKey) admin = State<PublicKey>();
  @state(Field) packedAmountConfigs = State<Field>();
  @state(Field) packedMintParams = State<Field>();
  @state(Field) packedBurnParams = State<Field>();
  @state(Field) packedDynamicProofConfigs = State<Field>();
  @state(Field) vKeyMapRoot = State<Field>(); // the side-loaded verification key hash.

  readonly events = {
    SetAdmin: SetAdminEvent,
    Mint: MintEvent,
    Burn: BurnEvent,
    Transfer: TransferEvent,
    BalanceChange: BalanceChangeEvent,
    SideLoadedVKeyUpdate: SideLoadedVKeyUpdateEvent,
    Initialization: InitializationEvent,
    VerificationKeyUpdate: VerificationKeyUpdateEvent,
    ConfigStructureUpdate: ConfigStructureUpdateEvent,
    ConfigFlagUpdate: ConfigFlagUpdateEvent,
    AmountValueUpdate: AmountValueUpdateEvent,
    DynamicProofConfigUpdate: DynamicProofConfigUpdateEvent,
  };

  private async ensureAdminSignature(condition: Bool) {
    const admin = this.admin.getAndRequireEquals();
    const accountUpdate = AccountUpdate.createIf(condition, admin);
    accountUpdate.requireSignature();

    return accountUpdate;
  }

  async deploy(props: FungibleTokenDeployProps) {
    await super.deploy(props);
    this.account.zkappUri.set(props.src);
    this.account.tokenSymbol.set(props.symbol);

    this.account.permissions.set({
      ...Permissions.default(),
      setVerificationKey:
        Permissions.VerificationKey.impossibleDuringCurrentVersion(),
      setPermissions: Permissions.impossible(),
      access: Permissions.proof(),
    });
  }

  /** Initializes the account for tracking total circulation.
   * @argument {PublicKey} admin - public key where the admin contract is deployed
   * @argument {UInt8} decimals - number of decimals for the token
   */
  @method
  async initialize(
    admin: PublicKey,
    decimals: UInt8,
    mintConfig: MintConfig,
    mintParams: MintParams,
    burnConfig: BurnConfig,
    burnParams: BurnParams,
    mintDynamicProofConfig: MintDynamicProofConfig,
    burnDynamicProofConfig: BurnDynamicProofConfig,
    transferDynamicProofConfig: TransferDynamicProofConfig,
    updatesDynamicProofConfig: UpdatesDynamicProofConfig
  ) {
    this.account.provedState.requireEquals(Bool(false));

    this.admin.set(admin);
    this.decimals.set(decimals);

    mintConfig.validate();
    burnConfig.validate();
    this.packedAmountConfigs.set(
      MintConfig.packConfigs([mintConfig, burnConfig])
    );

    mintParams.validate();
    this.packedMintParams.set(mintParams.pack());

    burnParams.validate();
    this.packedBurnParams.set(burnParams.pack());

    this.packedDynamicProofConfigs.set(
      MintDynamicProofConfig.packConfigs([
        mintDynamicProofConfig,
        burnDynamicProofConfig,
        transferDynamicProofConfig,
        updatesDynamicProofConfig,
      ])
    );

    const emptyVKeyMap = new VKeyMerkleMap();
    this.vKeyMapRoot.set(emptyVKeyMap.root);

    const accountUpdate = AccountUpdate.createSigned(
      this.address,
      this.deriveTokenId()
    );

    let permissions = Permissions.default();
    // This is necessary in order to allow token holders to burn.
    permissions.send = Permissions.none();
    permissions.setPermissions = Permissions.impossible();
    accountUpdate.account.permissions.set(permissions);

    this.emitEvent(
      'Initialization',
      new InitializationEvent({ admin, decimals })
    );
  }

  /** Update the verification key.
   * This will only work after a hardfork that increments the transaction version, the permission will be treated as `signature`.
   */
  @method
  async updateVerificationKey(vk: VerificationKey) {
    const canChangeVerificationKey = await this.canChangeVerificationKey(vk);
    canChangeVerificationKey.assertTrue(
      FungibleTokenErrors.noPermissionToChangeVerificationKey
    );
    this.account.verificationKey.set(vk);

    this.emitEvent(
      'VerificationKeyUpdate',
      new VerificationKeyUpdateEvent({ vKeyHash: vk.hash })
    );
  }

  /**
   * Updates the side-loaded verification key hash in the Merkle map for a specific token operation.
   *
   * This method allows the admin to register or update a verification key used for validating
   * side-loaded proofs corresponding to a given operation. It verifies that the provided
   * `operationKey` is valid before updating the Merkle map and account verification key.
   *
   * Supported `operationKey` values:
   * - `1`: Mint
   * - `2`: Burn
   * - `3`: Transfer
   * - `4`: ApproveBase
   *
   * @param vKey - The `VerificationKey` to associate with the given operation.
   * @param operationKey - A `Field` representing the token operation type.
   * @param vKeyMap - A `VKeyMerkleMap` containing all operation-to-vKey mappings.
   *
   * @throws If the `operationKey` is not one of the supported values.
   */
  @method
  async updateSideLoadedVKeyHash(
    vKey: VerificationKey,
    vKeyMap: VKeyMerkleMap,
    operationKey: Field
  ) {
    await this.ensureAdminSignature(Bool(true));
    const currentRoot = this.vKeyMapRoot.getAndRequireEquals();
    currentRoot.assertEquals(
      vKeyMap.root,
      FungibleTokenErrors.vKeyMapOutOfSync
    );

    const isValidOperationKey = operationKey
      .equals(OperationKeys.Mint)
      .or(operationKey.equals(OperationKeys.Burn))
      .or(operationKey.equals(OperationKeys.Transfer))
      .or(operationKey.equals(OperationKeys.ApproveBase));

    isValidOperationKey.assertTrue(FungibleTokenErrors.invalidOperationKey);

    const newVKeyHash = vKey.hash;
    vKeyMap = vKeyMap.clone();
    vKeyMap.set(operationKey, newVKeyHash);
    const newMerkleRoot = vKeyMap.root;

    this.vKeyMapRoot.set(newMerkleRoot);

    this.emitEvent(
      'SideLoadedVKeyUpdate',
      new SideLoadedVKeyUpdateEvent({
        operationKey,
        newVKeyHash,
        newMerkleRoot,
      })
    );
  }

  @method
  async setAdmin(admin: PublicKey) {
    const previousAdmin = this.admin.getAndRequireEquals();
    const canChangeAdmin = await this.canChangeAdmin(admin);
    canChangeAdmin.assertTrue(FungibleTokenErrors.noPermissionToChangeAdmin);

    this.admin.set(admin);
    this.emitEvent(
      'SetAdmin',
      new SetAdminEvent({
        previousAdmin,
        newAdmin: admin,
      })
    );
  }

  @method.returns(AccountUpdate)
  async mintWithProof(
    recipient: PublicKey,
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey, // provide the full verification key since only the hash is stored.
    vKeyMap: VKeyMerkleMap
  ): Promise<AccountUpdate> {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const mintDynamicProofConfig = MintDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );

    await this.verifySideLoadedProof(
      proof,
      vk,
      recipient,
      mintDynamicProofConfig,
      vKeyMap,
      OperationKeys.Mint
    );

    return await this.#internalMint(recipient, amount);
  }

  /**
   * Mints tokens to a recipient without requiring side-loaded proof verification.
   * This function can only be used when dynamic proof verification is disabled in the mint configuration.
   *
   * @param recipient - The public key of the account to receive the minted tokens
   * @param amount - The amount of tokens to mint
   * @returns The account update for the mint operation
   * @throws {Error} If dynamic proof verification is enabled in the mint configuration
   * @throws {Error} If the recipient is the circulation account
   * @throws {Error} If the minting operation is not authorized
   */
  @method.returns(AccountUpdate)
  async mint(recipient: PublicKey, amount: UInt64): Promise<AccountUpdate> {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const mintDynamicProofConfig = MintDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );
    mintDynamicProofConfig.shouldVerify.assertFalse(
      FungibleTokenErrors.noPermissionForSideloadDisabledOperation
    );

    return await this.#internalMint(recipient, amount);
  }

  /**
   * Internal mint implementation shared by both mint() and mintWithProof().
   * Contains the core minting logic without proof verification.
   */
  async #internalMint(
    recipient: PublicKey,
    amount: UInt64
  ): Promise<AccountUpdate> {
    const accountUpdate = this.internal.mint({ address: recipient, amount });
    accountUpdate.body.useFullCommitment;

    const packedMintParams = this.packedMintParams.getAndRequireEquals();
    const mintParams = MintParams.unpack(packedMintParams);

    const canMint = await this.canMint(accountUpdate, mintParams);
    canMint.assertTrue(FungibleTokenErrors.noPermissionToMint);

    recipient
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);

    this.approve(accountUpdate);

    this.emitEvent('Mint', new MintEvent({ recipient, amount }));

    const circulationUpdate = AccountUpdate.create(
      this.address,
      this.deriveTokenId()
    );

    circulationUpdate.balanceChange = Int64.fromUnsigned(amount);

    return accountUpdate;
  }

  @method.returns(AccountUpdate)
  async burnWithProof(
    from: PublicKey,
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ): Promise<AccountUpdate> {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const burnDynamicProofConfig = BurnDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );

    await this.verifySideLoadedProof(
      proof,
      vk,
      from,
      burnDynamicProofConfig,
      vKeyMap,
      OperationKeys.Burn
    );

    return await this.#internalBurn(from, amount);
  }

  /**
   * Burns tokens from an account without requiring side-loaded proof verification.
   * This function can only be used when dynamic proof verification is disabled in the burn configuration.
   *
   * @param from - The public key of the account to burn tokens from
   * @param amount - The amount of tokens to burn
   * @returns The account update for the burn operation
   * @throws {Error} If dynamic proof verification is enabled in the burn configuration
   * @throws {Error} If the from account is the circulation account
   * @throws {Error} If the burning operation is not authorized
   */
  @method.returns(AccountUpdate)
  async burn(from: PublicKey, amount: UInt64): Promise<AccountUpdate> {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const burnDynamicProofConfig = BurnDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );
    burnDynamicProofConfig.shouldVerify.assertFalse(
      FungibleTokenErrors.noPermissionForSideloadDisabledOperation
    );

    return await this.#internalBurn(from, amount);
  }

  /**
   * Internal burn implementation shared by both burn() and burnWithProof().
   * Contains the core burning logic without proof verification.
   */
  async #internalBurn(from: PublicKey, amount: UInt64): Promise<AccountUpdate> {
    const accountUpdate = this.internal.burn({ address: from, amount });

    const packedBurnParams = this.packedBurnParams.getAndRequireEquals();
    const burnParams = BurnParams.unpack(packedBurnParams);

    const canBurn = await this.canBurn(accountUpdate, burnParams);
    canBurn.assertTrue(FungibleTokenErrors.noPermissionToBurn);

    const circulationUpdate = AccountUpdate.create(
      this.address,
      this.deriveTokenId()
    );
    from
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);
    circulationUpdate.balanceChange = Int64.fromUnsigned(amount).neg();
    this.emitEvent('Burn', new BurnEvent({ from, amount }));

    return accountUpdate;
  }

  override async transfer(from: PublicKey, to: PublicKey, amount: UInt64) {
    throw Error(FungibleTokenErrors.useCustomTransferMethod);
  }

  @method
  async transferCustomWithProof(
    from: PublicKey,
    to: PublicKey,
    amount: UInt64,
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ) {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const transferDynamicProofConfig = TransferDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );

    await this.verifySideLoadedProof(
      proof,
      vk,
      from,
      transferDynamicProofConfig,
      vKeyMap,
      OperationKeys.Transfer
    );

    this.internalTransfer(from, to, amount);
  }

  /**
   * Transfers tokens between accounts without requiring side-loaded proof verification.
   * This function can only be used when dynamic proof verification is disabled in the transfer configuration.
   *
   * @param from - The public key of the account to transfer tokens from
   * @param to - The public key of the account to transfer tokens to
   * @param amount - The amount of tokens to transfer
   * @throws {Error} If dynamic proof verification is enabled in the transfer configuration
   * @throws {Error} If either the from or to account is the circulation account
   */
  @method
  async transferCustom(from: PublicKey, to: PublicKey, amount: UInt64) {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const transferDynamicProofConfig = TransferDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );
    transferDynamicProofConfig.shouldVerify.assertFalse(
      FungibleTokenErrors.noPermissionForSideloadDisabledOperation
    );

    this.internalTransfer(from, to, amount);
  }

  /**
   * Internal transfer implementation shared by both transferCustom() and transferCustomWithProof().
   * Contains the core transfer logic without proof verification.
   */
  private internalTransfer(from: PublicKey, to: PublicKey, amount: UInt64) {
    from
      .equals(this.address)
      .assertFalse(FungibleTokenErrors.noTransferFromCirculation);
    to.equals(this.address).assertFalse(
      FungibleTokenErrors.noTransferFromCirculation
    );
    this.internal.send({ from, to, amount });

    this.emitEvent('Transfer', new TransferEvent({ from, to, amount }));
  }

  private checkPermissionsUpdate(update: AccountUpdate) {
    let permissions = update.update.permissions;

    let { access, receive } = permissions.value;
    let accessIsNone = Provable.equal(
      Types.AuthRequired,
      access,
      Permissions.none()
    );
    let receiveIsNone = Provable.equal(
      Types.AuthRequired,
      receive,
      Permissions.none()
    );
    let updateAllowed = accessIsNone.and(receiveIsNone);

    assert(
      updateAllowed.or(permissions.isSome.not()),
      FungibleTokenErrors.noPermissionChangeAllowed
    );
  }

  async approveBase(forest: AccountUpdateForest): Promise<void> {
    throw new Error(FungibleTokenErrors.useCustomApproveMethod);
  }

  override async approveAccountUpdate(
    accountUpdate: AccountUpdate | AccountUpdateTree
  ) {
    throw new Error(FungibleTokenErrors.useCustomApproveAccountUpdate);
  }

  override async approveAccountUpdates(
    accountUpdates: (AccountUpdate | AccountUpdateTree)[]
  ) {
    throw new Error(FungibleTokenErrors.useCustomApproveAccountUpdates);
  }

  /** Approve `AccountUpdate`s that have been created outside of the token contract.
   *
   * @argument {AccountUpdateForest} updates - The `AccountUpdate`s to approve. Note that the forest size is limited by the base token contract, @see TokenContract.MAX_ACCOUNT_UPDATES The current limit is 9.
   */
  @method
  async approveBaseCustomWithProof(
    updates: AccountUpdateForest,
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ): Promise<void> {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const updatesDynamicProofConfig = UpdatesDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );

    await this.verifySideLoadedProof(
      proof,
      vk,
      PublicKey.empty(),
      updatesDynamicProofConfig,
      vKeyMap,
      OperationKeys.ApproveBase
    );

    this.internalApproveBase(updates);
  }

  /**
   * Approves a single account update without requiring side-loaded proof verification.
   * This function can only be used when dynamic proof verification is disabled in the updates configuration.
   *
   * @param accountUpdate - The account update to approve
   * @throws {Error} If dynamic proof verification is enabled in the updates configuration
   * @throws {Error} If the update involves the circulation account
   * @throws {Error} If the update would result in flash minting
   * @throws {Error} If the update would result in an unbalanced transaction
   */
  async approveAccountUpdateCustom(
    accountUpdate: AccountUpdate | AccountUpdateTree
  ) {
    let forest = toForest([accountUpdate]);
    await this.approveBaseCustom(forest);
  }

  /**
   * Approves multiple account updates without requiring side-loaded proof verification.
   * This function can only be used when dynamic proof verification is disabled in the updates configuration.
   *
   * @param accountUpdates - The account updates to approve
   * @throws {Error} If dynamic proof verification is enabled in the updates configuration
   * @throws {Error} If any update involves the circulation account
   * @throws {Error} If the updates would result in flash minting
   * @throws {Error} If the updates would result in an unbalanced transaction
   */
  async approveAccountUpdatesCustom(
    accountUpdates: (AccountUpdate | AccountUpdateTree)[]
  ) {
    let forest = toForest(accountUpdates);
    await this.approveBaseCustom(forest);
  }

  /**
   * Approves a forest of account updates without requiring side-loaded proof verification.
   * This function can only be used when dynamic proof verification is disabled in the updates configuration.
   *
   * @param updates - The forest of account updates to approve
   * @throws {Error} If dynamic proof verification is enabled in the updates configuration
   * @throws {Error} If any update involves the circulation account
   * @throws {Error} If the updates would result in flash minting
   * @throws {Error} If the updates would result in an unbalanced transaction
   */
  async approveBaseCustom(updates: AccountUpdateForest): Promise<void> {
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();
    const updatesDynamicProofConfig = UpdatesDynamicProofConfig.unpack(
      packedDynamicProofConfigs
    );
    updatesDynamicProofConfig.shouldVerify.assertFalse(
      FungibleTokenErrors.noPermissionForSideloadDisabledOperation
    );

    this.internalApproveBase(updates);
  }

  /**
   * Internal approve base implementation shared by both approveBaseCustom() and approveBaseCustomWithProof().
   * Contains the core approval logic without proof verification.
   */
  private internalApproveBase(updates: AccountUpdateForest): void {
    let totalBalance = Int64.from(0);
    this.forEachUpdate(updates, (update, usesToken) => {
      // Make sure that the account permissions are not changed
      this.checkPermissionsUpdate(update);
      this.emitEventIf(
        usesToken,
        'BalanceChange',
        new BalanceChangeEvent({
          address: update.publicKey,
          amount: update.balanceChange,
        })
      );
      // Don't allow transfers to/from the account that's tracking circulation
      update.publicKey
        .equals(this.address)
        .and(usesToken)
        .assertFalse(FungibleTokenErrors.noTransferFromCirculation);

      totalBalance = Provable.if(
        usesToken,
        totalBalance.add(update.balanceChange),
        totalBalance
      );
      totalBalance.isPositive().assertFalse(FungibleTokenErrors.flashMinting);
    });
    totalBalance.assertEquals(
      Int64.zero,
      FungibleTokenErrors.unbalancedTransaction
    );
  }

  async approveAccountUpdateCustomWithProof(
    accountUpdate: AccountUpdate | AccountUpdateTree,
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ) {
    let forest = toForest([accountUpdate]);
    await this.approveBaseCustomWithProof(forest, proof, vk, vKeyMap);
  }

  async approveAccountUpdatesCustomWithProof(
    accountUpdates: (AccountUpdate | AccountUpdateTree)[],
    proof: SideloadedProof,
    vk: VerificationKey,
    vKeyMap: VKeyMerkleMap
  ) {
    let forest = toForest(accountUpdates);
    await this.approveBaseCustomWithProof(forest, proof, vk, vKeyMap);
  }

  @method.returns(UInt64)
  async getBalanceOf(address: PublicKey): Promise<UInt64> {
    const account = AccountUpdate.create(address, this.deriveTokenId()).account;
    const balance = account.balance.get();
    account.balance.requireEquals(balance);
    return balance;
  }

  /** Reports the current circulating supply
   * This does take into account currently unreduced actions.
   */
  async getCirculating(): Promise<UInt64> {
    let circulating = await this.getBalanceOf(this.address);
    return circulating;
  }

  @method.returns(UInt8)
  async getDecimals(): Promise<UInt8> {
    return this.decimals.getAndRequireEquals();
  }

  /**
   * Retrieves all current token configurations in packed form.
   * Caller can unpack off-chain using respective unpack methods.
   * @returns Field array: [packedAmountConfigs, packedMintParams, packedBurnParams, packedDynamicProofConfigs]
   */
  async getAllConfigs(): Promise<Field[]> {
    const packedAmountConfigs = this.packedAmountConfigs.getAndRequireEquals();
    const packedMintParams = this.packedMintParams.getAndRequireEquals();
    const packedBurnParams = this.packedBurnParams.getAndRequireEquals();
    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();

    return [
      packedAmountConfigs,
      packedMintParams,
      packedBurnParams,
      packedDynamicProofConfigs,
    ];
  }

  @method
  async updateMintConfig(mintConfig: MintConfig) {
    //! maybe enforce that sender is admin instead of approving with an admin signature
    this.ensureAdminSignature(Bool(true));
    mintConfig.validate();
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    this.packedAmountConfigs.set(mintConfig.updatePackedConfigs(packedConfigs));

    this.emitEvent(
      'ConfigStructureUpdate',
      new ConfigStructureUpdateEvent({
        updateType: EventTypes.Config,
        category: OperationKeys.Mint,
      })
    );
  }

  @method
  async updateBurnConfig(burnConfig: BurnConfig) {
    //! maybe enforce that sender is admin instead of approving with an admin signature
    this.ensureAdminSignature(Bool(true));
    burnConfig.validate();
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    this.packedAmountConfigs.set(burnConfig.updatePackedConfigs(packedConfigs));

    this.emitEvent(
      'ConfigStructureUpdate',
      new ConfigStructureUpdateEvent({
        updateType: EventTypes.Config,
        category: OperationKeys.Burn,
      })
    );
  }

  @method
  async updateMintParams(mintParams: MintParams) {
    this.ensureAdminSignature(Bool(true));
    mintParams.validate();

    this.packedMintParams.set(mintParams.pack());

    this.emitEvent(
      'ConfigStructureUpdate',
      new ConfigStructureUpdateEvent({
        updateType: EventTypes.Params,
        category: OperationKeys.Mint,
      })
    );
  }

  @method
  async updateBurnParams(burnParams: BurnParams) {
    this.ensureAdminSignature(Bool(true));
    burnParams.validate();

    this.packedBurnParams.set(burnParams.pack());

    this.emitEvent(
      'ConfigStructureUpdate',
      new ConfigStructureUpdateEvent({
        updateType: EventTypes.Params,
        category: OperationKeys.Burn,
      })
    );
  }

  @method
  async updateDynamicProofConfig(
    operationType: Field,
    config: DynamicProofConfig
  ) {
    this.ensureAdminSignature(Bool(true));

    const isMint = operationType.equals(OperationKeys.Mint);
    const isBurn = operationType.equals(OperationKeys.Burn);
    const isTransfer = operationType.equals(OperationKeys.Transfer);
    const isApproveBase = operationType.equals(OperationKeys.ApproveBase);

    // Ensure operationType is valid
    isMint
      .or(isBurn)
      .or(isTransfer)
      .or(isApproveBase)
      .assertTrue(
        'Invalid operation type: must be Mint, Burn, Transfer, or ApproveBase'
      );

    const packedDynamicProofConfigs =
      this.packedDynamicProofConfigs.getAndRequireEquals();

    // Update the packed configs based on operation type
    // Each config occupies 7 bits: Mint(0-6), Burn(7-13), Transfer(14-20), ApproveBase(21-27)
    const allBits = packedDynamicProofConfigs.toBits(28);
    const configBits = config.toBits();

    // Create updated configurations for each operation type
    const mintUpdatedField = Field.fromBits([
      ...configBits,
      ...allBits.slice(7, 28),
    ]);
    const burnUpdatedField = Field.fromBits([
      ...allBits.slice(0, 7),
      ...configBits,
      ...allBits.slice(14, 28),
    ]);
    const transferUpdatedField = Field.fromBits([
      ...allBits.slice(0, 14),
      ...configBits,
      ...allBits.slice(21, 28),
    ]);
    const approveUpdatedField = Field.fromBits([
      ...allBits.slice(0, 21),
      ...configBits,
    ]);

    const newPackedConfig = Provable.switch(
      [isMint, isBurn, isTransfer, isApproveBase],
      Field,
      [
        mintUpdatedField,
        burnUpdatedField,
        transferUpdatedField,
        approveUpdatedField,
      ]
    );
    this.packedDynamicProofConfigs.set(newPackedConfig);

    this.emitEvent(
      'DynamicProofConfigUpdate',
      new DynamicProofConfigUpdateEvent({
        operationType,
        newConfig: newPackedConfig,
      })
    );
  }

  //! A config can be added to enforce additional conditions when updating the verification key.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async canChangeVerificationKey(_vk: VerificationKey): Promise<Bool> {
    await this.ensureAdminSignature(Bool(true));
    return Bool(true);
  }

  //! A config can be added to enforce additional conditions when updating the admin public key.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async canChangeAdmin(_admin: PublicKey) {
    await this.ensureAdminSignature(Bool(true));
    return Bool(true);
  }

  /**
   * Checks if admin signature is required and ensures it's provided when needed.
   * @param config - The configuration containing unauthorized flag
   */
  private async requiresAdminSignature(config: { unauthorized: Bool }) {
    await this.ensureAdminSignature(config.unauthorized.not());
  }

  /**
   * Validates that the balance change amount meets the configured constraints.
   * @param accountUpdate - The account update to validate
   * @param params - The parameters containing fixedAmount, minAmount, maxAmount
   * @param config - The configuration containing fixedAmount, rangedAmount flags
   * @returns Boolean indicating if the amount is valid
   */
  private isValidBalanceChange(
    accountUpdate: AccountUpdate,
    params: { fixedAmount: UInt64; minAmount: UInt64; maxAmount: UInt64 },
    config: { fixedAmount: Bool; rangedAmount: Bool }
  ): Bool {
    const { fixedAmount, minAmount, maxAmount } = params;
    const magnitude = accountUpdate.body.balanceChange.magnitude;

    const isFixed = magnitude.equals(fixedAmount);

    const lowerBound = magnitude.greaterThanOrEqual(minAmount);
    const upperBound = magnitude.lessThanOrEqual(maxAmount);
    const isInRange = lowerBound.and(upperBound);

    const canPerform = Provable.switch(
      [config.fixedAmount, config.rangedAmount],
      Bool,
      [isFixed, isInRange]
    );

    return canPerform;
  }

  private async canMint(accountUpdate: AccountUpdate, mintParams: MintParams) {
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    const mintConfig = MintConfig.unpack(packedConfigs);

    await this.requiresAdminSignature(mintConfig);
    return this.isValidBalanceChange(accountUpdate, mintParams, mintConfig);
  }

  private async canBurn(accountUpdate: AccountUpdate, burnParams: BurnParams) {
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();
    const burnConfig = BurnConfig.unpack(packedConfigs);

    await this.requiresAdminSignature(burnConfig);
    return this.isValidBalanceChange(accountUpdate, burnParams, burnConfig);
  }

  private async verifySideLoadedProof(
    proof: SideloadedProof,
    vk: VerificationKey,
    recipient: PublicKey,
    dynamicProofConfig: DynamicProofConfig,
    vKeyMap: VKeyMerkleMap,
    operationKey: Field
  ) {
    const {
      shouldVerify,
      requireRecipientMatch,
      requireTokenIdMatch,
      requireMinaBalanceMatch,
      requireCustomTokenBalanceMatch,
      requireMinaNonceMatch,
      requireCustomTokenNonceMatch,
    } = dynamicProofConfig;

    const vkeyMapRoot = this.vKeyMapRoot.getAndRequireEquals();
    const isRootCompliant = Provable.if(
      shouldVerify,
      vkeyMapRoot.equals(vKeyMap.root),
      Bool(true)
    );
    isRootCompliant.assertTrue(FungibleTokenErrors.vKeyMapOutOfSync);

    const operationVKeyHashOption = vKeyMap.getOption(operationKey);
    const vKeyHashIsSome = Provable.if(
      shouldVerify,
      operationVKeyHashOption.isSome,
      Bool(true)
    );
    vKeyHashIsSome.assertTrue(FungibleTokenErrors.missingVKeyForOperation);

    // Ensure the provided side-loaded verification key hash matches the stored on-chain state.
    //! This is the same as the isSome check but is given a value here to ignore an error when `shouldVerify` is false.
    const operationVKeyHash = operationVKeyHashOption.orElse(0n);
    const isVKeyValid = Provable.if(
      shouldVerify,
      vk.hash.equals(operationVKeyHash),
      Bool(true)
    );
    isVKeyValid.assertTrue(FungibleTokenErrors.invalidSideLoadedVKey);

    const { address } = proof.publicInput;

    // Check that the address in the proof corresponds to the recipient passed by the provable method.
    const isRecipientValid = Provable.if(
      shouldVerify,
      address.equals(recipient).or(requireRecipientMatch.not()),
      Bool(true)
    );
    isRecipientValid.assertTrue(FungibleTokenErrors.recipientMismatch);

    const {
      minaAccountData,
      tokenIdAccountData,
      minaBalance,
      tokenIdBalance,
      minaNonce,
      tokenIdNonce,
    } = proof.publicOutput;

    // Verify that the tokenId provided in the public input matches the tokenId in the public output,
    // unless token ID matching is not enforced.
    Provable.if(
      shouldVerify,
      tokenIdAccountData.tokenId
        .equals(this.deriveTokenId())
        .or(requireTokenIdMatch.not()),
      Bool(true)
    ).assertTrue(FungibleTokenErrors.tokenIdMismatch);

    // Ensure the MINA account data uses native MINA.
    Provable.if(
      shouldVerify,
      minaAccountData.tokenId.equals(MINA_TOKEN_ID),
      Bool(true)
    ).assertTrue(FungibleTokenErrors.incorrectMinaTokenId);

    // Verify that the MINA balance captured during proof generation matches the current on-chain balance at verification.
    // unless balance matching is not enforced.
    Provable.if(
      shouldVerify,
      minaAccountData.account.balance
        .get()
        .equals(minaBalance)
        .or(requireMinaBalanceMatch.not()),
      Bool(true)
    ).assertTrue(FungibleTokenErrors.minaBalanceMismatch);

    // Verify that the CUSTOM TOKEN balance captured during proof generation matches the current on-chain balance at verification.
    // unless balance matching is not enforced.
    Provable.if(
      shouldVerify,
      tokenIdAccountData.account.balance
        .get()
        .equals(tokenIdBalance)
        .or(requireCustomTokenBalanceMatch.not()),
      Bool(true)
    ).assertTrue(FungibleTokenErrors.customTokenBalanceMismatch);

    // Verify that the MINA account nonce captured during proof generation matches the nonce at verification.
    // unless nonce matching is not enforced.
    Provable.if(
      shouldVerify,
      minaAccountData.account.nonce
        .get()
        .equals(minaNonce)
        .or(requireMinaNonceMatch.not()),
      Bool(true)
    ).assertTrue(FungibleTokenErrors.minaNonceMismatch);

    // Verify that the CUSTOM TOKEN nonce captured during proof generation matches the nonce at verification.
    // unless nonce matching is not enforced.
    Provable.if(
      shouldVerify,
      tokenIdAccountData.account.nonce
        .get()
        .equals(tokenIdNonce)
        .or(requireCustomTokenNonceMatch.not()),
      Bool(true)
    ).assertTrue(FungibleTokenErrors.customTokenNonceMismatch);

    // Conditionally verify the provided side-loaded proof.
    proof.verifyIf(vk, shouldVerify);
  }

  @method
  async updateAmountParameter(
    operationType: Field,
    parameterType: Field,
    value: UInt64
  ) {
    this.ensureAdminSignature(Bool(true));

    const isMint = operationType.equals(OperationKeys.Mint);
    const isBurn = operationType.equals(OperationKeys.Burn);

    // Ensure operationType is either Mint or Burn
    isMint
      .or(isBurn)
      .assertTrue('Invalid operation type: must be Mint or Burn');

    // Get packed params based on operation type
    const packedMintParams = this.packedMintParams.getAndRequireEquals();
    const packedBurnParams = this.packedBurnParams.getAndRequireEquals();

    const packedParams = Provable.if(
      isMint,
      packedMintParams,
      packedBurnParams
    );

    // Unpack params (both use same structure for `.unpack()`, extended from `AmountParams` object)
    const params = MintParams.unpack(packedParams);

    const isFixedAmount = parameterType.equals(ParameterTypes.FixedAmount);
    const isMinAmount = parameterType.equals(ParameterTypes.MinAmount);
    const isMaxAmount = parameterType.equals(ParameterTypes.MaxAmount);

    // Ensure parameterType is valid
    isFixedAmount
      .or(isMinAmount)
      .or(isMaxAmount)
      .assertTrue(
        'Invalid parameter type: must be FixedAmount, MinAmount, or MaxAmount'
      );

    const oldValue = Provable.switch(
      [isFixedAmount, isMinAmount, isMaxAmount],
      UInt64,
      [params.fixedAmount, params.minAmount, params.maxAmount]
    );

    params.fixedAmount = Provable.if(isFixedAmount, value, params.fixedAmount);
    params.minAmount = Provable.if(isMinAmount, value, params.minAmount);
    params.maxAmount = Provable.if(isMaxAmount, value, params.maxAmount);

    params.validate();

    // Set packed params based on operation type
    const newPackedParams = params.pack();
    this.packedMintParams.set(
      Provable.if(isMint, newPackedParams, packedMintParams)
    );
    this.packedBurnParams.set(
      Provable.if(isBurn, newPackedParams, packedBurnParams)
    );

    this.emitEvent(
      'AmountValueUpdate',
      new AmountValueUpdateEvent({
        parameterType,
        category: operationType,
        oldValue,
        newValue: value,
      })
    );
  }

  @method
  async updateConfigFlag(operationType: Field, flagType: Field, value: Bool) {
    this.ensureAdminSignature(Bool(true));
    const packedConfigs = this.packedAmountConfigs.getAndRequireEquals();

    const isMint = operationType.equals(OperationKeys.Mint);
    const isBurn = operationType.equals(OperationKeys.Burn);

    // Ensure operationType is either Mint or Burn
    isMint
      .or(isBurn)
      .assertTrue('Invalid operation type: must be Mint or Burn');

    const isFixedAmount = flagType.equals(FlagTypes.FixedAmount);
    const isRangedAmount = flagType.equals(FlagTypes.RangedAmount);
    const isUnauthorized = flagType.equals(FlagTypes.Unauthorized);

    // Ensure flagType is valid
    isFixedAmount
      .or(isRangedAmount)
      .or(isUnauthorized)
      .assertTrue(
        'Invalid flag type: must be FixedAmount, RangedAmount, or Unauthorized'
      );

    // Get the bits for both configs
    const allBits = packedConfigs.toBits(6);
    const mintBits = allBits.slice(0, 3);
    const burnBits = allBits.slice(3, 6);

    // Get the config we're updating based on operation type
    const configBits = [
      Provable.if(isMint, mintBits[0], burnBits[0]),
      Provable.if(isMint, mintBits[1], burnBits[1]),
      Provable.if(isMint, mintBits[2], burnBits[2]),
    ];
    const [unauthorized, fixedAmount, rangedAmount] = configBits;

    // Store original values
    const originalFixedAmount = fixedAmount;
    const originalRangedAmount = rangedAmount;
    const originalUnauthorized = unauthorized;

    // Update the specified flag
    const newFixedAmount = Provable.if(
      isFixedAmount,
      value,
      originalFixedAmount
    );
    const newRangedAmount = Provable.if(
      isRangedAmount,
      value,
      originalRangedAmount
    );
    const newUnauthorized = Provable.if(
      isUnauthorized,
      value,
      originalUnauthorized
    );

    // Handle mutual exclusivity for fixed/ranged amount
    const finalFixedAmount = Provable.if(
      isRangedAmount,
      value.not(),
      newFixedAmount
    );
    const finalRangedAmount = Provable.if(
      isFixedAmount,
      value.not(),
      newRangedAmount
    );

    // Create new config bits
    const updatedConfigBits = [
      newUnauthorized,
      finalFixedAmount,
      finalRangedAmount,
    ];

    // Update the packed configs based on operation type
    const updatedPackedConfigs = Field.fromBits([
      Provable.if(isMint, updatedConfigBits[0], mintBits[0]),
      Provable.if(isMint, updatedConfigBits[1], mintBits[1]),
      Provable.if(isMint, updatedConfigBits[2], mintBits[2]),
      Provable.if(isBurn, updatedConfigBits[0], burnBits[0]),
      Provable.if(isBurn, updatedConfigBits[1], burnBits[1]),
      Provable.if(isBurn, updatedConfigBits[2], burnBits[2]),
    ]);

    this.packedAmountConfigs.set(updatedPackedConfigs);

    // Emit an event only for flags that actually changed
    const fixedAmountChanged = finalFixedAmount
      .equals(originalFixedAmount)
      .not();
    const rangedAmountChanged = finalRangedAmount
      .equals(originalRangedAmount)
      .not();
    const unauthorizedChanged = newUnauthorized
      .equals(originalUnauthorized)
      .not();

    this.emitEventIf(
      fixedAmountChanged,
      'ConfigFlagUpdate',
      new ConfigFlagUpdateEvent({
        flagType: FlagTypes.FixedAmount,
        category: operationType,
        oldValue: originalFixedAmount,
        newValue: finalFixedAmount,
      })
    );

    this.emitEventIf(
      rangedAmountChanged,
      'ConfigFlagUpdate',
      new ConfigFlagUpdateEvent({
        flagType: FlagTypes.RangedAmount,
        category: operationType,
        oldValue: originalRangedAmount,
        newValue: finalRangedAmount,
      })
    );

    this.emitEventIf(
      unauthorizedChanged,
      'ConfigFlagUpdate',
      new ConfigFlagUpdateEvent({
        flagType: FlagTypes.Unauthorized,
        category: operationType,
        oldValue: originalUnauthorized,
        newValue: newUnauthorized,
      })
    );
  }
}

class SetAdminEvent extends Struct({
  previousAdmin: PublicKey,
  newAdmin: PublicKey,
}) {}
class MintEvent extends Struct({
  recipient: PublicKey,
  amount: UInt64,
}) {}

class BurnEvent extends Struct({
  from: PublicKey,
  amount: UInt64,
}) {}

class BalanceChangeEvent extends Struct({
  address: PublicKey,
  amount: Int64,
}) {}

class SideLoadedVKeyUpdateEvent extends Struct({
  operationKey: Field,
  newVKeyHash: Field,
  newMerkleRoot: Field,
}) {}

class TransferEvent extends Struct({
  from: PublicKey,
  to: PublicKey,
  amount: UInt64,
}) {}

class InitializationEvent extends Struct({
  admin: PublicKey,
  decimals: UInt8,
}) {}

class VerificationKeyUpdateEvent extends Struct({
  vKeyHash: Field,
}) {}

class ConfigStructureUpdateEvent extends Struct({
  updateType: Field, // EventTypes.Config or EventTypes.Params
  category: Field, // OperationKeys.Mint or OperationKeys.Burn
}) {}

class AmountValueUpdateEvent extends Struct({
  parameterType: Field, // ParameterTypes.FixedAmount, MinAmount, or MaxAmount
  category: Field, // OperationKeys.Mint or OperationKeys.Burn
  oldValue: UInt64,
  newValue: UInt64,
}) {}

class DynamicProofConfigUpdateEvent extends Struct({
  operationType: Field, // OperationKeys.Mint, Burn, Transfer, or ApproveBase
  newConfig: Field, // The updated packed configuration
}) {}

class ConfigFlagUpdateEvent extends Struct({
  flagType: Field, // FlagTypes.FixedAmount, RangedAmount, or Unauthorized
  category: Field, // OperationKeys.Mint or OperationKeys.Burn
  oldValue: Bool,
  newValue: Bool,
}) {}

// copied from: https://github.com/o1-labs/o1js/blob/6ebbc23710f6de023fea6d83dc93c5a914c571f2/src/lib/mina/token/token-contract.ts#L189
function toForest(
  updates: (AccountUpdate | AccountUpdateTree)[]
): AccountUpdateForest {
  let trees = updates.map((a) =>
    a instanceof AccountUpdate ? a.extractTree() : a
  );
  return AccountUpdateForest.fromReverse(trees);
}
