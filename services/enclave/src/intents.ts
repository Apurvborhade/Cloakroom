import { getAddress, type Address } from 'viem';
import type {
  IntentMsg,
  IntentStatus,
  IntentStore,
  Journal,
  JournalEntry,
  JournalEvent,
  PriceReport,
  StoredIntent,
} from '@cloakroom/shared';

export interface IntentStoreOptions {
  now?: () => number;
}

export type JournalStreamEntry = JournalEntry | { event: JournalEvent; timestamp?: number };

export type JournalStream =
  | Pick<Journal, 'replay'>
  | AsyncIterable<JournalStreamEntry>
  | Iterable<JournalStreamEntry>;

function cloneStoredIntent(item: StoredIntent): StoredIntent {
  return {
    id: item.id,
    owner: item.owner,
    intent: {
      owner: item.intent.owner,
      tokenIn: item.intent.tokenIn,
      tokenOut: item.intent.tokenOut,
      amountIn: item.intent.amountIn,
      comparator: item.intent.comparator,
      triggerPrice: item.intent.triggerPrice,
      maxSlippageBps: item.intent.maxSlippageBps,
      nonce: item.intent.nonce,
      expiry: item.intent.expiry,
    },
    status: item.status,
    createdAt: item.createdAt,
    ...(item.settledAmountOut !== undefined ? { settledAmountOut: item.settledAmountOut } : {}),
    ...(item.failureReason !== undefined ? { failureReason: item.failureReason } : {}),
  };
}

function normalizeToken(token: string): string {
  const trimmed = token.trim();
  const hex = trimmed.startsWith('0X') ? `0x${trimmed.slice(2)}` : trimmed;
  try {
    return getAddress(hex);
  } catch {
    return hex.toLowerCase();
  }
}

function parsePair(pair: string): [string, string] | null {
  const parts = pair.split('/');
  if (parts.length !== 2) return null;
  const p0 = parts[0];
  const p1 = parts[1];
  if (!p0 || !p1) return null;
  const t0 = p0.trim();
  const t1 = p1.trim();
  if (!t0 || !t1) return null;
  return [normalizeToken(t0), normalizeToken(t1)];
}

/**
 * In-memory store for intent lifecycle tracking, condition matching, and recovery replay.
 */
export class InMemoryIntentStore implements IntentStore {
  private readonly intents = new Map<string, StoredIntent>();
  private readonly customNow?: () => number;

  constructor(options?: IntentStoreOptions) {
    this.customNow = options?.now;
  }

  get size(): number {
    return this.intents.size;
  }

  all(): StoredIntent[] {
    return Array.from(this.intents.values()).map(cloneStoredIntent);
  }

  clear(): void {
    this.intents.clear();
  }

  add(id: string, owner: Address, msg: IntentMsg): void {
    if (!id || typeof id !== 'string') {
      throw new Error('Intent id must be a non-empty string');
    }
    if (this.intents.has(id)) {
      throw new Error(`Intent with id '${id}' already exists`);
    }

    const normOwner = getAddress(owner);
    const msgOwner = getAddress(msg.owner);
    if (normOwner !== msgOwner) {
      throw new Error(`Owner mismatch: caller is ${normOwner} but intent message owner is ${msgOwner}`);
    }

    if (msg.comparator !== 0 && msg.comparator !== 1) {
      throw new Error(`Unsupported comparator: ${msg.comparator}. Expected 0 (>=) or 1 (<=)`);
    }

    if (typeof msg.amountIn !== 'bigint' || msg.amountIn <= 0n) {
      throw new Error('amountIn must be a positive bigint');
    }

    if (typeof msg.triggerPrice !== 'bigint' || msg.triggerPrice <= 0n) {
      throw new Error('triggerPrice must be a positive bigint');
    }

    if (typeof msg.nonce !== 'bigint' || msg.nonce < 0n) {
      throw new Error('nonce must be a non-negative bigint');
    }

    if (typeof msg.expiry !== 'bigint' || msg.expiry <= 0n) {
      throw new Error('expiry must be a positive bigint');
    }

    const normTokenIn = getAddress(msg.tokenIn);
    const normTokenOut = getAddress(msg.tokenOut);

    const createdAt = this.customNow
      ? Math.floor(this.customNow() / 1000)
      : Math.floor(Date.now() / 1000);

    const stored: StoredIntent = {
      id,
      owner: normOwner,
      intent: {
        owner: normOwner,
        tokenIn: normTokenIn,
        tokenOut: normTokenOut,
        amountIn: msg.amountIn,
        comparator: msg.comparator,
        triggerPrice: msg.triggerPrice,
        maxSlippageBps: msg.maxSlippageBps,
        nonce: msg.nonce,
        expiry: msg.expiry,
      },
      status: 'pending',
      createdAt,
    };

    this.intents.set(id, stored);
  }

