import { EscapeState } from './escape-state.js';
import { DepositCompletedEventSchema, ERROR_CODES, NATIVE } from '@cloakroom/shared';
import type {
  BalanceRecord,
  Journal,
  JournalEvent,
  Ledger,
  OwnerBalances,
} from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import { MarginFundingState } from './margin-funding.js';
import { MarginPositionState } from './margin-positions.js';

export type ReservationStatus = 'active' | 'released' | 'consumed';

export interface Reservation {
  id: string;
  owner: Address;
  token: Address;
  amount: bigint;
  status: ReservationStatus;
}

export interface CreditRecord {
  owner: Address;
  token: Address;
  amount: bigint;
}

export interface OperationalGasRecord {
  token: Address;
  feeAmount: bigint;
}

/**
 * In-memory accounting ledger implementing the shared Ledger interface.
 *
 * Guarantees:
 * 1. Non-negativity: available >= 0 and reserved >= 0 for all owners and tokens.
 * 2. Conservation: every reserved wei is accounted for by an active reservation.
 * 3. Token isolation: balances across different tokens are strictly independent.
 * 4. Replay idempotency: deterministic event projection from JournalEvent stream.
 * 5. Strict BigInt precision: no floating-point arithmetic.
 */
export class InMemoryLedger implements Ledger {
  readonly escape = new EscapeState(this);
  private readonly userBalances = new Map<Address, Map<Address, BalanceRecord>>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly credits = new Map<string, CreditRecord>();
  private readonly nonces = new Map<Address, bigint>();
  private readonly protocolRevenue = new Map<Address, bigint>();
  private readonly operationalGasSpent = new Map<Address, bigint>();
  private readonly bookedGasFees = new Map<string, OperationalGasRecord>();
  private readonly depositSessions = new Map<string, Address>();
  private readonly depositFunding = new Map<string, Extract<JournalEvent, { t: 'DEPOSIT_SESSION_OPENED' }>>();
  readonly margin = new MarginFundingState(this);
  readonly marginPositions = new MarginPositionState(this);

  private getOrCreateBalance(owner: Address, token: Address): BalanceRecord {
    let ownerMap = this.userBalances.get(owner);
    if (!ownerMap) {
      ownerMap = new Map<Address, BalanceRecord>();
      this.userBalances.set(owner, ownerMap);
    }
    let bal = ownerMap.get(token);
    if (!bal) {
      bal = { available: 0n, reserved: 0n };
      ownerMap.set(token, bal);
    }
    return bal;
  }

  credit(owner: Address, token: Address, amt: bigint, ref: string): void {
    if (typeof amt !== 'bigint') {
      throw new Error('Credit amount must be a bigint');
    }
    if (amt <= 0n) {
      throw new Error('Credit amount must be strictly positive');
    }
    if (!ref || typeof ref !== 'string') {
      throw new Error('Credit reference must be a non-empty string');
    }

    const normOwner = getAddress(owner);
    const normToken = getAddress(token);

    const existing = this.credits.get(ref);
    if (existing) {
      if (existing.owner === normOwner && existing.token === normToken && existing.amount === amt) {
        // Idempotent duplicate: do not double-credit
        return;
      }
      throw new Error(`Credit reference '${ref}' already used with conflicting parameters`);
    }

    this.credits.set(ref, { owner: normOwner, token: normToken, amount: amt });
    const bal = this.getOrCreateBalance(normOwner, normToken);
    bal.available += amt;
  }

  reserve(owner: Address, token: Address, amt: bigint, ref: string): void {
    if (typeof amt !== 'bigint') {
      throw new Error('Reservation amount must be a bigint');
    }
    if (amt <= 0n) {
      throw new Error('Reservation amount must be strictly positive');
    }
    if (!ref || typeof ref !== 'string') {
      throw new Error('Reservation reference must be a non-empty string');
    }

    const normOwner = getAddress(owner);
    const normToken = getAddress(token);

    if (this.reservations.has(ref)) {
      throw new Error(`Reservation reference already exists: ${ref}`);
    }

    const bal = this.getOrCreateBalance(normOwner, normToken);
    if (bal.available < amt) {
      throw new Error(ERROR_CODES.INSUFFICIENT_BALANCE);
    }

    bal.available -= amt;
    bal.reserved += amt;

    this.reservations.set(ref, {
      id: ref,
      owner: normOwner,
      token: normToken,
      amount: amt,
      status: 'active',
    });
  }

