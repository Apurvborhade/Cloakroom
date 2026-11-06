import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AesGcmStateVault, FileCipherBlobStore, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';

const provider = () => simulationSealingKey('12'.repeat(32), true);

describe('sealed state', () => {
  it('requires an explicit simulation mode for environment-backed keys', () => {
    expect(() => simulationSealingKey('12'.repeat(32), false)).toThrow('SIM_MODE_REQUIRED');
    expect(() => new AesGcmStateVault(new MemoryCipherBlobStore(), provider())).toThrow('SIM_MODE_REQUIRED');
  });

  it('persists authenticated ciphertext and restores it with a fresh vault instance', async () => {
    const store = new MemoryCipherBlobStore();
    const vault = new AesGcmStateVault(store, provider(), true);
    expect(await vault.read()).toBeUndefined();
    const secret = Buffer.from('private seed material');
    expect(await vault.write(secret, null)).toBe(1);
    expect(Buffer.from((await store.read())!).toString()).not.toContain(secret.toString());
    expect(await new AesGcmStateVault(store, provider(), true).read()).toEqual({ revision: 1, plaintext: secret });
  });

  it('rejects ciphertext modifications and a different wrapping key', async () => {
    const store = new MemoryCipherBlobStore();
    const vault = new AesGcmStateVault(store, provider(), true);
    await vault.write(Buffer.from('secret'), null);
    const wrong = simulationSealingKey('34'.repeat(32), true);
    await expect(new AesGcmStateVault(store, wrong, true).read()).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
    const old = await store.read();
    const record = JSON.parse(Buffer.from(old!).toString());
    record.revision++;
    const tampered = new MemoryCipherBlobStore();
    await tampered.compareAndSwap(null, Buffer.from(JSON.stringify(record)));
    await expect(new AesGcmStateVault(tampered, provider(), true).read()).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
  });

  it('refuses stale revisions and concurrent writers', async () => {
    const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), provider(), true);
    await vault.write(Buffer.from('first'), null);
    const outcomes = await Promise.allSettled([
      vault.write(Buffer.from('second'), 1), vault.write(Buffer.from('third'), 1),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(vault.write(Buffer.from('stale'), 1)).rejects.toThrow('SEALED_STATE_CONFLICT');
  });

  it('uses durable, private files and fails on corruption instead of replacing state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cloakroom-vault-'));
    const path = join(directory, 'state');
    try {
      const vault = new AesGcmStateVault(new FileCipherBlobStore(path), provider(), true);
      await vault.write(Buffer.from('secret'), null);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      const blob = await readFile(path);
      expect(blob.includes(Buffer.from('secret'))).toBe(false);
      await writeFile(path, 'corrupt');
      await expect(vault.read()).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
      await expect(vault.write(Buffer.from('replacement'), null)).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
      expect(await readFile(path, 'utf8')).toBe('corrupt');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
