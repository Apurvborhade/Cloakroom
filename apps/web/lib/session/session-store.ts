import { SESSION_GRANT_TTL_SEC } from '@cloakroom/shared';
import type { SessionQueryWire } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { createSession } from '../api/endpoints';
import type { CloakroomApi } from '../api/client';
import { ApiError, CLIENT_ERROR_CODES } from '../api/errors';
import { nowSec } from '../format/time';
import { buildSessionGrant, buildSessionQuery, QUERY_LIFETIME_SEC, signRequest } from '../wallet/typed-data';
import type { EnclaveBinding, SignedWire, TypedDataSigner } from '../wallet/typed-data';

/**
 * The read-only session key lifecycle.
 *
 * The key is generated with secure randomness (viem's generatePrivateKey uses
 * crypto.getRandomValues), lives only in this module's memory, and is never written to storage,
 * logged or sent anywhere. A refresh therefore loses it; the user signs a new grant. It can only
 * sign SessionQuery reads: mutations always go through the primary wallet.
 */
export interface ReadSession {
  owner: Address;
  sessionAddress: Address;
  /** Unix seconds, as confirmed by the enclave. */
  expiresAt: number;
  chainId: number;
  enclavePubKey: Hex;
}

/**
 * The grant asks for a little less than the enclave's 30-minute maximum, so a browser clock up to
 * a minute ahead of the enclave still produces an acceptable expiry.
 */
export const GRANT_LIFETIME_SEC = SESSION_GRANT_TTL_SEC - 60;
/** Stop using a session this close to its expiry, so a read never races the deadline. */
const EXPIRY_MARGIN_SEC = 15;

export type SessionEndReason = 'expired' | 'account-changed' | 'chain-changed' | 'enclave-changed' | 'rejected-by-enclave' | 'manual';

type Listener = () => void;

export class SessionStore {
  #account: PrivateKeyAccount | null = null;
  #snapshot: ReadSession | null = null;
  #lastEnd: SessionEndReason | null = null;
  #listeners = new Set<Listener>();
  #clock: () => number;

  constructor(clock: () => number = nowSec) {
    this.#clock = clock;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): ReadSession | null => this.#snapshot;

  get lastEndReason(): SessionEndReason | null {
    return this.#lastEnd;
  }

  /** True when a session exists for exactly this owner, chain and enclave key and is not near expiry. */
  isActive(owner: Address | undefined, binding: EnclaveBinding | null): boolean {
    const session = this.#snapshot;
    if (!session || !owner || !binding || !this.#account) return false;
    if (getAddress(owner) !== session.owner) return false;
    if (binding.chainId !== session.chainId || binding.enclavePubKey.toLowerCase() !== session.enclavePubKey.toLowerCase()) return false;
    if (session.expiresAt - EXPIRY_MARGIN_SEC <= this.#clock()) {
      this.end('expired');
      return false;
    }
    return true;
  }

  /** Generates a fresh key, has the primary wallet sign the grant, and registers it with the enclave. */
  async establish(params: {
    owner: Address;
    binding: EnclaveBinding;
    ownerSigner: TypedDataSigner;
    api: CloakroomApi;
  }): Promise<ReadSession> {
    const owner = getAddress(params.owner);
    const account = privateKeyToAccount(generatePrivateKey());
    const request = buildSessionGrant(params.binding, {
      owner,
      sessionKey: account.address,
      expiry: BigInt(this.#clock() + GRANT_LIFETIME_SEC),
    });
    const signed = await signRequest(params.ownerSigner, request);
    const response = await createSession(params.api, params.binding, signed);
    this.#account = account;
    this.#snapshot = {
      owner,
      sessionAddress: account.address,
      expiresAt: response.expiresAt,
      chainId: params.binding.chainId,
      enclavePubKey: params.binding.enclavePubKey,
    };
    this.#lastEnd = null;
    this.#emit();
    return this.#snapshot;
  }

  /** Signs a SessionQuery with the session key. Throws NO_SESSION when there is no usable session. */
  async signQuery(owner: Address | undefined, binding: EnclaveBinding | null): Promise<SignedWire<SessionQueryWire>> {
    if (!this.isActive(owner, binding) || !this.#account || !this.#snapshot || !binding) {
      throw new ApiError(CLIENT_ERROR_CODES.NO_SESSION);
    }
    const account = this.#account;
    const request = buildSessionQuery(binding, {
      owner: this.#snapshot.owner,
      expiry: BigInt(this.#clock() + QUERY_LIFETIME_SEC),
    });
    return signRequest((args) => account.signTypedData(args as Parameters<PrivateKeyAccount['signTypedData']>[0]), request);
  }

  end(reason: SessionEndReason): void {
    if (!this.#snapshot && !this.#account) return;
    this.#account = null;
    this.#snapshot = null;
    this.#lastEnd = reason;
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const sessionStore = new SessionStore();
