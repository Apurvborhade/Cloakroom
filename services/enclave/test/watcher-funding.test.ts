import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NATIVE, type CustodyEOA, type JournalEvent } from '@cloakroom/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPublicClient, createTestClient, getAddress, http, parseEther, publicActions, walletActions,
  type Address, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Inventory } from '../src/inventory.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import { DepositWatcher, type WatcherJournal, type WatcherLedger } from '../src/watcher.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from './fixtures/test-token.js';

const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0 }) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions).extend(walletActions);
const reserve = parseEther('0.001');
const fresh = () => privateKeyToAddress(generatePrivateKey());
let process: ChildProcess;
let directory: string;
let sender: Address;
let token: Address;
const journals: EncryptedJournal[] = [];

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cloakroom-funding-'));
  process = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  await vi.waitFor(() => chain.getBlockNumber(), { timeout: 10_000, interval: 100 });
  [sender] = (await anvil.getAddresses()) as [Address];
  const hash = await anvil.deployContract({ account: sender, chain: foundry,
    abi: TEST_TOKEN_ABI, bytecode: TEST_TOKEN_BYTECODE });
  token = getAddress((await chain.waitForTransactionReceipt({ hash })).contractAddress!);
});
afterEach(async () => { for (const journal of journals.splice(0)) await journal.close(); });
afterAll(() => { process?.kill(); rmSync(directory, { recursive: true, force: true }); });

async function send(eoa: Address, native: bigint, amount = 0n) {
  if (native > 0n) {
    const hash = await anvil.sendTransaction({ account: sender, chain: foundry, to: eoa, value: native });
    await chain.waitForTransactionReceipt({ hash });
  }
  if (amount > 0n) {
    const hash = await anvil.writeContract({ account: sender, chain: foundry, address: token,
      abi: TEST_TOKEN_ABI, functionName: 'mint', args: [eoa, amount] });
    await chain.waitForTransactionReceipt({ hash });
  }
}

function setup() {
  const journal = new EncryptedJournal({ filePath: join(directory, `${Math.random()}.journal`), key: randomBytes(32) });
  journals.push(journal);
  const owner = fresh();
  const eoa = fresh();
  const eoas: CustodyEOA[] = [{ index: 0, address: eoa, role: 'deposit', lastUsedAt: 0 }];
  const inventory = new Inventory({ chain, keys: { list: () => eoas }, tokens: [token], gasReserveWei: reserve });
  const ledger = new InMemoryLedger();
  const makeWatcher = (target: WatcherLedger = ledger, log: WatcherJournal = journal, confirmations = 0n) =>
    new DepositWatcher({ chain, ledger: target, journal: log, queue: new FifoSerialQueue(), confirmations,
      onSessionClosed: (address) => inventory.markInventory(address) });
  const watcher = makeWatcher();
  const open = async (asset = token) => {
    const expiry = Number((await chain.getBlock()).timestamp) + 60;
    inventory.linkDeposit(owner, eoa);
    return watcher.openSession({ id: 's', owner, eoa, expiry, funding: { asset, gasReserveWei: reserve } });
  };
  const events = async () => {
    const result: JournalEvent[] = [];
    for await (const { event } of journal.replay()) result.push(event);
    return result;
  };
  return { journal, owner, eoa, inventory, ledger, watcher, makeWatcher, open, events };
}

