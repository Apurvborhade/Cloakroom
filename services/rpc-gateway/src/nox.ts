import { randomBytes, randomInt } from 'node:crypto';
import { Duplex } from 'node:stream';
import { connect, type TLSSocket } from 'node:tls';
import { Agent, request, type RequestOptions } from 'node:https';
import { NoxClient, type NoxClientConfig } from '@hisoka-io/nox-client';
import { Tunnel, type TunnelPort } from './vendor/nox-tunnel.js';
import type { RpcTransport, RpcResponse } from './gateway.js';

class TunnelSocket extends Duplex {
  private readonly abort = new AbortController();
  private readonly outgoing: Buffer[] = [];
  private pumping = false;
  private received = 0;
  private readonly tunnel: Tunnel;
  constructor(port: TunnelPort, host: string, private readonly deadline: number) {
    super();
    const exits = port.tunnelExits();
    if (exits.length === 0) throw new Error('NOX_TLS_UNAVAILABLE');
    this.tunnel = new Tunnel(port, exits[randomInt(exits.length)]!, host, 443,
      { copyAfterMs: () => 3000, gapMs: 1000, maxCopies: 2 }, { now: Date.now, randomBytes }, (data) => {
        this.received += data.length;
        if (this.received > 2_097_152) throw new Error('NOX_RESPONSE_TOO_LARGE');
        this.push(Buffer.from(data));
      });
  }
  override _read() { void this.pump(); }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    if (this.outgoing.reduce((sum, part) => sum + part.length, chunk.length) > 262_144) {
      callback(new Error('NOX_REQUEST_TOO_LARGE')); return;
    }
    this.outgoing.push(Buffer.from(chunk));
    callback();
    setImmediate(() => { void this.pump(); });
  }
  private async pump() {
    if (this.pumping || this.destroyed || (this.tunnel.seq === 0 && this.outgoing.length === 0)) return;
    this.pumping = true;
    try {
      while (!this.destroyed && !this.tunnel.eof) {
        const before = this.received;
        const data = Buffer.concat(this.outgoing.splice(0));
        await this.tunnel.exchange({ data, surbs: 4, deadlineAt: this.deadline, background: false,
          signal: this.abort.signal, openTimeoutMs: 15_000,
          satisfied: () => this.received > before || this.outgoing.length > 0 });
        // Let TLS process the server flight and enqueue its next write.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      if (this.tunnel.eof && !this.destroyed) this.push(null);
    } catch { if (!this.destroyed) this.destroy(new Error('NOX_TUNNEL_UNAVAILABLE')); }
    finally { this.pumping = false; }
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    this.abort.abort();
    this.outgoing.length = 0;
    // Teardown never starts another HTTP request or resubmits a transaction.
    if (this.tunnel.seq > 0) void this.tunnel.teardown(new Uint8Array(), Date.now() + 2000).catch(() => {});
    callback(error);
  }
}

export class NoxTlsAgent extends Agent {
  constructor(private readonly port: TunnelPort, private readonly hostname: string,
    private readonly timeoutMs = 45_000, private readonly ca?: string) {
    super({ keepAlive: false, maxCachedSessions: 0, maxSockets: 4, maxTotalSockets: 4 });
  }
  override createConnection(options: RequestOptions): TLSSocket {
    if (options.hostname !== this.hostname && options.host !== this.hostname) throw new Error('NOX_HOST_MISMATCH');
    const socket = new TunnelSocket(this.port, this.hostname, Date.now() + this.timeoutMs);
    return connect({ socket, servername: this.hostname, rejectUnauthorized: true, minVersion: 'TLSv1.2',
      ALPNProtocols: ['http/1.1'], ...(this.ca ? { ca: this.ca } : {}) });
  }
}

export async function createNoxTransport(target: string, config: NoxClientConfig): Promise<RpcTransport & { close(): void }> {
  const url = new URL(target);
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash) {
    throw new Error('HTTPS_UPSTREAM_REQUIRED');
  }
  const nox = await NoxClient.init({ ...config, retryOnTimeout: false, log: () => {} });
  const agent = new NoxTlsAgent(nox, url.hostname);
  return {
    close() { agent.destroy(); nox.disconnect(); },
    send(call, signal) {
      return new Promise<RpcResponse>((resolve, reject) => {
        const body = JSON.stringify(call);
        const fail = () => reject(new Error('NOX_RPC_UNAVAILABLE'));
        const req = request(url, { agent, method: 'POST', signal,
          headers: { 'content-type': 'application/json', 'accept-encoding': 'identity', 'content-length': Buffer.byteLength(body) } }, (res) => {
          if (res.statusCode !== 200) { res.destroy(); fail(); return; }
          const chunks: Buffer[] = [];
          let length = 0;
          res.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 1_048_576) { req.destroy(); res.destroy(); fail(); }
            else chunks.push(chunk);
          });
          res.on('error', fail); res.on('aborted', fail);
          res.on('end', () => {
            if (!res.complete || length > 1_048_576) { fail(); return; }
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as RpcResponse); }
            catch { fail(); }
          });
        });
        req.on('error', fail); req.end(body);
      });
    },
  };
}
