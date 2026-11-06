import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex, Address } from 'viem';
import { EIP712_TYPES, createDomain, deriveEnclaveSalt } from './typedData';

export interface SessionKeyState {
  privateKey: Hex;
  address: Address;
  owner: Address;
  expiresAt: number; // Unix timestamp in seconds
}

const STORAGE_KEY_PREFIX = 'nony_session_key_';

export function getStoredSessionKey(owner: Address): SessionKeyState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`);
    if (!raw) return null;
    const parsed: SessionKeyState = JSON.parse(raw);
    const now = Math.floor(Date.now() / 1000);
    if (parsed.expiresAt <= now + 30) {
      // Expired or close to expiration
      sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createNewSessionKey(owner: Address, ttlSeconds: number = 1800): SessionKeyState {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const now = Math.floor(Date.now() / 1000);
  const state: SessionKeyState = {
    privateKey,
    address: account.address,
    owner,
    expiresAt: now + ttlSeconds,
  };
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`, JSON.stringify(state));
  }
  return state;
}

export function clearSessionKey(owner: Address): void {
  if (typeof window === 'undefined') return null;
  sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`);
}

/**
 * Signs a read query (`SessionQuery`) using the ephemeral session key.
 * This is done in-browser without any wallet popup.
 */
export async function signSessionQuery(
  session: SessionKeyState,
  chainId: number,
  enclavePubKey: Hex
): Promise<{ message: { owner: Address; expiry: string }; signature: Hex }> {
  const account = privateKeyToAccount(session.privateKey);
  const enclaveSalt = deriveEnclaveSalt(enclavePubKey);
  const domain = createDomain(chainId, enclaveSalt);
  const now = Math.floor(Date.now() / 1000);
  // Expiry for the query itself is short-lived (e.g., 60 seconds into the future)
  const queryExpiry = BigInt(now + 120);

  const signature = await account.signTypedData({
    domain,
    types: {
      SessionQuery: EIP712_TYPES.SessionQuery,
    },
    primaryType: 'SessionQuery',
    message: {
      owner: session.owner,
      expiry: queryExpiry,
    },
  });

  return {
    message: {
      owner: session.owner,
      expiry: queryExpiry.toString(),
    },
    signature,
  };
}
