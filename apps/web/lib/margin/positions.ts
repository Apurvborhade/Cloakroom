import type { PositionItem } from '@cloakroom/shared';

export const OPEN_STATUSES = new Set(['opening', 'open', 'closing', 'liquidating']);
export const BUSY_STATUSES = new Set(['opening', 'closing', 'liquidating']);

export interface MarginTotals {
  activeCount: number;
  openCount: number;
  collateral: bigint;
  /** Summed per debt token: a long owes USDC, a short owes ETH. */
  debtByToken: Record<string, bigint>;
  /** Sum of equity over positions that report it, and how many do. */
  equity: bigint;
  equityReported: number;
  /** Open positions without an equity value: the enclave had no fresh risk price. */
  openWithoutEquity: number;
}

/** Aggregates only what the backend reported; missing optional fields are counted, not zeroed. */
export function marginTotals(positions: readonly PositionItem[]): MarginTotals {
  const totals: MarginTotals = { activeCount: 0, openCount: 0, collateral: 0n, debtByToken: {}, equity: 0n, equityReported: 0, openWithoutEquity: 0 };
  for (const position of positions) {
    if (!OPEN_STATUSES.has(position.status)) continue;
    totals.activeCount += 1;
    totals.collateral += BigInt(position.collateral);
    const key = position.debtToken.toLowerCase();
    totals.debtByToken[key] = (totals.debtByToken[key] ?? 0n) + BigInt(position.debt);
    if (position.status === 'open') {
      totals.openCount += 1;
      if (position.equity === undefined) totals.openWithoutEquity += 1;
    }
    if (position.equity !== undefined) {
      totals.equity += BigInt(position.equity);
      totals.equityReported += 1;
    }
  }
  return totals;
}

/** What the absence of equity on open positions says about the risk price. */
export function riskPriceFreshness(totals: MarginTotals): 'fresh' | 'stale' | 'unknown' {
  if (totals.openCount === 0) return 'unknown';
  return totals.openWithoutEquity === 0 ? 'fresh' : 'stale';
}

export function leverageLabel(bps: number): string {
  return `${(bps / 10_000).toFixed(bps % 10_000 === 0 ? 0 : 2).replace(/0$/, '')}x`;
}
