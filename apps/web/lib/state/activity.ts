import type { Address, Hash, Hex } from 'viem';
import { ExternalStore } from './external-store';

/**
 * Details the user signed in this tab. The status endpoints return only ids and statuses, so this
 * is the only place the pair, amount and trigger of an intent are known. It is memory only: it is
 * never persisted, and it is cleared when the connected account changes.
 */
export interface LocalIntent {
  id: Hex;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  triggerPrice: bigint;
  comparator: number;
  maxSlippageBps: number;
  signedAt: number;
  /** Unix seconds. The signed expiry, which the enclave also uses as the order's lifetime. */
  expiresAt: number;
}

export interface LocalWithdrawal {
  id: string;
  token: Address;
  amount: bigint;
  to: Address;
  createdAt: number;
}

export interface LocalDeposit {
  sessionId: string;
  depositAddress: Address;
  expiresAt: number;
  createdAt: number;
  txHash?: Hash;
  amountWei?: bigint;
}

export interface Activity {
  owner: Address | null;
  intents: Record<string, LocalIntent>;
  withdrawals: Record<string, LocalWithdrawal>;
  deposits: LocalDeposit[];
}

const empty = (owner: Address | null): Activity => ({ owner, intents: {}, withdrawals: {}, deposits: [] });

export const activityStore = new ExternalStore<Activity>(empty(null));

/** Clears everything when the owner changes. */
export function bindActivityOwner(owner: Address | null): void {
  const current = activityStore.getSnapshot();
  if ((current.owner ?? '').toLowerCase() !== (owner ?? '').toLowerCase()) activityStore.set(empty(owner));
}

export function recordIntent(intent: LocalIntent): void {
  activityStore.set((state) => ({ ...state, intents: { ...state.intents, [intent.id.toLowerCase()]: intent } }));
}

export function recordWithdrawal(withdrawal: LocalWithdrawal): void {
  activityStore.set((state) => ({ ...state, withdrawals: { ...state.withdrawals, [withdrawal.id]: withdrawal } }));
}

export function recordDeposit(deposit: LocalDeposit): void {
  activityStore.set((state) => ({ ...state, deposits: [deposit, ...state.deposits.filter((d) => d.sessionId !== deposit.sessionId)] }));
}

export function updateDeposit(sessionId: string, patch: Partial<LocalDeposit>): void {
  activityStore.set((state) => ({
    ...state,
    deposits: state.deposits.map((deposit) => (deposit.sessionId === sessionId ? { ...deposit, ...patch } : deposit)),
  }));
}
