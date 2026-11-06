import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { AesGcmStateVault, RemoteCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { KeyManager } from '../src/keys.js';
import { memoryJournal } from './helpers/memory-journal.js';

const ID = 'ab'.repeat(32);
const processes: ChildProcess[] = [], directories: string[] = [];
afterEach(async () => {
  await Promise.all(processes.splice(0).map(async (child) => {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
  }));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-storage-test-')); directories.push(directory);
  let generation = 0;
  async function start() {
    const socketPath = join(directory, `storage-${generation++}.sock`);
    const child = spawn('python3', [fileURLToPath(new URL('../nitro/storage.py', import.meta.url)),
      '--directory', directory, '--unix-socket', socketPath], { stdio: 'ignore' });
    processes.push(child);
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error('storage helper exited');
      try { await stat(socketPath); break; }
      catch { await new Promise((done) => setTimeout(done, 10)); }
    }
    return { child, store: new RemoteCipherBlobStore(socketPath, ID, 'custody') };
  }
  return { directory, start, ...await start() };
}

describe('external ciphertext persistence', () => {
  it('restores custody addresses and transport identity after both manager and storage service restart', async () => {
    const { directory, start, child, store } = await setup();
    const provider = simulationSealingKey('cd'.repeat(32), true);
    const { journal } = memoryJournal();
    const options = { vault: new AesGcmStateVault(store, provider, true), journal, simMode: true, allowCreate: true,
      policy: { chainId: 1, maxGas: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, maxNativeValue: 1n } };
    const keys = new KeyManager(options); await keys.init();
    const eoa = await keys.allocate('inventory');
    const disclosed = await keys.claimSeedingAddresses();
    expect(disclosed).toEqual([eoa.address]);
    const ciphertext = await readFile(join(directory, ID, 'custody.blob'), 'utf8');
    expect(ciphertext).not.toContain(eoa.address);
    expect(ciphertext).not.toContain('allocations');
    expect((await stat(join(directory, ID, 'custody.blob'))).mode & 0o777).toBe(0o600);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const next = await start();
    const restarted = new KeyManager({ ...options, vault: new AesGcmStateVault(next.store, provider, true), allowCreate: false });
    await restarted.init();
    expect(restarted.list()).toEqual(keys.list());
    expect(restarted.transportPublicKey()).toBe(keys.transportPublicKey());
    await expect(restarted.claimSeedingAddresses()).rejects.toThrow('SEEDING_DISABLED');
  });

  it('rejects a stale writer and admits exactly one concurrent compare-and-swap', async () => {
    const { store } = await setup();
    expect(await store.read()).toBeUndefined();
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => store.compareAndSwap(null, Buffer.from(`ciphertext-${index}`))));
    expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((item) => item.status === 'rejected')).toHaveLength(7);
    await expect(store.compareAndSwap(null, Buffer.from('stale'))).rejects.toThrow('SEALED_STATE_CONFLICT');
    const current = (await store.read())!;
    await store.compareAndSwap(createHash('sha256').update(current).digest('hex'), Buffer.from('updated ciphertext'));
    expect(Buffer.from((await store.read())!).toString()).toBe('updated ciphertext');
  });

  it('refuses tampered ciphertext and missing storage without replacing existing custody', async () => {
    const { store, directory, child } = await setup();
    const vault = new AesGcmStateVault(store, simulationSealingKey('ef'.repeat(32), true), true);
    await vault.write(Buffer.from('confidential custody state'), null);
    await writeFile(join(directory, ID, 'custody.blob'), '{corrupted');
    await expect(vault.read()).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
    await expect(vault.write(Buffer.from('replacement'), null)).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    await expect(store.read()).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
  });
});
