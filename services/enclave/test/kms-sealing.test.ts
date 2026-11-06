import { afterEach, describe, expect, it } from 'vitest';
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:https';
import { KmsRelayAgent, NitroKmsSealingKey } from '../src/kms-sealing.js';
import type { RecipientKms } from '../src/kms-sealing.js';
import type { QuoteProvider } from '../src/attestation.js';
import { AesGcmStateVault, MemoryCipherBlobStore } from '../src/sealed-state.js';

const run = promisify(execFile);
const KEY_ARN = 'arn:aws:kms:eu-central-1:111122223333:key/12345678-1234-1234-1234-123456789abc';
const VAULT_ID = 'ab'.repeat(32);
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function mockKms() {
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-kms-test-')); directories.push(directory);
  const issuer = join(directory, 'issuer.pem');
  await run('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', issuer]);
  const dataKey = randomBytes(32);
  const wrapped = randomBytes(128);
  let generated = 0; let decrypted = 0;
  const publicKeys: Buffer[] = [];
  const quote: QuoteProvider = async ({ publicKey, userData }) => {
    expect(userData).toEqual(createHash('sha256').update(JSON.stringify({ purpose: 'cloakroom/vault/v1', vaultId: VAULT_ID })).digest());
    expect(createPublicKey({ key: publicKey, type: 'spki', format: 'der' }).asymmetricKeyDetails?.modulusLength).toBe(2048);
    publicKeys.push(publicKey); return publicKey;
  };
  async function recipientCiphertext(publicKey: Uint8Array) {
    const id = randomBytes(8).toString('hex');
    const publicPath = join(directory, `${id}.pub`), certificate = join(directory, `${id}.crt`);
    const input = join(directory, `${id}.input`), output = join(directory, `${id}.cms`);
    await writeFile(publicPath, createPublicKey({ key: Buffer.from(publicKey), format: 'der', type: 'spki' }).export({ format: 'pem', type: 'spki' }));
    await run('openssl', ['x509', '-new', '-force_pubkey', publicPath, '-key', issuer,
      '-subj', '/CN=Offline KMS recipient test', '-days', '1', '-out', certificate]);
    await writeFile(input, dataKey, { mode: 0o600 });
    await run('openssl', ['cms', '-encrypt', '-binary', '-aes-256-cbc', '-in', input, '-out', output,
      '-outform', 'DER', '-recip', certificate, '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256']);
    return readFile(output);
  }
  const kms: RecipientKms = {
    async generate(input) {
      generated++; expect(input.keyArn).toBe(KEY_ARN);
      return { keyArn: KEY_ARN, ciphertext: wrapped, recipientCiphertext: await recipientCiphertext(input.quote) };
    },
    async decrypt(input) {
      decrypted++; expect(input.ciphertext).toEqual(wrapped);
      return { keyArn: KEY_ARN, recipientCiphertext: await recipientCiphertext(input.quote) };
    },
  };
  const store = new MemoryCipherBlobStore();
  const options = { keyArn: KEY_ARN, vaultId: VAULT_ID, store, kms, quote };
  return { options, kms, store, dataKey, publicKeys, counts: () => ({ generated, decrypted }) };
}

