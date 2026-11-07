import { createServer, request } from 'node:https';
import { connect, type Socket } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { encodeTunnelReplyV1, type TopologyNode } from '@hisoka-io/nox-client';
import { NoxTlsAgent } from '../src/nox.js';
import type { TunnelPort } from '../src/vendor/nox-tunnel.js';

let directory: string, key: Buffer, cert: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'nox-tls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', join(directory, 'key'), '-out', join(directory, 'cert'), '-subj', '/CN=rpc.example.com',
    '-addext', 'subjectAltName=DNS:rpc.example.com', '-days', '1'], { stdio: 'ignore' });
  key = readFileSync(join(directory, 'key')); cert = readFileSync(join(directory, 'cert'), 'utf8');
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function localExit(port: number) {
  const exit = { id: 'local', address: '', routingAddress: '', publicKey: new Uint8Array(32), layer: 3, role: 3 } as TopologyNode;
  const sessions = new Map<string, { socket: Socket; seqs: Set<number>; parts: { offset: bigint; data: Uint8Array }[];
    offset: bigint; notify: Set<() => void> }>();
  const wire: Buffer[] = [];
  const transport: TunnelPort = {
    tunnelExits: () => [exit],
    tunnelSend(_exit, call, options) {
      const id = Buffer.from(call.tunnelId).toString('hex');
      let session = sessions.get(id);
      if (!session) {
        session = { socket: connect(port, '127.0.0.1'), seqs: new Set(), parts: [], offset: 0n, notify: new Set() };
        sessions.set(id, session);
        const current = session;
        current.socket.on('error', () => {});
        current.socket.on('data', (data) => {
          current.parts.push({ offset: current.offset, data }); current.offset += BigInt(data.length);
          for (const callback of [...current.notify]) callback();
        });
      }
      const current = session;
      if (!current.seqs.has(call.seq)) {
        current.seqs.add(call.seq); wire.push(Buffer.from(call.data));
        if (call.data.length) current.socket.write(call.data);
        if (call.close) current.socket.end();
      }
      const done = new Promise<void>((resolve, reject) => {
        if (!options.surbs) { resolve(); return; }
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return; settled = true;
          clearTimeout(timer); current.notify.delete(notify); options.signal?.removeEventListener('abort', abort);
          if (error) reject(error); else resolve();
        };
        const abort = () => finish(new Error('ABORTED'));
        const notify = () => {
          for (const part of current.parts) {
            if (part.offset + BigInt(part.data.length) <= call.ackOffset) continue;
            const result = options.onReply?.(encodeTunnelReplyV1({ kind: 'Data', seq: call.seq, ...part, fin: null }));
            if (result === 'done') { finish(); break; }
          }
        };
        const timer = setTimeout(() => finish(new Error('TIMEOUT')), options.timeoutMs);
        current.notify.add(notify); options.signal?.addEventListener('abort', abort, { once: true });
        if (options.signal?.aborted) abort(); else queueMicrotask(notify);
      });
      return { entryId: 'entry', mixId: 'mix', done };
    },
  };
  return { transport, wire, close() { for (const value of sessions.values()) value.socket.destroy(); } };
}

it('sends one HTTP request over encrypted tunnel records; rejects invalid CA/SNI and cancels a pending request', async () => {
  const bodies: string[] = [];
  const server = createServer({ key, cert }, async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    bodies.push(Buffer.concat(chunks).toString());
    if (req.url !== '/stall') res.end('ok');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error();
  const exit = localExit(address.port);
  const trusted = new NoxTlsAgent(exit.transport, 'rpc.example.com', 2000, cert);
  const untrusted = new NoxTlsAgent(exit.transport, 'rpc.example.com', 2000);
  const wrongName = new NoxTlsAgent(exit.transport, 'wrong.example.com', 2000, cert);
  const body = JSON.stringify({ method: 'eth_sendRawTransaction', params: ['0xabcdef123456'] });
  const send = (agent: NoxTlsAgent, host = 'rpc.example.com', path = '/', signal?: AbortSignal) => new Promise<string>((resolve, reject) => {
    const req = request(`https://${host}${path}`, { agent, method: 'POST', signal, headers: { 'content-length': Buffer.byteLength(body) } }, (res) => {
      let result = ''; res.on('data', (part) => { result += part; }); res.on('end', () => resolve(result)); res.on('error', reject);
    });
    req.on('error', reject); req.end(body);
  });
  try {
    expect(await send(trusted)).toBe('ok');
    expect(bodies).toEqual([body]);
    expect(Buffer.concat(exit.wire).includes(Buffer.from('eth_sendRawTransaction'))).toBe(false);
    await expect(send(untrusted)).rejects.toThrow();
    await expect(send(wrongName, 'wrong.example.com')).rejects.toThrow();
    expect(bodies).toHaveLength(1);
    await expect(send(trusted, 'rpc.example.com', '/stall', AbortSignal.timeout(150))).rejects.toThrow();
    expect(bodies).toHaveLength(2);
  } finally {
    trusted.destroy(); untrusted.destroy(); wrongName.destroy(); exit.close(); server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
