export interface LendingPosition {
  /** In the private balance and free to lend. */
  available: bigint;
  /** Already lent by this owner. */
  supplied: bigint;
  /** Everyone's lent funds not out on loan, which limits what can come back now. */
  poolAvailable: bigint;
}

export type LendingChange =
  | { action: 'none'; amount: 0n; limited: boolean }
  | { action: 'supply' | 'redeem'; amount: bigint; limited: boolean };

/**
 * What moves the owner to lending this percent of their balance. `limited` means less can come back
 * now than they asked for, because the rest is out on loan.
 */
export function lendingChange(position: LendingPosition, percent: number): LendingChange {
  const { available, poolAvailable, supplied } = position;
  const target = ((available + supplied) * BigInt(percent)) / 100n;
  if (target > supplied) return { action: 'supply', amount: target - supplied, limited: false };
  const wanted = supplied - target;
  if (wanted === 0n) return { action: 'none', amount: 0n, limited: false };
  const amount = wanted < poolAvailable ? wanted : poolAvailable;
  if (amount === 0n) return { action: 'none', amount: 0n, limited: true };
  return { action: 'redeem', amount, limited: amount < wanted };
}
