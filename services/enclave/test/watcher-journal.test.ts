import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NATIVE, type CustodyEOA, type JournalEvent } from '@cloakroom/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  http,
  parseEther,
  publicActions,
  walletActions,
  type Address,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Inventory } from '../src/inventory.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import { DepositWatcher, type WatcherLedger } from '../src/watcher.js';

const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0 }) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions)
  .extend(walletActions);

let anvilProcess: ChildProcess;
let directory: string;
let sender: Address;
const journals: EncryptedJournal[] = [];

const freshAddress = () => privateKeyToAddress(generatePrivateKey());

function openJournal(key = randomBytes(32), filePath = join(directory, `${Math.random()}.journal`)) {
  const journal = new EncryptedJournal({ filePath, key });
  journals.push(journal);
  return { journal, key, filePath };
}

function newWatcher(journal: EncryptedJournal, ledger: WatcherLedger, onClosed?: (eoa: Address) => void) {
  return new DepositWatcher({
    chain,
    journal,
    ledger,
    queue: new FifoSerialQueue(),
    confirmations: 2n,
    onSessionClosed: onClosed,
  });
}

async function send(to: Address, value: bigint): Promise<void> {
  const hash = await anvil.sendTransaction({ account: sender, to, value, chain: foundry });
  await anvil.waitForTransactionReceipt({ hash });
  await anvil.mine({ blocks: 2 });
}

async function now(): Promise<number> {
  return Number((await chain.getBlock()).timestamp);
}

async function replayInto(target: { replay(event: JournalEvent): void }, journal: EncryptedJournal) {
  for await (const { event } of journal.replay()) target.replay(event);
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cloakroom-watcher-'));
  anvilProcess = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chain.getBlockNumber();
      [sender] = (await anvil.getAddresses()) as [Address];
      await anvil.mine({ blocks: 3 });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('anvil did not start');
}, 15_000);

afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
});

afterAll(() => {
  anvilProcess?.kill();
  rmSync(directory, { recursive: true, force: true });
});

