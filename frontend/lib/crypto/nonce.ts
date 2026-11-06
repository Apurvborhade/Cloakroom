import type { Address } from 'viem';

const STORAGE_KEY_PREFIX = 'nony_last_nonce_';

/**
 * Monotonic nonce tracker for state-mutating requests (Deposit, Intent, Cancel, Withdrawal).
 * Enclave requires nonce > lastNonce, starting from 0 (so first valid nonce is 1).
 */
export function getLastCommittedNonce(owner: Address): bigint {
  if (typeof window === 'undefined') return 0n;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`);
    if (!raw) return 0n;
    return BigInt(raw);
  } catch {
    return 0n;
  }
}

export function getNextNonce(owner: Address): bigint {
  const last = getLastCommittedNonce(owner);
  return last + 1n;
}

export function commitNonce(owner: Address, nonce: bigint): void {
  if (typeof window === 'undefined') return;
  try {
    const last = getLastCommittedNonce(owner);
    if (nonce > last) {
      window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`, nonce.toString());
    }
  } catch {
    // Non-fatal if localStorage is restricted
  }
}

export function bumpNonceOnConflict(owner: Address, hintCurrentNonce?: bigint): bigint {
  if (typeof window === 'undefined') return 1n;
  try {
    const last = getLastCommittedNonce(owner);
    const candidate = hintCurrentNonce ? (hintCurrentNonce > last ? hintCurrentNonce : last) : last;
    const bumped = candidate + 1n;
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${owner.toLowerCase()}`, bumped.toString());
    return bumped;
  } catch {
    return 1n;
  }
}
