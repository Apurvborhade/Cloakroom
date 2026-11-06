import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent } from '@cloakroom/shared';
import { keccak256, recoverTransactionAddress } from 'viem';
import type { TransactionSerializableEIP1559, TransactionSerializedEIP1559 } from 'viem';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import { AesGcmStateVault, RemoteCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';

const ID = 'ab'.repeat(32);
const OWNER = '0x1111111111111111111111111111111111111111';
const TO = '0x2222222222222222222222222222222222222222';
const POLICY = { chainId: 11155111, maxGas: 200_000n, maxFeePerGas: 100_000_000_000n,
  maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: 10n ** 18n };
const TX: TransactionSerializableEIP1559 = { type: 'eip1559', chainId: POLICY.chainId,
  nonce: 0, to: TO, value: 10n, data: '0x', gas: 21_000n,
  maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
const DEPOSIT: JournalEvent = { t: 'DEPOSIT_CREDITED', id: 'funding', owner: OWNER, amount: 100n, block: 1n };
const processes: ChildProcess[] = [], directories: string[] = [], proxies: Server[] = [];
const runtimes: Awaited<ReturnType<typeof openCustodyRuntime>>[] = [];

async function stop(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  }
}
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  await Promise.all(proxies.splice(0).map(async (server) => {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
  await Promise.all(processes.splice(0).map(stop));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-runtime-')); directories.push(directory);
  let generation = 0;
  async function start() {
    const socketPath = join(directory, `storage-${generation++}.sock`);
    const child = spawn('python3', [fileURLToPath(new URL('../nitro/storage.py', import.meta.url)),
      '--directory', directory, '--unix-socket', socketPath], { stdio: 'ignore' });
    processes.push(child);
    for (let attempt = 0; attempt < 200; attempt++) {
      if (child.exitCode !== null) throw new Error('storage helper exited');
      try { await stat(socketPath); return { child, socketPath }; }
      catch { await new Promise((done) => setTimeout(done, 10)); }
    }
    throw new Error('storage helper startup timed out');
  }
  return { directory, start, ...await start() };
}

async function boot(socketPath: string, allowCreate = false, quote = vi.fn(async () => Buffer.from('test-quote'))) {
  const runtime = await openCustodyRuntime({
    vault: new AesGcmStateVault(new RemoteCipherBlobStore(socketPath, ID, 'custody'), simulationSealingKey('cd'.repeat(32), true), true),
    journalStore: new RemoteCipherBlobStore(socketPath, ID, 'journal'),
    policy: POLICY, buildHash: 'ef'.repeat(32), simMode: true, allowCreate, quote,
  });
  runtimes.push(runtime);
  return runtime;
}

async function prepare(socketPath: string) {
  const runtime = await boot(socketPath, true);
  const eoa = await runtime.keys.allocate('inventory');
  await append(runtime, DEPOSIT);
  await append(runtime, { t: 'WITHDRAWAL_LOCKED', id: 'payout', owner: OWNER, token: NATIVE, amount: 10n, to: TO });
  await runtime.keys.registerOp('payout', { eoa: eoa.address, to: TO, value: 10n, dataHash: keccak256('0x') });
  return { runtime, eoa };
}

async function append(runtime: Awaited<ReturnType<typeof boot>>, event: JournalEvent) {
  const entry = await runtime.journal.append(event);
  runtime.ledger.apply(entry.event);
}

async function lossyProxy(directory: string, upstreamSocket: string) {
  let drop: 'journal' | 'custody' | undefined;
  let dropped = 0;
  const socketPath = join(directory, 'proxy.sock');
  const server = createServer((incoming, outgoing) => {
    const upstream = request({ socketPath: upstreamSocket, path: incoming.url, method: incoming.method,
      headers: incoming.headers, agent: false }, (response) => {
      if (drop && incoming.method === 'POST' && incoming.url?.endsWith(`/${drop}`) && response.statusCode === 200) {
        drop = undefined; dropped++;
        response.resume();
        response.on('end', () => outgoing.destroy());
      } else {
        outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
      }
      response.on('error', () => outgoing.destroy());
    });
    upstream.on('error', () => outgoing.destroy());
    incoming.pipe(upstream);
  });
  proxies.push(server);
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return { socketPath, dropNext(name: 'journal' | 'custody') { drop = name; }, dropped: () => dropped };
}

describe('custody runtime with parent storage', () => {
  it('restores identity, balances and cached signatures after the storage process is killed', async () => {
    const parent = await setup();
    const { runtime: first, eoa } = await prepare(parent.socketPath);
    const raw = await first.keys.sign(eoa.address, TX, 'payout');
    const identity = first.keys.transportPublicKey(), allocations = first.keys.list();
    expect((await first.attestation.response()).enclavePubKey).toBe(identity);
    const encrypted = await readFile(join(parent.directory, ID, 'journal.blob'));
    expect(encrypted.includes(Buffer.from(OWNER))).toBe(false);
    expect(encrypted.includes(Buffer.from('WITHDRAWAL_LOCKED'))).toBe(false);
    await stop(parent.child); await first.close();

    const next = await parent.start();
    const quote = vi.fn(async () => Buffer.from('test-quote'));
    const second = await boot(next.socketPath, false, quote);
    expect(quote).toHaveBeenCalledTimes(1);
    expect(quote).toHaveBeenCalledWith(expect.objectContaining({ publicKey: Buffer.from(identity.slice(2), 'hex') }));
    expect(second.keys.transportPublicKey()).toBe(identity);
    expect(second.keys.list()).toEqual(allocations);
    expect(second.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 10n });
    expect(await second.keys.recoverSigned('payout')).toBe(raw);
    await expect(second.keys.sign(eoa.address, TX, 'payout')).rejects.toThrow('SIGNING_DENIED');
    await append(second, { t: 'WITHDRAWAL_BROADCAST', id: 'payout', eoa: eoa.address, nonce: 0, txHash: keccak256(raw), raw });
    await append(second, { t: 'WITHDRAWAL_CONFIRMED', id: 'payout', owner: OWNER });
    await second.close();
    await stop(next.child);
    const third = await boot((await parent.start()).socketPath);
    expect(third.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 0n });
    await expect(third.keys.recoverSigned('payout')).rejects.toThrow('SIGNING_DENIED');
  });

  it('stops on disconnection before a write and restarts with the previous balance', async () => {
    const parent = await setup();
    const first = await boot(parent.socketPath, true);
    await append(first, DEPOSIT);
    await stop(parent.child);
    await expect(append(first, { ...DEPOSIT, id: 'never-committed' })).rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(first.ledger.getBalance(OWNER, NATIVE).available).toBe(100n);
    expect(() => first.keys.transportPublicKey()).toThrow('KEY_MANAGER_UNAVAILABLE');
    await expect(first.attestation.response()).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    const second = await boot((await parent.start()).socketPath);
    expect(second.ledger.getBalance(OWNER, NATIVE).available).toBe(100n);
  });

  it.each(['journal', 'custody'] as const)('recovers signing after losing the %s write response on the socket', async (blob) => {
    const parent = await setup();
    const proxy = await lossyProxy(parent.directory, parent.socketPath);
    const { runtime: first, eoa } = await prepare(proxy.socketPath);
    proxy.dropNext(blob);
    await expect(first.keys.sign(eoa.address, TX, 'payout')).rejects.toThrow(
      blob === 'journal' ? 'JOURNAL_UNAVAILABLE' : 'KEY_MANAGER_UNAVAILABLE');
    expect(proxy.dropped()).toBe(1);
    await expect(first.journal.append(DEPOSIT)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await expect(first.keys.sign(eoa.address, TX, 'payout')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    await first.close();
    await stop(parent.child);

    const second = await boot((await parent.start()).socketPath);
    const raw = await second.keys.recoverSigned('payout');
    expect(raw).toBeDefined();
    expect(raw).toMatch(/^0x02/);
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerializedEIP1559 })).toBe(eoa.address);
    expect(await second.keys.recoverSigned('payout')).toBe(raw);
    await expect(second.keys.sign(eoa.address, TX, 'payout')).rejects.toThrow('SIGNING_DENIED');
    expect(second.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 90n, reserved: 10n });
    const events = [];
    for await (const { event } of second.journal.replay()) events.push(event);
    expect(events.filter((event) => event.t === 'SIGNING_COMPLETED')).toHaveLength(blob === 'journal' ? 1 : 0);
  });

  it.each(['custody', 'journal'] as const)('refuses a missing %s file even with creation enabled', async (blob) => {
    const parent = await setup();
    const first = await boot(parent.socketPath, true); await first.close();
    const survivor = join(parent.directory, ID, `${blob === 'journal' ? 'custody' : 'journal'}.blob`);
    const original = await readFile(survivor);
    const missing = join(parent.directory, ID, `${blob}.blob`);
    await rm(missing);
    await expect(boot(parent.socketPath, true)).rejects.toThrow('CUSTODY_STATE_MISSING');
    await expect(stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(survivor)).toEqual(original);
  });

  it.each(['custody', 'journal'] as const)('refuses a damaged %s file without repairing it', async (blob) => {
    const parent = await setup();
    const first = await boot(parent.socketPath, true); await first.close();
    const path = join(parent.directory, ID, `${blob}.blob`);
    const damaged = (await readFile(path)).subarray(0, -1);
    await writeFile(path, damaged);
    await expect(boot(parent.socketPath, true)).rejects.toThrow(blob === 'journal' ? 'JOURNAL_CORRUPT' : 'SEALED_STATE_UNAVAILABLE');
    expect(await readFile(path)).toEqual(damaged);
  });

  it('does not provision missing state during an ordinary restart', async () => {
    const parent = await setup();
    await expect(boot(parent.socketPath)).rejects.toThrow('CUSTODY_STATE_MISSING');
    expect((await readdir(join(parent.directory, ID))).filter((file) => file.endsWith('.blob'))).toEqual([]);
  });

  it('does not return a runtime when attestation fails', async () => {
    const parent = await setup();
    const first = await boot(parent.socketPath, true);
    const identity = first.keys.transportPublicKey(); await first.close();
    await expect(boot(parent.socketPath, false, vi.fn(async () => { throw new Error('NSM_UNAVAILABLE'); })))
      .rejects.toThrow('NSM_UNAVAILABLE');
    expect((await boot(parent.socketPath)).keys.transportPublicKey()).toBe(identity);
  });

  it.each(['ledger', 'signing'] as const)('refuses inconsistent %s replay before requesting attestation', async (component) => {
    const parent = await setup();
    const first = await boot(parent.socketPath, true);
    await first.journal.append(component === 'ledger'
      ? { t: 'WITHDRAWAL_LOCKED', id: 'unfunded', owner: OWNER, token: NATIVE, amount: 10n, to: TO }
      : { t: 'SIGNING_COMPLETED', opId: 'unknown', txHash: `0x${'ab'.repeat(32)}` });
    await first.close();
    const quote = vi.fn(async () => Buffer.from('test-quote'));
    await expect(boot(parent.socketPath, false, quote)).rejects.toThrow();
    expect(quote).not.toHaveBeenCalled();
  });
});
