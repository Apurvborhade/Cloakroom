import { randomBytes } from 'node:crypto';
import { request } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { readFile } from 'node:fs/promises';
import { verifyRpcAttestation, type RpcAttestation, type TrustedRelease } from '@cloakroom/attestation';
import { tlsSpkiSha256 } from '../src/gateway.js';

const [endpoint, releasePath] = process.argv.slice(2);
if (!endpoint || !releasePath) throw new Error('Usage: verify-endpoint.ts <https-url> <trusted-release.json>');
const url = new URL(endpoint);
if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTPS_REQUIRED');
const release = JSON.parse(await readFile(releasePath, 'utf8')) as TrustedRelease;
const nonce = randomBytes(32).toString('hex');
url.pathname = '/attestation'; url.search = `nonce=${nonce}`; url.hash = '';
const reply = await new Promise<{ response: RpcAttestation; spki: string }>((resolve, reject) => {
  const req = request(url, { method: 'GET', agent: false, signal: AbortSignal.timeout(15_000) }, (res) => {
    const certificate = (res.socket as TLSSocket).getPeerX509Certificate();
    if (res.statusCode !== 200 || !certificate) { res.destroy(); reject(new Error('ATTESTATION_UNAVAILABLE')); return; }
    const spki = tlsSpkiSha256(certificate.toString());
    let length = 0; const parts: Buffer[] = [];
    res.on('data', (part: Buffer) => {
      length += part.length;
      if (length > 65_536) { res.destroy(); reject(new Error('ATTESTATION_TOO_LARGE')); } else parts.push(part);
    });
    res.on('error', reject);
    res.on('end', () => {
      try {
        if (!res.complete || length > 65_536) throw new Error('ATTESTATION_INCOMPLETE');
        resolve({ response: JSON.parse(Buffer.concat(parts).toString('utf8')), spki });
      } catch (error) { reject(error); }
    });
  });
  req.on('error', reject); req.end();
});
console.log(JSON.stringify(await verifyRpcAttestation(reply.response,
  { release, nonce, expectedTlsSpkiSha256: reply.spki })));
