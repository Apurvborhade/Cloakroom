import { isDeepStrictEqual } from 'node:util';
import { ERROR_CODES, NATIVE } from '@cloakroom/shared';
import type {
  Journal, JournalEvent, MarginAccounting, MarginFundingEvent, MarginFundingRequest,
  MarginFundingReservation, LendingView, MarginSupplyMsg, SerialQueue,
} from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import type { InMemoryLedger } from './ledger.js';
import { AuthError } from './auth.js';

type Claim = { owner: Address; token: Address; amount: bigint; ref: string };
type BalanceLedger = Pick<InMemoryLedger, 'getBalance' | 'getReservation' | 'reserve' | 'release' | 'consume'>;
const claimKey = (owner: Address, token: Address) => `${getAddress(owner)}:${getAddress(token)}`;
const fundingRef = (opId: string) => `margin:funding:${opId}`;
const collateralRef = (opId: string) => `margin:collateral:${opId}`;
function positive(value: bigint) {
  if (typeof value !== 'bigint' || value <= 0n) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD, 'MARGIN_AMOUNT_INVALID');
}

/** Projected alongside the ordinary ledger, so both recover from the same journal. */
export class MarginFundingState {
  private readonly claims = new Map<string, Claim>();
  private readonly holds = new Map<string, MarginFundingReservation>();
  private readonly commands = new Map<string, JournalEvent>();
  private readonly authorized = new Set<string>();
  private readonly shortfalls = new Map<Address, bigint>();
  private faulted = false;

  constructor(private readonly ledger: BalanceLedger) {}

  pool(token: Address): { supplied: bigint; reserved: bigint; available: bigint } {
    token = getAddress(token);
    let supplied = 0n, reserved = 0n;
    for (const claim of this.claims.values()) if (claim.token === token) supplied += claim.amount;
    for (const hold of this.holds.values()) {
      if ((hold.status === 'reserved' || hold.status === 'borrowed') && hold.borrow.token === token) reserved += hold.borrow.amount;
    }
    return { supplied, reserved, available: this.shortfall(token) > 0n ? 0n : supplied - reserved };
  }

  shortfall(token: Address): bigint { return this.shortfalls.get(getAddress(token)) ?? 0n; }

  assertAvailable(): void {
    if (this.faulted) throw new Error('MARGIN_FUNDING_UNAVAILABLE');
  }

  stop(): void { this.faulted = true; }

  command(opId: string): JournalEvent | undefined {
    const event = this.commands.get(opId);
    return event && structuredClone(event);
  }

  validateCommand(event: JournalEvent & { opId: string }): boolean {
    const previous = this.commands.get(event.opId);
    if (!previous) return true;
    if (!isDeepStrictEqual(previous, event)) throw new AuthError(ERROR_CODES.NONCE_USED, 'MARGIN_OP_CONFLICT');
    return false;
  }

  remember(event: JournalEvent & { opId: string }): void {
    this.commands.set(event.opId, structuredClone(event));
  }

  authorize(event: Extract<MarginFundingEvent, { t: 'MARGIN_OPEN_RESERVED' }>): void {
    this.apply(event);
    this.authorized.add(event.opId);
  }

  activate(opId: string): void {
    const hold = this.holds.get(opId);
    if (!hold || hold.status !== 'reserved' || !this.authorized.has(opId)) throw new Error('MARGIN_RESERVATION_MISMATCH');
    this.ledger.consume(collateralRef(opId));
    hold.status = 'borrowed';
  }

  cancel(opId: string): void {
    this.authorized.delete(opId);
    this.apply({ t: 'MARGIN_OPEN_RELEASED', opId });
  }

  repay(opId: string, amount: bigint): void {
    const hold = this.holds.get(opId);
    if (!hold || hold.status !== 'borrowed' || amount < 0n || amount > hold.borrow.amount) throw new Error('MARGIN_REPAYMENT_INVALID');
    const loss = hold.borrow.amount - amount;
    this.shortfalls.set(hold.borrow.token, this.shortfall(hold.borrow.token) + loss);
    hold.status = 'repaid';
  }

  balance(owner: Address, token: Address): LendingView {
    token = getAddress(token);
    const claimAmount = this.claims.get(claimKey(owner, token))?.amount ?? 0n;
    const available = this.pool(token).available;
    return { token, supplied: claimAmount, available: claimAmount < available ? claimAmount : available };
  }

