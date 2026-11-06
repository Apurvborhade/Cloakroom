import { isDeepStrictEqual } from 'node:util';
import { ERROR_CODES, NATIVE } from '@cloakroom/shared';
import type { JournalEvent, MarginFundingEvent, PositionView } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { AuthError } from './auth.js';
import type { InMemoryLedger } from './ledger.js';

export type MarginStateEvent = Extract<JournalEvent, { t:
  'MARGIN_OP_APPROVED' | 'MARGIN_OP_BROADCAST' | 'MARGIN_OP_SETTLED' | 'MARGIN_OP_FAILED' | 'MARGIN_COLLATERAL_ADDED'
}>;
export type MarginApproval = Extract<MarginStateEvent, { t: 'MARGIN_OP_APPROVED' }>;
type Terminal = Extract<MarginStateEvent, { t: 'MARGIN_OP_SETTLED' | 'MARGIN_OP_FAILED' }>;
type Operation = { approval: MarginApproval; broadcast?: Extract<MarginStateEvent, { t: 'MARGIN_OP_BROADCAST' }>; terminal?: Terminal };
export interface MarginPosition extends PositionView {
  openOpId: string;
  usdcDecimals: number;
  cash: bigint;
}

/** Durable projection; the command service validates risk before approval. */
export class MarginPositionState {
  private readonly entries = new Map<Hex, MarginPosition>();
  private readonly operations = new Map<string, Operation>();

  constructor(private readonly ledger: InMemoryLedger) {}

  position(id: Hex): MarginPosition | undefined {
    const position = this.entries.get(id);
    return position && structuredClone(position);
  }

  positions(): MarginPosition[] { return [...this.entries.values()].map((p) => structuredClone(p)); }

  operation(opId: string): Operation | undefined {
    const operation = this.operations.get(opId);
    return operation && structuredClone(operation);
  }

  private funding(event: MarginApproval): Extract<MarginFundingEvent, { t: 'MARGIN_OPEN_RESERVED' }> {
    if (event.accounting?.kind !== 'long-open' && event.accounting?.kind !== 'short-open') throw new Error('MARGIN_APPROVAL_INVALID');
    const long = event.accounting.kind === 'long-open';
    const collateral = event.accounting.message.collateral;
    return { t: 'MARGIN_OPEN_RESERVED', opId: event.opId, owner: event.owner,
      collateral: { token: long ? event.tokenIn : event.tokenOut, amount: collateral },
      borrow: { token: event.tokenIn, amount: long ? event.amountIn - collateral : event.amountIn } };
  }

