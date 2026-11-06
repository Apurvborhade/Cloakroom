/**
 * Mutating requests need a nonce strictly above the owner's last accepted one, and the API has no
 * way to read that value. Like the repository's round-trip script, this uses the current time in
 * milliseconds, bumped when two requests land in the same millisecond. A NONCE_USED answer means
 * another client used a higher nonce; retrying picks a newer one.
 */
let last = 0n;

export function nextNonce(now: () => number = Date.now): bigint {
  const candidate = BigInt(now());
  last = candidate > last ? candidate : last + 1n;
  return last;
}

/** For tests only. */
export function resetNonceForTests(): void {
  last = 0n;
}
