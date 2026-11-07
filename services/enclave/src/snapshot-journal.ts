import { createHash } from 'node:crypto';
import type { Hex } from 'viem';
import type { Journal, JournalEntry, JournalEvent } from '@cloakroom/shared';
import type { JournalCipher } from './keys.js';
import { computeEntryHash, GENESIS_HASH, validateJournalEntry } from './journal.js';
import { MAX_BLOB_BYTES } from './sealed-state.js';
import type { CipherBlobStore } from './sealed-state.js';

const AAD = new TextEncoder().encode('cloakroom/journal-snapshot/v1');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

type Options = {
  store: CipherBlobStore;
  cipher: JournalCipher;
  allowCreate?: boolean;
  maxBytes?: number;
  onFault?: () => void;
};

/** Bounded encrypted snapshots; acknowledgement follows the store's durable CAS. */
export class SnapshotJournal implements Journal {
  readonly #options: Options;
  readonly #limit: number;
  #entries: JournalEntry[] = [];
  #hash: string | null = null;
  #tail: Promise<void> = Promise.resolve();
  #faulted = false;
  #closed = false;

  private constructor(options: Options) {
    this.#options = { ...options };
    this.#limit = options.maxBytes ?? MAX_BLOB_BYTES;
    if (!Number.isSafeInteger(this.#limit) || this.#limit < 64 || this.#limit > MAX_BLOB_BYTES) {
      throw new Error('JOURNAL_LIMIT_INVALID');
    }
  }

  static async open(options: Options): Promise<SnapshotJournal> {
    const journal = new SnapshotJournal(options);
    const saved = await options.store.read();
    if (saved === undefined) {
      if (!options.allowCreate) throw new Error('JOURNAL_MISSING');
      await journal.#persist([]);
    } else {
      if (saved.byteLength > journal.#limit || saved.byteLength < 28) throw new Error('JOURNAL_CORRUPT');
      try {
        const plaintext = options.cipher.decrypt(saved, AAD);
        const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext), (_key, value: unknown) => {
          if (value && typeof value === 'object' && Object.keys(value).join(',') === '$bigint') {
            const number = (value as { $bigint: unknown }).$bigint;
            if (typeof number !== 'string' || !/^-?(0|[1-9][0-9]*)$/.test(number)) throw new Error();
            return BigInt(number);
          }
          return value;
        });
        const snapshot = decoded as { version: unknown; entries: unknown[] };
        if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.entries)
            || Object.keys(snapshot).sort().join(',') !== 'entries,version') throw new Error();
        let previous = GENESIS_HASH;
        journal.#entries = snapshot.entries.map((value, index) => {
          const entry = validateJournalEntry(value, index + 1, previous);
          previous = entry.entryHash;
          return entry;
        });
        journal.#hash = digest(saved);
      } catch { throw new Error('JOURNAL_CORRUPT'); }
    }
    return journal;
  }

  #assertOpen(): void {
    if (this.#closed || this.#faulted) throw new Error('JOURNAL_UNAVAILABLE');
  }

  async #persist(entries: JournalEntry[]): Promise<void> {
    const plaintext = new TextEncoder().encode(JSON.stringify({ version: 1, entries }, (_key, value: unknown) =>
      typeof value === 'bigint' ? { $bigint: value.toString() } : value));
    if (plaintext.byteLength + 28 > this.#limit) {
      this.#faulted = true;
      this.#options.onFault?.();
      throw new Error('JOURNAL_FULL');
    }
    const sealed = this.#options.cipher.encrypt(plaintext, AAD);
    if (sealed.byteLength !== plaintext.byteLength + 28) throw new Error('JOURNAL_CIPHER_INVALID');
    try {
      await this.#options.store.compareAndSwap(this.#hash, sealed);
    } catch {
      // A failed acknowledgement may follow a committed write. Only a fresh boot can resolve it.
      this.#faulted = true;
      this.#options.onFault?.();
      throw new Error('JOURNAL_UNAVAILABLE');
    }
    this.#entries = entries;
    this.#hash = digest(sealed);
  }

  append(event: JournalEvent): Promise<JournalEntry> {
    const snapshot = structuredClone(event);
    const result = this.#tail.then(async () => {
      this.#assertOpen();
      const sequence = this.#entries.length + 1;
      const timestamp = Math.floor(Date.now() / 1000);
      const prevHash = this.lastEntryHash();
      const entry: JournalEntry = { sequence, timestamp, prevHash, event: snapshot,
        entryHash: computeEntryHash(sequence, timestamp, prevHash, snapshot) };
      await this.#persist([...this.#entries, entry]);
      return structuredClone(entry);
    });
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }

  async *replay(): AsyncIterable<JournalEntry> {
    await this.#tail;
    this.#assertOpen();
    for (const entry of this.#entries) yield structuredClone(entry);
  }

  lastEntryHash(): Hex {
    this.#assertOpen();
    return this.#entries.at(-1)?.entryHash ?? GENESIS_HASH;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#tail;
  }
}
