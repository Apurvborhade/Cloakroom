import {
  ERROR_CODES,
  deriveEnclaveSalt,
  createDomain,
  EIP712_TYPES,
  type ErrorCode,
  type SessionGrantMsg,
  type SessionQueryMsg,
  type DepositRequestMsg,
  type IntentMsg,
  type CancelIntentMsg,
  type WithdrawalMsg,
  type MarginSupplyMsg,
  type MarginRedeemMsg,
  type MarginOpenMsg,
  type MarginAddCollateralMsg,
  type MarginCloseMsg,
  type SerialQueue,
  type Journal,
  type Ledger,
} from '@cloakroom/shared';
import { getAddress, recoverTypedDataAddress } from 'viem';
import type { Address, Hex } from 'viem';

export class AuthError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

export type MutatingPrimaryType =
  | 'DepositRequest'
  | 'Intent'
  | 'CancelIntent'
  | 'Withdrawal'
  | 'MarginSupply'
  | 'MarginRedeem'
  | 'MarginOpen'
  | 'MarginAddCollateral'
  | 'MarginClose';

export type MutatingMessageMap = {
  DepositRequest: DepositRequestMsg;
  Intent: IntentMsg;
  CancelIntent: CancelIntentMsg;
  Withdrawal: WithdrawalMsg;
  MarginSupply: MarginSupplyMsg;
  MarginRedeem: MarginRedeemMsg;
  MarginOpen: MarginOpenMsg;
  MarginAddCollateral: MarginAddCollateralMsg;
  MarginClose: MarginCloseMsg;
};

export type OwnerPrimaryType = MutatingPrimaryType | 'SessionGrant';

export type OwnerMessageMap = MutatingMessageMap & {
  SessionGrant: SessionGrantMsg;
};

export type OwnerPayload =
  | { primaryType: 'SessionGrant'; message: SessionGrantMsg }
  | { primaryType: 'DepositRequest'; message: DepositRequestMsg }
  | { primaryType: 'Intent'; message: IntentMsg }
  | { primaryType: 'CancelIntent'; message: CancelIntentMsg }
  | { primaryType: 'Withdrawal'; message: WithdrawalMsg }
  | { primaryType: 'MarginSupply'; message: MarginSupplyMsg }
  | { primaryType: 'MarginRedeem'; message: MarginRedeemMsg }
  | { primaryType: 'MarginOpen'; message: MarginOpenMsg }
  | { primaryType: 'MarginAddCollateral'; message: MarginAddCollateralMsg }
  | { primaryType: 'MarginClose'; message: MarginCloseMsg };

export interface AuthConfig {
  sessionGrantTtlSec: number;
  maxExpiryFutureSec: number;
  maxClockSkewSec: number;
}

export type AuthConfigInput =
  | AuthConfig
  | {
      SESSION_GRANT_TTL_SEC: number;
      MAX_EXPIRY_FUTURE_SEC: number;
      MAX_CLOCK_SKEW_SEC: number;
    };

export interface AuthServiceDeps {
  chainId: number;
  enclavePubKey: Hex;
  config: AuthConfigInput;
  queue: SerialQueue;
  journal: Pick<Journal, 'append'>;
  ledger: Pick<Ledger, 'getLastNonce' | 'setNonce'>;
  clock?: () => number;
}

export interface SessionGrantRecord {
  owner: Address;
  sessionKey: Address;
  expiry: bigint;
}

/**
 * Authentication and authorization service for Cloakroom enclave.
 *
 * Guarantees:
 * 1. Cryptographic EIP-712 typed-data signature verification bound to chainId and enclave salt.
 * 2. Owner authorization for all state-mutating requests (Deposit, Intent, Cancel, Withdrawal).
 * 3. Session key authorization restricted exclusively to read-only queries (SessionQuery).
 * 4. Deterministic timestamp validation with clock-skew allowance and grant TTL limits.
 * 5. Replay-safe, strictly monotonic nonce consumption serialized inside FifoSerialQueue
 *    with journal durability before in-memory ledger mutation.
 */
export class AuthService {
  private readonly chainId: number;
  private readonly enclavePubKey: Hex;
  private readonly enclaveSalt: Hex;
  private readonly sessionGrantTtlSec: number;
  private readonly maxExpiryFutureSec: number;
  private readonly maxClockSkewSec: number;
  private readonly queue: SerialQueue;
  private readonly journal: Pick<Journal, 'append'>;
  private readonly ledger: Pick<Ledger, 'getLastNonce' | 'setNonce'>;
  private readonly clock: () => number;

  private readonly sessionGrants = new Map<Address, SessionGrantRecord>();

