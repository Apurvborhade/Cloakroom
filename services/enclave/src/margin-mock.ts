import { randomBytes } from 'node:crypto';
import { BPS_DENOMINATOR_BIGINT, ERROR_CODES, NATIVE, PRICE_PRECISION } from '@cloakroom/shared';
import type {
  Journal,
  LendingView,
  MarginAccounting,
  MarginAddCollateralMsg,
  MarginCloseMsg,
  MarginExecutionFailure,
  MarginExecutionResult,
  MarginOpenMsg,
  MarginOperation,
  MarginOperationKind,
  MarginSupplyMsg,
  PositionView,
  PriceReport,
  SerialQueue,
} from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { AuthError } from './auth.js';
import { minOutForLimit } from './swap-calldata.js';

const ID_BYTES = 32;
const WEI_PER_ETH = 10n ** 18n;
const MS_PER_SECOND = 1000;

export interface MockMarginAccountingDeps {
  journal: Pick<Journal, 'append'>;
  queue: Pick<SerialQueue, 'run'>;
  usdc: Address;
  usdcDecimals: number;
  maxLeverageBps?: number;
  maintenanceBps?: number;
  /** How far below the risk price a liquidation may sell. */
  liquidationSlippageBps?: number;
  /** Extra USDC spent closing a short, since swaps are exact-input and the debt is a fixed amount of ETH. */
  shortCloseBufferBps?: number;
  operationTtlSec?: number;
  nowMs?: () => number;
}

interface MockPosition extends PositionView {
  leverageBps: number;
}

/**
 * A stand-in for Felix's accounting, so the API and execution can be built and demonstrated first.
 *
 * It is in memory only, doesn't touch the real ledger, charges no interest, and trusts that the
 * owner has the funds. server.ts refuses to use it outside simulation. Its risk maths follows the
 * proposed rules in docs/margin-interface.md and is expected to be replaced, not extended.
 */
export class MockMarginAccounting implements MarginAccounting {
  private readonly positionsById = new Map<Hex, MockPosition>();
  private readonly operations = new Map<string, MarginOperation>();
  private readonly supplied = new Map<string, bigint>();
  private readonly loaned = new Map<Address, bigint>();
  private readonly usdc: Address;
  private readonly maxLeverageBps: bigint;
  private readonly maintenanceBps: bigint;
  private readonly liquidationSlippageBps: bigint;
  private readonly shortCloseBufferBps: bigint;
  private readonly operationTtlSec: number;
  private readonly usdcScale: bigint;
  private readonly nowMs: () => number;

  constructor(private readonly deps: MockMarginAccountingDeps) {
    this.usdc = getAddress(deps.usdc);
    this.maxLeverageBps = BigInt(deps.maxLeverageBps ?? 40_000);
    this.maintenanceBps = BigInt(deps.maintenanceBps ?? 1_000);
    this.liquidationSlippageBps = BigInt(deps.liquidationSlippageBps ?? 300);
    this.shortCloseBufferBps = BigInt(deps.shortCloseBufferBps ?? 200);
    this.operationTtlSec = deps.operationTtlSec ?? 120;
    this.usdcScale = 10n ** BigInt(deps.usdcDecimals);
    this.nowMs = deps.nowMs ?? Date.now;
  }

  async supply(owner: Address, { amount, token }: MarginSupplyMsg): Promise<void> {
    const key = this.lendingKey(owner, token);
    this.supplied.set(key, (this.supplied.get(key) ?? 0n) + amount);
  }

  async redeem(owner: Address, { amount, token }: MarginSupplyMsg): Promise<void> {
    const key = this.lendingKey(owner, token);
    const supplied = this.supplied.get(key) ?? 0n;
    if (supplied < amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE);
    if (this.availableToLend(token) < amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_LIQUIDITY);
    this.supplied.set(key, supplied - amount);
  }