  cancel(id: string, owner: Address): void {
    const stored = this.intents.get(id);
    if (!stored) {
      throw new Error(`Intent with id '${id}' not found`);
    }

    const normOwner = getAddress(owner);
    if (stored.owner !== normOwner) {
      throw new Error(`Unauthorized: caller ${normOwner} is not the owner of intent '${id}'`);
    }

    if (stored.status === 'executing') {
      throw new Error(`Cannot cancel intent '${id}': intent is currently executing`);
    }

    if (stored.status !== 'pending') {
      throw new Error(`Cannot cancel intent '${id}': intent is in terminal status '${stored.status}'`);
    }

    stored.status = 'cancelled';
  }

  expire(id: string): void {
    const stored = this.intents.get(id);
    if (!stored) {
      throw new Error(`Intent with id '${id}' not found`);
    }

    if (stored.status === 'executing') {
      throw new Error(`Cannot expire intent '${id}': intent is currently executing`);
    }

    if (stored.status !== 'pending') {
      throw new Error(`Cannot expire intent '${id}': intent is in terminal status '${stored.status}'`);
    }

    stored.status = 'expired';
  }

  mark(id: string, s: IntentStatus, amountOut?: bigint, failureReason?: string): void {
    const stored = this.intents.get(id);
    if (!stored) {
      throw new Error(`Intent with id '${id}' not found`);
    }

    // Idempotent if same status
    if (stored.status === s) {
      if (amountOut !== undefined) {
        stored.settledAmountOut = amountOut;
      }
      if (failureReason !== undefined) {
        stored.failureReason = failureReason;
      }
      return;
    }

    // Terminal states cannot transition to any other status
    if (['done', 'failed', 'cancelled', 'expired'].includes(stored.status)) {
      throw new Error(
        `Cannot transition intent '${id}' from terminal status '${stored.status}' to '${s}'`,
      );
    }

    // Disallow executing -> cancelled or executing -> expired
    if (stored.status === 'executing' && (s === 'cancelled' || s === 'expired')) {
      throw new Error(`Cannot transition executing intent '${id}' to '${s}'`);
    }

    stored.status = s;
    if (amountOut !== undefined) {
      stored.settledAmountOut = amountOut;
    }
    if (failureReason !== undefined) {
      stored.failureReason = failureReason;
    }
  }

  get(id: string): StoredIntent | undefined {
    const stored = this.intents.get(id);
    return stored ? cloneStoredIntent(stored) : undefined;
  }

  listByOwner(owner: Address): StoredIntent[] {
    const normOwner = getAddress(owner);
    const result: StoredIntent[] = [];
    for (const stored of this.intents.values()) {
      if (stored.owner === normOwner) {
        result.push(cloneStoredIntent(stored));
      }
    }
    return result;
  }

  due(report: PriceReport): StoredIntent[] {
    if (
      !report ||
      typeof report.pair !== 'string' ||
      typeof report.price !== 'bigint' ||
      typeof report.ts !== 'number'
    ) {
      throw new Error('Invalid PriceReport');
    }

    const pairTokens = parsePair(report.pair);
    if (!pairTokens) {
      return [];
    }
    const [reportIn, reportOut] = pairTokens;

    const reportTsSec = BigInt(report.ts);
    const nowSec = this.customNow
      ? BigInt(Math.floor(this.customNow() / 1000))
      : reportTsSec;

    const result: StoredIntent[] = [];

    for (const stored of this.intents.values()) {
      // 1. Must be pending
      if (stored.status !== 'pending') {
        continue;
      }

      // 2. Token pair must match
      const intentIn = normalizeToken(stored.intent.tokenIn);
      const intentOut = normalizeToken(stored.intent.tokenOut);
      if (reportIn !== intentIn || reportOut !== intentOut) {
        continue;
      }

      // 3. Must not be expired
      if (stored.intent.expiry <= reportTsSec || stored.intent.expiry <= nowSec) {
        continue;
      }

      // 4. Comparator condition
      if (stored.intent.comparator !== 0 && stored.intent.comparator !== 1) {
        throw new Error(`Unsupported comparator: ${stored.intent.comparator}`);
      }

      const conditionMet =
        stored.intent.comparator === 0
          ? report.price >= stored.intent.triggerPrice
          : report.price <= stored.intent.triggerPrice;

      if (conditionMet) {
        result.push(cloneStoredIntent(stored));
      }
    }

    return result;
  }

