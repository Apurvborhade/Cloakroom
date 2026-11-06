import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parentRoleCredentials } from '../src/parent-credentials.js';

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