  async addCollateral(owner: Address, { amount, positionId }: MarginAddCollateralMsg): Promise<void> {
    const position = this.ownedPosition(owner, positionId);
    if (position.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
    position.collateral += amount;
  }

  async prepareOpen(owner: Address, message: MarginOpenMsg, price: PriceReport): Promise<MarginOperation> {
    const { collateral, leverageBps, limitPrice, maxSlippageBps } = message;
    if (BigInt(leverageBps) > this.maxLeverageBps) throw new AuthError(ERROR_CODES.INSUFFICIENT_COLLATERAL);
    const sizeUsd = (collateral * BigInt(leverageBps)) / BPS_DENOMINATOR_BIGINT;
    const id = `0x${randomBytes(ID_BYTES).toString('hex')}` as Hex;
    const long = message.side === 0;

    // A long borrows the size less the collateral. A short borrows ETH worth the whole size.
    const debtToken = long ? this.usdc : getAddress(NATIVE);
    const debt = long ? sizeUsd - collateral : this.ethFor(sizeUsd, price.price);
    if (this.availableToLend(debtToken) < debt) throw new AuthError(ERROR_CODES.INSUFFICIENT_LIQUIDITY);

    const amountIn = long ? sizeUsd : debt;
    this.positionsById.set(id, {
      id,
      owner: getAddress(owner),
      side: long ? 'long' : 'short',
      status: 'opening',
      collateral,
      sizeUsd,
      leverageBps,
      debtToken,
      debt,
      assetToken: long ? getAddress(NATIVE) : this.usdc,
      asset: 0n,
    });
    this.addLoan(debtToken, debt);
    return this.approve(id, 'open', {
      tokenIn: long ? this.usdc : getAddress(NATIVE),
      tokenOut: long ? getAddress(NATIVE) : this.usdc,
      amountIn,
      minAmountOut: minOutForLimit(long ? 'buy' : 'sell', amountIn, limitPrice, this.deps.usdcDecimals),
      maxSlippageBps,
    });
  }

  async prepareClose(owner: Address, message: MarginCloseMsg, price: PriceReport): Promise<MarginOperation> {
    const position = this.ownedPosition(owner, message.positionId);
    if (position.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
    position.status = 'closing';
    return this.approveClose(position, 'close', message.limitPrice, message.maxSlippageBps, price.price);
  }

  async liquidationCandidates(price: PriceReport): Promise<readonly Hex[]> {
    return [...this.positionsById.values()]
      .filter((position) => position.status === 'open' && this.belowMaintenance(position, price.price))
      .map((position) => position.id);
  }

  async prepareLiquidation(positionId: Hex, price: PriceReport): Promise<MarginOperation | null> {
    const position = this.positionsById.get(positionId);
    if (!position || position.status !== 'open' || !this.belowMaintenance(position, price.price)) return null;
    position.status = 'liquidating';
    // A long sells at no less than this limit, and a short buys at no more.
    const room = position.side === 'long'
      ? BPS_DENOMINATOR_BIGINT - this.liquidationSlippageBps
      : BPS_DENOMINATOR_BIGINT + this.liquidationSlippageBps;
    const limit = (price.price * room) / BPS_DENOMINATOR_BIGINT;
    return this.approveClose(position, 'liquidate', limit, Number(this.liquidationSlippageBps), price.price);
  }

  async settle(opId: string, result: MarginExecutionResult): Promise<void> {
    await this.deps.queue.run(() => this.deps.journal.append({ t: 'MARGIN_OP_SETTLED', opId, ...result }));
    const operation = this.operations.get(opId);
    if (!operation) return;
    const position = this.positionsById.get(operation.positionId);
    if (!position) return;

    if (operation.kind === 'open') {
      position.status = 'open';
      position.asset = result.amountOut;
      position.entryPrice = this.fillPrice(position.side, result);
    } else {
      this.finishClose(position, operation.kind, result);
    }
  }

  async fail(opId: string, failure: MarginExecutionFailure): Promise<void> {
    await this.deps.queue.run(() => this.deps.journal.append({ t: 'MARGIN_OP_FAILED', opId, ...failure }));
    const operation = this.operations.get(opId);
    if (!operation) return;
    const position = this.positionsById.get(operation.positionId);
    if (!position) return;
    position.reason = failure.reason;
    if (operation.kind === 'open') {
      position.status = 'failed';
      this.addLoan(position.debtToken, -position.debt);
    } else {
      // The debt is still owed and the assets are still locked, so the position stays open.
      position.status = 'open';
    }
  }

  positions(owner: Address, price: PriceReport | null): readonly PositionView[] {
    const key = getAddress(owner);
    return [...this.positionsById.values()]
      .filter((position) => position.owner === key)
      .map((position) => {
        const { leverageBps: _leverage, ...view } = position;
        if (!price || position.status !== 'open') return view;
        return {
          ...view,
          equity: this.equity(position, price.price),
          liquidationPrice: this.liquidationPrice(position),
        };
      });
  }

  lending(owner: Address): readonly LendingView[] {
    const key = getAddress(owner);
    return [getAddress(NATIVE), this.usdc].map((token) => ({
      token,
      supplied: this.supplied.get(this.lendingKey(key, token)) ?? 0n,
      available: this.availableToLend(token),
    }));
  }

  /** Closing a long sells all its ETH. Closing a short buys back its ETH debt with USDC. */
  private async approveClose(
    position: MockPosition,
    kind: MarginOperationKind,
    limitPrice: bigint,
    maxSlippageBps: number,
    riskPrice: bigint,
  ): Promise<MarginOperation> {
    const long = position.side === 'long';
    const usdcNeeded = (this.usdcFor(position.debt, riskPrice) * (BPS_DENOMINATOR_BIGINT + this.shortCloseBufferBps))
      / BPS_DENOMINATOR_BIGINT;
    const usdcHeld = position.asset + position.collateral;
    const amountIn = long ? position.asset : usdcNeeded < usdcHeld ? usdcNeeded : usdcHeld;
    return this.approve(position.id, kind, {
      tokenIn: long ? getAddress(NATIVE) : this.usdc,
      tokenOut: long ? this.usdc : getAddress(NATIVE),
      amountIn,
      minAmountOut: minOutForLimit(long ? 'sell' : 'buy', amountIn, limitPrice, this.deps.usdcDecimals),
      maxSlippageBps,
    });
  }

  private async approve(
    positionId: Hex,
    kind: MarginOperationKind,
    swap: Pick<MarginOperation, 'tokenIn' | 'tokenOut' | 'amountIn' | 'minAmountOut' | 'maxSlippageBps'>,
  ): Promise<MarginOperation> {
    const position = this.positionsById.get(positionId) as MockPosition;
    const operation: MarginOperation = {
      opId: `margin:${randomBytes(ID_BYTES).toString('hex')}`,
      kind,
      positionId,
      owner: position.owner,
      expiry: Math.floor(this.nowMs() / MS_PER_SECOND) + this.operationTtlSec,
      ...swap,
    };
    await this.deps.queue.run(() => this.deps.journal.append({ t: 'MARGIN_OP_APPROVED', ...operation }));
    delete position.reason;
    this.operations.set(operation.opId, operation);
    return operation;
  }

  private finishClose(position: MockPosition, kind: MarginOperationKind, result: MarginExecutionResult): void {
    this.addLoan(position.debtToken, -position.debt);
    if (position.side === 'long') {
      // The collateral went into the ETH, so the sale pays the loan and the rest is the trader's.
      const proceeds = result.amountOut;
      position.payout = proceeds > position.debt ? proceeds - position.debt : 0n;
      position.shortfall = position.debt > proceeds ? position.debt - proceeds : 0n;
    } else {
      // The USDC not spent buying back the ETH is the trader's. A shortfall here is in ETH.
      position.payout = position.collateral + position.asset - result.amountIn;
      position.shortfall = position.debt > result.amountOut ? position.debt - result.amountOut : 0n;
    }
    position.asset = 0n;
    position.status = kind === 'liquidate' ? 'liquidated' : 'closed';
  }

  /** Below maintenance when equity is under the required share of the position's current value. */
  private belowMaintenance(position: MockPosition, price: bigint): boolean {
    return this.equity(position, price) * BPS_DENOMINATOR_BIGINT < this.exposure(position, price) * this.maintenanceBps;
  }

  private equity(position: MockPosition, price: bigint): bigint {
    return position.side === 'long'
      ? position.collateral + this.usdcFor(position.asset, price) - position.sizeUsd
      : position.collateral + position.asset - this.usdcFor(position.debt, price);
  }

  private exposure(position: MockPosition, price: bigint): bigint {
    return this.usdcFor(position.side === 'long' ? position.asset : position.debt, price);
  }

  /** The exact price where equity meets maintenance margin, ignoring swap costs. */
  private liquidationPrice(position: MockPosition): bigint {
    const eth = position.side === 'long' ? position.asset : position.debt;
    if (eth === 0n) return 0n;
    const toPrice = (usdc: bigint) => (usdc * WEI_PER_ETH * PRICE_PRECISION) / (eth * this.usdcScale);
    return position.side === 'long'
      ? toPrice((position.debt * BPS_DENOMINATOR_BIGINT) / (BPS_DENOMINATOR_BIGINT - this.maintenanceBps))
      : toPrice(((position.collateral + position.asset) * BPS_DENOMINATOR_BIGINT) / (BPS_DENOMINATOR_BIGINT + this.maintenanceBps));
  }

  private fillPrice(side: PositionView['side'], result: MarginExecutionResult): bigint {
    const [eth, usdc] = side === 'long' ? [result.amountOut, result.amountIn] : [result.amountIn, result.amountOut];
    return eth === 0n ? 0n : (usdc * WEI_PER_ETH * PRICE_PRECISION) / (eth * this.usdcScale);
  }

  private usdcFor(wei: bigint, price: bigint): bigint {
    return (wei * price * this.usdcScale) / (WEI_PER_ETH * PRICE_PRECISION);
  }

  private ethFor(usdc: bigint, price: bigint): bigint {
    return (usdc * WEI_PER_ETH * PRICE_PRECISION) / (price * this.usdcScale);
  }

  private ownedPosition(owner: Address, positionId: Hex): MockPosition {
    const position = this.positionsById.get(positionId);
    // Another owner's position gets the same answer as one that doesn't exist.
    if (!position || position.owner !== getAddress(owner)) throw new AuthError(ERROR_CODES.POSITION_NOT_FOUND);
    return position;
  }

  private lendingKey(owner: Address, token: Address): string {
    return `${getAddress(owner)}/${getAddress(token)}`;
  }

  private availableToLend(token: Address): bigint {
    const key = getAddress(token);
    let total = 0n;
    for (const [entry, amount] of this.supplied) if (entry.endsWith(`/${key}`)) total += amount;
    return total - (this.loaned.get(key) ?? 0n);
  }

  private addLoan(token: Address, amount: bigint): void {
    const key = getAddress(token);
    this.loaned.set(key, (this.loaned.get(key) ?? 0n) + amount);
  }
}
