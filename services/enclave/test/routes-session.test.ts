import { NATIVE } from '@cloakroom/shared';
import { getAddress, parseEther } from 'viem';
import type { Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DepositWatcher } from '../src/watcher.js';
import type { RunningEnclave } from '../src/server.js';
import { apiClient, enclaveHarness } from './helpers/enclave.js';

const harness = enclaveHarness(18_797, 18_798);
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
const LIFETIME_SEC = 120;

const expiry = (fromNow = LIFETIME_SEC) => Math.floor(Date.now() / 1000) + fromNow;

function client(enclave: RunningEnclave) {
  const api = apiClient(enclave);

  const grant = async (
    owner: PrivateKeyAccount,
    sessionKey: PrivateKeyAccount = privateKeyToAccount(generatePrivateKey()),
    options: { signer?: PrivateKeyAccount; expiresAt?: number } = {},
  ) => {
    const expiresAt = options.expiresAt ?? expiry();
    const signature = await api.sign(options.signer ?? owner, 'SessionGrant', {
      owner: owner.address,
      sessionKey: sessionKey.address,
      expiry: BigInt(expiresAt),
    } as never);
    const response = await api.post('/session', {
      message: { owner: owner.address, sessionKey: sessionKey.address, expiry: String(expiresAt) },
      signature,
    });
    return { ...response, sessionKey, expiresAt };
  };

  const deposit = async (
    owner: PrivateKeyAccount,
    nonce: bigint,
    options: { signer?: PrivateKeyAccount; expiresAt?: number; asset?: Address } = {},
  ) => {
    const expiresAt = options.expiresAt ?? expiry();
    const asset = options.asset ?? NATIVE;
    const signature = await api.sign(options.signer ?? owner, 'DepositRequest', {
      owner: owner.address,
      asset,
      nonce,
      expiry: BigInt(expiresAt),
    } as never);
    return api.post('/deposit-session', {
      message: { owner: owner.address, asset, nonce: String(nonce), expiry: String(expiresAt) },
      signature,
    });
  };

  const balance = async (owner: Address, signer: PrivateKeyAccount, expiresAt = expiry()) => {
    const signature = await api.sign(signer, 'SessionQuery', { owner, expiry: BigInt(expiresAt) } as never);
    return api.post('/balance', { message: { owner, expiry: String(expiresAt) }, signature });
  };

  return { api, balance, deposit, grant };
}

beforeAll(() => harness.start());
afterAll(() => harness.finish());
beforeEach(() => harness.reset());
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

describe('the encrypted transport', () => {
  it('encrypts a successful response', async () => {
    const enclave = await harness.boot();

    const { raw, body, status } = await client(enclave).grant(alice);

    expect(status).toBe(200);
    expect(Object.keys(raw).sort()).toEqual(['ct', 'nonce']);
    expect(JSON.stringify(raw)).not.toContain('expiresAt');
    expect(body.ok).toBe(true);
  });

  it.each([
    ['an empty body', {}],
    ['fields that are not an envelope', { enc: 'x', ct: 'y' }],
  ])('refuses %s', async (_name, payload) => {
    const enclave = await harness.boot();

    for (const url of ['/session', '/deposit-session', '/balance']) {
      const response = await enclave.app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'INVALID_PAYLOAD' });
    }
  });

  it('refuses a request sealed for a different route', async () => {
    const enclave = await harness.boot();

    const response = await apiClient(enclave).post('/balance', { message: {}, signature: '0x' }, '/session');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_PAYLOAD' });
  });

  it('refuses decrypted JSON of the wrong shape', async () => {
    const enclave = await harness.boot();

    const response = await apiClient(enclave).post('/session', { message: { owner: 'nope' }, signature: '0x' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'INVALID_PAYLOAD' });
  });

  it('marks responses as not cacheable', async () => {
    const enclave = await harness.boot();

    const response = await enclave.app.inject({ method: 'POST', url: '/balance', payload: {} });

    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /session', () => {
  it('creates a grant with the requested expiry', async () => {
    const enclave = await harness.boot();

    const { body, expiresAt, sessionKey } = await client(enclave).grant(alice);

    expect(body).toEqual({ ok: true, expiresAt });
    expect(enclave.parts.auth.getGrant(alice.address)?.sessionKey).toBe(sessionKey.address);
  });

  it('refuses a grant signed by someone other than the owner', async () => {
    const enclave = await harness.boot();

    const { status, body } = await client(enclave).grant(alice, undefined, { signer: bob });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'BAD_SIGNATURE' });
    expect(enclave.parts.auth.getGrant(alice.address)).toBeUndefined();
  });

  it.each([
    ['in the past', -1],
    ['too far ahead', 1800 + LIFETIME_SEC],
  ])('refuses a grant expiring %s', async (_name, fromNow) => {
    const enclave = await harness.boot();

    const { status, body } = await client(enclave).grant(alice, undefined, { expiresAt: expiry(fromNow) });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'EXPIRED' });
  });
});