  release(ref: string): void {
    const res = this.reservations.get(ref);
    if (!res) {
      throw new Error(`Unknown reservation reference: ${ref}`);
    }
    if (res.status === 'consumed') {
      throw new Error(`Cannot release consumed reservation: ${ref}`);
    }
    if (res.status === 'released') {
      // Idempotent repeated release: do not double-credit
      return;
    }

    res.status = 'released';
    const bal = this.getOrCreateBalance(res.owner, res.token);
    if (bal.reserved < res.amount) {
      throw new Error(
        `Invariant violation: reserved balance ${bal.reserved} is less than reservation amount ${res.amount}`,
      );
    }
    bal.reserved -= res.amount;
    bal.available += res.amount;
  }

  consume(ref: string): void {
    const res = this.reservations.get(ref);
    if (!res) {
      throw new Error(`Unknown reservation reference: ${ref}`);
    }
    if (res.status === 'released') {
      throw new Error(`Cannot consume released reservation: ${ref}`);
    }
    if (res.status === 'consumed') {
      // Idempotent repeated consume: does not mutate balances again
      return;
    }

    res.status = 'consumed';
    const bal = this.getOrCreateBalance(res.owner, res.token);
    if (bal.reserved < res.amount) {
      throw new Error(
        `Invariant violation: reserved balance ${bal.reserved} is less than reservation amount ${res.amount}`,
      );
    }
    bal.reserved -= res.amount;
  }

  balances(owner: Address): OwnerBalances[] {
    const normOwner = getAddress(owner);
    const ownerMap = this.userBalances.get(normOwner);
    if (!ownerMap) {
      return [];
    }
    const result: OwnerBalances[] = [];
    for (const [token, bal] of ownerMap.entries()) {
      result.push({
        token,
        available: bal.available,
        reserved: bal.reserved,
        pending: 0n,
      });
    }
    return result;
  }

  getBalance(owner: Address, token: Address): OwnerBalances {
    const normOwner = getAddress(owner);
    const normToken = getAddress(token);
    const bal = this.userBalances.get(normOwner)?.get(normToken);
    return {
      token: normToken,
      available: bal?.available ?? 0n,
      reserved: bal?.reserved ?? 0n,
      pending: 0n,
    };
  }

  totals(): Map<Address, BalanceRecord> {
    const result = new Map<Address, BalanceRecord>();
    for (const ownerMap of this.userBalances.values()) {
      for (const [token, bal] of ownerMap.entries()) {
        const existing = result.get(token);
        if (existing) {
          existing.available += bal.available;
          existing.reserved += bal.reserved;
        } else {
          result.set(token, {
            available: bal.available,
            reserved: bal.reserved,
          });
        }
      }
    }
    return result;
  }

  getLastNonce(owner: Address): bigint {
    return this.nonces.get(getAddress(owner)) ?? 0n;
  }

  /** Cash and locked assets required on-chain, excluding performing margin receivables. */
  custodyClaims(): Map<Address, bigint> {
    const result = new Map<Address, bigint>();
    for (const [token, balance] of this.totals()) result.set(token, balance.available + balance.reserved);
    for (const [token, amount] of this.protocolRevenue) result.set(token, (result.get(token) ?? 0n) + amount);
    for (const [token, amount] of this.marginPositions.custodyAdjustments()) result.set(token, (result.get(token) ?? 0n) + amount);
    return result;
  }

  setNonce(owner: Address, nonce: bigint): void {
    if (typeof nonce !== 'bigint') {
      throw new Error('Nonce must be a bigint');
    }
    const normOwner = getAddress(owner);
    const current = this.getLastNonce(normOwner);
    if (nonce <= current) {
      throw new Error(ERROR_CODES.NONCE_USED);
    }
    this.nonces.set(normOwner, nonce);
  }

  getReservation(ref: string): Reservation | undefined {
    return this.reservations.get(ref);
  }

  bookProtocolRevenue(token: Address, fee: bigint): void {
    if (typeof fee !== 'bigint') {
      throw new Error('Protocol fee must be a bigint');
    }
    if (fee < 0n) {
      throw new Error('Protocol fee must be non-negative');
    }
    if (fee === 0n) return;
    const normToken = getAddress(token);
    const current = this.protocolRevenue.get(normToken) ?? 0n;
    this.protocolRevenue.set(normToken, current + fee);
  }