describe('Nitro KMS sealing', () => {
  it('generates and restores an attested data key through real RSA-OAEP CMS, storing only wrapped bytes', async () => {
    const { options, store, dataKey, publicKeys, counts } = await mockKms();
    const first = new NitroKmsSealingKey({ ...options, allowCreate: true });
    const [key, same] = await Promise.all([first.getKey(), first.getKey()]);
    expect(key).toBe(same); expect(key.export()).toEqual(dataKey);
    const saved = Buffer.from((await store.read())!);
    expect(saved.toString()).not.toContain(dataKey.toString('hex'));
    const restarted = new NitroKmsSealingKey(options);
    expect((await restarted.getKey()).export()).toEqual(dataKey);
    expect(publicKeys[0]).not.toEqual(publicKeys[1]);
    expect(counts()).toEqual({ generated: 1, decrypted: 1 });
    const ciphertextStore = new MemoryCipherBlobStore();
    const vault = new AesGcmStateVault(ciphertextStore, first);
    await vault.write(Buffer.from('sealed custody'), null);
    expect(Buffer.from((await new AesGcmStateVault(ciphertextStore, restarted).read())!.plaintext).toString()).toBe('sealed custody');
  });

  it('refuses absent state on restart, corrupt metadata, wrong vault identity and NSM failure', async () => {
    const { options, store, counts } = await mockKms();
    await expect(new NitroKmsSealingKey(options).getKey()).rejects.toThrow('KMS_SEALING_UNAVAILABLE');
    await expect(new NitroKmsSealingKey({ ...options, allowCreate: true, quote: async () => { throw new Error('no NSM'); } }).getKey())
      .rejects.toThrow('KMS_SEALING_UNAVAILABLE');
    expect(counts().generated).toBe(0);
    await new NitroKmsSealingKey({ ...options, allowCreate: true }).getKey();
    await expect(new NitroKmsSealingKey({ ...options, vaultId: 'cd'.repeat(32) }).getKey()).rejects.toThrow('KMS_SEALING_UNAVAILABLE');
    const saved = (await store.read())!;
    await store.compareAndSwap(createHash('sha256').update(saved).digest('hex'), Buffer.from('{broken'));
    await expect(new NitroKmsSealingKey({ ...options, allowCreate: true }).getKey()).rejects.toThrow('KMS_SEALING_UNAVAILABLE');
  });

  it('rejects plaintext releases, wrong keys, malformed CMS and uncertain persistence', async () => {
    const { options } = await mockKms();
    for (const response of [
      { keyArn: KEY_ARN, ciphertext: randomBytes(32), recipientCiphertext: randomBytes(20), plaintext: randomBytes(32) },
      { keyArn: KEY_ARN.replace('123456789abc', 'abcdef012345'), ciphertext: randomBytes(32), recipientCiphertext: randomBytes(20) },
      { keyArn: KEY_ARN, ciphertext: randomBytes(32), recipientCiphertext: randomBytes(20) },
    ]) {
      const provider = new NitroKmsSealingKey({ ...options, allowCreate: true, kms: { ...options.kms, generate: async () => response } });
      await expect(provider.getKey()).rejects.toThrow('KMS_SEALING_UNAVAILABLE');
    }
    const provider = new NitroKmsSealingKey({ ...options, allowCreate: true, store: {
      read: async () => undefined, compareAndSwap: async () => { throw new Error('disk unavailable'); },
    } });
    await expect(provider.getKey()).rejects.toThrow('KMS_SEALING_UNAVAILABLE');
    await expect(provider.getKey()).rejects.toThrow('KMS_SEALING_UNAVAILABLE');
  });
});

describe('KMS TLS over a parent relay', () => {
  it('authenticates the AWS hostname over a Unix relay and rejects an untrusted certificate or another hostname', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cloakroom-kms-tls-')); directories.push(directory);
    const key = join(directory, 'server.key'), cert = join(directory, 'server.crt');
    const endpoint = 'kms.eu-central-1.amazonaws.com';
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-subj', `/CN=${endpoint}`, '-addext', `subjectAltName=DNS:${endpoint}`, '-days', '1']);
    const ca = await readFile(cert, 'utf8'), socketPath = join(directory, 'relay.sock');
    const server = createServer({ key: await readFile(key), cert: ca }, (_req, res) => res.end('authenticated KMS fixture'));
    server.on('tlsClientError', () => undefined);
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const fetch = (host: string, trust?: string) => new Promise<string>((resolve, reject) => {
      const agent = new KmsRelayAgent(host, socketPath, trust);
      const req = request({ hostname: host, agent, method: 'POST', path: '/' }, (res) => {
        let body = ''; res.on('data', (bytes) => { body += String(bytes); });
        res.on('end', () => { agent.destroy(); resolve(body); });
      });
      req.on('error', (error) => { agent.destroy(); reject(error); });
      req.setTimeout(3_000, () => req.destroy()); req.end();
    });
    try {
      expect(await fetch(endpoint, ca)).toBe('authenticated KMS fixture');
      await expect(fetch(endpoint)).rejects.toThrow();
      await expect(fetch('kms.us-east-1.amazonaws.com', ca)).rejects.toThrow();
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
});