describe('POST /deposit-session', () => {
  it('credits a real deposit, and the balance route shows it', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const { sessionKey } = await api.grant(alice);

    const { status, body } = await api.deposit(alice, 1n);
    expect(status).toBe(200);
    await harness.send(body.depositAddress as Address, parseEther('0.5'));
    await enclave.parts.watcher.tick();

    const { body: read } = await api.balance(alice.address, sessionKey);
    expect(read.balances).toContainEqual({
      token: NATIVE,
      available: parseEther('0.5').toString(),
      reserved: '0',
      pending: '0',
    });
  });

  it('returns a session that ends at the configured lifetime', async () => {
    const enclave = await harness.boot();
    const before = Math.floor(Date.now() / 1000);

    const { body } = await client(enclave).deposit(alice, 1n);

    const ttl = harness.config().DEPOSIT_SESSION_TTL_SEC;
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + ttl);
    expect(body.expiresAt).toBeLessThanOrEqual(before + ttl + 5);
    expect(body.sessionId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(enclave.parts.watcher.getSession(body.sessionId as string)?.owner).toBe(alice.address);
  });

  it('gives each session its own address, and links it to the owner', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);

    const first = await api.deposit(alice, 1n);
    const second = await api.deposit(alice, 2n);
    const other = await api.deposit(bob, 1n);

    const addresses = [first, second, other].map(({ body }) => body.depositAddress as Address);
    expect(new Set(addresses).size).toBe(3);
    expect([...enclave.parts.inventory.eoasLinkedTo(alice.address)]).toEqual(addresses.slice(0, 2));
    expect([...enclave.parts.inventory.eoasLinkedTo(bob.address)]).toEqual([addresses[2]]);
  });

  it('never offers an inventory address as a deposit address', async () => {
    const enclave = await harness.boot();
    const inventory = enclave.parts.keys.list().map((eoa) => eoa.address);

    const { body } = await client(enclave).deposit(alice, 1n);

    expect(inventory).not.toContain(body.depositAddress);
  });

  it('refuses a replayed nonce and a lower one, without allocating an address', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    await api.deposit(alice, 5n);
    const allocated = enclave.parts.keys.list().length;

    const replay = await api.deposit(alice, 5n);
    const lower = await api.deposit(alice, 4n);

    expect([replay.status, lower.status]).toEqual([409, 409]);
    expect(replay.body).toEqual({ error: 'NONCE_USED' });
    expect(lower.body).toEqual({ error: 'NONCE_USED' });
    expect(enclave.parts.keys.list()).toHaveLength(allocated);
  });

  it('lets one of two concurrent requests with the same nonce through', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);

    const results = await Promise.all([api.deposit(alice, 1n), api.deposit(alice, 1n)]);

    expect(results.map(({ status }) => status).sort()).toEqual([200, 409]);
  });

  it('refuses a request not signed by the owner, and keeps the nonce usable', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);

    const { status, body } = await api.deposit(alice, 1n, { signer: bob });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'BAD_SIGNATURE' });
    expect((await api.deposit(alice, 1n)).status).toBe(200);
  });

  it.each([
    ['in the past', -3600],
    ['too far ahead', 3600],
  ])('refuses a request expiring %s, and keeps the nonce usable', async (_name, fromNow) => {
    const enclave = await harness.boot();
    const api = client(enclave);

    const { status, body } = await api.deposit(alice, 1n, { expiresAt: expiry(fromNow) });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'EXPIRED' });
    expect((await api.deposit(alice, 1n)).status).toBe(200);
  });

  it('refuses anything but native ETH, and keeps the nonce usable', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);

    const { status, body } = await api.deposit(alice, 1n, { asset: harness.token() });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'UNSUPPORTED_ASSET' });
    expect((await api.deposit(alice, 1n)).status).toBe(200);
  });

  it('hides the cause when a session cannot open', async () => {
    const enclave = await harness.boot();
    vi.spyOn(DepositWatcher.prototype, 'openSession').mockRejectedValueOnce(new Error('rpc at secret-url'));

    const { status, body } = await client(enclave).deposit(alice, 1n);

    expect(status).toBe(500);
    expect(body).toEqual({ error: 'INTERNAL_ERROR' });
  });

  it('keeps nonces, sessions and owner links after a restart', async () => {
    const first = await harness.boot();
    const { body } = await client(first).deposit(alice, 7n);
    await first.stop();

    const second = await harness.boot();
    const api = client(second);

    expect((await api.deposit(alice, 7n)).body).toEqual({ error: 'NONCE_USED' });
    expect([...second.parts.inventory.eoasLinkedTo(alice.address)]).toContain(body.depositAddress);
    await harness.send(body.depositAddress as Address, 11n);
    await second.parts.watcher.tick();
    expect(second.parts.ledger.getBalance(alice.address, NATIVE).available).toBe(11n);
  });
});

