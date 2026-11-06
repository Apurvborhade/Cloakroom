import { Agent, request, type RequestOptions } from 'node:https';
import { connect, type TLSSocket } from 'node:tls';
import type { EnclaveConfig } from './config.js';
import { UniswapClient, type QuoteFetch } from './uniswap.js';

const HOST = 'trade-api.gateway.uniswap.org';
const API_URL = `https://${HOST}/v1`;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const unavailable = () => new Error('UNISWAP_UNAVAILABLE');

class UniswapRelayAgent extends Agent {
  constructor(private readonly socketPath: string, private readonly ca?: string) {
    super({ keepAlive: false, maxCachedSessions: 0 });
  }

  override createConnection(options: RequestOptions): TLSSocket {
    if (options.hostname !== HOST && options.host !== HOST) throw unavailable();
    return connect({ path: this.socketPath, servername: HOST, rejectUnauthorized: true,
      minVersion: 'TLSv1.2', ...(this.ca ? { ca: this.ca } : {}) });
  }
}

/** Fixed-destination JSON transport; the parent sees TLS records only. */
export function uniswapRelayFetch(socketPath = '\0cloakroom-uniswap', trustedCa?: string): QuoteFetch {
  return async (url, init) => {
    if (url !== `${API_URL}/quote` || init.method !== 'POST' || typeof init.body !== 'string'
        || Buffer.byteLength(init.body) > 65_536 || !init.signal || init.signal.aborted) throw unavailable();
    const headers = new Headers(init.headers);
    const agent = new UniswapRelayAgent(socketPath, trustedCa);
    try {
      return await new Promise((resolve, reject) => {
        const fail = () => reject(unavailable());
        const req = request(url, { method: 'POST', agent, signal: init.signal!, headers: {
          'content-type': 'application/json', 'x-api-key': headers.get('x-api-key') ?? '',
          'content-length': Buffer.byteLength(init.body as string), 'accept-encoding': 'identity',
        } }, (res) => {
          const parts: Buffer[] = [];
          let length = 0;
          res.on('error', fail);
          res.on('aborted', fail);
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > MAX_RESPONSE_BYTES) { req.destroy(); res.destroy(); fail(); }
            else parts.push(chunk);
          });
          res.on('end', () => {
            if (!res.complete || length > MAX_RESPONSE_BYTES) { fail(); return; }
            const status = res.statusCode ?? 502;
            const body = Buffer.concat(parts).toString('utf8');
            resolve({ ok: status >= 200 && status < 300, status, json: async () => JSON.parse(body) });
          });
        });
        req.on('error', fail);
        req.end(init.body as string);
      });
    } finally { agent.destroy(); }
  };
}

/** Use this factory at Nitro application boot; it never falls back to direct networking. */
export function createNitroUniswapClient(config: Pick<EnclaveConfig,
  'UNISWAP_API_URL' | 'UNISWAP_API_KEY' | 'CHAIN_ID' | 'PRICE_QUOTE_TIMEOUT_MS'>): UniswapClient {
  if (config.UNISWAP_API_URL.replace(/\/$/, '') !== API_URL) throw new Error('INVALID_UNISWAP_ENDPOINT');
  return new UniswapClient({ apiUrl: API_URL, apiKey: config.UNISWAP_API_KEY, chainId: config.CHAIN_ID,
    timeoutMs: config.PRICE_QUOTE_TIMEOUT_MS, fetch: uniswapRelayFetch() });
}