describe('single-use deposits', () => {
  it.each(['ETH first', 'USDC first'])('credits both assets and frees the address immediately: %s', async (order) => {
    const c = setup();
    await c.open();
    if (order === 'ETH first') await send(c.eoa, reserve + 123n);
    else await send(c.eoa, 0n, 10_000_000n);
    await c.watcher.tick();
    expect(c.ledger.balances(c.owner)).toEqual([]);
    await c.inventory.refresh();
    expect(c.inventory.pick(token, 1n, new Set())).toBeNull();
    expect(c.watcher.listByOwner(c.owner)[0]?.status).toBe(order === 'ETH first' ? 'awaiting_token' : 'awaiting_gas');

    if (order === 'ETH first') await send(c.eoa, 0n, 10_000_000n);
    else await send(c.eoa, reserve + 123n);
    await Promise.all([c.watcher.tick(), c.watcher.tick()]);
    expect(c.ledger.getBalance(c.owner, NATIVE).available).toBe(123n);
    expect(c.ledger.getBalance(c.owner, token).available).toBe(10_000_000n);
    expect(c.watcher.getSession('s')?.open).toBe(false);
    expect(await c.inventory.getPhysicalBalances()).toEqual(new Map([[NATIVE, 123n], [token, 10_000_000n]]));
    expect(c.inventory.pick(token, 10_000_000n, new Set())?.address).toBe(c.eoa);
    expect(c.inventory.pick(token, 1n, c.inventory.depositEoasOf(c.owner))).toBeNull();
    expect((await c.events()).map((event) => event.t)).toEqual(['DEPOSIT_SESSION_OPENED', 'DEPOSIT_COMPLETED']);
    const rebuilt = await replayLedger(c.journal);
    expect(rebuilt.balances(c.owner)).toEqual(c.ledger.balances(c.owner));
  });

  it('keeps an underfunded USDC pair pending across expiry and restart until ETH arrives', async () => {
    const c = setup();
    await c.open();
    await send(c.eoa, reserve / 2n, 10_000_000n);
    await c.watcher.tick();
    await anvil.increaseTime({ seconds: 120 });
    await anvil.mine({ blocks: 1 });
    const ledger = await replayLedger(c.journal);
    const restarted = c.makeWatcher(ledger);
    for (const event of await c.events()) restarted.replay(event);
    await restarted.tick();
    expect(restarted.listByOwner(c.owner)[0]?.status).toBe('awaiting_gas');
    expect(ledger.balances(c.owner)).toEqual([]);
    await send(c.eoa, reserve / 2n);
    await restarted.tick();
    expect(ledger.getBalance(c.owner, token).available).toBe(10_000_000n);
    expect(ledger.getBalance(c.owner, NATIVE).available).toBe(0n);
  });

  it('waits for a positive native deposit beyond the gas reserve', async () => {
    const c = setup();
    await c.open(NATIVE);
    await send(c.eoa, reserve);
    await c.watcher.tick();
    expect(c.watcher.listByOwner(c.owner)[0]?.status).toBe('awaiting_gas');
    await send(c.eoa, 99n);
    await c.watcher.tick();
    expect(c.ledger.getBalance(c.owner, NATIVE).available).toBe(99n);
    expect(c.watcher.getSession('s')?.open).toBe(false);
  });

  it('never credits later inventory receipts after completion, including after replay', async () => {
    const c = setup();
    await c.open();
    await send(c.eoa, reserve, 1_000_000n);
    await c.watcher.tick();
    const ledger = await replayLedger(c.journal);
    const restarted = c.makeWatcher(ledger);
    for (const event of await c.events()) restarted.replay(event);
    await send(c.eoa, reserve, 50_000_000n);
    await restarted.tick();
    expect(ledger.getBalance(c.owner, token).available).toBe(1_000_000n);
    expect(ledger.getBalance(c.owner, NATIVE).available).toBe(0n);
  });

  it('expires an empty session and refuses deposits first made after expiry', async () => {
    const c = setup();
    await c.open();
    await anvil.increaseTime({ seconds: 120 });
    await send(c.eoa, reserve, 1_000_000n);
    await c.watcher.tick();
    expect(c.watcher.listByOwner(c.owner)[0]?.status).toBe('expired');
    expect(c.ledger.balances(c.owner)).toEqual([]);
  });

  it('subtracts both baselines and does not treat pre-existing funds as a deposit', async () => {
    const c = setup();
    await send(c.eoa, reserve, 2_000_000n);
    await c.open();
    await anvil.mine({ blocks: 1 });
    await c.watcher.tick();
    expect(c.ledger.balances(c.owner)).toEqual([]);
    await send(c.eoa, reserve + 2n, 1_000_000n);
    await c.watcher.tick();
    expect(c.ledger.getBalance(c.owner, token).available).toBe(1_000_000n);
    expect(c.ledger.getBalance(c.owner, NATIVE).available).toBe(2n);
  });

  it('recovers both credits and the closed address from a crash after the single journal write', async () => {
    const c = setup();
    await c.open();
    const crashing = c.makeWatcher({ credit: () => { throw new Error('crash'); } });
    for (const event of await c.events()) crashing.replay(event);
    await send(c.eoa, reserve + 1n, 10_000_000n);
    await expect(crashing.tick()).rejects.toThrow('crash');
    const ledger = await replayLedger(c.journal);
    const restarted = c.makeWatcher(ledger);
    for (const event of await c.events()) {
      restarted.replay(event);
      c.inventory.replay(event);
    }
    await restarted.tick();
    expect(ledger.getBalance(c.owner, NATIVE).available).toBe(1n);
    expect(ledger.getBalance(c.owner, token).available).toBe(10_000_000n);
    await c.inventory.refresh();
    expect(c.inventory.pick(token, 1n, new Set())?.address).toBe(c.eoa);
    expect((await c.events()).filter((event) => event.t === 'DEPOSIT_COMPLETED')).toHaveLength(1);
  });

  it('does not credit or free the EOA when the journal write fails; retries without duplication', async () => {
    const c = setup();
    await c.open();
    let fail = true;
    const watcher = c.makeWatcher(c.ledger, { append: async (event) => {
      if (fail) throw new Error('disk full');
      await c.journal.append(event);
    } });
    for (const event of await c.events()) watcher.replay(event);
    await send(c.eoa, reserve, 1_000_000n);
    await expect(watcher.tick()).rejects.toThrow('disk full');
    expect(c.ledger.balances(c.owner)).toEqual([]);
    await c.inventory.refresh();
    expect(c.inventory.pick(token, 1n, new Set())).toBeNull();
    fail = false;
    await watcher.tick();
    await watcher.tick();
    expect(c.ledger.getBalance(c.owner, token).available).toBe(1_000_000n);
  });

  it('waits for the configured confirmation depth for both transfers', async () => {
    const c = setup();
    await anvil.mine({ blocks: 2 });
    await c.open();
    const watcher = c.makeWatcher(c.ledger, c.journal, 2n);
    for (const event of await c.events()) watcher.replay(event);
    await send(c.eoa, reserve, 1_000_000n);
    await watcher.tick();
    expect(c.ledger.balances(c.owner)).toEqual([]);
    await anvil.mine({ blocks: 1 });
    await watcher.tick();
    expect(c.ledger.balances(c.owner)).toEqual([]);
    await anvil.mine({ blocks: 1 });
    await watcher.tick();
    expect(c.ledger.getBalance(c.owner, token).available).toBe(1_000_000n);
  });

  it('rejects replay credits bound to a different asset, owner or gas reserve', async () => {
    const c = setup();
    await c.open();
    await send(c.eoa, reserve + 1n, 1_000_000n);
    await c.watcher.tick();
    const [opened, completed] = await c.events();
    if (completed?.t !== 'DEPOSIT_COMPLETED') throw new Error('missing completion');
    for (const patch of [{ asset: fresh() }, { owner: fresh() }, { gasReserveWei: reserve + 1n }]) {
      const ledger = new InMemoryLedger();
      ledger.apply(opened!);
      expect(() => ledger.apply({ ...completed, ...patch })).toThrow('does not match session');
      expect(ledger.balances(c.owner)).toEqual([]);
    }
    const ledger = await replayLedger(c.journal);
    ledger.apply(completed);
    expect(ledger.getBalance(c.owner, token).available).toBe(1_000_000n);
    expect(ledger.getBalance(c.owner, NATIVE).available).toBe(1n);
  });
});
