import { randomBytes } from 'node:crypto';
import { ERROR_CODES } from '@cloakroom/shared';
import type { IntentMsg, Journal, JournalEvent } from '@cloakroom/shared';
import { getAddress } from 'viem';
import type { Address } from 'viem';
import { AuthError } from './auth.js';
import type { InMemoryIntentStore } from './intents.js';
import type { InMemoryLedger } from './ledger.js';
import type { FifoSerialQueue } from './queue.js';

const INTENT_ID_BYTES = 32;
const MS_PER_SECOND = 1000;

export interface IntentOrdersDeps {
  intents: InMemoryIntentStore;
  journal: Pick<Journal, 'append'>;
  ledger: Pick<InMemoryLedger, 'apply' | 'getBalance'>;
  queue: Pick<FifoSerialQueue, 'run'>;
  nowMs?: () => number;
}

/**
 * Creates and ends orders. Each change is journaled, then applied through the same code replay
 * uses, so a restart rebuilds the same balances. Only the executor runs a swap.
 */
export class IntentOrders {
  constructor(private readonly deps: IntentOrdersDeps) {}

  /** Reserves the funds and records the order. Call once the nonce is consumed. */
  async create(owner: Address, intent: IntentMsg): Promise<string> {
    const { intents, journal, ledger, queue } = this.deps;
    const id = `0x${randomBytes(INTENT_ID_BYTES).toString('hex')}`;
    return queue.run(async () => {
      // Check before journaling: a reservation that can't apply would stop every later replay.
      if (ledger.getBalance(owner, intent.tokenIn).available < intent.amountIn) {
        throw new AuthError(ERROR_CODES.INSUFFICIENT_BALANCE);
      }
      const event = { t: 'INTENT_CREATED', id, owner, intent } as const;
      const entry = await journal.append(event);
      ledger.apply(event);
      intents.apply(event, entry.timestamp);
      return id;
    });
  }

  /**
   * Cancels a pending order. Another owner's order gets the same answer as one that doesn't exist,
   * and so does an order that is running or finished, because only a pending order can be stopped.
   */
  async cancel(owner: Address, id: string): Promise<void> {
    await this.deps.queue.run(async () => {
      const stored = this.deps.intents.get(id);
      if (!stored || stored.owner !== getAddress(owner) || stored.status !== 'pending') {
        throw new AuthError(ERROR_CODES.INTENT_NOT_FOUND);
      }
      await this.end(id, { t: 'INTENT_CANCELLED', id, owner: stored.owner });
    });
  }

  /** Ends every pending order past its expiry, and releases its funds. Returns how many. */
  async expireDue(): Promise<number> {
    const { intents, nowMs, queue } = this.deps;
    const nowSec = BigInt(Math.floor((nowMs ?? Date.now)() / MS_PER_SECOND));
    return queue.run(async () => {
      let expired = 0;
      for (const stored of intents.all()) {
        // The status can change while an earlier order in this loop is being journaled.
        if (intents.get(stored.id)?.status !== 'pending' || stored.intent.expiry > nowSec) continue;
        await this.end(stored.id, { t: 'INTENT_EXPIRED', id: stored.id, owner: stored.owner });
        expired += 1;
      }
      return expired;
    });
  }

  /**
   * Takes the order out of pending before the journal write. The pipeline doesn't use this queue,
   * so a price report during the write could otherwise start a swap with funds being released.
   */
  private async end(id: string, event: JournalEvent): Promise<void> {
    const { intents, journal, ledger } = this.deps;
    intents.mark(id, 'executing');
    try {
      await journal.append(event);
    } catch (error) {
      intents.mark(id, 'pending');
      throw error;
    }
    ledger.apply(event);
    intents.apply(event);
  }
}
