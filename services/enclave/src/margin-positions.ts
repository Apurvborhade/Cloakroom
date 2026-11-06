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
export interface LongPosition extends PositionView {
  openOpId: string;
  usdcDecimals: number;
  cash: bigint;
}

/** Durable projection; the command service validates risk before approval. */
export class MarginPositionState {
  private readonly entries = new Map<Hex, LongPosition>();
  private readonly operations = new Map<string, Operation>();

  constructor(private readonly ledger: InMemoryLedger) {}

  position(id: Hex): LongPosition | undefined {
    const position = this.entries.get(id);
    return position && structuredClone(position);
  }

  positions(): LongPosition[] { return [...this.entries.values()].map((p) => structuredClone(p)); }

  operation(opId: string): Operation | undefined {
    const operation = this.operations.get(opId);
    return operation && structuredClone(operation);
  }

  private funding(event: MarginApproval): Extract<MarginFundingEvent, { t: 'MARGIN_OPEN_RESERVED' }> {
    if (event.accounting?.kind !== 'long-open') throw new Error('MARGIN_APPROVAL_INVALID');
    const collateral = event.accounting.message.collateral;
    return { t: 'MARGIN_OPEN_RESERVED', opId: event.opId, owner: event.owner,
      collateral: { token: event.tokenIn, amount: collateral },
      borrow: { token: event.tokenIn, amount: event.amountIn - collateral } };
  }

  validate(event: MarginStateEvent): boolean {
    if (event.t === 'MARGIN_OP_APPROVED') {
      if (!event.accounting) return false;
      if (!this.ledger.margin.validateCommand(event)) return false;
      if (event.amountIn <= 0n || event.minAmountOut <= 0n) throw new Error('MARGIN_APPROVAL_INVALID');
      if (event.accounting.kind === 'long-open') {
        if (event.kind !== 'open' || this.entries.has(event.positionId as Hex) || event.tokenOut !== NATIVE) {
          throw new Error('MARGIN_APPROVAL_INVALID');
        }
        this.ledger.margin.validate(this.funding(event));
      } else {
        const position = this.owned(event.owner, event.positionId as Hex);
        if (position.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
        if (event.kind === 'open' || event.amountIn !== position.asset || event.tokenIn !== NATIVE || event.tokenOut !== position.debtToken) {
          throw new Error('MARGIN_APPROVAL_INVALID');
        }
      }
      return true;
    }
    if (event.t === 'MARGIN_COLLATERAL_ADDED') {
      if (!this.ledger.margin.validateCommand(event)) return false;
      const { owner, positionId, amount } = event.message;
      const position = this.owned(owner, positionId);
      if (position.status !== 'open') throw new AuthError(ERROR_CODES.POSITION_BUSY);
      if (typeof amount !== 'bigint' || amount <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
      if (this.ledger.getBalance(owner, position.debtToken).available < amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE);
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
      if (metadata.kind === 'long-open') {
        this.ledger.margin.authorize(this.funding(event));
        this.entries.set(event.positionId as Hex, {
          id: event.positionId as Hex, owner: getAddress(event.owner), side: 'long', status: 'opening',
          collateral: metadata.message.collateral, sizeUsd: event.amountIn,
          debtToken: getAddress(event.tokenIn), debt: event.amountIn - metadata.message.collateral,
          assetToken: NATIVE, asset: 0n, cash: 0n,
          openOpId: event.opId, usdcDecimals: metadata.usdcDecimals,
        });
      } else {
        const position = this.entries.get(event.positionId as Hex)!;
        position.status = event.kind === 'close' ? 'closing' : 'liquidating';
        delete position.reason;
      }
      this.operations.set(event.opId, { approval: structuredClone(event) });
      this.ledger.margin.remember(event);
      return;
    }
    if (event.t === 'MARGIN_COLLATERAL_ADDED') {
      const { amount, positionId } = event.message;
      const position = this.entries.get(positionId)!;
      this.ledger.reserve(position.owner, position.debtToken, amount, event.opId);
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
      position.reason = event.reason;
      if (operation.approval.kind === 'open') {
        this.ledger.margin.cancel(position.openOpId);
        position.debt = 0n;
        position.status = 'failed';
      } else position.status = 'open';
    } else if (operation.approval.kind === 'open') {
      this.ledger.margin.activate(position.openOpId);
      position.asset = event.amountOut;
      position.entryPrice = event.amountIn * 10n ** 36n / (event.amountOut * 10n ** BigInt(position.usdcDecimals));
      position.status = 'open';
    } else {
      const proceeds = event.amountOut + position.cash;
      const repaid = proceeds < position.debt ? proceeds : position.debt;
      position.shortfall = position.debt - repaid;
      position.payout = proceeds - repaid;
      this.ledger.margin.repay(position.openOpId, repaid);
      if (position.payout > 0n) this.ledger.credit(position.owner, position.debtToken, position.payout, event.opId);
      position.debt = position.shortfall;
      position.asset = 0n;
      position.cash = 0n;
      position.status = operation.approval.kind === 'liquidate' ? 'liquidated' : 'closed';
    }
    this.ledger.bookOperationalGas(event.opId, NATIVE, event.gasCost ?? 0n);
    operation.terminal = structuredClone(event);
  }

  owned(owner: Address, id: Hex): LongPosition {
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
      add(p.debtToken, p.cash - p.debt);
      add(p.assetToken, p.asset);
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
