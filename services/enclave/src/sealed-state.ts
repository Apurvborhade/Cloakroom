import { createCipheriv, createDecipheriv, createHash, createSecretKey, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MAX_BLOB_BYTES = 4 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface CipherBlobStore {
  read(): Promise<Uint8Array | undefined>;
  compareAndSwap(expectedHash: string | null, ciphertext: Uint8Array): Promise<void>;
}

export interface SealingKeyProvider {
  readonly protection: 'simulation' | 'nitro-kms';
  getKey(): Promise<KeyObject>;
}

export interface StateVault {
  readonly protection: SealingKeyProvider['protection'];
  read(): Promise<{ revision: number; plaintext: Uint8Array } | undefined>;
  write(plaintext: Uint8Array, expectedRevision: number | null): Promise<number>;
}

/** Ciphertext only. A stale writer cannot overwrite another process's committed state. */
export class FileCipherBlobStore implements CipherBlobStore {
  constructor(readonly path: string) {}

  async read(): Promise<Uint8Array | undefined> {
    try {
      const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > MAX_BLOB_BYTES) throw new Error();
        return await file.readFile();
      } finally { await file.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error('SEALED_STATE_UNAVAILABLE');
    }
  }

  async compareAndSwap(expectedHash: string | null, ciphertext: Uint8Array): Promise<void> {
    if (ciphertext.byteLength > MAX_BLOB_BYTES) throw new Error('SEALED_STATE_UNAVAILABLE');
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const lock = await open(`${this.path}.lock`, 'a', 0o600);
    await lock.close();
    const helper = fileURLToPath(new URL('../nitro/blob-cas.mjs', import.meta.url));
    // Kernel advisory locks are released on process death; no stale PID lock removal.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('flock', ['-n', '-E', '73', `${this.path}.lock`, process.execPath,
        helper, this.path, expectedHash ?? '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, 20_000);
      child.stdin.on('error', () => undefined);
      child.on('error', () => { clearTimeout(timer); reject(new Error('SEALED_STATE_UNAVAILABLE')); });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(code === 73 ? 'SEALED_STATE_BUSY'
          : code === 74 ? 'SEALED_STATE_CONFLICT' : 'SEALED_STATE_UNAVAILABLE'));
      });
      child.stdin.end(ciphertext);
    });
  }
}

/** A deterministic test backend; never used as production persistence. */
export class MemoryCipherBlobStore implements CipherBlobStore {
  #blob: Uint8Array | undefined;
  async read(): Promise<Uint8Array | undefined> { return this.#blob?.slice(); }
  async compareAndSwap(expectedHash: string | null, ciphertext: Uint8Array): Promise<void> {
    if ((this.#blob ? digest(this.#blob) : null) !== expectedHash) throw new Error('SEALED_STATE_CONFLICT');
    this.#blob = ciphertext.slice();
  }
}

/** Explicit simulation only. There is no environment-key fallback in production. */
export function simulationSealingKey(keyHex: string, simMode: boolean): SealingKeyProvider {
  if (!simMode) throw new Error('SIM_MODE_REQUIRED');
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) throw new Error('INVALID_SEALING_KEY');
  const key = createSecretKey(Buffer.from(keyHex, 'hex'));
  return { protection: 'simulation', async getKey() { return key; } };
}

/** AES-256-GCM at-rest encryption. The backing store sees authenticated ciphertext only. */
export class AesGcmStateVault implements StateVault {
  readonly #store: CipherBlobStore;
  readonly #provider: SealingKeyProvider;
  readonly protection: SealingKeyProvider['protection'];

  constructor(store: CipherBlobStore, provider: SealingKeyProvider, simMode = false) {
    if (provider.protection === 'simulation' && !simMode) throw new Error('SIM_MODE_REQUIRED');
    this.#store = store;
    this.#provider = provider;
    this.protection = provider.protection;
  }

  async #open(blob: Uint8Array): Promise<{ revision: number; plaintext: Uint8Array }> {
    try {
      const value = JSON.parse(Buffer.from(blob).toString('utf8')) as Record<string, unknown>;
      if (value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
          || typeof value.nonce !== 'string' || typeof value.tag !== 'string'
          || typeof value.ciphertext !== 'string') throw new Error();
      const revision = Number(value.revision);
      const nonce = Buffer.from(value.nonce, 'base64');
      const tag = Buffer.from(value.tag, 'base64');
      if (nonce.length !== 12 || tag.length !== 16) throw new Error();
      const key = await this.#provider.getKey();
      if (key.type !== 'secret' || key.symmetricKeySize !== 32) throw new Error();
      const cipher = createDecipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(Buffer.from(`cloakroom/vault/v1:${revision}`));
      cipher.setAuthTag(tag);
      return { revision, plaintext: Buffer.concat([
        cipher.update(Buffer.from(value.ciphertext, 'base64')), cipher.final(),
      ]) };
    } catch { throw new Error('SEALED_STATE_UNAVAILABLE'); }
  }

  async read(): Promise<{ revision: number; plaintext: Uint8Array } | undefined> {
    const blob = await this.#store.read();
    return blob ? this.#open(blob) : undefined;
  }

  async write(plaintext: Uint8Array, expectedRevision: number | null): Promise<number> {
    if (plaintext.byteLength > MAX_BLOB_BYTES / 2) throw new Error('SEALED_STATE_UNAVAILABLE');
    const previous = await this.#store.read();
    const current = previous ? await this.#open(previous) : undefined;
    if ((current?.revision ?? null) !== expectedRevision) throw new Error('SEALED_STATE_CONFLICT');
    const revision = (expectedRevision ?? 0) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('SEALED_STATE_UNAVAILABLE');
    const key = await this.#provider.getKey();
    if (key.type !== 'secret' || key.symmetricKeySize !== 32) throw new Error('INVALID_SEALING_KEY');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(`cloakroom/vault/v1:${revision}`));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const blob = Buffer.from(JSON.stringify({
      version: 1, revision, nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'),
    }));
    await this.#store.compareAndSwap(previous ? digest(previous) : null, blob);
    return revision;
  }
}
