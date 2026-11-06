import type { Address, Hex } from 'viem';
import type { IntentMsg } from '../eip712.js';

/**
 * Discriminator union for append-only hash-chained journal events.
 *
 * Open decisions:
 * - Session Grant Persistence: Session grants are currently handled ephemerally in-memory.
 *   If persistence across restarts is required, a SESSION_GRANTED event should be added.
 * - EOA Relabeling: Relabeling from 'deposit' to 'inventory' occurs upon DEPOSIT_SESSION_CLOSED.
 */
export type JournalEvent =
  | { t: 'SIGNING_REGISTERED'; opId: string; eoa: Address; to: Address; value: bigint; dataHash: Hex; chainId: number }
  | { t: 'SIGNING_COMPLETED'; opId: string; txHash: Hex }
  | { t: 'NONCE_USED'; owner: Address; nonce: bigint }
  | {
      t: 'DEPOSIT_SESSION_OPENED';
      id: string;
      owner: Address;
      eoa: Address;
      expiry: number;
      baseline: bigint;
      baselineBlock: bigint;
    }
  | {
      t: 'DEPOSIT_CREDITED';
      id: string;
      amount: bigint;
      block: bigint;
      owner: Address;
      txHash?: Hex;
    }
  | { t: 'DEPOSIT_SESSION_CLOSED'; id: string; eoa: Address }
  | { t: 'INTENT_CREATED'; id: string; owner: Address; intent: IntentMsg }
  | { t: 'INTENT_CANCELLED'; id: string; owner: Address }
  | { t: 'INTENT_EXPIRED'; id: string; owner: Address }
  | {
      t: 'EXEC_BROADCAST';
      opId: string;
      eoa: Address;
      nonce: number;
      txHash: Hex;
      raw: Hex;
      intentId?: string;
    }
  | {
      t: 'EXEC_SETTLED';
      opId: string;
      intentId: string;
      owner: Address;
      tokenOut: Address;
      amountOut: bigint;
      fee: bigint;
    }
  | { t: 'EXEC_FAILED'; opId: string; intentId: string; owner: Address; reason: string }
  | {
      t: 'WITHDRAWAL_LOCKED';
      id: string;
      owner: Address;
      token: Address;
      amount: bigint;
      to: Address;
    }
  | {
      t: 'WITHDRAWAL_BROADCAST';
      id: string;
      eoa: Address;
      nonce: number;
      txHash: Hex;
      raw: Hex;
    }
  | { t: 'WITHDRAWAL_CONFIRMED'; id: string; owner: Address }
  | { t: 'WITHDRAWAL_FAILED'; id: string; owner: Address; reason: string }
  | { t: 'FEE_BOOKED'; opId: string; token: Address; feeAmount: bigint };

export interface JournalEntry {
  sequence: number;
  timestamp: number;
  prevHash: Hex;
  event: JournalEvent;
  entryHash: Hex;
}
