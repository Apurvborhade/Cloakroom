import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { promisify } from 'node:util';
import { createPublicClient, http } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNitroRpcTransport, rpcRelayFetch } from '../src/nitro-rpc.js';

const run = promisify(execFile);
const HOST = 'rpc.example';
const SECRET = 'private-fixture-api-key';
const ENDPOINT = `https://${HOST}/v2/${SECRET}`;
const LABEL = 'https://enclave-rpc.invalid/';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(options: { host?: string; handler?: (req: IncomingMessage, res: ServerResponse) => void } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-rpc-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  const host = options.host ?? HOST;
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`, '-days', '1']);
  const ca = await readFile(cert, 'utf8');
  const received: Array<{ path?: string; host?: string; sni: string | false | null; method: string }> = [];
  const server = createServer({ key: await readFile(key), cert: ca }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (bytes: Buffer) => chunks.push(bytes));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString());
      received.push({ path: req.url, host: req.headers.host, sni: (req.socket as TLSSocket).servername, method: body.method });
      if (options.handler) options.handler(req, res);
      else res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0xaa36a7' }));
    });
  });
  server.on('tlsClientError', () => undefined);
  const socketPath = join(directory, 'rpc.sock');
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const client = (trust = ca, timeout = 2000) => createPublicClient({ transport: http(LABEL, {
    fetchFn: rpcRelayFetch(ENDPOINT, socketPath, trust), retryCount: 0, timeout,
  }) });
  return { client, received, socketPath };
}

describe('Nitro RPC HTTPS transport', () => {
  it('queues a balance refresh instead of exceeding the relay connection limit', async () => {
    let active = 0, peak = 0;
    const { client } = await fixture({ handler: (req, res) => {
      active += 1;
      peak = Math.max(peak, active);
      res.on('close', () => { active -= 1; });
      if (active > 16) { req.socket.destroy(); return; }
      setTimeout(() => res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' })), 50);
    } });
    const rpc = client();
    const requests = Array.from({ length: 24 }, (_, index) => rpc.getBalance({
      address: `0x${(index + 1).toString(16).padStart(40, '0')}`,
    }));
    const results = await Promise.allSettled(requests);
    expect(results.every((result) => result.status === 'fulfilled' && result.value === 1n)).toBe(true);
    expect(peak).toBeLessThanOrEqual(16);
  });

  it('works with viem and authenticates the hostname before sending the private URL path', async () => {
    const { client, received } = await fixture();
    expect(await client().getChainId()).toBe(11155111);
    expect(received).toEqual([{ path: `/v2/${SECRET}`, host: HOST, sni: HOST, method: 'eth_chainId' }]);
  });

  it('rejects an untrusted certificate without sending the path or leaking it in viem errors', async () => {
    const { received, socketPath } = await fixture();
    const client = createPublicClient({ transport: http(LABEL, {
      fetchFn: rpcRelayFetch(ENDPOINT, socketPath), timeout: 2000, retryCount: 0,
    }) });
    const error = await client.getChainId().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('RPC_UNAVAILABLE');
    expect(String(error)).not.toContain(SECRET);
    expect(String(error)).not.toContain(HOST);
    expect(received).toEqual([]);
  });

  it('rejects a trusted certificate for a different hostname', async () => {
    const { client, received } = await fixture({ host: 'wrong.example' });
    await expect(client().getChainId()).rejects.toThrow('RPC_UNAVAILABLE');
    expect(received).toEqual([]);
  });

  it('refuses redirects without resending the credential-bearing path', async () => {
    const { client, received } = await fixture({ handler: (_req, res) => {
      res.writeHead(302, { location: `https://wrong.example/${SECRET}` }); res.end('{}');
    } });
    await expect(client().getChainId()).rejects.toThrow('RPC_UNAVAILABLE');
    expect(received).toHaveLength(1);
  });

  it('bounds the time to receive the entire response', async () => {
    const { client } = await fixture({ handler: (_req, res) => { res.writeHead(200); res.write('{'); } });
    await expect(client(undefined, 100).getChainId()).rejects.toThrow();
  });

  it('refuses oversized and truncated responses', async () => {
    for (const handler of [
      (_req: IncomingMessage, res: ServerResponse) => res.end('x'.repeat(10 * 1024 * 1024 + 1)),
      (_req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(200, { 'content-length': 1000 }); res.end('{}');
      },
    ]) {
      const { client } = await fixture({ handler });
      await expect(client().getChainId()).rejects.toThrow();
    }
  });

  it('has no direct networking fallback and keeps the endpoint out of transport metadata', async () => {
    const direct = vi.spyOn(globalThis, 'fetch');
    const transport = createNitroRpcTransport(ENDPOINT)({});
    expect(transport.value?.url).toBe(LABEL);
    expect(JSON.stringify(transport)).not.toContain(SECRET);
    const fetch = rpcRelayFetch(ENDPOINT, '/missing-relay');
    await expect(fetch(LABEL, { method: 'POST', body: '{}', signal: AbortSignal.timeout(50) })).rejects.toThrow('RPC_UNAVAILABLE');
    expect(direct).not.toHaveBeenCalled();
  });

  it('rejects unsafe endpoints and unexpected fetch requests', async () => {
    for (const endpoint of ['http://rpc.example', 'https://rpc.example:8443', 'https://name:secret@rpc.example',
      'https://rpc.example/#secret', 'not-a-url']) {
      expect(() => createNitroRpcTransport(endpoint)).toThrow(/^INVALID_RPC_ENDPOINT$/);
    }
    const fetch = rpcRelayFetch(ENDPOINT, '/missing-relay');
    for (const [input, init] of [
      [ENDPOINT, { method: 'POST', body: '{}' }],
      [LABEL, { method: 'GET' }],
      [LABEL, { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) }],
    ] as const) {
      await expect(fetch(input, { ...init, signal: AbortSignal.timeout(50) })).rejects.toThrow(/^RPC_UNAVAILABLE$/);
    }
  });
});
