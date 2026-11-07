import { connect as tcpConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { Agent, request, type RequestOptions } from 'node:https';
import type { Duplex } from 'node:stream';

/** The parent receives a destination hostname and encrypted TLS records only. */
export class EgressAgent extends Agent {
  constructor(private readonly socketPath: string, private readonly ca?: string) {
    super({ keepAlive: true, maxSockets: 8, maxTotalSockets: 16, maxFreeSockets: 4 });
  }
  override createConnection(options: RequestOptions, callback?: (error: Error | null, stream: Duplex) => void) {
    const host = String(options.hostname ?? options.host);
    if (!callback || !/^[a-z0-9.-]{1,253}$/i.test(host) || Number(options.port ?? 443) !== 443) {
      throw new Error('INVALID_EGRESS_DESTINATION');
    }
    const socket = tcpConnect(this.socketPath);
    const timer = setTimeout(() => socket.destroy(new Error('EGRESS_TIMEOUT')), 10_000);
    const fail = () => { clearTimeout(timer); callback(new Error('EGRESS_UNAVAILABLE'), socket); };
    socket.once('error', fail);
    socket.once('connect', () => socket.write(`${host}\n`));
    socket.once('data', (data) => {
      clearTimeout(timer);
      socket.off('error', fail);
      if (data.length !== 1 || data[0] !== 0) { callback(new Error('EGRESS_REFUSED'), socket); socket.destroy(); return; }
      const tls = tlsConnect({ socket, servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true,
        ALPNProtocols: ['http/1.1'], ...(this.ca ? { ca: this.ca } : {}) });
      callback(null, tls);
    });
    return undefined;
  }
}

export function createRelayFetch(socketPath = '\0cloakroom-egress', ca?: string) {
  const agent = new EgressAgent(socketPath, ca);
  let active = 0;
  return {
    close() { agent.destroy(); },
    async fetch(input: string, init: RequestInit = {}): Promise<Response> {
      const url = new URL(input);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) {
        throw new Error('HTTPS_EGRESS_REQUIRED');
      }
      if (active >= 32) throw new Error('EGRESS_BUSY');
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      if (headers.host || headers.connection || headers['transfer-encoding']) throw new Error('INVALID_EGRESS_HEADERS');
      const body = init.body === undefined || init.body === null ? undefined
        : typeof init.body === 'string' ? Buffer.from(init.body)
        : init.body instanceof Uint8Array ? Buffer.from(init.body)
        : init.body instanceof ArrayBuffer ? Buffer.from(init.body) : undefined;
      if ((init.body && !body) || (body?.length ?? 0) > 1_048_576) throw new Error('INVALID_EGRESS_BODY');
      active++;
      try {
        return await new Promise<Response>((resolve, reject) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 45_000);
          const cancel = () => controller.abort();
          init.signal?.addEventListener('abort', cancel, { once: true });
          if (init.signal?.aborted) cancel();
          const cleanup = () => { clearTimeout(timer); init.signal?.removeEventListener('abort', cancel); };
          const fail = () => { cleanup(); reject(new Error('EGRESS_UNAVAILABLE')); };
          const req = request(url, { agent, method: init.method ?? 'GET', signal: controller.signal,
            headers: { ...headers, 'accept-encoding': 'identity', ...(body ? { 'content-length': body.length } : {}) } }, (res) => {
            const parts: Buffer[] = []; let length = 0;
            res.on('data', (part: Buffer) => {
              length += part.length;
              if (length > 2_097_152) { res.destroy(); req.destroy(); fail(); } else parts.push(part);
            });
            res.on('error', fail); res.on('aborted', fail);
            res.on('end', () => {
              if (!res.complete || length > 2_097_152) { fail(); return; }
              cleanup();
              try {
                const responseHeaders = new Headers();
                for (const [key, value] of Object.entries(res.headers)) {
                  if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
                }
                resolve(new Response([204, 205, 304].includes(res.statusCode!) ? null : Buffer.concat(parts),
                  { status: res.statusCode, headers: responseHeaders }));
              } catch { fail(); }
            });
          });
          req.on('error', fail); req.end(body);
        });
      } finally { active--; }
    },
  };
}
