import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent } from '@cloakroom/shared';
import { getAddress, parseEther } from 'viem';
import type { Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunningEnclave } from '../src/server.js';
import { apiClient, enclaveHarness, waitForDeposit } from './helpers/enclave.js';

const harness = enclaveHarness(18_801, 18_802);
const LIFETIME_SEC = 120;
const DEPOSIT = parseEther('0.5');
const SESSION_TTL_SEC = 60;

const expiry = (fromNow = LIFETIME_SEC) => Math.floor(Date.now() / 1000) + fromNow;
const newAccount = () => privateKeyToAccount(generatePrivateKey());

function client(enclave: RunningEnclave) {
  const api = apiClient(enclave);
  const nonces = new Map<Address, bigint>();
  const nextNonce = (owner: Address) => {
    const nonce = (nonces.get(owner) ?? 0n) + 1n;
    nonces.set(owner, nonce);
    return nonce;
  };

  const deposit = async (owner: PrivateKeyAccount, amount = DEPOSIT) => {
    const nonce = nextNonce(owner.address);
    const expires = expiry();
    const signature = await api.sign(owner, 'DepositRequest', {
      owner: owner.address,
      asset: NATIVE,
      nonce,
      expiry: BigInt(expires),
    } as never);
    const { body } = await api.post('/deposit-session', {
      message: { owner: owner.address, asset: NATIVE, nonce: String(nonce), expiry: String(expires) },
      signature,
    });
    await harness.send(body.depositAddress as Address, amount + BigInt(body.gasReserveWei as string));
    await waitForDeposit(enclave, body.sessionId as string, amount);
    return body.depositAddress as Address;
  };

  const withdraw = async (
    owner: PrivateKeyAccount,
    to: Address,
    amount: bigint,
    overrides: Partial<{
      token: Address;
      nonce: bigint;
      expiresAt: number;
      signer: PrivateKeyAccount;
      sendTo: Address;
    }> = {},
  ) => {
    const nonce = overrides.nonce ?? nextNonce(owner.address);
    const expires = overrides.expiresAt ?? expiry();
    const token = overrides.token ?? NATIVE;
    const signature = await api.sign(overrides.signer ?? owner, 'Withdrawal', {
      owner: owner.address,
      token,
      amount,
      to,
      nonce,
      expiry: BigInt(expires),
    } as never);
    return api.post('/withdrawals', {
      message: {
        owner: owner.address,
        token,
        amount: String(amount),
        to: overrides.sendTo ?? to,
        nonce: String(nonce),
        expiry: String(expires),
      },
      signature,
    });
  };

  const status = async (owner: PrivateKeyAccount) => {
    const sessionKey = newAccount();
    const expires = expiry();
    const grant = await api.sign(owner, 'SessionGrant', {
      owner: owner.address,
      sessionKey: sessionKey.address,
      expiry: BigInt(expires),
    } as never);
    await api.post('/session', {
      message: { owner: owner.address, sessionKey: sessionKey.address, expiry: String(expires) },
      signature: grant,
    });
    const signature = await api.sign(sessionKey, 'SessionQuery', { owner: owner.address, expiry: BigInt(expires) } as never);
    return api.post('/withdrawals/status', { message: { owner: owner.address, expiry: String(expires) }, signature });
  };

  return { deposit, status, withdraw };
}

const native = (enclave: RunningEnclave, owner: Address) => enclave.parts.ledger.getBalance(owner, NATIVE);

async function statusOf(api: ReturnType<typeof client>, owner: PrivateKeyAccount, id: unknown) {
  const { body } = await api.status(owner);
  return (body.withdrawals as Array<Record<string, string>>).find((item) => item.id === id);
}

async function waitForStatus(api: ReturnType<typeof client>, owner: PrivateKeyAccount, id: unknown, status: string) {
  await vi.waitFor(async () => expect((await statusOf(api, owner, id))?.status).toBe(status), {
    timeout: 10_000,
    interval: 100,
  });
}