  validate(event: MarginStateEvent): boolean {
    if (event.t === 'MARGIN_OP_APPROVED') {
      if (!event.accounting) return false;
      if (!this.ledger.margin.validateCommand(event)) return false;
      if (event.amountIn <= 0n || event.minAmountOut <= 0n) throw new Error('MARGIN_APPROVAL_INVALID');
      if (event.accounting.kind === 'long-open' || event.accounting.kind === 'short-open') {
        const long = event.accounting.kind === 'long-open';
        if (event.kind !== 'open' || this.entries.has(event.positionId as Hex) ||
          event.accounting.message.side !== (long ? 0 : 1) || event.owner !== getAddress(event.accounting.message.owner) ||
          (long ? event.tokenOut !== NATIVE || event.tokenIn === NATIVE : event.tokenIn !== NATIVE || event.tokenOut === NATIVE)) {
          throw new Error('MARGIN_APPROVAL_INVALID');
        }
        this.ledger.margin.validate(this.funding(event));
      } else {
        const position = this.owned(event.owner, event.positionId as Hex);
        if (position.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
        if (event.accounting.kind !== `${position.side}-${event.kind}` ||
          event.kind === 'open' || event.tokenIn !== position.assetToken || event.tokenOut !== position.debtToken ||
          (position.side === 'long' ? event.amountIn !== position.asset : event.amountIn > position.asset + position.cash)) {
          throw new Error('MARGIN_APPROVAL_INVALID');
        }
        if (position.side === 'short' && (event.kind === 'close' || event.amountIn < position.asset + position.cash) &&
          event.minAmountOut < position.debt) throw new Error('MARGIN_APPROVAL_INVALID');
      }
      return true;
    }
    if (event.t === 'MARGIN_COLLATERAL_ADDED') {
      if (!this.ledger.margin.validateCommand(event)) return false;
      const { owner, positionId, amount } = event.message;
      const position = this.owned(owner, positionId);
      if (position.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
      if (typeof amount !== 'bigint' || amount <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
      const usdc = position.side === 'long' ? position.debtToken : position.assetToken;
      if (this.ledger.getBalance(owner, usdc).available < amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE);
      return true;
    }
    const operation = this.operations.get(event.opId);
    // Older simulation approvals deliberately have no ledger effects.
    if (!operation) return false;
    if (event.t === 'MARGIN_OP_BROADCAST') {
      if (operation.broadcast && isDeepStrictEqual(operation.broadcast, event)) return false;
      if (operation.broadcast || operation.terminal) throw new Error('MARGIN_RESULT_CONFLICT');
      return true;
    }
    if (operation.terminal) {
      if (isDeepStrictEqual(operation.terminal, event)) return false;
      throw new Error('MARGIN_RESULT_CONFLICT');
    }
    if (event.gasCost !== undefined && (typeof event.gasCost !== 'bigint' || event.gasCost < 0n)) throw new Error('MARGIN_RESULT_INVALID');
    if (!operation.broadcast && (event.t === 'MARGIN_OP_SETTLED' || event.txHash !== undefined || (event.gasCost ?? 0n) > 0n)) {
      throw new Error('MARGIN_RESULT_UNCONFIRMED');
    }
    if (operation.broadcast && (event.txHash !== operation.broadcast.txHash ||
      (event.t === 'MARGIN_OP_FAILED' && event.reason !== 'REVERTED'))) throw new Error('MARGIN_RESULT_UNCONFIRMED');
    if (event.t === 'MARGIN_OP_SETTLED' && (event.amountIn !== operation.approval.amountIn ||
      typeof event.amountOut !== 'bigint' || event.amountOut < operation.approval.minAmountOut ||
      typeof event.gasCost !== 'bigint' || !/^0x[\da-fA-F]{64}$/.test(event.txHash))) throw new Error('MARGIN_RESULT_INVALID');
    return true;
  }

  apply(event: MarginStateEvent): void {
    if (!this.validate(event)) return;
    if (event.t === 'MARGIN_OP_APPROVED') {
      const metadata = event.accounting!;
      if (metadata.kind === 'long-open' || metadata.kind === 'short-open') {
        const long = metadata.kind === 'long-open';
        this.ledger.margin.authorize(this.funding(event));
        this.entries.set(event.positionId as Hex, {
          id: event.positionId as Hex, owner: getAddress(event.owner), side: long ? 'long' : 'short', status: 'opening',
          collateral: metadata.message.collateral,
          sizeUsd: metadata.message.collateral * BigInt(metadata.message.leverageBps) / 10_000n,
          debtToken: getAddress(event.tokenIn), debt: long ? event.amountIn - metadata.message.collateral : event.amountIn,
          assetToken: getAddress(event.tokenOut), asset: 0n, cash: 0n,
          openOpId: event.opId, usdcDecimals: metadata.usdcDecimals,
        });
      } else {
        this.entries.get(event.positionId as Hex)!.status = event.kind === 'close' ? 'closing' : 'liquidating';
      }
      this.operations.set(event.opId, { approval: structuredClone(event) });
      this.ledger.margin.remember(event);
      return;
    }
    if (event.t === 'MARGIN_COLLATERAL_ADDED') {
      const { amount, positionId } = event.message;
      const position = this.entries.get(positionId)!;
      const usdc = position.side === 'long' ? position.debtToken : position.assetToken;
      this.ledger.reserve(position.owner, usdc, amount, event.opId);
      this.ledger.consume(event.opId);
      position.cash += amount;
      position.collateral += amount;
      this.ledger.margin.remember(event);
      return;
    }
    const operation = this.operations.get(event.opId)!;
    if (event.t === 'MARGIN_OP_BROADCAST') {
      operation.broadcast = structuredClone(event);
      return;
    }
    const position = this.entries.get(operation.approval.positionId as Hex)!;
    if (event.t === 'MARGIN_OP_FAILED') {
      if (operation.approval.kind === 'open') {
        this.ledger.margin.cancel(position.openOpId);
        position.debt = 0n;
        position.status = 'failed';
      } else position.status = 'open';
    } else if (operation.approval.kind === 'open') {
      this.ledger.margin.activate(position.openOpId);
      position.asset = event.amountOut;
      const long = position.side === 'long';
      const [usdc, eth] = long ? [event.amountIn, event.amountOut] : [event.amountOut, event.amountIn];
      position.entryPrice = usdc * 10n ** 36n / (eth * 10n ** BigInt(position.usdcDecimals));
      if (!long) position.cash = position.collateral;
      position.status = 'open';
    } else {
      const long = position.side === 'long';
      const proceeds = event.amountOut + (long ? position.cash : 0n);
      const repaid = proceeds < position.debt ? proceeds : position.debt;
      position.shortfall = position.debt - repaid;
      position.payout = long ? proceeds - repaid : position.asset + position.cash - event.amountIn;
      this.ledger.margin.repay(position.openOpId, repaid);
      const usdc = long ? position.debtToken : position.assetToken;
      if (position.payout > 0n) this.ledger.credit(position.owner, usdc, position.payout, event.opId);
      if (!long) {
        position.payoutNative = proceeds - repaid;
        if (position.payoutNative > 0n) this.ledger.credit(position.owner, NATIVE, position.payoutNative, `${event.opId}:surplus`);
      }
      position.debt = position.shortfall;
      position.asset = 0n;
      position.cash = 0n;
      position.status = operation.approval.kind === 'liquidate' ? 'liquidated' : 'closed';
    }
    this.ledger.bookOperationalGas(event.opId, NATIVE, event.gasCost ?? 0n);
    operation.terminal = structuredClone(event);
  }

  owned(owner: Address, id: Hex): MarginPosition {
    const position = this.position(id);
    if (!position || position.owner !== getAddress(owner)) throw new AuthError(ERROR_CODES.POSITION_NOT_FOUND);
    return position;
  }

  /** Performing loans replace cash; bad debt remains an uncovered claim. */
  custodyAdjustments(): Map<Address, bigint> {
    const result = new Map<Address, bigint>();
    const add = (token: Address, amount: bigint) => result.set(token, (result.get(token) ?? 0n) + amount);
    for (const p of this.entries.values()) {
      if (p.status !== 'open' && p.status !== 'closing' && p.status !== 'liquidating') continue;
      const long = p.side === 'long';
      add(p.debtToken, (long ? p.cash : 0n) - p.debt);
      add(p.assetToken, p.asset + (long ? 0n : p.cash));
    }
    return result;
  }

  assertInvariants(): void {
    for (const p of this.entries.values()) {
      const hold = this.ledger.margin.reservation(p.openOpId);
      const active = p.status === 'open' || p.status === 'closing' || p.status === 'liquidating';
      if (!hold || p.cash < 0n || p.asset < 0n || p.debt < 0n ||
        (p.status === 'opening' && hold.status !== 'reserved') ||
        (active && (hold.status !== 'borrowed' || p.debt !== hold.borrow.amount || p.asset === 0n)) ||
        (p.status === 'failed' && hold.status !== 'released') ||
        ((p.status === 'closed' || p.status === 'liquidated') && hold.status !== 'repaid')) throw new Error('MARGIN_POSITION_MISMATCH');
    }
  }
}
