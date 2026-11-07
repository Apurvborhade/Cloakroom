import { createHash, X509Certificate } from 'node:crypto';
import { createServer, type ServerOptions } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type RpcId = string | number | null;
export type RpcRequest = { jsonrpc: '2.0'; id: RpcId; method: string; params: unknown[] };
export type RpcResponse = { jsonrpc: '2.0'; id: RpcId } & (
  | { result: unknown; error?: never }
  | { error: { code: number; message: string; data?: string }; result?: never }
);
export interface RpcTransport {
  send(request: RpcRequest, signal: AbortSignal): Promise<RpcResponse>;
}

const METHODS = new Set([
  'eth_chainId', 'net_version', 'web3_clientVersion', 'eth_blockNumber', 'eth_getBalance',
  'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas',
  'eth_feeHistory', 'eth_call', 'eth_getCode', 'eth_getTransactionByHash',
  'eth_getTransactionReceipt', 'eth_getBlockByHash', 'eth_getBlockByNumber', 'eth_getLogs',
  'eth_sendRawTransaction',
]);
const error = (id: RpcId, code: number, message: string): RpcResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export interface GatewayOptions {
  tls: Pick<ServerOptions, 'key' | 'cert'>;
  transport: RpcTransport;
  maxBodyBytes?: number;
  maxResponseBytes?: number;
  maxBatch?: number;
  maxConcurrent?: number;
  timeoutMs?: number;
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < 1 || actual > maximum) throw new Error('INVALID_GATEWAY_LIMIT');
  return actual;
}

function normalizeRequest(input: unknown): RpcRequest | RpcResponse {
  const id = object(input) && (typeof input.id === 'string' || typeof input.id === 'number' || input.id === null) ? input.id : null;
  if (!object(input) || input.jsonrpc !== '2.0' || !('id' in input) || id === null && input.id !== null
    || typeof id === 'number' && !Number.isSafeInteger(id) || typeof id === 'string' && id.length > 128
    || typeof input.method !== 'string' || !Array.isArray(input.params === undefined ? [] : input.params)) {
    return error(id, -32600, 'Invalid request');
  }
  if (!METHODS.has(input.method)) return error(id, -32601, 'Method not allowed');
  const params = (input.params ?? []) as unknown[];
  if (params.length > 10) return error(id, -32602, 'Invalid params');
  if (input.method === 'eth_sendRawTransaction' && (params.length !== 1 || typeof params[0] !== 'string'
    || !/^0x(?:[0-9a-fA-F]{2})+$/.test(params[0]))) return error(id, -32602, 'Expected one signed transaction');
  return { jsonrpc: '2.0', id, method: input.method, params };
}

function normalizeResponse(input: unknown, id: RpcId): RpcResponse {
  if (!object(input) || input.jsonrpc !== '2.0' || input.id !== id || ('result' in input) === ('error' in input)) {
    throw new Error('INVALID_RPC_RESPONSE');
  }
  if ('result' in input) return { jsonrpc: '2.0', id, result: input.result };
  if (!object(input.error) || !Number.isSafeInteger(input.error.code)) throw new Error('INVALID_RPC_ERROR');
  const message = String(input.error.message ?? '');
  const known = [
    /insufficient funds/i, /nonce too low/i, /already known/i, /replacement transaction underpriced/i,
    /execution reverted/i, /max fee per gas less than block base fee/i,
  ].find((pattern) => pattern.test(message));
  return { jsonrpc: '2.0', id, error: {
    code: input.error.code as number,
    message: known?.source.replaceAll('\\', '') ?? 'Upstream RPC error',
    ...(typeof input.error.data === 'string' && /^0x[0-9a-fA-F]*$/.test(input.error.data)
      && input.error.data.length <= 8194 ? { data: input.error.data } : {}),
  } };
}

