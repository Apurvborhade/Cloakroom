import { createServer as tcpServer, connect, type Socket } from 'node:net';
import { createServer as httpsServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRelayFetch } from '../src/egress.js';

let directory: string, key: Buffer, cert: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'rpc-egress-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1',
    '-nodes', '-keyout', join(directory, 'key'), '-out', join(directory, 'cert'), '-subj', '/CN=rpc.example.com',
    '-addext', 'subjectAltName=DNS:rpc.example.com', '-days', '1'], { stdio: 'ignore' });
  key = readFileSync(join(directory, 'key')); cert = readFileSync(join(directory, 'cert'), 'utf8');
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('enclave HTTPS egress', () => {
  it('validates the upstream CA and hostname inside the client and does not follow redirects', async () => {
    let calls = 0; const hosts: string[] = [];
    const upstream = httpsServer({ key, cert }, (req, res) => {
      calls++; res.writeHead(req.url === '/redirect' ? 302 : 200, { location: 'https://elsewhere.example.com' });
      res.end('reply');
    });
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
    const address = upstream.address(); if (!address || typeof address === 'string') throw new Error();
    const sockets = new Set<Socket>();
    const relay = tcpServer((socket) => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.once('data', (data) => {
        hosts.push(data.toString().trim());
        const target = connect(address.port, '127.0.0.1', () => { socket.write(Buffer.from([0])); socket.pipe(target); target.pipe(socket); });
        sockets.add(target); target.on('close', () => sockets.delete(target));
        target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy());
        socket.on('close', () => target.destroy());
      });
    });
    const socketPath = join(directory, 'relay.sock');
    await new Promise<void>((done) => relay.listen(socketPath, done));
    const trusted = createRelayFetch(socketPath, cert), untrusted = createRelayFetch(socketPath);
    try {
      expect(await (await trusted.fetch('https://rpc.example.com')).text()).toBe('reply');
      expect((await trusted.fetch('https://rpc.example.com/redirect')).status).toBe(302);
      await expect(untrusted.fetch('https://rpc.example.com')).rejects.toThrow('EGRESS_UNAVAILABLE');
      await expect(trusted.fetch('https://wrong.example.com')).rejects.toThrow('EGRESS_UNAVAILABLE');
      await expect(trusted.fetch('http://rpc.example.com')).rejects.toThrow('HTTPS_EGRESS_REQUIRED');
      expect(calls).toBe(2);
      expect(hosts).not.toContain('elsewhere.example.com');
    } finally {
      trusted.close(); untrusted.close(); for (const socket of sockets) socket.destroy();
      upstream.closeAllConnections(); await Promise.all([new Promise<void>((done) => upstream.close(() => done())),
        new Promise<void>((done) => relay.close(() => done()))]);
    }
  });
});