  apply(event: JournalEvent, timestamp?: number): void {
    switch (event.t) {
      case 'INTENT_CREATED': {
        if (this.intents.has(event.id)) {
          return; // Idempotent duplicate event
        }
        const normOwner = getAddress(event.owner);
        const normTokenIn = getAddress(event.intent.tokenIn);
        const normTokenOut = getAddress(event.intent.tokenOut);
        const createdAt =
          timestamp ??
          (this.customNow
            ? Math.floor(this.customNow() / 1000)
            : Math.floor(Date.now() / 1000));

        this.intents.set(event.id, {
          id: event.id,
          owner: normOwner,
          intent: {
            owner: normOwner,
            tokenIn: normTokenIn,
            tokenOut: normTokenOut,
            amountIn: event.intent.amountIn,
            comparator: event.intent.comparator,
            triggerPrice: event.intent.triggerPrice,
            maxSlippageBps: event.intent.maxSlippageBps,
            nonce: event.intent.nonce,
            expiry: event.intent.expiry,
          },
          status: 'pending',
          createdAt,
        });
        break;
      }
      case 'INTENT_CANCELLED': {
        const stored = this.intents.get(event.id);
        if (stored) {
          if (stored.owner !== getAddress(event.owner)) {
            throw new Error(`Owner mismatch on INTENT_CANCELLED for intent '${event.id}'`);
          }
          stored.status = 'cancelled';
        }
        break;
      }
      case 'INTENT_EXPIRED': {
        const stored = this.intents.get(event.id);
        if (stored) {
          if (stored.owner !== getAddress(event.owner)) {
            throw new Error(`Owner mismatch on INTENT_EXPIRED for intent '${event.id}'`);
          }
          stored.status = 'expired';
        }
        break;
      }
      case 'EXEC_BROADCAST': {
        const intentId =
          event.intentId ?? (event.opId.startsWith('exec:') ? event.opId.slice(5) : event.opId);
        const stored = this.intents.get(intentId);
        if (stored && stored.status === 'pending') {
          stored.status = 'executing';
        }
        break;
      }
      case 'EXEC_SETTLED': {
        const stored = this.intents.get(event.intentId);
        if (stored) {
          if (stored.owner !== getAddress(event.owner)) {
            throw new Error(`Owner mismatch on EXEC_SETTLED for intent '${event.intentId}'`);
          }
          stored.status = 'done';
          stored.settledAmountOut = event.amountOut - event.fee;
        }
        break;
      }
      case 'EXEC_FAILED': {
        const stored = this.intents.get(event.intentId);
        if (stored) {
          if (stored.owner !== getAddress(event.owner)) {
            throw new Error(`Owner mismatch on EXEC_FAILED for intent '${event.intentId}'`);
          }
          stored.status = 'failed';
          stored.failureReason = event.reason;
        }
        break;
      }
      default:
        // Other events (DEPOSIT_*, WITHDRAWAL_*, NONCE_USED, SIGNING_*, FEE_BOOKED) do not alter intent store
        break;
    }
  }
}

/**
 * Replays journal events to reconstruct intent store state deterministically.
 * Does not perform ledger mutations or reserve balances.
 */
function isReplayableJournal(
  journal: JournalStream,
): journal is Pick<Journal, 'replay'> {
  return typeof (journal as any)?.replay === 'function';
}

export async function replayIntents(
  journal: JournalStream,
  store?: InMemoryIntentStore,
): Promise<InMemoryIntentStore> {
  const intentStore = store ?? new InMemoryIntentStore();
  const stream: AsyncIterable<JournalStreamEntry> | Iterable<JournalStreamEntry> =
    isReplayableJournal(journal) ? journal.replay() : journal;

  for await (const entry of stream) {
    if ('event' in entry) {
      intentStore.apply(entry.event, 'timestamp' in entry ? entry.timestamp : undefined);
    }
  }

  return intentStore;
}
