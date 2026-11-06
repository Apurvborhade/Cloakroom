import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEntry, JournalEvent } from '@cloakroom/shared';
import { KeyManager } from '../src/keys.js';
import type { JournalCipher } from '../src/keys.js';
import { GENESIS_HASH } from '../src/journal.js';
import { SnapshotJournal } from '../src/snapshot-journal.js';
import { AesGcmStateVault, MAX_BLOB_BYTES, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { memoryJournal } from './helpers/memory-journal.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const event: JournalEvent = { t: 'DEPOSIT_CREDITED', id: '1n', owner: OWNER, amount: 100n, block: 1n };
const AAD = Buffer.from('cloakroom/journal-snapshot/v1');
async function entries(journal: SnapshotJournal) {
  const result: JournalEntry[] = [];
  for await (const entry of journal.replay()) result.push(entry);
  return result;
}

describe('encrypted snapshot journal', () => {
  let store: MemoryCipherBlobStore, cipher: JournalCipher;
  beforeEach(async () => {
    store = new MemoryCipherBlobStore();
    const keys = new KeyManager({
      vault: new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey('ab'.repeat(32), true), true),
      journal: memoryJournal().journal, simMode: true, allowCreate: true,
      policy: { chainId: 1, maxGas: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, maxNativeValue: 1n },
    });
    await keys.init();
    cipher = keys.journalCipher();
  });

  it('requires explicit creation and persists an authenticated empty journal', async () => {
    await expect(SnapshotJournal.open({ store, cipher })).rejects.toThrow('JOURNAL_MISSING');
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    expect(journal.lastEntryHash()).toBe(GENESIS_HASH);
    expect((await store.read())!.length).toBeGreaterThan(28);
    expect(await entries(await SnapshotJournal.open({ store, cipher }))).toEqual([]);
  });

  it('serializes concurrent appends and restores bigint amounts without changing string IDs', async () => {
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    const results = await Promise.all(Array.from({ length: 8 }, () => journal.append(event)));
    expect(results.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Buffer.from((await store.read())!).includes(Buffer.from('DEPOSIT_CREDITED'))).toBe(false);
    const reopened = await SnapshotJournal.open({ store, cipher });
    expect(await entries(reopened)).toEqual(results);
    expect((await entries(reopened))[0]!.event).toEqual(event);
    expect(reopened.lastEntryHash()).toBe(results.at(-1)!.entryHash);
  });

  it('isolates input, append results and replay results from later mutation', async () => {
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    const input = { ...event };
    const pending = journal.append(input);
    input.amount = 999n;
    const returned = await pending;
    returned.event = { t: 'NONCE_USED', owner: OWNER, nonce: 2n };
    const replayed = await entries(journal);
    replayed[0]!.event = returned.event;
    expect((await entries(journal))[0]!.event).toEqual(event);
  });

  it('does not acknowledge or change the head until the durable CAS resolves', async () => {
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    const cas = store.compareAndSwap.bind(store);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(store, 'compareAndSwap').mockImplementationOnce(async (hash, bytes) => {
      entered(); await gate; await cas(hash, bytes);
    });
    let acknowledged = false;
    const pending = journal.append(event).then(() => { acknowledged = true; });
    await started;
    expect(acknowledged).toBe(false);
    expect(journal.lastEntryHash()).toBe(GENESIS_HASH);
    release(); await pending;
    expect(acknowledged).toBe(true);
    expect(journal.lastEntryHash()).not.toBe(GENESIS_HASH);
  });

  it('stops after an uncertain acknowledgement and recovers the committed entry exactly once', async () => {
    const onFault = vi.fn();
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true, onFault });
    const cas = store.compareAndSwap.bind(store);
    const writes = vi.spyOn(store, 'compareAndSwap').mockImplementationOnce(async (hash, bytes) => {
      await cas(hash, bytes); throw new Error('lost acknowledgement');
    });
    await expect(journal.append(event)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await expect(journal.append(event)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await expect(entries(journal)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(() => journal.lastEntryHash()).toThrow('JOURNAL_UNAVAILABLE');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(onFault).toHaveBeenCalledTimes(1);
    const recovered = await entries(await SnapshotJournal.open({ store, cipher }));
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.event).toEqual(event);
  });

  it('faults stale writers without overwriting acknowledged entries', async () => {
    const first = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    const stale = await SnapshotJournal.open({ store, cipher });
    const committed = await first.append(event);
    await expect(stale.append(event)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(await entries(await SnapshotJournal.open({ store, cipher }))).toEqual([committed]);
  });

  it('enforces the total size limit before writing and preserves the committed snapshot', async () => {
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true, maxBytes: 1024 });
    const committed = await journal.append(event);
    const previous = await store.read();
    const cas = vi.spyOn(store, 'compareAndSwap');
    await expect(journal.append({ ...event, id: 'a'.repeat(1024) })).rejects.toThrow('JOURNAL_FULL');
    expect(cas).not.toHaveBeenCalled();
    expect(await store.read()).toEqual(previous);
    expect(await entries(journal)).toEqual([committed]);
    await expect(SnapshotJournal.open({ store, cipher, maxBytes: MAX_BLOB_BYTES + 1 })).rejects.toThrow('JOURNAL_LIMIT_INVALID');
  });

  it.each(['flip', 'truncate', 'empty'] as const)('rejects %s corruption without changing the file', async (kind) => {
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    await journal.append(event);
    const original = (await store.read())!;
    const damaged = kind === 'truncate' ? original.slice(0, -1) : kind === 'empty' ? new Uint8Array() : original.slice();
    if (kind === 'flip') damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    const broken = new MemoryCipherBlobStore();
    await broken.compareAndSwap(null, damaged);
    await expect(SnapshotJournal.open({ store: broken, cipher, allowCreate: true })).rejects.toThrow('JOURNAL_CORRUPT');
    expect(await broken.read()).toEqual(damaged);
  });

  it.each(['sequence', 'prevHash', 'entryHash'] as const)('validates %s even with valid encryption', async (field) => {
    const journal = await SnapshotJournal.open({ store, cipher, allowCreate: true });
    await journal.append(event);
    const decoded = JSON.parse(Buffer.from(cipher.decrypt((await store.read())!, AAD)).toString());
    decoded.entries[0][field] = field === 'sequence' ? 2 : `0x${'ff'.repeat(32)}`;
    const broken = new MemoryCipherBlobStore();
    await broken.compareAndSwap(null, cipher.encrypt(Buffer.from(JSON.stringify(decoded)), AAD));
    await expect(SnapshotJournal.open({ store: broken, cipher })).rejects.toThrow('JOURNAL_CORRUPT');
  });
});
