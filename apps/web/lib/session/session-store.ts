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
 * crypto.getRandomValues) and is never logged or sent anywhere. In the browser it is kept in
 * sessionStorage, so a refresh doesn't ask for another signature; it goes when the tab closes or
 * the grant expires. It can only sign SessionQuery reads: anyone holding it can see this owner's
 * balances until it expires, but mutations always go through the primary wallet.
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

const STORAGE_KEY = 'cloakroom.read-session';

export type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class SessionStore {
  #account: PrivateKeyAccount | null = null;
  #snapshot: ReadSession | null = null;
  #lastEnd: SessionEndReason | null = null;
  #listeners = new Set<Listener>();
  #clock: () => number;
  #storage: SessionStorageLike | null;

  constructor(clock: () => number = nowSec, storage: SessionStorageLike | null = null) {
    this.#clock = clock;
    this.#storage = storage;
    this.#restore();
  }

  #restore(): void {
    try {
      const saved = this.#storage?.getItem(STORAGE_KEY);
      if (!saved) return;
      const { key, session } = JSON.parse(saved) as { key: Hex; session: ReadSession };
      if (session.expiresAt - EXPIRY_MARGIN_SEC <= this.#clock()) {
        this.#storage?.removeItem(STORAGE_KEY);
        return;
      }
      this.#account = privateKeyToAccount(key);
      this.#snapshot = session;
    } catch {
      this.#account = null;
      this.#snapshot = null;
      try { this.#storage?.removeItem(STORAGE_KEY); } catch { /* Storage is unavailable. */ }
    }
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
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
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
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify({ key, session: this.#snapshot }));
    } catch {
      // Without storage the session still works until the next refresh.
    }
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
    try { this.#storage?.removeItem(STORAGE_KEY); } catch { /* Storage is unavailable. */ }
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

function browserStorage(): SessionStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export const sessionStore = new SessionStore(nowSec, browserStorage());
