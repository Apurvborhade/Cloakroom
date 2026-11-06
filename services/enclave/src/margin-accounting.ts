import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { ERROR_CODES, NATIVE, ORACLE_MAX_STALENESS_SEC } from '@cloakroom/shared';
import type {
  MarginAccounting, MarginAddCollateralMsg, MarginCloseMsg, MarginExecutionFailure, MarginExecutionResult,
  MarginOpenMsg, MarginOperation, PositionView, PriceReport,
} from '@cloakroom/shared';
import { getAddress, keccak256, toBytes } from 'viem';
import type { Address, Hex } from 'viem';
import { AuthError } from './auth.js';
import { MarginFunding } from './margin-funding.js';
import type { MarginFundingDeps } from './margin-funding.js';
import type { MarginPosition, MarginApproval, MarginStateEvent } from './margin-positions.js';
import { minOutForLimit } from './swap-calldata.js';

const BPS = 10_000n;
const MAINTENANCE_BPS = 1_000n;
const LIQUIDATION_SLIPPAGE_BPS = 300;
const SHORT_CLOSE_BUFFER_BPS = 200n;
const OPERATION_TTL_SEC = 120;

export interface JournaledMarginAccountingDeps extends MarginFundingDeps {
  usdcDecimals: number;
  maxPriceAgeSec?: number;
  nowMs?: () => number;
}

/** Full-close positions, up to 4x, without interest or extra margin fees. */
export class JournaledMarginAccounting extends MarginFunding implements MarginAccounting {
  private readonly tokenOut: Address;
  private readonly scale: bigint;
  private readonly nowMs: () => number;

  constructor(private readonly options: JournaledMarginAccountingDeps) {
    super(options);
    if (!Number.isInteger(options.usdcDecimals) || options.usdcDecimals < 0 || options.usdcDecimals > 18) throw new Error('MARGIN_DECIMALS_INVALID');
    this.tokenOut = getAddress(options.usdc);
    this.scale = 10n ** BigInt(options.usdcDecimals);
    this.nowMs = options.nowMs ?? Date.now;
    for (const p of options.ledger.marginPositions.positions()) {
      const usdc = p.side === 'long' ? p.debtToken : p.assetToken;
      if (usdc !== this.tokenOut || p.usdcDecimals !== options.usdcDecimals) throw new Error('MARGIN_ASSET_MISMATCH');
    }
  }

  private now(): number { return Math.floor(this.nowMs() / 1000); }

