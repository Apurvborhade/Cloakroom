import type { Address, Hex } from 'viem';
import type { IntentMsg } from '../eip712.js';

export type BalanceRecord = {
  available: bigint;
  reserved: bigint;
};

export type OwnerBalances = {
  token: Address;
  available: bigint;
  reserved: bigint;
  pending: bigint;
};

export type IntentStatus =
  | 'pending'
  | 'executing'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface StoredIntent {
  id: string;
  owner: Address;
  intent: IntentMsg;
  status: IntentStatus;
  createdAt: number;
  settledAmountOut?: bigint;
  failureReason?: string;
}

export interface CustodyEOA {
  index: number;
  address: Address;
  role: 'deposit' | 'inventory';
  lastUsedAt: number;
  inFlight?: boolean;
}

export interface LockedWithdrawal {
  id: string;
  owner: Address;
  token: Address;
  amount: bigint;
  to: Address;
  status: 'locked' | 'sent' | 'confirmed' | 'failed';
  txHash?: Hex;
  reason?: string;
}

export interface ReconcileResult {
  ok: boolean;
  perToken: Array<{
    token: Address;
    onChain: bigint;
    claims: bigint;
  }>;
}
