import { Agent, request, type RequestOptions } from 'node:https';
import { connect, type TLSSocket } from 'node:tls';
import { http } from 'viem';

const TRANSPORT_URL = 'https://enclave-rpc.invalid/';
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const unavailable = () => new Error('RPC_UNAVAILABLE');

class RpcRelayAgent extends Agent {
  constructor(private readonly socketPath: string, private readonly hostname: string, private readonly ca?: string) {
    super({ keepAlive: false, maxCachedSessions: 0 });
  }

  override createConnection(options: RequestOptions): TLSSocket {
    if (options.hostname !== this.hostname && options.host !== this.hostname) throw unavailable();
    return connect({ path: this.socketPath, servername: this.hostname, rejectUnauthorized: true,
      minVersion: 'TLSv1.2', ...(this.ca ? { ca: this.ca } : {}) });
  }
}

/** The endpoint stays inside this closure, including API credentials in its path. */
export function rpcRelayFetch(endpoint: string, socketPath = '\0cloakroom-rpc', trustedCa?: string): typeof fetch {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('INVALID_RPC_ENDPOINT'); }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash
      || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname)) throw new Error('INVALID_RPC_ENDPOINT');

  return async (input, init) => {
    if (String(input) !== TRANSPORT_URL || init?.method !== 'POST' || typeof init.body !== 'string'
        || Buffer.byteLength(init.body) > 1024 * 1024 || !init.signal || init.signal.aborted) throw unavailable();
    const agent = new RpcRelayAgent(socketPath, url.hostname, trustedCa);
    try {
      return await new Promise<Response>((resolve, reject) => {
        const fail = () => reject(unavailable());
        const req = request(url, { method: 'POST', agent, signal: init.signal!, headers: {
          'content-type': 'application/json', 'content-length': Buffer.byteLength(init.body as string),
          'accept-encoding': 'identity',
        } }, (res) => {
          res.on('error', fail);
          const status = res.statusCode ?? 502;
          if (status < 200 || status >= 300) { res.destroy(); req.destroy(); fail(); return; }
          const parts: Buffer[] = [];
          let length = 0;
          res.on('aborted', fail);
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > MAX_RESPONSE_BYTES) { req.destroy(); res.destroy(); fail(); }
            else parts.push(chunk);
          });
          res.on('end', () => {
            if (!res.complete || length > MAX_RESPONSE_BYTES) { fail(); return; }
            resolve(new Response(Buffer.concat(parts), { status: 200, headers: { 'content-type': 'application/json' } }));
          });
        });
        req.on('error', fail);
        req.end(init.body as string);
      });
    } finally { agent.destroy(); }
  };
}

export function createNitroRpcTransport(endpoint: string) {
  // Viem includes the transport URL in errors; give it a credential-free label.
  return http(TRANSPORT_URL, { fetchFn: rpcRelayFetch(endpoint), timeout: 10_000, retryCount: 0 });
}
