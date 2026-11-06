/**
 * The deposit lifecycle, derived from facts rather than optimism. Each stage needs evidence:
 * a wallet hash for "submitted", a successful receipt for "confirmed", a balance increase reported
 * by the enclave for "credited".
 */
export type DepositStage =
  | 'no-session'
  | 'awaiting-transfer'
  | 'session-expired'
  | 'submitted'
  | 'reverted'
  | 'confirmed-on-chain'
  | 'credited';

/** Below this, a transfer may not be mined before the session window closes. */
export const MIN_SECONDS_TO_SEND = 90;

export interface DepositFacts {
  hasSession: boolean;
  secondsLeft: number;
  txHash: string | null;
  receiptStatus: 'success' | 'reverted' | null;
  /** Total ETH (available + reserved) the enclave reports now, and when the transfer was sent. */
  privateTotalNow: bigint | null;
  privateTotalAtSend: bigint | null;
  amountWei: bigint | null;
}

export function depositStage(facts: DepositFacts): DepositStage {
  if (!facts.hasSession) return 'no-session';
  if (facts.txHash) {
    if (facts.receiptStatus === 'reverted') return 'reverted';
    if (
      facts.privateTotalNow !== null &&
      facts.privateTotalAtSend !== null &&
      facts.amountWei !== null &&
      facts.privateTotalNow - facts.privateTotalAtSend >= facts.amountWei
    ) {
      return 'credited';
    }
    if (facts.receiptStatus === 'success') return 'confirmed-on-chain';
    return 'submitted';
  }
  return facts.secondsLeft > 0 ? 'awaiting-transfer' : 'session-expired';
}

export function canSendNow(secondsLeft: number): boolean {
  return secondsLeft >= MIN_SECONDS_TO_SEND;
}