/** Lets open deposit sessions end, so their addresses join the pool. */
async function closeSessions(enclave: RunningEnclave, sessionEoas: Address[]) {
  await harness.expireDeposits(enclave);
  for (const eoa of sessionEoas) {
    expect(enclave.parts.inventory.pick(NATIVE, 1n, new Set(sessionEoas.filter((other) => other !== eoa)))?.address).toBe(eoa);
  }
}

const bootWithPool = () => harness.boot({ config: harness.config({ DEPOSIT_SESSION_TTL_SEC: String(SESSION_TTL_SEC) }) });

/** Funds an inventory address the way the operator seeds the pool. */
async function seed(enclave: RunningEnclave, amount = parseEther('1')) {
  const address = enclave.parts.keys.list().find((eoa) => eoa.role === 'inventory')!.address;
  await harness.send(address, amount);
  await enclave.parts.inventory.refresh();
  return address;
}

beforeAll(() => harness.start());
afterAll(() => harness.finish());
beforeEach(() => harness.reset());
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

describe('two users round-trip', () => {
  it('pays each user to a fresh wallet from an address they never funded, through the real signer', async () => {
    const enclave = await bootWithPool();
    const api = client(enclave);
    const [alice, bob] = [newAccount(), newAccount()];
    const [aliceWallet, bobWallet] = [newAccount().address, newAccount().address];
    const aliceDeposit = await api.deposit(alice);
    const bobDeposit = await api.deposit(bob);
    expect(native(enclave, alice.address).available).toBe(DEPOSIT);
    expect(native(enclave, bob.address).available).toBe(DEPOSIT);
    await closeSessions(enclave, [aliceDeposit, bobDeposit]);
    const amount = parseEther('0.2');

    const aliceOut = await api.withdraw(alice, aliceWallet, amount);
    const bobOut = await api.withdraw(bob, bobWallet, amount);

    expect(aliceOut.body).toEqual({ withdrawalId: expect.stringMatching(/^0x[0-9a-f]{64}$/), status: 'locked' });
    await waitForStatus(api, alice, aliceOut.body.withdrawalId, 'confirmed');
    await waitForStatus(api, bob, bobOut.body.withdrawalId, 'confirmed');

    expect(await harness.chain.getBalance({ address: aliceWallet })).toBe(amount);
    expect(await harness.chain.getBalance({ address: bobWallet })).toBe(amount);
    expect(native(enclave, alice.address)).toMatchObject({ available: DEPOSIT - amount, reserved: 0n });
    expect(native(enclave, bob.address)).toMatchObject({ available: DEPOSIT - amount, reserved: 0n });

    const aliceTx = await statusOf(api, alice, aliceOut.body.withdrawalId);
    const bobTx = await statusOf(api, bob, bobOut.body.withdrawalId);
    const aliceSender = (await harness.chain.getTransaction({ hash: aliceTx!.txHash as `0x${string}` })).from;
    const bobSender = (await harness.chain.getTransaction({ hash: bobTx!.txHash as `0x${string}` })).from;
    expect(getAddress(aliceSender)).not.toBe(aliceDeposit);
    expect(getAddress(bobSender)).not.toBe(bobDeposit);
    expect(getAddress(aliceSender)).toBe(bobDeposit);
    expect(getAddress(bobSender)).toBe(aliceDeposit);
  });
});