  constructor(deps: AuthServiceDeps) {
    this.chainId = deps.chainId;
    this.enclavePubKey = deps.enclavePubKey;
    this.enclaveSalt = deriveEnclaveSalt(deps.enclavePubKey);

    if ('sessionGrantTtlSec' in deps.config) {
      this.sessionGrantTtlSec = deps.config.sessionGrantTtlSec;
      this.maxExpiryFutureSec = deps.config.maxExpiryFutureSec;
      this.maxClockSkewSec = deps.config.maxClockSkewSec;
    } else {
      this.sessionGrantTtlSec = deps.config.SESSION_GRANT_TTL_SEC;
      this.maxExpiryFutureSec = deps.config.MAX_EXPIRY_FUTURE_SEC;
      this.maxClockSkewSec = deps.config.MAX_CLOCK_SKEW_SEC;
    }

    this.queue = deps.queue;
    this.journal = deps.journal;
    this.ledger = deps.ledger;
    this.clock = deps.clock ?? (() => Math.floor(Date.now() / 1000));
  }

  getDomain() {
    return createDomain(this.chainId, this.enclaveSalt);
  }

  getEnclaveSalt(): Hex {
    return this.enclaveSalt;
  }

  /**
   * Validates request expiry timestamp boundaries.
   *
   * @param expiry Unix timestamp in integer seconds.
   * @param isSessionGrant Whether this is a session grant (uses sessionGrantTtlSec instead of maxExpiryFutureSec).
   */
  validateExpiry(expiry: bigint, isSessionGrant = false): void {
    const now = BigInt(this.clock());
    if (isSessionGrant) {
      if (expiry <= now) {
        throw new AuthError(
          ERROR_CODES.EXPIRED,
          'Session grant expiry must be strictly in the future',
        );
      }
      if (expiry > now + BigInt(this.sessionGrantTtlSec)) {
        throw new AuthError(
          ERROR_CODES.EXPIRED,
          'Session grant expiry exceeds maximum TTL',
        );
      }
      return;
    }

    const minAllowed = now - BigInt(this.maxClockSkewSec);
    const maxAllowed = now + BigInt(this.maxExpiryFutureSec);

    if (expiry < minAllowed) {
      throw new AuthError(
        ERROR_CODES.EXPIRED,
        'Request expiry is beyond allowed clock skew',
      );
    }

    if (expiry > maxAllowed) {
      throw new AuthError(
        ERROR_CODES.EXPIRED,
        'Request expiry is too far into the future',
      );
    }
  }

