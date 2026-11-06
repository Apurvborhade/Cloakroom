import { NATIVE } from '@cloakroom/shared';
import type { PriceReport } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import { priceFromQuote } from './price-poller.js';
import type { Quote, QuoteRequest } from './uniswap.js';

const MS_PER_SECOND = 1000;
const BPS_SCALE = 10_000n;
/** A report older than this many poll intervals no longer counts as the latest price. */
const MAX_AGE_INTERVALS = 2;

export interface RiskPricePollerDeps {
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
  tokenOut: Address;
  tokenOutDecimals: number;
  referenceAmountWei: bigint;
  intervalSec: number;
  /** Buy and sell prices further apart than this are treated as a bad reading, not a price. */
  maxSpreadBps: number;
  /** A throwaway address, so polling does not reveal custody addresses to Uniswap. */
  swapper: Address;
  onReport: (report: PriceReport) => void | Promise<void>;
  onError: (error: unknown) => void;
  now?: () => number;
}

/**
 * The price margin risk is measured against, kept apart from the quote each swap executes at.
 *
 * It is the midpoint of Uniswap's buy and sell prices, because the two differ by about 0.6% on
 * Sepolia and using one side would make longs and shorts look unequally healthy. With no valid
 * reading, latest() returns null, which stops new positions and liquidations.
 */
export class RiskPricePoller {
  private latestReport: PriceReport | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly pair: string;
  private readonly now: () => number;

  constructor(private readonly deps: RiskPricePollerDeps) {
    this.pair = `${getAddress(NATIVE)}/${getAddress(deps.tokenOut)}`;
    this.now = deps.now ?? Date.now;
  }

  start(): () => void {
    if (this.running) throw new Error('RISK_PRICE_POLLER_RUNNING');
    this.running = true;
    void this.pollAndSchedule();
    return () => {
      this.running = false;
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
    };
  }

  latest(): PriceReport | null {
    if (!this.latestReport) return null;
    const ageSec = this.now() / MS_PER_SECOND - this.latestReport.ts;
    return ageSec <= this.deps.intervalSec * MAX_AGE_INTERVALS ? this.latestReport : null;
  }

  /** Reads both directions once. Public so a test or script can poll without a timer. */
  async poll(): Promise<PriceReport> {
    const { maxSpreadBps, quoter, referenceAmountWei, swapper, tokenOut, tokenOutDecimals } = this.deps;
    const sell = await quoter.quote({ tokenIn: NATIVE, tokenOut, amountIn: referenceAmountWei, swapper });
    const buy = await quoter.quote({ tokenIn: tokenOut, tokenOut: NATIVE, amountIn: sell.amountOut, swapper });

    const sellPrice = priceFromQuote(sell.amountIn, sell.amountOut, tokenOutDecimals);
    const buyPrice = priceFromQuote(buy.amountOut, buy.amountIn, tokenOutDecimals);
    if (sellPrice === 0n || buyPrice === 0n) throw new Error('RISK_PRICE_INVALID');
    const [low, high] = sellPrice < buyPrice ? [sellPrice, buyPrice] : [buyPrice, sellPrice];
    if ((high - low) * BPS_SCALE > low * BigInt(maxSpreadBps)) throw new Error('RISK_PRICE_SPREAD');

    const report: PriceReport = {
      pair: this.pair,
      price: (low + high) / 2n,
      ts: Math.floor(this.now() / MS_PER_SECOND),
      source: 'uniswap-midpoint',
    };
    this.latestReport = report;
    return report;
  }

  private async pollAndSchedule(): Promise<void> {
    try {
      const report = await this.poll();
      if (this.running) await this.deps.onReport(report);
    } catch (error) {
      if (this.running) this.deps.onError(error);
    }
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.pollAndSchedule();
    }, this.deps.intervalSec * MS_PER_SECOND);
  }
}
