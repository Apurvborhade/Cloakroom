import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, X509Certificate } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { StateVault } from '@cloakroom/enclave/dist/sealed-state.js';

const run = promisify(execFile);
export function validHostname(host: string) {
  return host.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
}

export async function loadTlsIdentity(vault: StateVault, hostname: string) {
  if (!validHostname(hostname)) throw new Error('INVALID_RPC_HOSTNAME');
  const saved = await vault.read();
  let state: { version: number; hostname: string; key: string; cert?: string };
  if (saved) {
    state = JSON.parse(Buffer.from(saved.plaintext).toString('utf8'));
    if (state.version !== 1 || state.hostname !== hostname || typeof state.key !== 'string') throw new Error('INVALID_TLS_STATE');
  } else {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    state = { version: 1, hostname, key: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() };
  }
  const privateKey = createPrivateKey(state.key);
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('INVALID_TLS_KEY');
  }
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' });
  const tlsSpkiSha256 = createHash('sha256').update(spki).digest('hex');
  let revision = saved?.revision ?? await vault.write(Buffer.from(JSON.stringify(state)), null);
  const validate = (pem: string) => {
    if (Buffer.byteLength(pem) > 16_384) throw new Error('INVALID_TLS_CERTIFICATE');
    const cert = new X509Certificate(pem);
    if (!cert.publicKey.export({ format: 'der', type: 'spki' }).equals(spki)
      || cert.checkHost(hostname, { subject: 'never', wildcards: false }) !== hostname
      || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) {
      throw new Error('INVALID_TLS_CERTIFICATE');
    }
  };
  // Expired public certificates can be replaced through the local control socket.
  let activeCertificate: string | undefined;
  if (state.cert) { try { validate(state.cert); activeCertificate = state.cert; } catch { /* renewal required */ } }
  return {
    tlsSpkiSha256,
    tls() { return activeCertificate ? { key: state.key, cert: activeCertificate } : undefined; },
    async csr() {
      const directory = await mkdtemp(join(tmpdir(), 'rpc-csr-'));
      try {
        await writeFile(join(directory, 'key.pem'), state.key, { mode: 0o600 });
        const { stdout } = await run('openssl', ['req', '-new', '-key', join(directory, 'key.pem'),
          '-subj', `/CN=${hostname}`, '-addext', `subjectAltName=DNS:${hostname}`], { timeout: 5000, maxBuffer: 16_384 });
        return stdout;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async installCertificate(cert: string) {
      validate(cert);
      const next = { ...state, cert };
      revision = await vault.write(Buffer.from(JSON.stringify(next)), revision);
      state = next; activeCertificate = cert;
    },
  };
}