  getProtocolRevenue(token: Address): bigint {
    return this.protocolRevenue.get(getAddress(token)) ?? 0n;
  }

  getProtocolRevenueTotals(): Map<Address, bigint> {
    return new Map(this.protocolRevenue);
  }

  bookOperationalGas(opId: string, token: Address, feeAmount: bigint): void {
    if (typeof feeAmount !== 'bigint') {
      throw new Error('Operational gas fee must be a bigint');
    }
    if (feeAmount < 0n) {
      throw new Error('Operational gas fee must be non-negative');
    }
    const normToken = getAddress(token);
    const existing = this.bookedGasFees.get(opId);
    if (existing) {
      if (existing.token === normToken && existing.feeAmount === feeAmount) {
        // Idempotent duplicate: ignore
        return;
      }
      throw new Error(
        `Operational gas fee for '${opId}' already booked with conflicting values`,
      );
    }
    this.bookedGasFees.set(opId, { token: normToken, feeAmount });
    const current = this.operationalGasSpent.get(normToken) ?? 0n;
    this.operationalGasSpent.set(normToken, current + feeAmount);
  }

  getOperationalGasSpent(token: Address): bigint {
    return this.operationalGasSpent.get(getAddress(token)) ?? 0n;
  }

  getOperationalGasTotals(): Map<Address, bigint> {
    return new Map(this.operationalGasSpent);
  }