  private command(owner: Address, message: { owner: Address; nonce: bigint }): string {
    if (getAddress(owner) !== getAddress(message.owner)) throw new AuthError(ERROR_CODES.BAD_SIGNATURE);
    if (typeof message.nonce !== 'bigint' || message.nonce <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
    return `margin:command:${getAddress(owner)}:${message.nonce}`;
  }

  private expiry(expiry: bigint): number {
    if (typeof expiry !== 'bigint' || expiry <= BigInt(this.now())) throw new AuthError(ERROR_CODES.EXPIRED);
    const cap = this.now() + OPERATION_TTL_SEC;
    return expiry < BigInt(cap) ? Number(expiry) : cap;
  }

  private price(report: PriceReport): bigint {
    const age = this.now() - report.ts;
    if (report.pair !== `${NATIVE}/${this.tokenOut}` || typeof report.price !== 'bigint' || report.price <= 0n ||
      !Number.isSafeInteger(report.ts) || age < 0 || age > (this.options.maxPriceAgeSec ?? ORACLE_MAX_STALENESS_SEC)) {
      throw new AuthError(ERROR_CODES.STALE_PRICE);
    }
    return report.price;
  }

  private swapLimit(limit: bigint, slippage: number): void {
    if (typeof limit !== 'bigint' || limit <= 0n || !Number.isInteger(slippage) || slippage < 0 || slippage >= 10_000) {
      throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
    }
  }

  private publicOperation(event: MarginApproval): MarginOperation {
    const { t: _type, accounting: _accounting, positionId, ...operation } = event;
    return { ...operation, positionId: positionId as Hex };
  }

  private previous(opId: string, kind: 'open' | 'close', message: MarginOpenMsg | MarginCloseMsg): MarginOperation | undefined {
    const previous = this.options.ledger.margin.command(opId);
    if (!previous) return undefined;
    if (previous.t !== 'MARGIN_OP_APPROVED' || previous.kind !== kind || !previous.accounting ||
      !('message' in previous.accounting) || !isDeepStrictEqual(previous.accounting.message, message)) {
      throw new AuthError(ERROR_CODES.NONCE_USED, 'MARGIN_OP_CONFLICT');
    }
    return this.publicOperation(previous);
  }

  /** Called only inside the shared queue. */
  private async write(event: MarginStateEvent): Promise<void> {
    const { ledger, journal } = this.options;
    ledger.margin.assertAvailable();
    if (!ledger.marginPositions.validate(event)) return;
    try {
      await journal.append(event);
      ledger.apply(event);
    } catch (error) {
      ledger.margin.stop();
      throw error;
    }
  }

  async prepareOpen(owner: Address, input: MarginOpenMsg, report: PriceReport): Promise<MarginOperation> {
    const message = structuredClone(input), price = structuredClone(report);
    const opId = this.command(owner, message);
    return this.options.queue.run(async () => {
      this.options.ledger.margin.assertAvailable();
      const previous = this.previous(opId, 'open', message);
      if (previous) return previous;
      const expiry = this.expiry(message.expiry), riskPrice = this.price(price);
      this.swapLimit(message.limitPrice, message.maxSlippageBps);
      if (message.side !== 0 && message.side !== 1) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
      const long = message.side === 0;
      if (typeof message.collateral !== 'bigint' || message.collateral <= 0n || !Number.isInteger(message.leverageBps) ||
        message.leverageBps < 10_000 || message.leverageBps > 40_000) throw new AuthError(ERROR_CODES.INSUFFICIENT_COLLATERAL);
      const size = message.collateral * BigInt(message.leverageBps) / BPS;
      const amountIn = long ? size : size * 10n ** 36n / (riskPrice * this.scale);
      if (amountIn === 0n) throw new AuthError(ERROR_CODES.INSUFFICIENT_COLLATERAL);
      const minimum = minOutForLimit(long ? 'buy' : 'sell', amountIn, message.limitPrice, this.options.usdcDecimals);
      const exposure = long ? this.value(minimum, riskPrice) : this.cost(amountIn, riskPrice);
      const equity = long ? exposure - (size - message.collateral) : message.collateral + minimum - exposure;
      if (exposure === 0n || equity * BPS <= exposure * MAINTENANCE_BPS) {
        throw new AuthError(ERROR_CODES.INSUFFICIENT_COLLATERAL);
      }
      const event: MarginApproval = {
        t: 'MARGIN_OP_APPROVED', opId, kind: 'open', positionId: keccak256(toBytes(opId)), owner: getAddress(owner),
        tokenIn: long ? this.tokenOut : NATIVE, tokenOut: long ? NATIVE : this.tokenOut, amountIn, minAmountOut: minimum,
        maxSlippageBps: message.maxSlippageBps, expiry,
        accounting: { kind: long ? 'long-open' : 'short-open', message, usdcDecimals: this.options.usdcDecimals },
      };
      await this.write(event);
      return this.publicOperation(event);
    });
  }

  async prepareClose(owner: Address, input: MarginCloseMsg, report: PriceReport): Promise<MarginOperation> {
    const message = structuredClone(input), price = structuredClone(report);
    const opId = this.command(owner, message);
    return this.options.queue.run(async () => {
      this.options.ledger.margin.assertAvailable();
      const previous = this.previous(opId, 'close', message);
      if (previous) return previous;
      const riskPrice = this.price(price);
      this.swapLimit(message.limitPrice, message.maxSlippageBps);
      const position = this.options.ledger.marginPositions.owned(owner, message.positionId);
      const event = this.closeApproval(position, opId, 'close', message.limitPrice, message.maxSlippageBps, this.expiry(message.expiry), riskPrice);
      // A voluntary close cannot waive the lenders' principal. Underwater exits use liquidation.
      const repayment = position.debt - (position.side === 'long' ? position.cash : 0n);
      if (event.minAmountOut < repayment) event.minAmountOut = repayment;
      event.accounting = { kind: position.side === 'long' ? 'long-close' : 'short-close', message };
      await this.write(event);
      return this.publicOperation(event);
    });
  }

  async addCollateral(owner: Address, input: MarginAddCollateralMsg): Promise<void> {
    const message = structuredClone(input), opId = this.command(owner, message);
    await this.options.queue.run(async () => {
      const event = { t: 'MARGIN_COLLATERAL_ADDED', opId, message } as const;
      this.options.ledger.margin.assertAvailable();
      if (!this.options.ledger.margin.validateCommand(event)) return;
      this.expiry(message.expiry);
      await this.write(event);
    });
  }

  async liquidationCandidates(report: PriceReport): Promise<readonly Hex[]> {
    const price = this.price(report);
    return this.options.ledger.marginPositions.positions()
      .filter((p) => p.status === 'open' && this.unhealthy(p, price)).map((p) => p.id);
  }

  async prepareLiquidation(positionId: Hex, report: PriceReport): Promise<MarginOperation | null> {
    const snapshot = structuredClone(report);
    return this.options.queue.run(async () => {
      this.options.ledger.margin.assertAvailable();
      const price = this.price(snapshot), position = this.options.ledger.marginPositions.position(positionId);
      if (!position || position.status !== 'open' || !this.unhealthy(position, price)) return null;
      const slippage = BigInt(LIQUIDATION_SLIPPAGE_BPS);
      const limit = position.side === 'long' ? price * (BPS - slippage) / BPS : price * (BPS + slippage) / BPS;
      const event = this.closeApproval(position, `margin:liquidate:${randomBytes(32).toString('hex')}`,
        'liquidate', limit, LIQUIDATION_SLIPPAGE_BPS, this.now() + OPERATION_TTL_SEC, price);
      await this.write(event);
      return this.publicOperation(event);
    });
  }

  private closeApproval(p: MarginPosition, opId: string, kind: 'close' | 'liquidate', limit: bigint, slippage: number,
    expiry: number, riskPrice: bigint): MarginApproval {
    if (p.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
    const long = p.side === 'long';
    const funds = p.asset + (long ? 0n : p.cash);
    const needed = long ? p.asset : (this.cost(p.debt, riskPrice) * (BPS + SHORT_CLOSE_BUFFER_BPS) + BPS - 1n) / BPS;
    const amountIn = needed < funds ? needed : funds;
    let minimum = minOutForLimit(long ? 'sell' : 'buy', amountIn, limit, this.options.usdcDecimals);
    // Leftover USDC can be paid out only if the ETH loan is fully repaid.
    if (!long && amountIn < funds && minimum < p.debt) minimum = p.debt;
    return { t: 'MARGIN_OP_APPROVED', opId, kind, positionId: p.id, owner: p.owner,
      tokenIn: p.assetToken, tokenOut: p.debtToken, amountIn, minAmountOut: minimum,
      maxSlippageBps: slippage, expiry, accounting: { kind: long ? 'long-liquidate' : 'short-liquidate' } };
  }

  async settle(opId: string, result: MarginExecutionResult): Promise<void> {
    await this.finish({ t: 'MARGIN_OP_SETTLED', opId, ...structuredClone(result) });
  }

  async fail(opId: string, failure: MarginExecutionFailure): Promise<void> {
    await this.finish({ t: 'MARGIN_OP_FAILED', opId, ...structuredClone(failure) });
  }

  private async finish(event: Extract<MarginStateEvent, { t: 'MARGIN_OP_SETTLED' | 'MARGIN_OP_FAILED' }>): Promise<void> {
    await this.options.queue.run(async () => {
      if (!this.options.ledger.marginPositions.operation(event.opId)) throw new Error('MARGIN_OPERATION_NOT_FOUND');
      await this.write(event);
    });
  }

  positions(owner: Address, report: PriceReport | null): readonly PositionView[] {
    const price = report ? this.price(report) : null;
    return this.options.ledger.marginPositions.positions().filter((p) => p.owner === getAddress(owner)).map((p) => {
      const { openOpId: _id, usdcDecimals: _decimals, cash: _cash, ...view } = p;
      if (p.status !== 'open') return view;
      const long = p.side === 'long';
      const basis = long ? (p.debt > p.cash ? p.debt - p.cash : 0n) : p.cash + p.asset;
      const numerator = basis * BPS * 10n ** 36n;
      const denominator = (long ? p.asset : p.debt) * this.scale * (long ? BPS - MAINTENANCE_BPS : BPS + MAINTENANCE_BPS);
      return { ...view, liquidationPrice: (numerator + denominator - 1n) / denominator,
        ...(price === null ? {} : { equity: this.equity(p, price) }) };
    });
  }

  private value(eth: bigint, price: bigint): bigint { return eth * price * this.scale / 10n ** 36n; }

  private cost(eth: bigint, price: bigint): bigint { return (eth * price * this.scale + 10n ** 36n - 1n) / 10n ** 36n; }

  private equity(p: MarginPosition, price: bigint): bigint {
    return p.side === 'long' ? this.value(p.asset, price) + p.cash - p.debt : p.asset + p.cash - this.cost(p.debt, price);
  }

  private unhealthy(p: MarginPosition, price: bigint): boolean {
    const exposure = p.side === 'long' ? this.value(p.asset, price) : this.cost(p.debt, price);
    return this.equity(p, price) * BPS <= exposure * MAINTENANCE_BPS;
  }
}

export { JournaledMarginAccounting as LongMarginAccounting };
export type LongMarginAccountingDeps = JournaledMarginAccountingDeps;