  balances(owner: Address): LendingView[] {
    owner = getAddress(owner);
    return [...this.claims.values()].filter((claim) => claim.owner === owner)
      .map((claim) => this.balance(owner, claim.token));
  }

  reservation(opId: string): MarginFundingReservation | undefined {
    const hold = this.holds.get(opId);
    return hold && structuredClone(hold);
  }

  reservations(): MarginFundingReservation[] {
    return [...this.holds.values()].filter((hold) => hold.status === 'reserved').map((hold) => structuredClone(hold));
  }

  private checkHold(ref: string, owner: Address, token: Address, amount: bigint) {
    const hold = this.ledger.getReservation(ref);
    if (!hold || hold.status !== 'active' || hold.owner !== owner || hold.token !== token || hold.amount !== amount) {
      throw new Error('MARGIN_RESERVATION_MISMATCH');
    }
  }

  /** False means an identical command was already applied; validate before appending. */
  validate(event: MarginFundingEvent): boolean {
    if (typeof event.opId !== 'string' || !event.opId) throw new Error('MARGIN_OP_INVALID');
    if (event.t === 'MARGIN_OPEN_RELEASED') {
      const hold = this.holds.get(event.opId);
      if (!hold) throw new Error('MARGIN_RESERVATION_NOT_FOUND');
      if (hold.status === 'released') return false;
      if (this.authorized.has(event.opId) || hold.status !== 'reserved') throw new AuthError(ERROR_CODES.POSITION_BUSY);
      this.checkHold(collateralRef(hold.opId), hold.owner, hold.collateral.token, hold.collateral.amount);
      return true;
    }
    if (!this.validateCommand(event)) return false;
    const owner = getAddress(event.owner);
    if (event.t === 'MARGIN_OPEN_RESERVED') {
      positive(event.collateral.amount);
      if (typeof event.borrow.amount !== 'bigint' || event.borrow.amount < 0n) throw new Error('MARGIN_AMOUNT_INVALID');
      const collateral = getAddress(event.collateral.token), borrowed = getAddress(event.borrow.token);
      if (this.ledger.getReservation(collateralRef(event.opId))) throw new Error('MARGIN_OP_CONFLICT');
      if (this.ledger.getBalance(owner, collateral).available < event.collateral.amount) throw new Error('INSUFFICIENT_BALANCE');
      if (this.pool(borrowed).available < event.borrow.amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_LIQUIDITY, 'INSUFFICIENT_LENDING_LIQUIDITY');
    } else {
      positive(event.amount);
      positive(event.nonce); positive(event.expiry);
      const token = getAddress(event.token);
      const claim = this.claims.get(claimKey(owner, token));
      if (claim) this.checkHold(claim.ref, owner, token, claim.amount);
      if (this.ledger.getReservation(fundingRef(event.opId))) throw new Error('MARGIN_OP_CONFLICT');
      if (event.t === 'MARGIN_SUPPLIED') {
        if (this.ledger.getBalance(owner, token).available < event.amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE);
      } else {
        if ((claim?.amount ?? 0n) < event.amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE, 'INSUFFICIENT_LENDING_CLAIM');
        if (this.pool(token).available < event.amount) throw new AuthError(ERROR_CODES.INSUFFICIENT_LIQUIDITY, 'INSUFFICIENT_LENDING_LIQUIDITY');
      }
    }
    return true;
  }

  apply(event: MarginFundingEvent): void {
    if (!this.validate(event)) return;
    if (event.t === 'MARGIN_OPEN_RELEASED') {
      this.ledger.release(collateralRef(event.opId));
      this.holds.get(event.opId)!.status = 'released';
      return;
    }
    const owner = getAddress(event.owner);
    if (event.t === 'MARGIN_OPEN_RESERVED') {
      const collateral = { token: getAddress(event.collateral.token), amount: event.collateral.amount };
      this.ledger.reserve(owner, collateral.token, collateral.amount, collateralRef(event.opId));
      this.holds.set(event.opId, { opId: event.opId, owner, collateral,
        borrow: { token: getAddress(event.borrow.token), amount: event.borrow.amount }, status: 'reserved' });
    } else {
      const token = getAddress(event.token), key = claimKey(owner, token);
      const previous = this.claims.get(key);
      const amount = (previous?.amount ?? 0n) + (event.t === 'MARGIN_SUPPLIED' ? event.amount : -event.amount);
      // Replace the aggregate hold synchronously; partial redemption needs no new base-ledger API.
      if (previous) this.ledger.release(previous.ref);
      if (amount > 0n) {
        const ref = fundingRef(event.opId);
        this.ledger.reserve(owner, token, amount, ref);
        this.claims.set(key, { owner, token, amount, ref });
      } else this.claims.delete(key);
    }
    this.remember(event);
  }

