import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createRpcGateway, type RpcRequest, type RpcResponse } from '../src/gateway.js';

// External compatibility probe only. Chromium is not part of a Nitro deployment.
const specifier = process.env.ANON_RPC_SPECIFIER;
const target = process.env.ANON_RPC_TARGET_URL;
const bootstrap = process.env.ANON_RPC_BOOTSTRAP_URL;
if (!specifier || !/^0x[0-9a-fA-F]{40}$/.test(specifier) || !target || !bootstrap) {
  throw new Error('Set ANON_RPC_SPECIFIER, ANON_RPC_TARGET_URL and ANON_RPC_BOOTSTRAP_URL');
}
for (const endpoint of [target, bootstrap]) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('HTTPS_REQUIRED');
}
const config = process.env.ANON_RPC_WORKER_CONFIG ? JSON.parse(process.env.ANON_RPC_WORKER_CONFIG) : undefined;
const { outputFiles } = await build({ stdin: {
  contents: `import { AnonRpcWorker } from '@anon-rpc/browser-harness'; globalThis.AnonRpcWorker = AnonRpcWorker;`,
  resolveDir: resolve('apps/web'), sourcefile: 'anon-write-probe.js',
}, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false });
const script = outputFiles[0]!.text;
const host = createServer((req, res) => {
  res.setHeader('content-type', req.url === '/probe.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/probe.js' ? script : '<!doctype html><script src="/probe.js"></script>');
});
await new Promise<void>((done) => host.listen(0, '127.0.0.1', done));
const hostAddress = host.address();
assert(hostAddress && typeof hostAddress !== 'string');
const directory = mkdtempSync(join(tmpdir(), 'anon-write-probe-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(directory, 'key.pem'),
  '-out', join(directory, 'cert.pem'), '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-days', '1'], { stdio: 'ignore' });
const cert = readFileSync(join(directory, 'cert.pem'));
let gateway: ReturnType<typeof createRpcGateway> | undefined;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
let stage = 'bootstrap';
try {
  const page = await browser.newPage();
  await page.exposeFunction('bootstrapRequest', async (call: { method: string; params?: unknown[] }) => {
    const response = await fetch(bootstrap, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...call }), signal: AbortSignal.timeout(15_000) });
    const body = await response.json() as { error?: unknown; result?: unknown };
    if (!response.ok || body.error) throw new Error('BOOTSTRAP_RPC_FAILED');
    return body.result;
  });
  await page.goto(`http://127.0.0.1:${hostAddress.port}`);
  await page.evaluate(async ({ specifier, config }) => {
    const scope = globalThis as any;
    scope.worker = new scope.AnonRpcWorker({ address: specifier, ...(config ? { config } : {}),
      preExisting: { rpcProvider: { request: scope.bootstrapRequest } } });
    await Promise.race([scope.worker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('WORKER_TIMEOUT')), 60_000))]);
  }, { specifier, config });
  console.log('Worker initialized; bundle hash verified by browser harness.');
  stage = 'read';
  gateway = createRpcGateway({ tls: { key: readFileSync(join(directory, 'key.pem')), cert }, timeoutMs: 45_000,
    transport: { async send(call, signal): Promise<RpcResponse> {
      const operation = page.evaluate(async ({ call, target }) => {
        const scope = globalThis as any;
        scope.controllers ??= new Map();
        const controller = new AbortController();
        scope.controllers.set(call.id, controller);
        const timer = setTimeout(() => controller.abort(), 40_000);
        try {
          const response = await scope.worker.fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify(call), signal: controller.signal });
          if (!response.ok) throw new Error('UPSTREAM_HTTP_FAILED');
          const text = await response.text();
          if (text.length > 1_048_576) throw new Error('UPSTREAM_RESPONSE_TOO_LARGE');
          return JSON.parse(text);
        } finally { clearTimeout(timer); scope.controllers.delete(call.id); }
      }, { call, target });
      const abort = () => { void page.evaluate((id) => (globalThis as any).controllers?.get(id)?.abort(), call.id).catch(() => {}); };
      signal.addEventListener('abort', abort, { once: true });
      try { return await operation; } finally { signal.removeEventListener('abort', abort); }
    } } });
  await new Promise<void>((done) => gateway!.listen(0, '127.0.0.1', done));
  const address = gateway.address();
  assert(address && typeof address !== 'string');
  const viaGateway = (call: RpcRequest) => new Promise<RpcResponse>((done, reject) => {
    const req = request(`https://127.0.0.1:${address.port}`, { method: 'POST', ca: cert,
      headers: { 'content-type': 'application/json' } }, (response) => {
      let raw = '';
      response.on('data', (part) => { raw += part; });
      response.once('end', () => { try { done(JSON.parse(raw)); } catch { reject(new Error('GATEWAY_RESPONSE_INVALID')); } });
    });
    req.once('error', () => reject(new Error('GATEWAY_UNAVAILABLE'))); req.end(JSON.stringify(call));
  });
  const chain = await viaGateway({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
  assert.equal(chain.result, '0xaa36a7', 'Anonymous read did not return Sepolia');
  console.log('PASS: Sepolia chain ID read through TLS gateway and anonymous worker.');
  stage = 'write';
  const account = privateKeyToAccount(generatePrivateKey());
  const raw = await account.signTransaction({ type: 'eip1559', chainId: 11155111, nonce: 0, to: account.address,
    value: 0n, gas: 21_000n, maxFeePerGas: 10_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n });
  const sent = await viaGateway({ jsonrpc: '2.0', id: 2, method: 'eth_sendRawTransaction', params: [raw] });
  assert(sent.error && /insufficient funds/i.test(sent.error.message), 'Expected upstream rejection of an unfunded signed transaction');
  console.log('PASS: signed raw transaction reached Sepolia RPC through anonymous worker; rejected for insufficient funds. No assets spent.');
} catch {
  console.error(`Anonymous write probe failed during ${stage}; no direct fallback was used.`);
  process.exitCode = 1;
} finally {
  if (gateway) { gateway.closeAllConnections(); await new Promise<void>((done) => gateway!.close(() => done())); }
  await browser.close();
  await new Promise<void>((done) => host.close(() => done()));
  rmSync(directory, { recursive: true, force: true });
}
