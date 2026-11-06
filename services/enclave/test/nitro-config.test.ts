import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeNitroConfig, readNitroConfig } from '../src/nitro-config.js';

const run = promisify(execFile);
const script = fileURLToPath(new URL('../nitro/config.py', import.meta.url));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function config() {
  return { ...parseEnv(await readFile(new URL('../../../.env.example', import.meta.url), 'utf8')),
    RPC_URL: 'https://rpc.example/private-fixture-key', UNISWAP_API_KEY: 'fixture-secret', SIM_MODE: 'false',
    ADMIN_ADDRESS: '0x1111111111111111111111111111111111111111', ALLOWED_ORIGIN: 'https://app.example',
    KMS_REGION: 'eu-central-1', KMS_KEY_ARN: 'arn:aws:kms:eu-central-1:123456789012:key/fixture', VAULT_ID: 'ab'.repeat(32) };
}

async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'cloakroom-config-'));
  cleanups.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function fixture() {
  const path = await directory();
  const file = join(path, 'private.json'), socketPath = join(path, 'config.sock');
  const bytes = Buffer.from(JSON.stringify(await config()));
  await writeFile(file, bytes, { mode: 0o600 });
  const child = spawn('python3', [script, 'parent', '--file', file, '--unix-socket', socketPath], { stdio: 'ignore' });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill(); await stopped;
    }
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('config relay exited');
    try { await stat(socketPath); break; } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
  return { file, socketPath, bytes };
}

describe('private Nitro boot configuration', () => {
  it('loads the committed configuration through the real parent server without changing process environment', async () => {
    const { socketPath, bytes } = await fixture();
    const before = process.env.UNISWAP_API_KEY;
    const env = await readNitroConfig(hash(bytes), socketPath);
    expect(env).toEqual(await config());
    expect(Object.isFrozen(env)).toBe(true);
    expect(process.env.UNISWAP_API_KEY).toBe(before);
  });

  it('rejects parent changes to the signing policy or credentials', async () => {
    const { file, socketPath, bytes } = await fixture();
    for (const change of [{ SIGNING_MAX_GAS: '99999999' }, { RPC_URL: 'https://another.example/secret' }]) {
      await writeFile(file, JSON.stringify({ ...await config(), ...change }));
      await expect(readNitroConfig(hash(bytes), socketPath)).rejects.toThrow(/^NITRO_CONFIG_UNAVAILABLE$/);
    }
  });

  it('refuses simulation, invalid fields and executable environment options even with a matching commitment', async () => {
    for (const change of [{ SIM_MODE: 'true' }, { NODE_OPTIONS: '--require=/tmp/evil' }, { VAULT_ID: 'bad' },
      { SIGNING_MAX_GAS: 'secret-invalid-value' }, { KMS_REGION: '' }, { UNISWAP_API_KEY: { nested: 'secret' } }]) {
      const bytes = Buffer.from(JSON.stringify({ ...await config(), ...change }));
      expect(() => decodeNitroConfig(bytes, hash(bytes))).toThrow(/^NITRO_CONFIG_UNAVAILABLE$/);
    }
  });

  it('refuses symlinks and publicly readable files without logging their contents', async () => {
    const path = await directory();
    const file = join(path, 'private.json'), link = join(path, 'link.json');
    await writeFile(file, JSON.stringify(await config()), { mode: 0o644 });
    const attempt = (file: string) => run('python3', [script, 'parent', '--file', file, '--unix-socket', join(path, 'unused.sock')]);
    await expect(attempt(file)).rejects.toMatchObject({ stderr: 'CONFIG_UNAVAILABLE\n' });
    await chmod(file, 0o600); await symlink(file, link);
    await expect(attempt(link)).rejects.toMatchObject({ stderr: 'CONFIG_UNAVAILABLE\n' });
  });

  it('rechecks file permissions when configuration is fetched', async () => {
    const { file, socketPath, bytes } = await fixture();
    await chmod(file, 0o644);
    await expect(readNitroConfig(hash(bytes), socketPath)).rejects.toThrow(/^NITRO_CONFIG_UNAVAILABLE$/);
  });

  it.each(['truncated', 'oversized', 'stalled'])('bounds a %s parent response', async (kind) => {
    const socketPath = join(await directory(), 'bad.sock');
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((socket) => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => undefined);
      socket.once('data', () => {
        if (kind === 'truncated') socket.end(Buffer.from([0, 0, 0, 10, 1]));
        if (kind === 'oversized') socket.end(Buffer.alloc(65_541));
      });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    cleanups.push(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });
    await expect(readNitroConfig('ab'.repeat(32), socketPath, 100)).rejects.toThrow(/^NITRO_CONFIG_UNAVAILABLE$/);
  });

  it('fails without a relay or a valid image commitment', async () => {
    await expect(readNitroConfig('ab'.repeat(32), '/missing-config-relay', 50)).rejects.toThrow(/^NITRO_CONFIG_UNAVAILABLE$/);
    await expect(readNitroConfig('uncommitted', '/missing-config-relay')).rejects.toThrow(/^NITRO_CONFIG_UNAVAILABLE$/);
  });

  it('waits briefly for the boot relay to start', async () => {
    const socketPath = join(await directory(), 'starting.sock');
    const body = Buffer.from(JSON.stringify(await config()));
    const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
    const server = createServer((socket) => socket.once('data', () => socket.end(Buffer.concat([header, body]))));
    const pending = readNitroConfig(hash(body), socketPath, 1000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    expect(await pending).toEqual(await config());
  });
});