  assertInvariants(): void {
    for (const claim of this.claims.values()) {
      positive(claim.amount);
      this.checkHold(claim.ref, claim.owner, claim.token, claim.amount);
    }
    for (const hold of this.holds.values()) {
      if (hold.status === 'reserved') this.checkHold(collateralRef(hold.opId), hold.owner, hold.collateral.token, hold.collateral.amount);
      if (hold.status === 'borrowed' && this.ledger.getReservation(collateralRef(hold.opId))?.status !== 'consumed') {
        throw new Error('MARGIN_RESERVATION_MISMATCH');
      }
      const pool = this.pool(hold.borrow.token);
      if (pool.supplied < pool.reserved + this.shortfall(hold.borrow.token)) throw new Error('MARGIN_LIQUIDITY_MISMATCH');
    }
  }
}

export interface MarginFundingDeps {
  ledger: InMemoryLedger;
  journal: Pick<Journal, 'append'>;
  queue: SerialQueue;
  usdc: Address;
}

/** Funding only. Use the same queue as withdrawals and spot orders. */
export class MarginFunding implements Pick<MarginAccounting, 'supply' | 'redeem' | 'lending'> {
  private readonly usdc: Address;

  constructor(private readonly deps: MarginFundingDeps) {
    this.usdc = getAddress(deps.usdc);
    if (this.usdc === NATIVE) throw new Error('MARGIN_TOKEN_INVALID');
  }

  private token(token: Address): Address {
    const normalized = getAddress(token);
    if (normalized !== NATIVE && normalized !== this.usdc) throw new AuthError(ERROR_CODES.UNSUPPORTED_ASSET, 'MARGIN_TOKEN_INVALID');
    return normalized;
  }

  private async commit(event: MarginFundingEvent): Promise<void> {
    const snapshot = structuredClone(event);
    await this.deps.queue.run(async () => {
      this.deps.ledger.margin.assertAvailable();
      if (!this.deps.ledger.margin.validate(snapshot)) return;
      try {
        await this.deps.journal.append(snapshot);
        this.deps.ledger.apply(snapshot);
      } catch (error) {
        // An uncertain write must be replayed before any further funding changes.
        this.deps.ledger.margin.stop();
        throw error;
      }
    });
  }

  private lendingEvent(t: 'MARGIN_SUPPLIED' | 'MARGIN_REDEEMED', owner: Address, message: MarginSupplyMsg) {
    owner = getAddress(owner);
    if (owner !== getAddress(message.owner)) throw new AuthError(ERROR_CODES.BAD_SIGNATURE);
    positive(message.nonce); positive(message.expiry);
    return { t, opId: `margin:command:${owner}:${message.nonce}`, owner,
      token: this.token(message.token), amount: message.amount, nonce: message.nonce, expiry: message.expiry };
  }

  async supply(owner: Address, message: MarginSupplyMsg): Promise<void> {
    await this.commit(this.lendingEvent('MARGIN_SUPPLIED', owner, message));
  }

  async redeem(owner: Address, message: MarginSupplyMsg): Promise<void> {
    await this.commit(this.lendingEvent('MARGIN_REDEEMED', owner, message));
  }

  async reserveOpen(request: MarginFundingRequest): Promise<MarginFundingReservation> {
    const event = { t: 'MARGIN_OPEN_RESERVED', opId: request.opId, owner: getAddress(request.owner),
      collateral: { token: this.usdc, amount: request.collateralUSDC },
      borrow: { token: this.token(request.borrow.token), amount: request.borrow.amount } } as const;
    await this.commit(event);
    return this.deps.ledger.margin.reservation(event.opId)!;
  }

  /** Release only a funding reservation that has not been authorized for execution. */
  async releaseOpen(opId: string): Promise<void> {
    await this.commit({ t: 'MARGIN_OPEN_RELEASED', opId });
  }

  lending(owner: Address): readonly LendingView[] {
    return this.deps.ledger.margin.balances(owner);
  }
}
