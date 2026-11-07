import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Server } from 'node:https';
import { rpcBinding } from '@cloakroom/attestation';
import { nitroQuote } from '@cloakroom/enclave/dist/attestation.js';
import { AesGcmStateVault, RemoteCipherBlobStore } from '@cloakroom/enclave/dist/sealed-state.js';
import { NitroKmsSealingKey, createRecipientKms } from '@cloakroom/enclave/dist/kms-sealing.js';
import { parentRoleCredentials } from '@cloakroom/enclave/dist/parent-credentials.js';
import { createRpcGateway } from './gateway.js';
import { createNoxTransport } from './nox.js';
import { createRelayFetch } from './egress.js';
import { readConfig } from './config.js';
import { loadTlsIdentity } from './identity.js';

async function main() {
  const commitment = (await readFile(new URL('./config.sha256', import.meta.url), 'utf8')).trim();
  const buildHash = (await readFile(new URL('./build-hash', import.meta.url), 'utf8')).trim();
  const config = await readConfig(commitment);
  const store = (name: 'custody' | 'wrapping') => new RemoteCipherBlobStore('\0cloakroom-storage', config.vaultId, name);
  const provider = new NitroKmsSealingKey({ keyArn: config.kmsKeyArn, vaultId: config.vaultId,
    store: store('wrapping'), allowCreate: true, kms: createRecipientKms({ region: config.kmsRegion,
      relaySocket: '\0cloakroom-kms', credentials: parentRoleCredentials() }) });
  // A distinct vault/context isolates this TLS identity from custody state.
  const identity = await loadTlsIdentity(new AesGcmStateVault(store('custody'), provider), config.hostname);
  const relay = createRelayFetch();
  const nox = await createNoxTransport(config.upstreamUrl, { ethRpcUrl: config.noxRegistryRpcUrl,
    registryAddress: config.noxRegistryAddress, transport: { fetch: relay.fetch, WebSocket: null } });
  const chain = await nox.send({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, AbortSignal.timeout(45_000));
  if (chain.result !== `0x${config.chainId.toString(16)}`) throw new Error('RPC_CHAIN_MISMATCH');
  const attestation = async (nonce: string) => {
    const binding = await rpcBinding(identity.tlsSpkiSha256, buildHash, config.chainId);
    const quote = await nitroQuote({ publicKey: Buffer.from(identity.tlsSpkiSha256, 'hex'),
      userData: Buffer.from(binding), nonce: Buffer.from(nonce, 'hex') });
    return { quote: quote.toString('base64'), buildHash, chainId: config.chainId, tlsSpkiSha256: identity.tlsSpkiSha256 };
  };
  let server: Server | undefined;
  const serve = async () => {
    const tls = identity.tls();
    if (!tls) return;
    if (server) { server.setSecureContext(tls); return; }
    server = createRpcGateway({ tls, timeoutMs: 60_000, transport: nox, attestation });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject); server!.listen('\0cloakroom-rpc', resolve);
    });
    console.log('RPC_READY');
  };
  await serve();
  const csr = await identity.csr();
  let installing = false;
  // Only the parent-loopback control relay reaches this socket. It never exports a key.
  const control = createServer(async (request, response) => {
    request.on('error', () => {});
    response.setHeader('cache-control', 'no-store');
    try {
      if (request.method === 'GET' && request.url === '/csr') {
        response.writeHead(200, { 'content-type': 'application/pkcs10' }); response.end(csr); return;
      }
      if (request.method === 'GET' && request.url === '/status') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ ready: !!server, hostname: config.hostname, buildHash,
          chainId: config.chainId, tlsSpkiSha256: identity.tlsSpkiSha256 })); return;
      }
      if (request.method !== 'POST' || request.url !== '/certificate') { response.writeHead(404); response.end(); return; }
      if (installing) { response.writeHead(409); response.end(); return; }
      installing = true;
      try {
        let length = 0; const parts: Buffer[] = [];
        for await (const part of request) {
          const bytes = Buffer.from(part); length += bytes.length;
          if (length > 16_384) { response.writeHead(413); response.end(); request.destroy(); return; }
          parts.push(bytes);
        }
        await identity.installCertificate(Buffer.concat(parts).toString('utf8'));
        await serve(); response.writeHead(204); response.end();
      } finally { installing = false; }
    } catch { response.writeHead(400); response.end('CONTROL_REQUEST_FAILED'); }
  });
  control.requestTimeout = 10_000; control.headersTimeout = 5000; control.maxConnections = 4;
  control.setTimeout(10_000, (socket) => socket.destroy());
  control.listen('\0cloakroom-rpc-control');
  console.log(server ? 'RPC_RUNNING' : 'RPC_CERTIFICATE_REQUIRED');
  const stop = () => { server?.closeAllConnections(); server?.close(); control.closeAllConnections(); control.close(); nox.close(); relay.close(); process.exit(0); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}

main().catch((error: unknown) => {
  // Upstream/library errors can contain URLs or credential material.
  const safe = error instanceof Error && /^(RPC_|KMS_SEALING_|PARENT_CREDENTIALS_|SEALED_STATE_)[A-Z_]+$/.test(error.message);
  console.error(safe ? error.message : 'RPC_BOOT_FAILED'); process.exit(1);
});
