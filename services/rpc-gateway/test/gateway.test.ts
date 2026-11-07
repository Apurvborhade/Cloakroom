import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import type { Server } from 'node:https';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPublicClient, createTestClient, http, parseEther, publicActions } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { createFetchTransport, createRpcGateway, tlsSpkiSha256, type GatewayOptions, type RpcRequest, type RpcResponse } from '../src/gateway.js';

let tls: { key: Buffer; cert: Buffer }, directory: string;
let anvil: ChildProcess;
const port = 20000 + Math.floor(Math.random() * 20000);
const rpcUrl = `http://127.0.0.1:${port}`;
const chain = createPublicClient({ transport: http(rpcUrl), chain: foundry, pollingInterval: 20 });
const test = createTestClient({ mode: 'anvil', transport: http(rpcUrl), chain: foundry }).extend(publicActions);
const servers: Server[] = [];

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'rpc-gateway-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'),
    '-out', join(directory, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-days', '1'], { stdio: 'ignore' });
  tls = { key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) };
  anvil = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await chain.getBlockNumber(); return; } catch { await new Promise((done) => setTimeout(done, 50)); }
  }
  throw new Error('ANVIL_UNAVAILABLE');
}, 15_000);
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => {
    server.closeAllConnections(); server.close(() => done());
  })));
});
afterAll(() => { anvil?.kill(); rmSync(directory, { recursive: true, force: true }); });

