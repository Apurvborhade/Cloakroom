// Phase-0 entrypoint. The main application server remains owned by the API workstream.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { AttestationService } from './attestation.js';
import { createBootstrapIdentity } from './keys.js';
import { runCustodySelfTest } from './custody-selftest.js';
import type { ErrorCode } from '@cloakroom/shared';

const buildHash = (await readFile(new URL('./build-hash', import.meta.url), 'utf8')).trim();
const attestation = new AttestationService(buildHash, { identity: await createBootstrapIdentity(), chainId: 11155111 });
// Fail closed outside Nitro; there is no simulated quote or host-generated key.
try {
  await runCustodySelfTest();
  await attestation.response();
} catch {
  console.error('ATTESTATION_UNAVAILABLE');
  process.exit(1);
}
let inFlight = 0;

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status: number, body: unknown) => {
    res.writeHead(status);
    res.end(JSON.stringify(body));
  };
  const sendError = (status: number, code: ErrorCode) => send(status, { error: code });
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://enclave');
  } catch {
    sendError(400, 'INVALID_PAYLOAD');
    return;
  }
  if (req.method !== 'GET' || url.pathname !== '/attestation') {
    sendError(404, 'INVALID_PAYLOAD');
    return;
  }
  const values = url.searchParams.getAll('nonce');
  if ([...url.searchParams.keys()].some((key) => key !== 'nonce') || values.length > 1
      || (values.length === 1 && !/^(?:[a-f0-9]{2}){32,64}$/.test(values[0]!))) {
    sendError(400, 'INVALID_PAYLOAD');
    return;
  }
  if (inFlight >= 8) {
    sendError(503, 'INTERNAL_ERROR');
    return;
  }
  inFlight++;
  try {
    send(200, await attestation.response(values[0] ? Buffer.from(values[0], 'hex') : undefined));
  } catch {
    sendError(503, 'INTERNAL_ERROR');
  } finally {
    inFlight--;
  }
});
server.headersTimeout = 5_000;
server.requestTimeout = 10_000;
server.maxHeadersCount = 32;
server.on('error', () => {
  console.error('ATTESTATION_SERVICE_FAILED');
  process.exit(1);
});
// Linux abstract Unix socket: no writable filesystem or socket file is needed.
server.listen('\0cloakroom-attestation');