describe('DepositWatcher with the real journal, ledger and queue', () => {
  it('credits the ledger, and the journal rebuilds the same balance', async () => {
    const { journal } = openJournal();
    const ledger = new InMemoryLedger();
    const watcher = newWatcher(journal, ledger);
    const owner = freshAddress();
    const eoa = freshAddress();

    await watcher.openSession({ id: 's1', owner, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await watcher.tick();

    expect(ledger.getBalance(owner, NATIVE).available).toBe(parseEther('1'));
    const rebuilt = await replayLedger(journal);
    expect(rebuilt.getBalance(owner, NATIVE).available).toBe(parseEther('1'));
  });

  it('does not credit twice after a restart, then credits only new deposits', async () => {
    const opened = openJournal();
    const owner = freshAddress();
    const eoa = freshAddress();
    const first = newWatcher(opened.journal, new InMemoryLedger());
    await first.openSession({ id: 's1', owner, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await first.tick();
    await opened.journal.close();

    const reopened = openJournal(opened.key, opened.filePath);
    const ledger = await replayLedger(reopened.journal);
    const restarted = newWatcher(reopened.journal, ledger);
    await replayInto(restarted, reopened.journal);

    await anvil.mine({ blocks: 3 });
    await restarted.tick();
    expect(ledger.getBalance(owner, NATIVE).available).toBe(parseEther('1'));

    await send(eoa, parseEther('0.25'));
    await restarted.tick();
    expect(ledger.getBalance(owner, NATIVE).available).toBe(parseEther('1.25'));
    expect((await replayLedger(reopened.journal)).getBalance(owner, NATIVE).available).toBe(
      parseEther('1.25'),
    );
  });

  it('loses no credit if the process dies between the journal write and the ledger', async () => {
    const { journal } = openJournal();
    const owner = freshAddress();
    const eoa = freshAddress();
    const crashing: WatcherLedger = {
      credit: () => {
        throw new Error('crashed');
      },
    };
    const watcher = newWatcher(journal, crashing);
    await watcher.openSession({ id: 's1', owner, eoa, expiry: (await now()) + 3600 });
    await send(eoa, parseEther('1'));
    await expect(watcher.tick()).rejects.toThrow('crashed');

    const rebuilt = await replayLedger(journal);
    expect(rebuilt.getBalance(owner, NATIVE).available).toBe(parseEther('1'));

    const restarted = newWatcher(journal, rebuilt);
    await replayInto(restarted, journal);
    await restarted.tick();
    expect(rebuilt.getBalance(owner, NATIVE).available).toBe(parseEther('1'));
  });

  it('rebuilds a closed session, so a later transfer is not credited', async () => {
    const { journal } = openJournal();
    const owner = freshAddress();
    const eoa = freshAddress();
    const first = newWatcher(journal, new InMemoryLedger());
    await first.openSession({ id: 's1', owner, eoa, expiry: (await now()) + 60 });
    await anvil.increaseTime({ seconds: 120 });
    await anvil.mine({ blocks: 3 });
    await first.tick();
    expect(first.getSession('s1')?.open).toBe(false);

    const ledger = await replayLedger(journal);
    const restarted = newWatcher(journal, ledger);
    await replayInto(restarted, journal);
    expect(restarted.getSession('s1')?.open).toBe(false);

    await send(eoa, parseEther('1'));
    await restarted.tick();
    expect(ledger.getBalance(owner, NATIVE).available).toBe(0n);
  });

  it('lets inventory rebuild from the same journal', async () => {
    const { journal } = openJournal();
    const owner = freshAddress();
    const eoa = freshAddress();
    const eoas: CustodyEOA[] = [{ index: 0, address: eoa, role: 'deposit', lastUsedAt: 0 }];
    const watcher = newWatcher(journal, new InMemoryLedger());
    await watcher.openSession({ id: 's1', owner, eoa, expiry: (await now()) + 60 });
    await send(eoa, parseEther('1'));
    await watcher.tick();
    await anvil.increaseTime({ seconds: 120 });
    await anvil.mine({ blocks: 3 });
    await watcher.tick();

    const inventory = new Inventory({
      chain,
      keys: { list: () => eoas },
      tokens: [],
      gasReserveWei: parseEther('0.01'),
    });
    await replayInto(inventory, journal);
    await inventory.refresh();

    expect(inventory.pick(NATIVE, 1n, new Set())?.address).toBe(eoa);
    expect([...inventory.eoasLinkedTo(owner)]).toEqual([eoa]);
  });

  it('refuses an opened session with no baseline instead of assuming zero', async () => {
    const { journal } = openJournal();
    const watcher = newWatcher(journal, new InMemoryLedger());
    const opened = {
      t: 'DEPOSIT_SESSION_OPENED',
      id: 's1',
      owner: freshAddress(),
      eoa: freshAddress(),
      expiry: 1,
    } as const;

    expect(() => watcher.replay(opened)).toThrow('MISSING_BASELINE');
    expect(() => watcher.replay({ ...opened, baseline: 0n })).toThrow('MISSING_BASELINE');
    expect(() => watcher.replay({ ...opened, baselineBlock: 1n })).toThrow('MISSING_BASELINE');
    expect(watcher.getSession('s1')).toBeUndefined();
  });

  it('accepts a zero baseline, which is a real value', async () => {
    const { journal } = openJournal();
    const watcher = newWatcher(journal, new InMemoryLedger());

    watcher.replay({
      t: 'DEPOSIT_SESSION_OPENED',
      id: 's1',
      owner: freshAddress(),
      eoa: freshAddress(),
      expiry: 1,
      baseline: 0n,
      baselineBlock: 0n,
    });

    expect(watcher.getSession('s1')?.baseline).toBe(0n);
  });

  it('ignores journal events that are not about deposits', async () => {
    const { journal } = openJournal();
    const watcher = newWatcher(journal, new InMemoryLedger());

    expect(() =>
      watcher.replay({ t: 'NONCE_USED', owner: freshAddress(), nonce: 1n }),
    ).not.toThrow();
  });

  it('still refuses a credit for a session it has never seen', async () => {
    const { journal } = openJournal();
    const watcher = newWatcher(journal, new InMemoryLedger());

    expect(() =>
      watcher.replay({ t: 'DEPOSIT_CREDITED', id: 'missing', amount: 1n, block: 1n }),
    ).toThrow('UNKNOWN_SESSION');
  });
});
