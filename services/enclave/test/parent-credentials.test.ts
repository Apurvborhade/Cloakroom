import { expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parentRoleCredentials } from '../src/parent-credentials.js';
import { KMSClient, DescribeKeyCommand } from '@aws-sdk/client-kms';
import { Readable } from 'node:stream';

it('caches role credentials, rejects expired or malformed responses, and redacts failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-credentials-test-'));
  const socketPath = join(directory, 'credentials.sock');
  let count = 0;
  let body = { Code: 'Success', AccessKeyId: 'A'.repeat(20), SecretAccessKey: 'B'.repeat(40),
    Token: 'test-token', Expiration: new Date(Date.now() + 600_000).toISOString() };
  const server = createServer((_req, res) => { count++; res.end(JSON.stringify(body)); });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    const provider = parentRoleCredentials(socketPath);
    const credentials = await Promise.all(Array.from({ length: 8 }, () => provider()));
    expect(count).toBe(1);
    expect(credentials[0]?.accessKeyId).toBe(body.AccessKeyId);
    // The AWS SDK needs this field to avoid treating expiring role credentials as static.
    expect(credentials[0]?.expiration).toEqual(new Date(body.Expiration));
    await provider(); expect(count).toBe(1);
    body = { ...body, Expiration: new Date(Date.now() - 1_000).toISOString() };
    await expect(parentRoleCredentials(socketPath)()).rejects.toThrow('PARENT_CREDENTIALS_UNAVAILABLE');
    body = { ...body, SecretAccessKey: 'invalid' };
    await expect(parentRoleCredentials(socketPath)()).rejects.toThrow('PARENT_CREDENTIALS_UNAVAILABLE');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

it('refreshes expiring role credentials through the actual AWS SDK credential cache', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const directory = await mkdtemp(join(tmpdir(), 'cloakroom-sdk-credentials-test-'));
  const socketPath = join(directory, 'credentials.sock');
  let count = 0;
  const server = createServer((_req, res) => {
    count++;
    res.end(JSON.stringify({ Code: 'Success', AccessKeyId: (count === 1 ? 'A' : 'C').repeat(20),
      SecretAccessKey: 'B'.repeat(40), Token: 'test-token', Expiration: new Date(Date.now() + 600_000).toISOString() }));
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const authorizations: string[] = [];
  const client = new KMSClient({ region: 'eu-central-1', credentials: parentRoleCredentials(socketPath),
    requestHandler: { async handle(req) {
      authorizations.push(req.headers.authorization ?? '');
      return { response: { statusCode: 200, headers: {}, body: Readable.from(['{}']) } };
    } },
  });
  try {
    await client.send(new DescribeKeyCommand({ KeyId: 'offline-test' }));
    await client.send(new DescribeKeyCommand({ KeyId: 'offline-test' }));
    expect(count).toBe(1);
    vi.setSystemTime(Date.now() + 9 * 60_000);
    await client.send(new DescribeKeyCommand({ KeyId: 'offline-test' }));
    expect(count).toBe(2);
    expect(authorizations[0]).toContain('Credential=' + 'A'.repeat(20));
    expect(authorizations[2]).toContain('Credential=' + 'C'.repeat(20));
  } finally {
    client.destroy(); vi.useRealTimers();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