describe('POST /withdrawals', () => {
  it('reserves the funds before the payout finishes', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);
    const events: JournalEvent['t'][] = [];
    const append = enclave.parts.journal.append.bind(enclave.parts.journal);
    vi.spyOn(enclave.parts.journal, 'append').mockImplementation(async (event) => {
      events.push(event.t);
      return append(event);
    });

    const { body } = await api.withdraw(alice, newAccount().address, 5n);

    await waitForStatus(api, alice, body.withdrawalId, 'confirmed');
    expect(events.slice(0, 3)).toEqual(['NONCE_USED', 'WITHDRAWAL_LOCKED', 'SIGNING_REGISTERED']);
    expect(events).toContain('WITHDRAWAL_CONFIRMED');
  });

  it('refuses a replayed request', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);
    const to = newAccount().address;
    const first = await api.withdraw(alice, to, 5n, { nonce: 70n });

    const replay = await api.withdraw(alice, to, 5n, { nonce: 70n });

    expect(replay.status).toBe(409);
    expect(replay.body).toEqual({ error: 'NONCE_USED' });
    await waitForStatus(api, alice, first.body.withdrawalId, 'confirmed');
    expect(await harness.chain.getBalance({ address: to })).toBe(5n);
  });

  it('refuses a destination changed after signing', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await api.deposit(alice);

    const { status, body } = await api.withdraw(alice, newAccount().address, 5n, { sendTo: newAccount().address });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'BAD_SIGNATURE' });
    expect(native(enclave, alice.address).reserved).toBe(0n);
  });

  it('refuses a request signed by someone else', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await api.deposit(alice);

    const { status, body } = await api.withdraw(alice, newAccount().address, 5n, { signer: newAccount() });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'BAD_SIGNATURE' });
  });

  it('refuses an expired request', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await api.deposit(alice);

    const { status, body } = await api.withdraw(alice, newAccount().address, 5n, { expiresAt: expiry(-3600) });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'EXPIRED' });
  });

  it('lets exactly one of two 80% withdrawals through', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);
    const amount = (DEPOSIT * 80n) / 100n;

    const results = await Promise.all([
      api.withdraw(alice, newAccount().address, amount),
      api.withdraw(alice, newAccount().address, amount),
    ]);

    expect(results.filter(({ status }) => status === 200)).toHaveLength(1);
    const winner = results.find(({ status }) => status === 200)!;
    await waitForStatus(api, alice, winner.body.withdrawalId, 'confirmed');
    expect(native(enclave, alice.address)).toMatchObject({ available: DEPOSIT - amount, reserved: 0n });
  });

  it('refuses a token the user does not hold, even when the pool has plenty', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);

    const { status, body } = await api.withdraw(alice, newAccount().address, 1n, { token: harness.token() });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'INSUFFICIENT_BALANCE' });
  });

  it('refuses more than the balance', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);

    const { status, body } = await api.withdraw(alice, newAccount().address, DEPOSIT + 1n);

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'INSUFFICIENT_BALANCE' });
    expect(native(enclave, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });

  it('releases the lock cleanly when no single address can pay it', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await api.deposit(alice);

    const { status, body } = await api.withdraw(alice, newAccount().address, 5n);

    expect(status).toBe(409);
    expect(body).toEqual({ error: 'NO_INVENTORY' });
    expect(native(enclave, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
    expect(enclave.parts.withdrawalOrders.inFlightCount).toBe(0);
  });

  it.each([
    ['a zero amount', () => ({ amount: 0n, to: newAccount().address }), 'INVALID_PAYLOAD'],
    ['the zero address as destination', () => ({ amount: 5n, to: NATIVE }), 'INVALID_PAYLOAD'],
    ['ETH above the cap', () => ({ amount: parseEther('1') + 1n, to: newAccount().address }), 'INVALID_PAYLOAD'],
  ])('refuses %s without spending the nonce', async (_name, values, code) => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);
    const { amount, to } = values();

    const { status, body } = await api.withdraw(alice, to, amount, { nonce: 90n });

    expect(status).toBe(400);
    expect(body).toEqual({ error: code });
    expect((await api.withdraw(alice, newAccount().address, 5n, { nonce: 90n })).status).toBe(200);
  });

  it('refuses an unsupported token', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();

    const { status, body } = await api.withdraw(alice, newAccount().address, 5n, { token: alice.address });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'UNSUPPORTED_ASSET' });
  });
});

