import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../../enclave/src/sealed-state.js';
import { loadTlsIdentity } from '../src/identity.js';
import { decodeConfig } from '../src/config.js';

describe('RPC TLS identity', () => {
  it('keeps the key sealed, accepts only a matching certificate, and survives restart', async () => {
    const store = new MemoryCipherBlobStore();
    const vault = new AesGcmStateVault(store, simulationSealingKey('ab'.repeat(32), true), true);
    const identity = await loadTlsIdentity(vault, 'rpc.example.com');
    expect(identity.tls()).toBeUndefined();
    const directory = mkdtempSync(join(tmpdir(), 'rpc-identity-'));
    try {
      const run = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
      run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem',
        '-subj', '/CN=local-test', '-days', '1');
      writeFileSync(join(directory, 'rpc.csr'), await identity.csr());
      writeFileSync(join(directory, 'ext'), 'subjectAltName=DNS:rpc.example.com\n');
      run('x509', '-req', '-in', 'rpc.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
        '-days', '1', '-extfile', 'ext', '-out', 'rpc.pem');
      const cert = readFileSync(join(directory, 'rpc.pem'), 'utf8');
      await expect(identity.installCertificate(readFileSync(join(directory, 'ca.pem'), 'utf8'))).rejects.toThrow('INVALID_TLS_CERTIFICATE');
      await identity.installCertificate(cert);
      const restored = await loadTlsIdentity(vault, 'rpc.example.com');
      expect(restored.tlsSpkiSha256).toBe(identity.tlsSpkiSha256);
      expect(restored.tls()).toEqual(identity.tls());
      const ciphertext = Buffer.from((await store.read())!).toString('utf8');
      expect(ciphertext).not.toContain('PRIVATE KEY');
      expect(ciphertext).not.toContain(identity.tls()!.key);
      await expect(loadTlsIdentity(vault, 'other.example.com')).rejects.toThrow('INVALID_TLS_STATE');
      writeFileSync(join(directory, 'ext'), 'subjectAltName=DNS:other.example.com\n');
      run('x509', '-req', '-in', 'rpc.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-days', '1', '-extfile', 'ext', '-out', 'wrong.pem');
      await expect(identity.installCertificate(readFileSync(join(directory, 'wrong.pem'), 'utf8'))).rejects.toThrow('INVALID_TLS_CERTIFICATE');
      expect((await loadTlsIdentity(vault, 'rpc.example.com')).tls()!.cert).toBe(cert);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('refuses a modified boot configuration and insecure upstream', () => {
    const value = { hostname: 'rpc.example.com', chainId: 11155111, upstreamUrl: 'https://rpc.example.com',
      noxRegistryRpcUrl: 'https://registry.example.com', noxRegistryAddress: `0x${'ab'.repeat(20)}`,
      kmsKeyArn: `arn:aws:kms:eu-west-1:123456789012:key/${'a'.repeat(36)}`, kmsRegion: 'eu-west-1', vaultId: 'cd'.repeat(32) };
    const bytes = Buffer.from(JSON.stringify(value));
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(decodeConfig(bytes, hash)).toEqual(value);
    expect(() => decodeConfig(bytes, 'ff'.repeat(32))).toThrow('RPC_CONFIG_MISMATCH');
    const insecure = Buffer.from(JSON.stringify({ ...value, upstreamUrl: 'http://rpc.example.com' }));
    expect(() => decodeConfig(insecure, createHash('sha256').update(insecure).digest('hex'))).toThrow('INVALID_RPC_CONFIG');
  });
});
