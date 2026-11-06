import { NATIVE, PRICE_PRECISION } from '@cloakroom/shared';
import type { PriceReport } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import type { Quote, QuoteRequest } from './uniswap.js';

const NATIVE_DECIMALS = 18;
const MS_PER_SECOND = 1000;
/** A report older than this many poll intervals no longer counts as the latest price. */
const MAX_AGE_INTERVALS = 2;

export interface PricePollerDeps {
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
  tokenOut: Address;
  tokenOutDecimals: number;
  referenceAmountWei: bigint;
  intervalSec: number;
  /** A throwaway address, so polling does not reveal custody addresses to Uniswap. */
  swapper: Address;
  /** Called with each new price. It must not wait for a swap to finish before returning. */
  onReport: (report: PriceReport) => void | Promise<void>;
  /** Called when a poll or handler fails. A failed poll reports no price. */
  onError: (error: unknown) => void;
  now?: () => number;
}

/** Turns a quote into tokenOut per 1 ETH in human units, scaled by 1e18. Rounds down. */
export function priceFromQuote(
  amountIn: bigint,
  amountOut: bigint,
  tokenOutDecimals: number,
): bigint {
  return (
    (amountOut * PRICE_PRECISION * 10n ** BigInt(NATIVE_DECIMALS)) /
    (amountIn * 10n ** BigInt(tokenOutDecimals))
  );
}

/** Checks the price on a timer. Polls never overlap, and stopping cancels any report in flight. */
export class PricePoller {
  private latestReport: PriceReport | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly pair: string;
  private readonly now: () => number;

  constructor(private readonly deps: PricePollerDeps) {
    this.pair = `${getAddress(NATIVE)}/${getAddress(deps.tokenOut)}`;
    this.now = deps.now ?? Date.now;
  }

  /** Polls now and then on every interval. Returns a function that stops polling. */
  start(): () => void {
    if (this.running) throw new Error('PRICE_POLLER_RUNNING');
    this.running = true;
    void this.pollAndSchedule();
    return () => this.stop();
  }

  /** The newest price, or null if none is recent enough to act on. */
  latest(): PriceReport | null {
    if (!this.latestReport) return null;
    const ageSec = this.now() / MS_PER_SECOND - this.latestReport.ts;
    return ageSec <= this.deps.intervalSec * MAX_AGE_INTERVALS ? this.latestReport : null;
  }

  /** The newest price however old it is, or null before the first one. Margin uses this. */
  lastReport(): PriceReport | null {
    return this.latestReport;
  }

  private stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async pollAndSchedule(): Promise<void> {
    await this.poll();
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.pollAndSchedule();
    }, this.deps.intervalSec * MS_PER_SECOND);
  }

  private async poll(): Promise<void> {
    const { onError, onReport, quoter, referenceAmountWei, swapper, tokenOut, tokenOutDecimals } =
      this.deps;
    let report: PriceReport;
    try {
      const quote = await quoter.quote({
        tokenIn: NATIVE,
        tokenOut,
        amountIn: referenceAmountWei,
        swapper,
      });
      report = {
        pair: this.pair,
        price: priceFromQuote(quote.amountIn, quote.amountOut, tokenOutDecimals),
        ts: Math.floor(this.now() / MS_PER_SECOND),
        source: 'uniswap',
      };
    } catch (error) {
      if (this.running) onError(error);
      return;
    }
    if (!this.running) return;

    this.latestReport = report;
    try {
      void Promise.resolve(onReport(report)).catch(onError);
    } catch (error) {
      onError(error);
    }
  }
}
