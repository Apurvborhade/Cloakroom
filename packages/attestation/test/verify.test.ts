import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encode } from 'cborg';
import { hexBytes, rpcBinding, verifyCustodyAttestation, verifyDocument, verifyRpcAttestation } from '../src/verify.js';

let directory: string, root: string, rootDer: Buffer, leaf: Buffer, key: Buffer;
const nonce = randomBytes(32), publicKey = randomBytes(32), binding = randomBytes(32);
const now = Date.now();
const measurements = { PCR0: '01'.repeat(48), PCR1: '02'.repeat(48), PCR2: '03'.repeat(48) };
const expected = { nonce, publicKey, binding, measurements, now };
const release = { measurements, chainId: 11155111, buildHash: 'ab'.repeat(32) };
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'nitro-verifier-test-'));
  const run = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
  run('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp384r1', '-nodes',
    '-keyout', 'root.key', '-out', 'root.pem', '-days', '1', '-subj', '/CN=synthetic root',
    '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:1', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
  run('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:secp384r1', '-nodes',
    '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=synthetic Nitro');
  run('x509', '-req', '-in', 'leaf.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial',
    '-days', '1', '-out', 'leaf.pem');
  root = readFileSync(join(directory, 'root.pem'), 'utf8');
  rootDer = run('x509', '-in', 'root.pem', '-outform', 'DER');
  leaf = run('x509', '-in', 'leaf.pem', '-outform', 'DER');
  key = readFileSync(join(directory, 'leaf.key'));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function quote(overrides: Record<string, unknown> = {}, tagged = false) {
  const document = { module_id: 'synthetic', digest: 'SHA384', timestamp: now, nonce, public_key: publicKey,
    user_data: binding, pcrs: new Map([[0, hexBytes(measurements.PCR0, 48)], [1, hexBytes(measurements.PCR1, 48)],
      [2, hexBytes(measurements.PCR2, 48)]]), certificate: leaf, cabundle: [rootDer], ...overrides };
  const protectedHeader = encode(new Map([[1, -35]])), payload = encode(document);
  const signature = sign('sha384', encode(['Signature1', protectedHeader, Buffer.alloc(0), payload]),
    { key, dsaEncoding: 'ieee-p1363' });
  const raw = encode([protectedHeader, {}, payload, signature]);
  return Buffer.concat(tagged ? [Buffer.from([0xd2]), raw] : [raw]).toString('base64');
}

describe('Nitro attestation verifier', () => {
  it('verifies the signed quote, pinned root, measurements and fresh challenge', async () => {
    // OpenSSL validity starts at integer seconds, after the test module's timestamp.
    await expect(verifyDocument(quote(), { ...expected, now: Date.now() }, root)).resolves.toBeUndefined();
    await expect(verifyDocument(quote({}, true), { ...expected, now: Date.now() }, root)).resolves.toBeUndefined();
  });
  it('rejects a self-selected trust root', async () => {
    await expect(verifyDocument(quote(), expected)).rejects.toThrow('CERTIFICATE_CHAIN');
  });
  it.each([
    ['nonce', randomBytes(32)], ['public_key', randomBytes(32)], ['user_data', randomBytes(32)],
    ['timestamp', now - 301_000], ['timestamp', now + 31_000], ['digest', 'SHA256'],
    ['pcrs', new Map([[0, Buffer.alloc(48)], [1, Buffer.alloc(48, 2)], [2, Buffer.alloc(48, 3)]])],
  ])('rejects a signed mismatch in %s', async (field, value) => {
    await expect(verifyDocument(quote({ [field]: value }), expected, root)).rejects.toThrow('ATTESTATION_');
  });
  it('rejects a corrupted COSE signature and expired chain', async () => {
    const raw = Buffer.from(quote(), 'base64'); raw[raw.length - 1] ^= 1;
    await expect(verifyDocument(raw.toString('base64'), { ...expected, now: Date.now() }, root)).rejects.toThrow('SIGNATURE');
    const later = now + 172_800_000;
    await expect(verifyDocument(quote({ timestamp: later }), { ...expected, now: later }, root)).rejects.toThrow('CERTIFICATE_CHAIN');
  });
  it('rejects missing trust policy, wrong build, chain and escape signer before trusting a response', async () => {
    const response = { quote: quote(), buildHash: `0x${release.buildHash}`, chainId: release.chainId,
      enclavePubKey: `0x${publicKey.toString('hex')}` };
    const options = { release, nonce: nonce.toString('hex') };
    await expect(verifyCustodyAttestation({ ...response, chainId: 1 }, options)).rejects.toThrow('CHAIN_MISMATCH');
    await expect(verifyCustodyAttestation({ ...response, buildHash: 'ff'.repeat(32) }, options)).rejects.toThrow('BUILD_MISMATCH');
    await expect(verifyCustodyAttestation(response, { ...options, escapeSigner: 'ab'.repeat(20) })).rejects.toThrow('SIGNER_MISMATCH');
    await expect(verifyCustodyAttestation({ ...response, escapeSigner: '00'.repeat(20) }, options)).rejects.toThrow('INVALID_SIGNER');
  });
  it('binds an RPC quote to the TLS key and chain', async () => {
    const tlsSpkiSha256 = 'cd'.repeat(32);
    const actual = await rpcBinding(tlsSpkiSha256, release.buildHash, release.chainId);
    const chain = Buffer.alloc(8); chain.writeBigUInt64BE(BigInt(release.chainId));
    const wanted = createHash('sha256').update('cloakroom/attestation/rpc/v1\0')
      .update(Buffer.from(tlsSpkiSha256, 'hex')).update(Buffer.from(release.buildHash, 'hex')).update(chain).digest();
    expect(Buffer.from(actual)).toEqual(wanted);
    await expect(verifyRpcAttestation({ quote: quote(), buildHash: release.buildHash, chainId: release.chainId, tlsSpkiSha256 },
      { release, nonce: nonce.toString('hex'), expectedTlsSpkiSha256: 'ef'.repeat(32) })).rejects.toThrow('TLS_KEY_MISMATCH');
  });
});