  apply(event: JournalEvent): void {
    switch (event.t) {
      case 'ESCAPE_RESERVED':
      case 'ESCAPE_BROADCAST':
      case 'ESCAPE_REGISTERED':
      case 'ESCAPE_FAILED':
      case 'ESCAPE_CLAIMED':
        this.escape.apply(event);
        break;
      case 'MARGIN_SUPPLIED':
      case 'MARGIN_REDEEMED':
      case 'MARGIN_OPEN_RESERVED':
      case 'MARGIN_OPEN_RELEASED': {
        this.margin.apply(event);
        break;
      }
      case 'NONCE_USED': {
        this.setNonce(event.owner, event.nonce);
        break;
      }
      case 'MARGIN_OP_APPROVED':
      case 'MARGIN_OP_BROADCAST':
      case 'MARGIN_OP_SETTLED':
      case 'MARGIN_OP_FAILED':
      case 'MARGIN_COLLATERAL_ADDED': {
        this.marginPositions.apply(event);
        break;
      }
      case 'SIGNING_REGISTERED':
      case 'SIGNING_COMPLETED': {
        break;
      }
      case 'DEPOSIT_SESSION_OPENED': {
        if (!event.id) {
          throw new Error('Missing id on DEPOSIT_SESSION_OPENED event');
        }
        if (!event.owner) {
          throw new Error(`Missing owner on DEPOSIT_SESSION_OPENED event: ${event.id}`);
        }
        if (
          event.baseline === undefined ||
          event.baseline === null ||
          typeof event.baseline !== 'bigint'
        ) {
          throw new Error(
            `Missing or invalid baseline on DEPOSIT_SESSION_OPENED event: ${event.id}`,
          );
        }
        if (
          event.baselineBlock === undefined ||
          event.baselineBlock === null ||
          typeof event.baselineBlock !== 'bigint'
        ) {
          throw new Error(
            `Missing or invalid baselineBlock on DEPOSIT_SESSION_OPENED event: ${event.id}`,
          );
        }
        const normOwner = getAddress(event.owner);
        const existingSessionOwner = this.depositSessions.get(event.id);
        if (existingSessionOwner && existingSessionOwner !== normOwner) {
          throw new Error(
            `Conflicting owner on DEPOSIT_SESSION_OPENED event for session '${event.id}': existing ${existingSessionOwner} != new ${normOwner}`,
          );
        }
        this.depositSessions.set(event.id, normOwner);
        if (event.funding) this.depositFunding.set(event.id, event);
        break;
      }
      case 'DEPOSIT_COMPLETED': {
        DepositCompletedEventSchema.parse(event);
        const opened = this.depositFunding.get(event.id);
        if (!opened?.funding || getAddress(opened.owner) !== getAddress(event.owner)
            || getAddress(opened.eoa) !== getAddress(event.eoa)
            || getAddress(opened.funding.asset) !== getAddress(event.asset)
            || opened.funding.gasReserveWei !== event.gasReserveWei) {
          throw new Error('Deposit completion does not match session');
        }
        if (event.nativeAmount > 0n) {
          this.credit(event.owner, NATIVE, event.nativeAmount, `deposit:${event.id}:native`);
        }
        if (event.tokenAmount > 0n) {
          this.credit(event.owner, event.asset, event.tokenAmount, `deposit:${event.id}:token`);
        }
        break;
      }
      case 'DEPOSIT_CREDITED': {
        if (this.depositFunding.has(event.id)) throw new Error('Legacy credit for single-use deposit');
        if (!event.owner) {
          throw new Error(`Missing owner on DEPOSIT_CREDITED event: ${event.id}`);
        }
        if (typeof event.amount !== 'bigint' || event.amount <= 0n) {
          throw new Error(`Invalid deposit amount on DEPOSIT_CREDITED event: ${event.amount}`);
        }
        if (typeof event.block !== 'bigint') {
          throw new Error(`Missing or invalid block on DEPOSIT_CREDITED event: ${event.id}`);
        }
        const normOwner = getAddress(event.owner);
        const sessionOwner = this.depositSessions.get(event.id);
        if (sessionOwner && sessionOwner !== normOwner) {
          throw new Error(
            `Owner mismatch on DEPOSIT_CREDITED event '${event.id}': session owner is ${sessionOwner}, event owner is ${normOwner}`,
          );
        }
        if (!sessionOwner) {
          this.depositSessions.set(event.id, normOwner);
        }
        const ref = `deposit:${event.id}:${event.block.toString()}`;
        this.credit(normOwner, NATIVE, event.amount, ref);
        break;
      }
      case 'DEPOSIT_SESSION_CLOSED': {
        // Advisory metadata; no direct balance mutation
        break;
      }
      case 'INTENT_CREATED': {
        const normOwner = getAddress(event.owner);
        const intentOwner = getAddress(event.intent.owner);
        if (normOwner !== intentOwner) {
          throw new Error(
            `INTENT_CREATED owner mismatch: event owner ${event.owner} != intent owner ${event.intent.owner}`,
          );
        }
        this.reserve(event.owner, event.intent.tokenIn, event.intent.amountIn, event.id);
        break;
      }
      case 'INTENT_CANCELLED': {
        const res = this.reservations.get(event.id);
        if (res && res.owner !== getAddress(event.owner)) {
          throw new Error(`INTENT_CANCELLED owner mismatch for ${event.id}`);
        }
        this.release(event.id);
        break;
      }
      case 'INTENT_EXPIRED': {
        const res = this.reservations.get(event.id);
        if (res && res.owner !== getAddress(event.owner)) {
          throw new Error(`INTENT_EXPIRED owner mismatch for ${event.id}`);
        }
        this.release(event.id);
        break;
      }
      case 'EXEC_BROADCAST': {
        // On-chain broadcast metadata; balance was already reserved on creation
        break;
      }
      case 'EXEC_SETTLED': {
        if (event.fee < 0n) {
          throw new Error(`Negative protocol fee on EXEC_SETTLED: ${event.fee}`);
        }
        if (event.amountOut < event.fee) {
          throw new Error(
            `Protocol fee ${event.fee} exceeds gross amountOut ${event.amountOut} on EXEC_SETTLED`,
          );
        }
        const res = this.reservations.get(event.intentId);
        if (res && res.owner !== getAddress(event.owner)) {
          throw new Error(`EXEC_SETTLED owner mismatch for intent ${event.intentId}`);
        }
        this.consume(event.intentId);
        const netOut = event.amountOut - event.fee;
        if (netOut > 0n) {
          this.credit(event.owner, event.tokenOut, netOut, `exec:${event.intentId}:settle`);
        }
        if (event.fee > 0n) {
          this.bookProtocolRevenue(event.tokenOut, event.fee);
        }
        break;
      }
      case 'EXEC_FAILED': {
        const res = this.reservations.get(event.intentId);
        if (res && res.owner !== getAddress(event.owner)) {
          throw new Error(`EXEC_FAILED owner mismatch for intent ${event.intentId}`);
        }
        this.release(event.intentId);
        break;
      }
      case 'WITHDRAWAL_LOCKED': {
        this.reserve(event.owner, event.token, event.amount, event.id);
        break;
      }
      case 'WITHDRAWAL_BROADCAST': {
        // On-chain broadcast metadata; balance was locked in WITHDRAWAL_LOCKED
        break;
      }
      case 'WITHDRAWAL_CONFIRMED': {
        const res = this.reservations.get(event.id);
        if (res && res.owner !== getAddress(event.owner)) {
          throw new Error(`WITHDRAWAL_CONFIRMED owner mismatch for ${event.id}`);
        }
        this.consume(event.id);
        break;
      }
      case 'WITHDRAWAL_FAILED': {
        const res = this.reservations.get(event.id);
        if (res && res.owner !== getAddress(event.owner)) {
          throw new Error(`WITHDRAWAL_FAILED owner mismatch for ${event.id}`);
        }
        this.release(event.id);
        break;
      }
      case 'FEE_BOOKED': {
        this.bookOperationalGas(event.opId, event.token, event.feeAmount);
        break;
      }
      default: {
        throw new Error(`Unknown journal event type: ${(event as any).t}`);
      }
    }
  }