async function start(overrides: Partial<GatewayOptions> = {}) {
  const send = vi.fn(async (call: RpcRequest, signal: AbortSignal): Promise<RpcResponse> => {
    const reply = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, signal, body: JSON.stringify(call) });
    return await reply.json() as RpcResponse;
  });
  const server = createRpcGateway({ tls, transport: { send }, ...overrides });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('MISSING_ADDRESS');
  const url = `https://127.0.0.1:${address.port}/`;
  return { send, server, url };
}
function post(url: string, input: unknown, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = request(url, { method: 'POST', ca: tls.cert, headers: { 'content-type': 'application/json', ...headers } }, (response) => {
      let raw = '';
      response.on('data', (chunk) => { raw += chunk; });
      response.once('end', () => resolve({ status: response.statusCode!, body: JSON.parse(raw) }));
    });
    req.once('error', reject); req.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
const call = (method = 'eth_chainId', params: unknown[] = [], id = 1) => ({ jsonrpc: '2.0', id, method, params });

describe('isolated TLS RPC gateway', () => {
  it('forwards a wallet-signed transaction unchanged and reads its confirmed receipt', async () => {
    const { url, send } = await start();
    const account = privateKeyToAccount(generatePrivateKey());
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    await test.setBalance({ address: account.address, value: parseEther('1') });
    const raw = await account.signTransaction({ chainId: foundry.id, type: 'eip1559', nonce: 0,
      gas: 21_000n, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n,
      to: recipient, value: parseEther('0.001') });
    expect((await post(url, call())).body.result).toBe('0x7a69');
    const broadcast = await post(url, call('eth_sendRawTransaction', [raw], 2));
    expect(broadcast.status).toBe(200);
    const receipt = await chain.waitForTransactionReceipt({ hash: broadcast.body.result });
    expect(receipt.status).toBe('success');
    expect(await chain.getBalance({ address: recipient })).toBe(parseEther('0.001'));
    expect(send.mock.calls[1]![0]).toEqual(call('eth_sendRawTransaction', [raw], 2));
    expect((await post(url, call('eth_getTransactionReceipt', [receipt.transactionHash], 3))).body.result.status).toBe('0x1');
    expect(tlsSpkiSha256(tls.cert)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(['eth_sendTransaction', 'eth_sign', 'personal_sign', 'admin_nodeInfo', 'debug_traceTransaction'])('refuses %s before transport', async (method) => {
    const { url, send } = await start();
    expect((await post(url, call(method))).body.error.code).toBe(-32601);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed, unsigned and oversized requests', async () => {
    const { url, send } = await start({ maxBodyBytes: 512, maxBatch: 2 });
    expect((await post(url, '{')).body.error.code).toBe(-32700);
    expect((await post(url, call('eth_sendRawTransaction', [{ to: '0x00' }]))).body.error.code).toBe(-32602);
    expect((await post(url, call('eth_sendRawTransaction', ['0x123']))).body.error.code).toBe(-32602);
    expect((await post(url, { ...call(), params: null })).body.error.code).toBe(-32600);
    expect((await post(url, 'x'.repeat(513))).status).toBe(413);
    expect((await post(url, [call(), call(), call()])).status).toBe(400);
    expect((await post(url, [])).status).toBe(400);
    expect((await post(url, call(), { 'content-type': 'text/plain' })).status).toBe(415);
    expect(send).not.toHaveBeenCalled();
  });

  it('survives a client resetting a partial request body and releases the slot', async () => {
    const { url, server, send } = await start({ maxConcurrent: 1 });
    const received = new Promise<import('node:http').IncomingMessage>((done) => server.once('request', done));
    const req = request(url, { method: 'POST', ca: tls.cert, headers: { 'content-type': 'application/json' } });
    req.on('error', () => {});
    req.write('{');
    const incoming = await received;
    const aborted = new Promise<void>((done) => incoming.once('aborted', () => done()));
    req.destroy();
    await aborted;
    await vi.waitFor(async () => expect((await post(url, call())).body.result).toBe('0x7a69'));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('survives a reset after rejecting a streamed oversized body', async () => {
    const { url, send } = await start({ maxBodyBytes: 128 });
    const oversized = new Promise<number>((done, reject) => {
      const req = request(url, { method: 'POST', ca: tls.cert, headers: { 'content-type': 'application/json' } }, (response) => {
        done(response.statusCode!);
        req.destroy();
      });
      req.on('error', () => {});
      req.write('x'.repeat(129));
      req.once('timeout', () => reject(new Error('NO_OVERSIZE_RESPONSE')));
      req.setTimeout(2000);
    });
    expect(await oversized).toBe(413);
    expect((await post(url, call())).body.result).toBe('0x7a69');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns one answer per batch member without passing forbidden methods through', async () => {
    const { url, send } = await start();
    const reply = await post(url, [call(), call('eth_sign', [], 2), call('eth_blockNumber', [], 3)]);
    expect(reply.body.map((item: RpcResponse) => item.id)).toEqual([1, 2, 3]);
    expect(reply.body[1].error.code).toBe(-32601);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not retry a timed-out write or exceed concurrency when the transport ignores abort', async () => {
    const send = vi.fn(() => new Promise<RpcResponse>(() => {}));
    const { url } = await start({ transport: { send }, timeoutMs: 40, maxConcurrent: 1 });
    const first = await post(url, [call('eth_sendRawTransaction', ['0x1234']), call('eth_chainId', [], 2)]);
    expect(first.body).toHaveLength(2);
    expect(first.body[0].error.message).toContain('status may be unknown');
    expect(first.body[1].error.message).toContain('timed out');
    expect((await post(url, call())).body.error.code).toBe(-32005);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('bounds concurrent requests and resumes after completion', async () => {
    let finish: (value: RpcResponse) => void = () => {};
    const send = vi.fn(() => new Promise<RpcResponse>((done) => { finish = done; }));
    const { url } = await start({ transport: { send }, maxConcurrent: 1 });
    const pending = post(url, call());
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((await post(url, call())).status).toBe(429);
    finish({ jsonrpc: '2.0', id: 1, result: '0x1' });
    expect((await pending).body.result).toBe('0x1');
  });

  it('does not expose upstream credential URLs or return an answer with a mismatched id', async () => {
    const send = vi.fn().mockRejectedValue(new Error('https://secret.example/PRIVATE_KEY'));
    const { url } = await start({ transport: { send } });
    expect(JSON.stringify((await post(url, call())).body)).not.toContain('PRIVATE_KEY');
    send.mockResolvedValue({ jsonrpc: '2.0', id: 99, result: 'wrong' });
    expect((await post(url, call())).body.error).toBeDefined();
    send.mockResolvedValue({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'provider failure at https://secret.example/PRIVATE_KEY' } });
    expect(JSON.stringify((await post(url, call())).body)).not.toContain('PRIVATE_KEY');
  });

  it('caps upstream response bytes and requires HTTPS for a supplied anonymous fetch', async () => {
    expect(() => createFetchTransport('http://rpc.example', fetch)).toThrow('HTTPS_UPSTREAM_REQUIRED');
    const anonymousFetch = vi.fn().mockResolvedValue(new Response('x'.repeat(513)));
    const adapter = createFetchTransport('https://rpc.example', anonymousFetch, 512);
    await expect(adapter.send(call() as RpcRequest, new AbortController().signal)).rejects.toThrow('UPSTREAM_RESPONSE_TOO_LARGE');
    expect(anonymousFetch.mock.calls[0]![1]).toMatchObject({ method: 'POST', redirect: 'error' });
  });
});
