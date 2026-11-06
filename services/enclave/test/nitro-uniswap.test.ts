import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect, createServer, type Socket } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { NATIVE } from '@cloakroom/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNitroUniswapClient, uniswapRelayFetch } from '../src/nitro-uniswap.js';
import { UniswapClient } from '../src/uniswap.js';

const run = promisify(execFile);
const HOST = 'trade-api.gateway.uniswap.org';
const URL = `https://${HOST}/v1`;
const API_KEY = 'fixture-api-key-not-for-the-parent';
const TOKEN = '0x3333333333333333333333333333333333333333';
const EOA = '0x1111111111111111111111111111111111111111';
const REQUEST = { tokenIn: NATIVE, tokenOut: TOKEN, amountIn: 100n, swapper: EOA } as const;
const BODY = { routing: 'CLASSIC', quote: { chainId: 11155111,
  input: { token: NATIVE, amount: '100' }, output: { token: TOKEN, amount: '200', minimumAmount: '199' } } };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(options: { host?: string; handler?: (req: IncomingMessage, res: ServerResponse) => void } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-uniswap-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  const host = options.host ?? HOST;
  await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`, '-days', '1']);
  const ca = await readFile(cert, 'utf8');
  const received: Array<{ url?: string; key?: string; host?: string; sni?: string; body: string }> = [];
  const server = createHttpsServer({ key: await readFile(key), cert: ca }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (bytes: Buffer) => chunks.push(bytes));
    req.on('end', () => {
      received.push({ url: req.url, key: req.headers['x-api-key'] as string, host: req.headers.host,
        sni: (req.socket as TLSSocket).servername || undefined, body: Buffer.concat(chunks).toString() });
      if (options.handler) options.handler(req, res);
      else res.end(JSON.stringify(BODY));
    });
  });
  server.on('tlsClientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no HTTPS fixture');
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const wire: Buffer[] = [];
  const sockets = new Set<Socket>();
  const tap = createServer((socket) => {
    const upstream = connect(address.port, '127.0.0.1');
    for (const connection of [socket, upstream]) {
      sockets.add(connection);
      connection.on('close', () => sockets.delete(connection));
      connection.on('error', () => { socket.destroy(); upstream.destroy(); });
    }
    socket.on('data', (bytes: Buffer) => wire.push(Buffer.from(bytes)));
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => tap.listen(0, '127.0.0.1', resolve));
  const tapAddress = tap.address();
  if (!tapAddress || typeof tapAddress === 'string') throw new Error('no wire fixture');
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => tap.close(() => resolve()));
  });
  const socketPath = join(directory, 'parent.sock');
  const script = fileURLToPath(new globalThis.URL('../nitro/uniswap-relay.py', import.meta.url));
  // Run the production relay, replacing only its upstream address for this offline test.
  const child: ChildProcess = spawn('python3', ['-c', `
import os, runpy, socket, sys
script, local, port = sys.argv[1:]
original = socket.create_connection
def connection(destination, timeout):
    assert destination == ("trade-api.gateway.uniswap.org", 443)
    return original(("127.0.0.1", int(port)), timeout=timeout)
socket.create_connection = connection
sys.path.insert(0, os.path.dirname(script))
sys.argv = [script, "parent", "--unix-socket", local]
runpy.run_path(script, run_name="__main__")
`, script, socketPath, String(tapAddress.port)], { stdio: 'ignore' });
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill(); await stopped;
    }
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('relay exited');
    try { await stat(socketPath); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
  const client = (trust: string | undefined = ca, timeoutMs = 2000) => new UniswapClient({ apiUrl: URL,
    apiKey: API_KEY, chainId: 11155111, timeoutMs, fetch: uniswapRelayFetch(socketPath, trust) });
  return { client, received, wire, socketPath, ca, child };
}

describe('Uniswap HTTPS over the parent relay', () => {
  it('authenticates the API hostname and keeps the HTTP request encrypted through the parent', async () => {
    const { client, received, wire } = await fixture();
    expect(await client().quote(REQUEST)).toEqual({ amountIn: 100n, amountOut: 200n, minAmountOut: 199n });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ url: '/v1/quote', host: HOST, sni: HOST, key: API_KEY });
    const bytes = Buffer.concat(wire).toString('latin1');
    expect(wire.length).toBeGreaterThan(0);
    expect(bytes).not.toContain(API_KEY);
    expect(bytes).not.toContain(EOA);
    expect(bytes).not.toContain('POST /v1/quote');
  });

  it('rejects an untrusted certificate before sending the API key', async () => {
    const { socketPath, received } = await fixture();
    const client = new UniswapClient({ apiUrl: URL, apiKey: API_KEY, chainId: 11155111,
      timeoutMs: 2000, fetch: uniswapRelayFetch(socketPath) });
    await expect(client.quote(REQUEST)).rejects.toThrow(/^UNISWAP_UNAVAILABLE$/);
    expect(received).toEqual([]);
  });

  it('rejects a trusted certificate for a different hostname', async () => {
    const { client, received } = await fixture({ host: 'another-api.example' });
    await expect(client().quote(REQUEST)).rejects.toThrow(/^UNISWAP_UNAVAILABLE$/);
    expect(received).toEqual([]);
  });

  it('does not follow redirects or resend the API key', async () => {
    const { client, received } = await fixture({ handler: (_req, res) => {
      res.writeHead(302, { location: 'https://another-api.example/collect' }); res.end('{}');
    } });
    await expect(client().quote(REQUEST)).rejects.toThrow('UNISWAP_QUOTE_FAILED:302');
    expect(received).toHaveLength(1);
  });

  it('aborts a stalled response after its total deadline', async () => {
    const { client } = await fixture({ handler: (_req, res) => { res.writeHead(200); res.write('{'); } });
    await expect(client(undefined, 50).quote(REQUEST)).rejects.toThrow(/^UNISWAP_UNAVAILABLE$/);
  });

  it('bounds the response body', async () => {
    const { client } = await fixture({ handler: (_req, res) => res.end('x'.repeat(1024 * 1024 + 1)) });
    await expect(client().quote(REQUEST)).rejects.toThrow(/^UNISWAP_UNAVAILABLE$/);
  });

  it('refuses other destinations and plaintext requests without contacting the relay', async () => {
    const fetch = uniswapRelayFetch('/nonexistent-relay');
    for (const url of ['http://' + HOST + '/v1/quote', URL + '/other', 'https://another-api.example/quote']) {
      await expect(fetch(url, { method: 'POST', body: '{}', signal: AbortSignal.timeout(50) }))
        .rejects.toThrow('UNISWAP_UNAVAILABLE');
    }
  });

  it('uses only the configured relay, without a direct-network fallback', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { child, client } = await fixture();
    const stopped = once(child, 'exit'); child.kill(); await stopped;
    await expect(client().quote(REQUEST)).rejects.toThrow(/^UNISWAP_UNAVAILABLE$/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pins the Nitro factory to the supported HTTPS API endpoint', () => {
    const config = { UNISWAP_API_URL: URL, UNISWAP_API_KEY: API_KEY, CHAIN_ID: 11155111, PRICE_QUOTE_TIMEOUT_MS: 2000 };
    expect(createNitroUniswapClient(config)).toBeInstanceOf(UniswapClient);
    for (const url of ['http://' + HOST + '/v1', 'https://another-api.example/v1', URL + '?key=secret']) {
      expect(() => createNitroUniswapClient({ ...config, UNISWAP_API_URL: url })).toThrow('INVALID_UNISWAP_ENDPOINT');
    }
  });
});
