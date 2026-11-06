import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE } from '@cloakroom/shared';
import type { Journal } from '@cloakroom/shared';
import { keccak256, recoverTransactionAddress } from 'viem';
import type { TransactionSerializableEIP1559 } from 'viem';
import { EncryptedJournal } from '../src/journal.js';
import { KeyManager } from '../src/keys.js';
import { replayLedger } from '../src/ledger.js';
import { AesGcmStateVault, FileCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const POLICY = { chainId: 11155111, maxGas: 200_000n, maxFeePerGas: 100_000_000_000n,
  maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: 10n ** 18n };
const TX: TransactionSerializableEIP1559 = { type: 'eip1559', chainId: POLICY.chainId,
  nonce: 0, to: TO, value: 10n, data: '0x', gas: 21_000n,
  maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };

describe.skipIf(process.platform !== 'linux')('custody journal recovery (Linux flock)', () => {
  let directory: string;
  const journals: EncryptedJournal[] = [];
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'cloakroom-custody-journal-')); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(journals.splice(0).map((journal) => journal.close()));
    await rm(directory, { recursive: true, force: true });
  });

  async function boot(allowCreate = false, stateName = 'custody.blob') {
    let opened: EncryptedJournal | undefined;
    const journal: Pick<Journal, 'append' | 'replay'> = {
      append(event) {
        if (!opened) throw new Error('JOURNAL_NOT_OPEN');
        return opened.append(event);
      },
      async *replay() {
        if (!opened) throw new Error('JOURNAL_NOT_OPEN');
        yield* opened.replay();
      },
    };
    const vault = new AesGcmStateVault(new FileCipherBlobStore(join(directory, stateName)),
      simulationSealingKey('ab'.repeat(32), true), true);
    const keys = new KeyManager({ vault, journal, policy: POLICY, simMode: true, allowCreate });
    await keys.init();
    opened = await EncryptedJournal.open({ filePath: join(directory, 'events.journal'), cipher: keys.journalCipher() });
    journals.push(opened);
    const ledger = await replayLedger(opened);
    await keys.restoreSigningState();
    return { keys, journal: opened, ledger };
  }

  async function prepare() {
    const runtime = await boot(true);
    const eoa = await runtime.keys.allocate('inventory');
    await runtime.journal.append({ t: 'DEPOSIT_CREDITED', id: 'funding', owner: OWNER, amount: 100n, block: 1n });
    await runtime.journal.append({ t: 'WITHDRAWAL_LOCKED', id: 'payout', owner: OWNER, token: NATIVE, amount: 10n, to: TO });
    await runtime.keys.registerOp('payout', { eoa: eoa.address, to: TO, value: 10n, dataHash: keccak256('0x') });
    return { ...runtime, eoa };
  }

  it('restores the same identity, balances and signed bytes from disk', async () => {
    const first = await prepare();
    const raw = await first.keys.sign(first.eoa.address, TX, 'payout');
    const identity = first.keys.transportPublicKey();
    const disk = await readFile(join(directory, 'events.journal'), 'utf8');
    expect(disk).not.toContain(OWNER);
    expect(disk).not.toContain('WITHDRAWAL_LOCKED');
    await first.journal.close();

    const second = await boot();
    expect(second.keys.transportPublicKey()).toBe(identity);
    expect(second.keys.list()).toEqual(first.keys.list());
    expect(second.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 10n });
    expect(await second.keys.recoverSigned('payout')).toBe(raw);
    await expect(second.keys.sign(first.eoa.address, TX, 'payout')).rejects.toThrow('SIGNING_DENIED');
    await second.journal.append({ t: 'WITHDRAWAL_BROADCAST', id: 'payout', eoa: first.eoa.address,
      nonce: 0, txHash: keccak256(raw), raw });
    await second.journal.append({ t: 'WITHDRAWAL_CONFIRMED', id: 'payout', owner: OWNER });
    await second.journal.close();

    const third = await boot();
    expect(third.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 0n });
    await expect(third.keys.recoverSigned('payout')).rejects.toThrow('SIGNING_DENIED');
  });

  it('recovers cached signing after the completion record fails to persist', async () => {
    const first = await prepare();
    const handle = (first.journal as unknown as { fileHandle: FileHandle }).fileHandle;
    vi.spyOn(handle, 'write').mockRejectedValueOnce(new Error('DISK_FULL'));
    await expect(first.keys.sign(first.eoa.address, TX, 'payout')).rejects.toThrow('DISK_FULL');
    await first.journal.close();

    const second = await boot();
    const raw = await second.keys.recoverSigned('payout');
    expect(raw).toBeDefined();
    expect(await recoverTransactionAddress({ serializedTransaction: raw! })).toBe(first.eoa.address);
    expect(second.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 10n });
    await expect(second.keys.sign(first.eoa.address, TX, 'payout')).rejects.toThrow('SIGNING_DENIED');
  });

  it('refuses a journal encrypted under a different custody seed without modifying it', async () => {
    const first = await prepare();
    await first.journal.close();
    const original = await readFile(join(directory, 'events.journal'));
    await expect(boot(true, 'other-custody.blob')).rejects.toThrow('JOURNAL_CORRUPT');
    expect(await readFile(join(directory, 'events.journal'))).toEqual(original);
    expect((await boot()).ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 10n });
  });
});