async function readBody(request: IncomingMessage, limit: number, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      request.off('data', onData); request.off('end', onEnd); request.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (reason: string) => { cleanup(); request.resume(); reject(new Error(reason)); };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { fail('BODY_TOO_LARGE'); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const onError = () => fail('REQUEST_FAILED');
    const onAbort = () => fail('REQUEST_ABORTED');
    request.on('data', onData); request.once('end', onEnd); request.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

/** TLS must terminate here when this server runs inside an enclave. No transport is selected implicitly. */
export function createRpcGateway(options: GatewayOptions) {
  if (!options.tls.key || !options.tls.cert) throw new Error('TLS_REQUIRED');
  const maxBody = bounded(options.maxBodyBytes, 131_072, 1_048_576);
  const maxResponse = bounded(options.maxResponseBytes, 1_048_576, 4_194_304);
  const maxBatch = bounded(options.maxBatch, 10, 100);
  const maxConcurrent = bounded(options.maxConcurrent, 8, 64);
  const timeoutMs = bounded(options.timeoutMs, 15_000, 120_000);
  let active = 0;
  let transportActive = 0;
  const respond = (response: ServerResponse, status: number, body: unknown) => {
    if (response.destroyed || response.writableEnded) return;
    let json = JSON.stringify(body);
    if (Buffer.byteLength(json) > maxResponse) { status = 502; json = JSON.stringify(error(null, -32000, 'RPC response too large')); }
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(status >= 400 ? { connection: 'close' } : {}) });
    response.end(json);
  };
  const server = createServer({ ...options.tls, minVersion: 'TLSv1.2', handshakeTimeout: 10_000 }, async (request, response) => {
    // A peer may reset the stream after body parsing or an early rejection finished.
    request.on('error', () => {});
    if (request.url !== '/' || request.method !== 'POST') { respond(response, 404, error(null, -32601, 'Not found')); return; }
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] ?? '')) {
      respond(response, 415, error(null, -32600, 'Expected application/json')); return;
    }
    if (active >= maxConcurrent) { respond(response, 429, error(null, -32005, 'RPC gateway busy')); return; }
    active++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onClose = () => { if (!response.writableEnded) controller.abort(); };
    response.once('close', onClose);
    const onAborted = () => controller.abort();
    request.once('aborted', onAborted);
    try {
      const raw = await readBody(request, maxBody, controller.signal);
      let body: unknown;
      try { body = JSON.parse(raw.toString('utf8')); }
      catch { respond(response, 400, error(null, -32700, 'Parse error')); return; }
      const batch = Array.isArray(body);
      const calls: unknown[] = Array.isArray(body) ? body : [body];
      if (calls.length === 0 || calls.length > maxBatch) {
        respond(response, 400, error(null, -32600, 'Invalid batch size')); return;
      }
      const results: RpcResponse[] = [];
      for (const input of calls) {
        const call = normalizeRequest(input);
        if (!('method' in call)) { results.push(call); continue; }
        if (controller.signal.aborted) { results.push(error(call.id, -32000, 'RPC request timed out')); continue; }
        if (transportActive >= maxConcurrent) { results.push(error(call.id, -32005, 'RPC transport busy')); continue; }
        let cancel: (() => void) | undefined;
        try {
          const aborted = new Promise<never>((_, reject) => {
            cancel = () => reject(new Error('REQUEST_ABORTED'));
            controller.signal.addEventListener('abort', cancel, { once: true });
            if (controller.signal.aborted) cancel();
          });
          transportActive++;
          const pending = Promise.resolve().then(() => options.transport.send(call, controller.signal))
            .finally(() => { transportActive--; });
          const answer = await Promise.race([pending, aborted]);
          results.push(normalizeResponse(answer, call.id));
        } catch {
          results.push(error(call.id, -32000, controller.signal.aborted
            ? 'RPC timed out; transaction status may be unknown' : 'RPC transport unavailable; transaction status may be unknown'));
        } finally {
          if (cancel) controller.signal.removeEventListener('abort', cancel);
        }
      }
      respond(response, 200, batch ? results : results[0]);
    } catch (failure) {
      const oversized = failure instanceof Error && failure.message === 'BODY_TOO_LARGE';
      respond(response, oversized ? 413 : 408, error(null, -32600, oversized ? 'RPC request too large' : 'Request timed out'));
    } finally {
      clearTimeout(timer); response.off('close', onClose); request.off('aborted', onAborted); active--;
    }
  });
  server.requestTimeout = timeoutMs;
  server.headersTimeout = Math.min(timeoutMs, 10_000);
  server.maxHeadersCount = 32;
  server.maxConnections = maxConcurrent * 2;
  server.on('tlsClientError', () => {});
  return server;
}

/** Bind this digest to a fresh Nitro quote before claiming that a remote TLS endpoint is attested. */
export function tlsSpkiSha256(certificate: string | Buffer): string {
  const spki = new X509Certificate(certificate).publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(spki).digest('hex');
}

/** Supply the anonymous fetch explicitly. There is no fallback to global fetch. */
export function createFetchTransport(url: string, anonymousFetch: typeof fetch, maxBytes = 1_048_576): RpcTransport {
  if (typeof anonymousFetch !== 'function') throw new Error('TRANSPORT_REQUIRED');
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.username || target.password || target.hash) throw new Error('HTTPS_UPSTREAM_REQUIRED');
  bounded(maxBytes, 1_048_576, 4_194_304);
  return {
    async send(request, signal) {
      const response = await anonymousFetch(target.href, { method: 'POST', signal, redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      if (!response.ok || !response.body) throw new Error('UPSTREAM_UNAVAILABLE');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > maxBytes) throw new Error('UPSTREAM_RESPONSE_TOO_LARGE');
          chunks.push(value);
        }
        return normalizeResponse(JSON.parse(Buffer.concat(chunks).toString('utf8')), request.id);
      } finally { await reader.cancel().catch(() => {}); }
    },
  };
}