  async verifyOwnerSignature(
    primaryType: 'SessionGrant',
    message: SessionGrantMsg,
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature(
    primaryType: 'DepositRequest',
    message: DepositRequestMsg,
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature(
    primaryType: 'Intent',
    message: IntentMsg,
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature(
    primaryType: 'CancelIntent',
    message: CancelIntentMsg,
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature(
    primaryType: 'Withdrawal',
    message: WithdrawalMsg,
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature<K extends MutatingPrimaryType>(
    primaryType: K,
    message: MutatingMessageMap[K],
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature<K extends OwnerPrimaryType>(
    primaryType: K,
    message: OwnerMessageMap[K],
    signature: Hex,
  ): Promise<Address>;
  async verifyOwnerSignature<K extends OwnerPrimaryType>(
    primaryType: K,
    message: OwnerMessageMap[K],
    signature: Hex,
  ): Promise<Address> {
    const domain = this.getDomain();
    let recovered: Address;

    try {
      const payload = { primaryType, message } as OwnerPayload;
      switch (payload.primaryType) {
        case 'SessionGrant':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'DepositRequest':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'Intent':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'CancelIntent':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'Withdrawal':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'MarginSupply':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'MarginRedeem':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'MarginOpen':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'MarginAddCollateral':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        case 'MarginClose':
          recovered = await recoverTypedDataAddress({
            domain,
            types: EIP712_TYPES,
            primaryType: payload.primaryType,
            message: payload.message,
            signature,
          });
          break;
        default: {
          const exhaustiveCheck: never = payload;
          throw new AuthError(
            ERROR_CODES.INVALID_PAYLOAD,
            `Unsupported primary type: ${String(exhaustiveCheck)}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(
        ERROR_CODES.BAD_SIGNATURE,
        'Invalid signature format or recovery failure',
      );
    }

    const normSigner = getAddress(recovered);
    const normOwner = getAddress(message.owner);

    if (normSigner !== normOwner) {
      throw new AuthError(
        ERROR_CODES.BAD_SIGNATURE,
        `Signer ${normSigner} does not match message owner ${normOwner}`,
      );
    }

    return normOwner;
  }

  /**
   * Validates and registers an ephemeral session grant authorized by the owner.
   * A new grant for an owner overwrites any previous grant upon success.
   * If registration fails, any existing valid grant remains intact.
   *
   * Note: Session grants reside in memory and do not persist across enclave restarts.
   */
  async createSessionGrant(
    message: SessionGrantMsg,
    signature: Hex,
  ): Promise<SessionGrantRecord> {
    this.validateExpiry(message.expiry, true);
    const owner = await this.verifyOwnerSignature('SessionGrant', message, signature);
    const sessionKey = getAddress(message.sessionKey);

    const record: SessionGrantRecord = {
      owner,
      sessionKey,
      expiry: message.expiry,
    };

    this.sessionGrants.set(owner, record);
    return record;
  }

  /**
   * Authorizes a read-only SessionQuery signed by a valid, active session key.
   * SessionQuery does not consume an owner nonce.
   */
  async verifySessionQuery(
    message: SessionQueryMsg,
    signature: Hex,
  ): Promise<{ owner: Address; sessionKey: Address }> {
    this.validateExpiry(message.expiry, false);

    const normOwner = getAddress(message.owner);
    const grant = this.sessionGrants.get(normOwner);

    if (!grant) {
      throw new AuthError(
        ERROR_CODES.UNKNOWN_SESSION,
        `No active session grant found for owner ${normOwner}`,
      );
    }

    const now = BigInt(this.clock());
    if (grant.expiry <= now) {
      this.sessionGrants.delete(normOwner);
      throw new AuthError(
        ERROR_CODES.EXPIRED,
        `Session grant for owner ${normOwner} has expired`,
      );
    }

    let recovered: Address;
    try {
      recovered = await recoverTypedDataAddress({
        domain: this.getDomain(),
        types: EIP712_TYPES,
        primaryType: 'SessionQuery',
        message,
        signature,
      });
    } catch {
      throw new AuthError(ERROR_CODES.BAD_SIGNATURE, 'Invalid session query signature');
    }

    const normSigner = getAddress(recovered);
    if (normSigner !== grant.sessionKey) {
      throw new AuthError(
        ERROR_CODES.UNAUTHORIZED,
        `Signer ${normSigner} does not match authorized session key ${grant.sessionKey}`,
      );
    }

    return { owner: normOwner, sessionKey: grant.sessionKey };
  }

  /**
   * Atomically verifies and consumes an owner's nonce inside FifoSerialQueue.
   * Journal persistence (append with durability) must succeed BEFORE in-memory ledger mutation.
   */
  async consumeNonce(owner: Address, nonce: bigint): Promise<void> {
    const normOwner = getAddress(owner);

    await this.queue.run(async () => {
      const lastNonce = this.ledger.getLastNonce(normOwner);
      if (nonce <= lastNonce) {
        throw new AuthError(
          ERROR_CODES.NONCE_USED,
          `Nonce ${nonce} has already been used or is lower than last accepted nonce ${lastNonce}`,
        );
      }

      // 1. Durably append to journal
      await this.journal.append({
        t: 'NONCE_USED',
        owner: normOwner,
        nonce,
      });

      // 2. Only after durable write succeeds, update in-memory ledger
      this.ledger.setNonce(normOwner, nonce);
    });
  }

  /**
   * Complete authorization pipeline for state-mutating requests:
   * 1. Validates owner signature outside the queue.
   * 2. Validates expiry horizon and clock skew outside the queue.
   * 3. Atomically validates and consumes nonce inside FifoSerialQueue with journal durability.
   */
  async verifyAndAuthorizeMutation(
    primaryType: 'DepositRequest',
    message: DepositRequestMsg,
    signature: Hex,
  ): Promise<{ owner: Address; nonce: bigint }>;
  async verifyAndAuthorizeMutation(
    primaryType: 'Intent',
    message: IntentMsg,
    signature: Hex,
  ): Promise<{ owner: Address; nonce: bigint }>;
  async verifyAndAuthorizeMutation(
    primaryType: 'CancelIntent',
    message: CancelIntentMsg,
    signature: Hex,
  ): Promise<{ owner: Address; nonce: bigint }>;
  async verifyAndAuthorizeMutation(
    primaryType: 'Withdrawal',
    message: WithdrawalMsg,
    signature: Hex,
  ): Promise<{ owner: Address; nonce: bigint }>;
  async verifyAndAuthorizeMutation<K extends MutatingPrimaryType>(
    primaryType: K,
    message: MutatingMessageMap[K],
    signature: Hex,
  ): Promise<{ owner: Address; nonce: bigint }>;
  async verifyAndAuthorizeMutation<K extends MutatingPrimaryType>(
    primaryType: K,
    message: MutatingMessageMap[K],
    signature: Hex,
  ): Promise<{ owner: Address; nonce: bigint }> {
    const owner = await this.verifyOwnerSignature(primaryType, message, signature);
    this.validateExpiry(message.expiry, false);
    await this.consumeNonce(owner, message.nonce);
    return { owner, nonce: message.nonce };
  }

  getGrant(owner: Address): SessionGrantRecord | undefined {
    return this.sessionGrants.get(getAddress(owner));
  }

  clearGrants(): void {
    this.sessionGrants.clear();
  }
}