  assertInvariants(): void {
    this.margin.assertInvariants();
    this.marginPositions.assertInvariants();
    // 1. Non-negativity check
    for (const [owner, tokenMap] of this.userBalances.entries()) {
      for (const [token, bal] of tokenMap.entries()) {
        if (bal.available < 0n) {
          throw new Error(
            `Invariant violation: negative available balance for ${owner} on ${token}: ${bal.available}`,
          );
        }
        if (bal.reserved < 0n) {
          throw new Error(
            `Invariant violation: negative reserved balance for ${owner} on ${token}: ${bal.reserved}`,
          );
        }
      }
    }

    // 2. Reservation conservation check
    const expectedReserved = new Map<string, bigint>();
    for (const res of this.reservations.values()) {
      if (res.status === 'active') {
        const key = `${res.owner}:${res.token}`;
        expectedReserved.set(key, (expectedReserved.get(key) ?? 0n) + res.amount);
      }
    }

    for (const [owner, tokenMap] of this.userBalances.entries()) {
      for (const [token, bal] of tokenMap.entries()) {
        const key = `${owner}:${token}`;
        const activeSum = expectedReserved.get(key) ?? 0n;
        if (bal.reserved !== activeSum) {
          throw new Error(
            `Invariant violation: reserved balance ${bal.reserved} does not match active reservations sum ${activeSum} for ${owner} on ${token}`,
          );
        }
      }
    }

    // Check that any active reservations for unmapped balance entries are zero
    for (const [key, sum] of expectedReserved.entries()) {
      const [owner, token] = key.split(':') as [Address, Address];
      const bal = this.userBalances.get(owner)?.get(token);
      if (!bal && sum > 0n) {
        throw new Error(
          `Invariant violation: active reservations sum ${sum} exists for ${owner} on ${token} but no balance record exists`,
        );
      }
    }

    // 3. Aggregate totals conservation check
    const totals = this.totals();
    const manualTotals = new Map<Address, { available: bigint; reserved: bigint }>();
    for (const tokenMap of this.userBalances.values()) {
      for (const [token, bal] of tokenMap.entries()) {
        const t = manualTotals.get(token) ?? { available: 0n, reserved: 0n };
        t.available += bal.available;
        t.reserved += bal.reserved;
        manualTotals.set(token, t);
      }
    }

    for (const [token, expected] of manualTotals.entries()) {
      const actual = totals.get(token);
      if (
        !actual ||
        actual.available !== expected.available ||
        actual.reserved !== expected.reserved
      ) {
        throw new Error(
          `Invariant violation: totals mismatch for token ${token}. Expected available=${expected.available}, reserved=${expected.reserved}`,
        );
      }
    }

    // 4. Protocol revenue and operational gas non-negativity
    for (const [token, rev] of this.protocolRevenue.entries()) {
      if (rev < 0n) {
        throw new Error(`Invariant violation: negative protocol revenue for ${token}: ${rev}`);
      }
    }
    for (const [token, gas] of this.operationalGasSpent.entries()) {
      if (gas < 0n) {
        throw new Error(`Invariant violation: negative operational gas for ${token}: ${gas}`);
      }
    }
  }
}

/**
 * Replays a journal's events into a fresh InMemoryLedger instance in strict chronological order.
 */
export async function replayLedger(journal: Pick<Journal, 'replay'>): Promise<InMemoryLedger> {
  const ledger = new InMemoryLedger();
  for await (const entry of journal.replay()) {
    ledger.apply(entry.event);
  }
  ledger.assertInvariants();
  return ledger;
}
