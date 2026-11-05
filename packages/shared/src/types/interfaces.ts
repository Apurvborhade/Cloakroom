import type { Address, Hex } from 'viem';
import type { IntentMsg } from '../eip712.js';
import type { BalanceRecord, OwnerBalances, IntentStatus, StoredIntent } from './models.js';
import type { JournalEvent, JournalEntry } from './journal.js';
import type { PriceReport } from './oracle.js';

export interface SerialQueue {
  run<T>(op: () => Promise<T>): Promise<T>;
}

export interface Journal {
  append(e: JournalEvent): Promise<JournalEntry>;
  replay(): AsyncIterable<JournalEntry>;
  lastEntryHash(): Hex;
  close(): Promise<void>;
}

export interface Ledger {
  credit(owner: Address, token: Address, amt: bigint, ref: string): void;
  reserve(owner: Address, token: Address, amt: bigint, ref: string): void;
  release(ref: string): void;
  consume(ref: string): void;
  balances(owner: Address): OwnerBalances[];
  totals(): Map<Address, BalanceRecord>;
  getLastNonce(owner: Address): bigint;
  setNonce(owner: Address, nonce: bigint): void;
}

export interface IntentStore {
  add(id: string, owner: Address, msg: IntentMsg): void;
  cancel(id: string, owner: Address): void;
  expire(id: string): void;
  due(report: PriceReport): StoredIntent[];
  mark(id: string, s: IntentStatus, amountOut?: bigint): void;
  get(id: string): StoredIntent | undefined;
  listByOwner(owner: Address): StoredIntent[];
}

export interface InventoryReader {
  getPhysicalBalances(): Promise<Map<Address, bigint>>;
}

export interface OracleVerifier {
  accept(report: PriceReport, authHeader?: string): Promise<PriceReport>;
}
