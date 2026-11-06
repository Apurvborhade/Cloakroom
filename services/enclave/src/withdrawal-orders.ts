import { randomBytes } from 'node:crypto';
import { ERROR_CODES } from '@cloakroom/shared';
import type { Journal, JournalEntry, JournalEvent, LockedWithdrawal, WithdrawalMsg } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import { AuthError } from './auth.js';
import type { Executor } from './executor.js';
import type { InMemoryLedger } from './ledger.js';
import type { FifoSerialQueue } from './queue.js';

const WITHDRAWAL_ID_BYTES = 32;

/** Each withdrawal's status, built only from journal events, so a restart rebuilds the same list. */
export class WithdrawalStatuses {
  private readonly withdrawals = new Map<string, LockedWithdrawal>();

  apply(event: JournalEvent): void {
    switch (event.t) {
      case 'WITHDRAWAL_LOCKED':
        this.withdrawals.set(event.id, {
          id: event.id,
          owner: getAddress(event.owner),
          token: event.token,
          amount: event.amount,
          to: event.to,
          status: 'locked',
        });
        break;
      case 'WITHDRAWAL_BROADCAST':
        // An unknown result stays 'sent' until recovery settles it.
        this.update(event.id, { status: 'sent', txHash: event.txHash });
        break;
      case 'WITHDRAWAL_CONFIRMED':
        this.update(event.id, { status: 'confirmed' });
        break;
      case 'WITHDRAWAL_FAILED':
        this.update(event.id, { status: 'failed', reason: event.reason });
        break;
      default:
        break;
    }
  }

  listByOwner(owner: Address): LockedWithdrawal[] {
    const normalized = getAddress(owner);
    return [...this.withdrawals.values()].filter((withdrawal) => withdrawal.owner === normalized);
  }

  private update(id: string, change: Partial<LockedWithdrawal>): void {
    const withdrawal = this.withdrawals.get(id);
    if (withdrawal) this.withdrawals.set(id, { ...withdrawal, ...change });
  }
}

/** Keeps the statuses current on every journal write, including the executor's. */
export function trackWithdrawals(
  journal: Pick<Journal, 'append'>,
  statuses: WithdrawalStatuses,
): Pick<Journal, 'append'> {
  return {
    append: async (event: JournalEvent): Promise<JournalEntry> => {
      const entry = await journal.append(event);
      statuses.apply(event);
      return entry;
    },
  };
}

export interface WithdrawalOrdersDeps {
  executor: Pick<Executor, 'runWithdrawal'>;
  journal: Pick<Journal, 'append'>;
  ledger: Pick<InMemoryLedger, 'apply' | 'getBalance'>;
  queue: Pick<FifoSerialQueue, 'run'>;
  onError?: () => void;
}

/** Owns the lock: funds are reserved and journaled here, and the executor owns the payout from there. */
export class WithdrawalOrders {
  private running = 0;

  constructor(private readonly deps: WithdrawalOrdersDeps) {}

  /** Payouts started and not yet finished. */
  get inFlightCount(): number {
    return this.running;
  }

  /** Reserves the funds and starts the payout. Call once the nonce is consumed. */
  async create(owner: Address, withdrawal: WithdrawalMsg): Promise<string> {
    const { executor, journal, ledger, queue, onError } = this.deps;
    const id = `0x${randomBytes(WITHDRAWAL_ID_BYTES).toString('hex')}`;
    const { token, amount, to } = withdrawal;

    await queue.run(async () => {
      // Check before journaling: a reservation that can't apply would stop every later replay.
      if (ledger.getBalance(owner, token).available < amount) {
        throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE);
      }
      const event = { t: 'WITHDRAWAL_LOCKED', id, owner, token, amount, to } as const;
      await journal.append(event);
      ledger.apply(event);
    });

    this.running += 1;
    const done = () => {
      this.running -= 1;
    };
    let finished;
    try {
      ({ finished } = await executor.runWithdrawal({ id, owner, token, amount, to, status: 'locked' }));
    } catch (error) {
      done();
      // The executor has released the lock.
      if ((error as Error).message === ERROR_CODES.NO_INVENTORY) throw new AuthError(ERROR_CODES.NO_INVENTORY);
      throw error;
    }
    // Rejects only if the journal can't be written. The funds stay reserved for recovery.
    void finished.catch(() => onError?.()).finally(done);
    return id;
  }
}
