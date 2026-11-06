import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JournalEvent, JournalEntry } from '@cloakroom/shared';
import {
  EncryptedJournal,
  GENESIS_HASH,
  canonicalJson,
  computeEntryHash,
  parseCanonicalJson,
} from '../src/journal.js';

describe('EncryptedJournal', () => {
  let tempDir: string;
  let journalPath: string;
  let testKey: Buffer;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), 'cloakroom-journal-test-'));
    journalPath = path.join(tempDir, 'journal.log');
    testKey = crypto.randomBytes(32);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  async function collectEntries(journal: EncryptedJournal): Promise<JournalEntry[]> {
    const entries: JournalEntry[] = [];
    for await (const entry of journal.replay()) {
      entries.push(entry);
    }
    return entries;
  }

  const sampleEvent1: JournalEvent = {
    t: 'NONCE_USED',
    owner: '0x1111111111111111111111111111111111111111',
    nonce: 1n,
  };

  const sampleEvent2: JournalEvent = {
    t: 'NONCE_USED',
    owner: '0x1111111111111111111111111111111111111111',
    nonce: 2n,
  };

  it.each(['', 'cloakroom/journal/v1'])('reopens cipher-backed records with associated data %j', async (associatedData) => {
    const cipher = {
      encrypt(plaintext: Uint8Array, aad: Uint8Array) {
        const nonce = crypto.randomBytes(12);
        const enc = crypto.createCipheriv('aes-256-gcm', testKey, nonce);
        enc.setAAD(aad);
        const ciphertext = Buffer.concat([enc.update(plaintext), enc.final()]);
        return Buffer.concat([nonce, enc.getAuthTag(), ciphertext]);
      },
      decrypt(sealed: Uint8Array, aad: Uint8Array) {
        const dec = crypto.createDecipheriv('aes-256-gcm', testKey, sealed.subarray(0, 12));
        dec.setAAD(aad);
        dec.setAuthTag(sealed.subarray(12, 28));
        return Buffer.concat([dec.update(sealed.subarray(28)), dec.final()]);
      },
    };
    const entry = { sequence: 1, timestamp: 1, prevHash: GENESIS_HASH, event: sampleEvent1,
      entryHash: computeEntryHash(1, 1, GENESIS_HASH, sampleEvent1) };
    const plaintext = Buffer.from(canonicalJson(entry));
    const sealed = cipher.encrypt(plaintext, Buffer.from(associatedData));
    const frame = Buffer.alloc(4 + sealed.length);
    frame.writeUInt32BE(plaintext.length);
    sealed.copy(frame, 4, 0, 12);
    sealed.copy(frame, 16, 28);
    sealed.copy(frame, 16 + plaintext.length, 12, 28);
    await fs.writeFile(journalPath, frame);
    const journal = await EncryptedJournal.open({ filePath: journalPath, cipher });
    expect(await collectEntries(journal)).toEqual([entry]);
    await journal.append(sampleEvent2);
    await journal.close();
    const file = await fs.readFile(journalPath);
    const next = file.subarray(frame.length);
    const length = next.readUInt32BE(0);
    const nextSealed = Buffer.concat([next.subarray(4, 16), next.subarray(16 + length), next.subarray(16, 16 + length)]);
    expect(parseCanonicalJson<JournalEntry>(cipher.decrypt(nextSealed, Buffer.from('cloakroom/journal/v1')).toString()).event)
      .toEqual(sampleEvent2);
    const reopened = await EncryptedJournal.open({ filePath: journalPath, cipher });
    expect(await collectEntries(reopened)).toHaveLength(2);
    await reopened.close();
    file[20] = file[20]! ^ 1;
    await fs.writeFile(journalPath, file);
    await expect(EncryptedJournal.open({ filePath: journalPath, cipher })).rejects.toThrow('JOURNAL_CORRUPT');
  });

  it('1. returns genesis hash and yields zero entries on empty journal', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    expect(journal.lastEntryHash()).toBe(GENESIS_HASH);
    expect(journal.sequence()).toBe(0);

    const entries = await collectEntries(journal);
    expect(entries).toHaveLength(0);
    await journal.close();
  });

  it('2. starts first append at sequence 1 referencing genesis hash', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const entry = await journal.append(sampleEvent1);

    expect(entry.sequence).toBe(1);
    expect(entry.prevHash).toBe(GENESIS_HASH);
    expect(entry.entryHash).toBeDefined();
    expect(journal.lastEntryHash()).toBe(entry.entryHash);
    expect(journal.sequence()).toBe(1);
    await journal.close();
  });

  it('3. increments sequence numbers monotonically without gaps', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const e1 = await journal.append(sampleEvent1);
    const e2 = await journal.append(sampleEvent2);
    const e3 = await journal.append({
      t: 'INTENT_CANCELLED',
      id: 'i-test',
      owner: '0x1111111111111111111111111111111111111111',
    });

    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e3.sequence).toBe(3);
    expect(journal.sequence()).toBe(3);
    await journal.close();
  });

  it('4. maintains hash-chain continuity across multiple entries', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const e1 = await journal.append(sampleEvent1);
    const e2 = await journal.append(sampleEvent2);

    expect(e1.prevHash).toBe(GENESIS_HASH);
    expect(e2.prevHash).toBe(e1.entryHash);
    expect(journal.lastEntryHash()).toBe(e2.entryHash);
    await journal.close();
  });

  it('5. produces deterministically verifiable hashes matching computeEntryHash', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const entry = await journal.append(sampleEvent1);

    const expectedHash = computeEntryHash(
      entry.sequence,
      entry.timestamp,
      entry.prevHash,
      entry.event
    );
    expect(entry.entryHash).toBe(expectedHash);
    await journal.close();
  });

  it('6. encrypts records on disk using AES-256-GCM framing', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();

    const rawFile = await fs.readFile(journalPath);
    expect(rawFile.length).toBeGreaterThan(32);

    const payloadLength = rawFile.readUInt32BE(0);
    const expectedFrameLength = 4 + 12 + payloadLength + 16;
    expect(rawFile.length).toBe(expectedFrameLength);

    const iv = rawFile.subarray(4, 16);
    const ciphertext = rawFile.subarray(16, 16 + payloadLength);
    const authTag = rawFile.subarray(16 + payloadLength, 16 + payloadLength + 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', testKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const entry = parseCanonicalJson<JournalEntry>(decrypted.toString('utf8'));

    expect(entry.sequence).toBe(1);
    expect(entry.event).toEqual(sampleEvent1);
  });

  it('7. ensures raw disk contents do not contain plaintext event data', async () => {
    const secretAddress = '0x9999999999999999999999999999999999999999';
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append({
      t: 'NONCE_USED',
      owner: secretAddress,
      nonce: 1337n,
    });
    await journal.close();

    const rawFile = await fs.readFile(journalPath);
    const fileString = rawFile.toString('utf8');

    expect(fileString.includes(secretAddress)).toBe(false);
    expect(fileString.includes('NONCE_USED')).toBe(false);
    expect(fileString.includes('1337')).toBe(false);
  });

  it('8. generates fresh, distinct IVs for separate records', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.append(sampleEvent2);
    await journal.close();

    const rawFile = await fs.readFile(journalPath);
    const len1 = rawFile.readUInt32BE(0);
    const iv1 = rawFile.subarray(4, 16);

    const offset2 = 4 + 12 + len1 + 16;
    const iv2 = rawFile.subarray(offset2 + 4, offset2 + 16);

    expect(iv1.equals(iv2)).toBe(false);
  });

  it('9. waits for durable filesystem sync on append', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    const syncSpy = vi.spyOn(handle, 'sync');

    await journal.append(sampleEvent1);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    await journal.close();
  });

  it('10. does not advance in-memory sequence or hash if append fails', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const e1 = await journal.append(sampleEvent1);
    expect(journal.sequence()).toBe(1);

    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    vi.spyOn(handle, 'write').mockRejectedValueOnce(new Error('DISK_FULL'));

    await expect(journal.append(sampleEvent2)).rejects.toThrow('DISK_FULL');

    expect(journal.sequence()).toBe(1);
    expect(journal.lastEntryHash()).toBe(e1.entryHash);

    const e2 = await journal.append(sampleEvent2);
    expect(e2.sequence).toBe(2);
    expect(e2.prevHash).toBe(e1.entryHash);
    await journal.close();
  });

  it('11. preserves ordering and unique sequences under concurrent append calls', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const count = 25;
    const promises = Array.from({ length: count }, (_, idx) =>
      journal.append({
        t: 'NONCE_USED',
        owner: '0x1111111111111111111111111111111111111111',
        nonce: BigInt(idx + 1),
      })
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(count);

    for (let i = 0; i < count; i++) {
      expect(results[i]!.sequence).toBe(i + 1);
      if (i > 0) {
        expect(results[i]!.prevHash).toBe(results[i - 1]!.entryHash);
      }
    }

    const replayed = await collectEntries(journal);
    expect(replayed).toHaveLength(count);
    await journal.close();
  });

  it('12. faithfully reconstructs all 15 canonical JournalEvent variants on replay', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });

    const allEvents: JournalEvent[] = [
      {
        t: 'NONCE_USED',
        owner: '0x1111111111111111111111111111111111111111',
        nonce: 42n,
      },
      {
        t: 'DEPOSIT_SESSION_OPENED',
        id: 'session-1',
        owner: '0x1111111111111111111111111111111111111111',
        eoa: '0x2222222222222222222222222222222222222222',
        expiry: 1700000000,
        baseline: 1000n,
        baselineBlock: 123456n,
      },
      {
        t: 'DEPOSIT_CREDITED',
        id: 'session-1',
        amount: 5000n,
        block: 123460n,
        owner: '0x1111111111111111111111111111111111111111',
      },
      {
        t: 'DEPOSIT_SESSION_CLOSED',
        id: 'session-1',
        eoa: '0x2222222222222222222222222222222222222222',
      },
      {
        t: 'INTENT_CREATED',
        id: 'intent-1',
        owner: '0x1111111111111111111111111111111111111111',
        intent: {
          owner: '0x1111111111111111111111111111111111111111',
          tokenIn: '0x0000000000000000000000000000000000000000',
          tokenOut: '0x3333333333333333333333333333333333333333',
          amountIn: 100000000000000000n,
          comparator: 0,
          triggerPrice: 3000000000000000000000n,
          maxSlippageBps: 50,
          nonce: 7n,
          expiry: 1790000000n,
        },
      },
      {
        t: 'INTENT_CANCELLED',
        id: 'intent-1',
        owner: '0x1111111111111111111111111111111111111111',
      },
      {
        t: 'INTENT_EXPIRED',
        id: 'intent-1',
        owner: '0x1111111111111111111111111111111111111111',
      },
      {
        t: 'EXEC_BROADCAST',
        opId: 'op-1',
        eoa: '0x2222222222222222222222222222222222222222',
        nonce: 10,
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        raw: '0x02f8deadbeef',
        intentId: 'intent-1',
      },
      {
        t: 'EXEC_SETTLED',
        opId: 'op-1',
        intentId: 'intent-1',
        owner: '0x1111111111111111111111111111111111111111',
        tokenOut: '0x3333333333333333333333333333333333333333',
        amountOut: 300000000000000000000n,
        fee: 300000000000000000n,
      },
      {
        t: 'EXEC_FAILED',
        opId: 'op-1',
        intentId: 'intent-1',
        owner: '0x1111111111111111111111111111111111111111',
        reason: 'REVERTED',
      },
      {
        t: 'WITHDRAWAL_LOCKED',
        id: 'w-1',
        owner: '0x1111111111111111111111111111111111111111',
        token: '0x0000000000000000000000000000000000000000',
        amount: 50000000000000000n,
        to: '0x4444444444444444444444444444444444444444',
      },
      {
        t: 'WITHDRAWAL_BROADCAST',
        id: 'w-1',
        eoa: '0x2222222222222222222222222222222222222222',
        nonce: 11,
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        raw: '0x02f8beefdead',
      },
      {
        t: 'WITHDRAWAL_CONFIRMED',
        id: 'w-1',
        owner: '0x1111111111111111111111111111111111111111',
      },
      {
        t: 'WITHDRAWAL_FAILED',
        id: 'w-1',
        owner: '0x1111111111111111111111111111111111111111',
        reason: 'INSUFFICIENT_FUNDS',
      },
      {
        t: 'FEE_BOOKED',
        opId: 'w-1',
        token: '0x0000000000000000000000000000000000000000',
        feeAmount: 63000000000000n,
      },
    ];

    for (const evt of allEvents) {
      await journal.append(evt);
    }
    await journal.close();

    const reopened = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    const replayed = await collectEntries(reopened);

    expect(replayed).toHaveLength(15);
    for (let i = 0; i < 15; i++) {
      expect(replayed[i]!.sequence).toBe(i + 1);
      expect(replayed[i]!.event).toEqual(allEvents[i]);
    }
    await reopened.close();
  });

  it('13. correctly reconstructs state after closing and reopening multiple times', async () => {
    let journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();

    journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    expect(journal.sequence()).toBe(1);
    await journal.append(sampleEvent2);
    await journal.close();

    journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    expect(journal.sequence()).toBe(2);
    const entries = await collectEntries(journal);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.sequence).toBe(1);
    expect(entries[1]!.sequence).toBe(2);
    await journal.close();
  });

  it.each([
    Buffer.from([0x00, 0x00]),
    Buffer.from([0x00, 0x00, 0x01, 0x00, 0xaa, 0xbb]),
  ])('preserves an incomplete tail and refuses startup', async (tail) => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();
    await fs.appendFile(journalPath, tail);
    const damaged = await fs.readFile(journalPath);
    await expect(EncryptedJournal.open({ filePath: journalPath, key: testKey }))
      .rejects.toThrow(/JOURNAL_CORRUPT: incomplete/);
    expect(await fs.readFile(journalPath)).toEqual(damaged);
  });

  it('15. rejects corrupted authentication tag with fatal error', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();

    const data = await fs.readFile(journalPath);
    // Tamper with the last byte (part of the 16-byte authTag)
    data[data.length - 1] = data[data.length - 1]! ^ 0xff;
    await fs.writeFile(journalPath, data);

    const broken = new EncryptedJournal({ filePath: journalPath, key: testKey });
    await expect(collectEntries(broken)).rejects.toThrow(/authentication tag verification failed/);
  });

  it('16. rejects mid-file ciphertext corruption with fatal error without truncating', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.append(sampleEvent2);
    await journal.append({
      t: 'NONCE_USED',
      owner: '0x1111111111111111111111111111111111111111',
      nonce: 3n,
    });
    await journal.close();

    const data = await fs.readFile(journalPath);
    // Tamper with ciphertext byte in middle record
    const midPoint = Math.floor(data.length / 2);
    data[midPoint] = data[midPoint]! ^ 0xff;
    await fs.writeFile(journalPath, data);

    const broken = new EncryptedJournal({ filePath: journalPath, key: testKey });
    await expect(collectEntries(broken)).rejects.toThrow(/JOURNAL_CORRUPT/);
    expect(await fs.readFile(journalPath)).toEqual(data);
  });

  it('17. rejects sequence-gap injection with fatal error', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();

    // Manually append entry with sequence 3 directly after sequence 1
    const rawFile = await fs.readFile(journalPath);
    const fakeEntry: JournalEntry = {
      sequence: 3,
      timestamp: 1700000000,
      prevHash: journal.lastEntryHash(),
      event: sampleEvent2,
      entryHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    fakeEntry.entryHash = computeEntryHash(
      fakeEntry.sequence,
      fakeEntry.timestamp,
      fakeEntry.prevHash,
      fakeEntry.event
    );

    const plaintext = Buffer.from(canonicalJson(fakeEntry), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const frame = Buffer.alloc(4 + 12 + ciphertext.length + 16);
    frame.writeUInt32BE(ciphertext.length, 0);
    iv.copy(frame, 4);
    ciphertext.copy(frame, 16);
    authTag.copy(frame, 16 + ciphertext.length);

    await fs.writeFile(journalPath, Buffer.concat([rawFile, frame]));

    const broken = new EncryptedJournal({ filePath: journalPath, key: testKey });
    await expect(collectEntries(broken)).rejects.toThrow(/sequence gap/);
  });

  it('18. rejects broken previous-hash chain with fatal error', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();

    const rawFile = await fs.readFile(journalPath);
    const fakeEntry: JournalEntry = {
      sequence: 2,
      timestamp: 1700000000,
      prevHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
      event: sampleEvent2,
      entryHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    };
    fakeEntry.entryHash = computeEntryHash(
      fakeEntry.sequence,
      fakeEntry.timestamp,
      fakeEntry.prevHash,
      fakeEntry.event
    );

    const plaintext = Buffer.from(canonicalJson(fakeEntry), 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const frame = Buffer.alloc(4 + 12 + ciphertext.length + 16);
    frame.writeUInt32BE(ciphertext.length, 0);
    iv.copy(frame, 4);
    ciphertext.copy(frame, 16);
    authTag.copy(frame, 16 + ciphertext.length);

    await fs.writeFile(journalPath, Buffer.concat([rawFile, frame]));

    const broken = new EncryptedJournal({ filePath: journalPath, key: testKey });
    await expect(collectEntries(broken)).rejects.toThrow(/broken hash chain/);
  });

  it('19. rejects malformed payload JSON with fatal error', async () => {
    const invalidJson = Buffer.from('this is not valid json at all {', 'utf8');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', testKey, iv);
    const ciphertext = Buffer.concat([cipher.update(invalidJson), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const frame = Buffer.alloc(4 + 12 + ciphertext.length + 16);
    frame.writeUInt32BE(ciphertext.length, 0);
    iv.copy(frame, 4);
    ciphertext.copy(frame, 16);
    authTag.copy(frame, 16 + ciphertext.length);

    await fs.writeFile(journalPath, frame);

    const broken = new EncryptedJournal({ filePath: journalPath, key: testKey });
    await expect(collectEntries(broken)).rejects.toThrow(/malformed payload/);
  });

  it('rejects oversized records before writing and on reopening', async () => {
    const smallJournal = await EncryptedJournal.open({ filePath: journalPath, key: testKey, maxRecordBytes: 50 });
    await expect(smallJournal.append(sampleEvent1)).rejects.toThrow('JOURNAL_RECORD_TOO_LARGE');
    expect((await fs.stat(journalPath)).size).toBe(0);
    await smallJournal.close();
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.close();
    await expect(EncryptedJournal.open({ filePath: journalPath, key: testKey, maxRecordBytes: 50 }))
      .rejects.toThrow(/exceeds maximum allowed size/);
  });

  it('21. immediately rejects append calls after close', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.close();

    await expect(journal.append(sampleEvent1)).rejects.toThrow(/cannot append to closed journal/);
  });

  it('22. supports safe and idempotent close calls', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);

    await journal.close();
    await journal.close();
    await journal.close();
    expect(true).toBe(true);
  });

  it('completes short writes before acknowledging and survives reopening', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    const write = handle.write.bind(handle);
    const writes = vi.spyOn(handle, 'write').mockImplementation(((buffer: Buffer, offset: number, length: number, position: number) =>
      write(buffer, offset, Math.min(7, length), position)) as typeof handle.write);
    await journal.append(sampleEvent2);
    expect(writes.mock.calls.length).toBeGreaterThan(1);
    await journal.close();
    const reopened = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    expect((await collectEntries(reopened)).map(({ event }) => event)).toEqual([sampleEvent1, sampleEvent2]);
    await reopened.close();
  });

  it('rejects zero-byte writes without acknowledging or losing earlier records', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    vi.spyOn(handle, 'write').mockResolvedValueOnce({ bytesWritten: 0, buffer: Buffer.alloc(0) });
    await expect(journal.append(sampleEvent2)).rejects.toThrow('JOURNAL_WRITE_FAILED');
    expect(journal.sequence()).toBe(1);
    await journal.append(sampleEvent2);
    await journal.close();
    const reopened = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    expect((await collectEntries(reopened)).map(({ event }) => event)).toEqual([sampleEvent1, sampleEvent2]);
    await reopened.close();
  });

  it('rolls back a partial failed append before admitting another write', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    const original = await fs.readFile(journalPath);
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    const write = handle.write.bind(handle);
    vi.spyOn(handle, 'write')
      .mockImplementationOnce(((buffer: Buffer, offset: number, length: number, position: number) =>
        write(buffer, offset, 7, position)) as typeof handle.write)
      .mockRejectedValueOnce(new Error('DISK_FULL'));
    await expect(journal.append(sampleEvent2)).rejects.toThrow('DISK_FULL');
    expect(await fs.readFile(journalPath)).toEqual(original);
    expect(journal.sequence()).toBe(1);
    await journal.append(sampleEvent2);
    expect((await collectEntries(journal)).map(({ event }) => event)).toEqual([sampleEvent1, sampleEvent2]);
    await journal.close();
  });

  it.each(['truncate', 'sync'] as const)('refuses further operations after rollback %s fails', async (failure) => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    vi.spyOn(handle, 'write').mockRejectedValueOnce(new Error('WRITE_FAILED'));
    vi.spyOn(handle, failure).mockRejectedValueOnce(new Error('ROLLBACK_FAILED'));
    await expect(journal.append(sampleEvent2)).rejects.toThrow('WRITE_FAILED');
    await expect(journal.append(sampleEvent2)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await expect(collectEntries(journal)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await journal.close();
  });

  it('does not acknowledge a failed fsync', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    const original = await fs.readFile(journalPath);
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('SYNC_FAILED'));
    await expect(journal.append(sampleEvent2)).rejects.toThrow('SYNC_FAILED');
    expect(journal.sequence()).toBe(1);
    expect(await fs.readFile(journalPath)).toEqual(original);
    await journal.close();
    const reopened = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    expect((await collectEntries(reopened)).map(({ event }) => event)).toEqual([sampleEvent1]);
    await reopened.close();
  });

  it('reads complete records despite short reads', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.append(sampleEvent2);
    const handle = (journal as unknown as { fileHandle: fs.FileHandle }).fileHandle;
    const read = handle.read.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(((buffer: Buffer, offset: number, length: number, position: number) =>
      read(buffer, offset, Math.min(length, 7), position)) as typeof handle.read);
    expect((await collectEntries(journal)).map(({ event }) => event)).toEqual([sampleEvent1, sampleEvent2]);
    await journal.close();
  });

  it.each([0, 1024 * 1024, 0xffffffff])('rejects a corrupt length %i without truncating on replay or restart', async (length) => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await journal.append(sampleEvent2);
    await journal.append({ ...sampleEvent1, nonce: 3n });
    const damaged = await fs.readFile(journalPath);
    const secondOffset = 4 + 12 + damaged.readUInt32BE(0) + 16;
    damaged.writeUInt32BE(length, secondOffset);
    await fs.writeFile(journalPath, damaged);
    await expect(collectEntries(journal)).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(journal.append(sampleEvent2)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await journal.close();
    await expect(EncryptedJournal.open({ filePath: journalPath, key: testKey })).rejects.toThrow('JOURNAL_CORRUPT');
    expect(await fs.readFile(journalPath)).toEqual(damaged);
  });

  it('refuses replay and append if the open file is truncated', async () => {
    const journal = await EncryptedJournal.open({ filePath: journalPath, key: testKey });
    await journal.append(sampleEvent1);
    await fs.truncate(journalPath, 0);
    await expect(collectEntries(journal)).rejects.toThrow('JOURNAL_CORRUPT');
    await expect(journal.append(sampleEvent2)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await journal.close();
  });

});