describe('POST /balance', () => {
  it('returns every supported token, with no balance as zero', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const { sessionKey } = await api.grant(alice);

    const { status, body } = await api.balance(alice.address, sessionKey);

    expect(status).toBe(200);
    expect(body).toEqual({
      balances: [NATIVE, getAddress(harness.token())].map((token) => ({ token, available: '0', reserved: '0', pending: '0' })),
    });
  });

  it("never shows one owner another owner's balance", async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const { body: session } = await api.deposit(alice, 1n);
    await harness.send(session.depositAddress as Address, 9n);
    await enclave.parts.watcher.tick();
    const { sessionKey: bobKey } = await api.grant(bob);

    const own = await api.balance(bob.address, bobKey);
    const other = await api.balance(alice.address, bobKey);

    expect((own.body.balances as Array<{ available: string }>)[0]?.available).toBe('0');
    expect(other.status).toBe(401);
    expect(other.body).toEqual({ error: 'UNKNOWN_SESSION' });
  });

  it('gives the same answer whether or not the named owner has a session', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    await api.grant(alice);
    const stranger = privateKeyToAccount(generatePrivateKey());
    const nobody = privateKeyToAccount(generatePrivateKey());

    const hasSession = await api.balance(alice.address, stranger);
    const noSession = await api.balance(nobody.address, stranger);

    expect(hasSession.status).toBe(noSession.status);
    expect(hasSession.body).toEqual(noSession.body);
    expect(noSession.body).toEqual({ error: 'UNKNOWN_SESSION' });
  });

  it('refuses a read signed by the wallet instead of its session key', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    await api.grant(alice);

    const { body } = await api.balance(alice.address, alice);

    expect(body).toEqual({ error: 'UNKNOWN_SESSION' });
  });

  it('refuses an expired query', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const { sessionKey } = await api.grant(alice);

    const { status, body } = await api.balance(alice.address, sessionKey, expiry(-3600));

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'EXPIRED' });
  });

  it('refuses a read after the grant has expired', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const { sessionKey } = await api.grant(alice, undefined, { expiresAt: expiry(1) });
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    const { body } = await api.balance(alice.address, sessionKey);

    expect(body).toEqual({ error: 'UNKNOWN_SESSION' });
  });

  it('needs a new grant after a restart', async () => {
    const first = await harness.boot();
    const { sessionKey } = await client(first).grant(alice);
    await first.stop();

    const second = await harness.boot();

    expect((await client(second).balance(alice.address, sessionKey)).body).toEqual({ error: 'UNKNOWN_SESSION' });
  });
});