describe('POST /withdrawals/status', () => {
  it("returns only the owner's withdrawals, with the transaction once sent", async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const [alice, bob] = [newAccount(), newAccount()];
    await seed(enclave);
    await api.deposit(alice);
    await api.deposit(bob);
    const { body } = await api.withdraw(alice, newAccount().address, 5n);
    await waitForStatus(api, alice, body.withdrawalId, 'confirmed');

    const own = await api.status(alice);
    const other = await api.status(bob);

    expect(own.body).toEqual({
      withdrawals: [{ id: body.withdrawalId, status: 'confirmed', txHash: expect.stringMatching(/^0x[0-9a-f]{64}$/) }],
    });
    expect(other.body).toEqual({ withdrawals: [] });
  });

  it('reports the reason a withdrawal failed', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await api.deposit(alice);
    await api.withdraw(alice, newAccount().address, 5n);

    const { body } = await api.status(alice);

    expect(body.withdrawals).toEqual([expect.objectContaining({ status: 'failed', reason: 'NO_INVENTORY' })]);
  });

  it('never shows the destination or the amount', async () => {
    const enclave = await harness.boot();
    const api = client(enclave);
    const alice = newAccount();
    await seed(enclave);
    await api.deposit(alice);
    const to = newAccount().address;
    const { body } = await api.withdraw(alice, to, 5n);
    await waitForStatus(api, alice, body.withdrawalId, 'confirmed');

    const { body: read } = await api.status(alice);

    expect(Object.keys((read.withdrawals as object[])[0]!).sort()).toEqual(['id', 'status', 'txHash']);
  });
});

describe('restarting', () => {
  it('keeps statuses and balances after a confirmed withdrawal', async () => {
    const first = await harness.boot();
    const api = client(first);
    const alice = newAccount();
    await seed(first);
    await api.deposit(alice);
    const { body } = await api.withdraw(alice, newAccount().address, 5n);
    await waitForStatus(api, alice, body.withdrawalId, 'confirmed');
    const before = await statusOf(api, alice, body.withdrawalId);
    await first.stop();

    const second = await harness.boot();

    expect(await statusOf(client(second), alice, body.withdrawalId)).toEqual(before);
    expect(native(second, alice.address)).toMatchObject({ available: DEPOSIT - 5n, reserved: 0n });
  });

  it('releases a withdrawal interrupted before it was sent, and says so', async () => {
    const first = await harness.boot();
    const api = client(first);
    const alice = newAccount();
    await api.deposit(alice);
    await first.parts.queue.run(async () => {
      const event = {
        t: 'WITHDRAWAL_LOCKED',
        id: 'interrupted',
        owner: alice.address,
        token: NATIVE,
        amount: 5n,
        to: newAccount().address,
      } as const;
      await first.parts.journal.append(event);
      first.parts.ledger.apply(event);
    });
    await first.stop();

    const second = await harness.boot();

    expect(native(second, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
    expect(await statusOf(client(second), alice, 'interrupted')).toMatchObject({ status: 'failed', reason: 'INTERRUPTED' });
  });

  it('settles a withdrawal that was broadcast before a restart, and pays only once', async () => {
    const first = await harness.boot();
    const api = client(first);
    const alice = newAccount();
    await seed(first);
    await api.deposit(alice);
    const to = newAccount().address;
    const { body } = await api.withdraw(alice, to, 5n);
    await vi.waitFor(async () => expect((await statusOf(api, alice, body.withdrawalId))?.txHash).toBeDefined(), {
      timeout: 10_000,
      interval: 50,
    });
    await first.stop();

    const second = await harness.boot();

    await vi.waitFor(async () => expect((await statusOf(client(second), alice, body.withdrawalId))?.status).toBe('confirmed'), {
      timeout: 10_000,
      interval: 100,
    });
    expect(await harness.chain.getBalance({ address: to })).toBe(5n);
    expect(native(second, alice.address)).toMatchObject({ available: DEPOSIT - 5n, reserved: 0n });
  });
});
