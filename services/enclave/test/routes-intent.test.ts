import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent } from '@cloakroom/shared';
import { getAddress, keccak256, parseEther, toHex } from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustodyEOA } from '@cloakroom/shared';
import { KeyManager } from '../src/keys.js';
import type { RunningEnclave } from '../src/server.js';
import { apiClient, enclaveHarness } from './helpers/enclave.js';

const harness = enclaveHarness(18_799, 18_800);
const alice = privateKeyToAccount(generatePrivateKey());
const bob = privateKeyToAccount(generatePrivateKey());
const PRICE_SCALE = 10n ** 18n;
const LIFETIME_SEC = 120;
const DEPOSIT = parseEther('0.5');
const AMOUNT = parseEther('0.1');
const MARKET_PRICE = 2_000n * PRICE_SCALE;

const expiry = (fromNow = LIFETIME_SEC) => Math.floor(Date.now() / 1000) + fromNow;

/** The real signer refuses swaps until its swap path exists, so these runs allow one known EOA. */
const swapAccount = privateKeyToAccount(generatePrivateKey());
class SwapAllowedKeys extends KeyManager {
  override list(): CustodyEOA[] {
    return [...super.list(), { index: 9_999, address: swapAccount.address, role: 'inventory', lastUsedAt: 0 }];
  }

  override async registerOp(opId: string, input: Parameters<KeyManager['registerOp']>[1]): Promise<void> {
    if (input.eoa !== swapAccount.address) return super.registerOp(opId, input);
  }

  override async sign(...[eoa, tx, opId]: Parameters<KeyManager['sign']>): Promise<Hex> {
    return eoa === swapAccount.address ? swapAccount.signTransaction(tx) : super.sign(eoa, tx, opId);
  }
}

function client(enclave: RunningEnclave, tokenOut: Address) {
  const api = apiClient(enclave);
  const nonces = new Map<Address, bigint>();
  const nextNonce = (owner: Address) => {
    const nonce = (nonces.get(owner) ?? 0n) + 1n;
    nonces.set(owner, nonce);
    return nonce;
  };

  /** Credits the owner through a real deposit, using the real routes. */
  const fund = async (owner: PrivateKeyAccount, amount = DEPOSIT) => {
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
    await harness.send(body.depositAddress as Address, amount);
    await enclave.parts.watcher.tick();
  };

  const create = async (
    owner: PrivateKeyAccount,
    overrides: Partial<{
      tokenIn: Address;
      tokenOut: Address;
      amountIn: bigint;
      comparator: number;
      triggerPrice: bigint;
      maxSlippageBps: number;
      nonce: bigint;
      expiresAt: number;
      signer: PrivateKeyAccount;
    }> = {},
  ) => {
    const message = {
      owner: owner.address,
      tokenIn: overrides.tokenIn ?? NATIVE,
      tokenOut: overrides.tokenOut ?? tokenOut,
      amountIn: overrides.amountIn ?? AMOUNT,
      comparator: overrides.comparator ?? 0,
      triggerPrice: overrides.triggerPrice ?? 1_000n * PRICE_SCALE,
      maxSlippageBps: overrides.maxSlippageBps ?? 50,
      nonce: overrides.nonce ?? nextNonce(owner.address),
      expiry: BigInt(overrides.expiresAt ?? expiry()),
    };
    const signature = await api.sign(overrides.signer ?? owner, 'Intent', message as never);
    return api.post('/intents', {
      message: {
        ...message,
        amountIn: String(message.amountIn),
        triggerPrice: String(message.triggerPrice),
        nonce: String(message.nonce),
        expiry: String(message.expiry),
      },
      signature,
    });
  };

  const cancel = async (owner: PrivateKeyAccount, intentId: string, nonce = nextNonce(owner.address)) => {
    const expires = expiry();
    const signature = await api.sign(owner, 'CancelIntent', {
      owner: owner.address,
      intentId,
      nonce,
      expiry: BigInt(expires),
    } as never);
    return api.post('/intents/cancel', {
      message: { owner: owner.address, intentId, nonce: String(nonce), expiry: String(expires) },
      signature,
    });
  };

  const status = async (owner: PrivateKeyAccount, sessionKey: PrivateKeyAccount) => {
    const expires = expiry();
    const grantSignature = await api.sign(owner, 'SessionGrant', {
      owner: owner.address,
      sessionKey: sessionKey.address,
      expiry: BigInt(expires),
    } as never);
    await api.post('/session', {
      message: { owner: owner.address, sessionKey: sessionKey.address, expiry: String(expires) },
      signature: grantSignature,
    });
    const signature = await api.sign(sessionKey, 'SessionQuery', { owner: owner.address, expiry: BigInt(expires) } as never);
    return api.post('/intents/status', { message: { owner: owner.address, expiry: String(expires) }, signature });
  };

  return { cancel, create, fund, status };
}

const statusOf = (enclave: RunningEnclave, id: unknown) => enclave.parts.intents.get(id as string)?.status;
const nativeBalance = (enclave: RunningEnclave, owner: Address) => enclave.parts.ledger.getBalance(owner, NATIVE);

function report(tokenOut: Address, price = MARKET_PRICE) {
  return { pair: `${NATIVE}/${getAddress(tokenOut)}`, price, ts: Math.floor(Date.now() / 1000), source: 'uniswap' };
}

async function bootForSwaps(configOverrides: Record<string, string> = {}, Keys: typeof KeyManager = SwapAllowedKeys) {
  const uniswap = await harness.localUniswap();
  const enclave = await harness.boot({
    config: harness.config({
      TOKEN_OUT_ADDRESS: uniswap.token,
      UNIVERSAL_ROUTER_ADDRESS: uniswap.router,
      ...configOverrides,
    }),
    quoter: uniswap.quoter,
    openKeys: harness.openKeysWith(Keys),
  });
  return { enclave, token: uniswap.token };
}

beforeAll(() => harness.start());
afterAll(() => harness.finish());
beforeEach(() => harness.reset());
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

describe('POST /intents', () => {
  it('reserves the funds once, and records a pending order', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);

    const { status, body } = await api.create(alice);

    expect(status).toBe(200);
    expect(body).toEqual({ intentId: expect.stringMatching(/^0x[0-9a-f]{64}$/), status: 'pending' });
    expect(statusOf(enclave, body.intentId)).toBe('pending');
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: DEPOSIT - AMOUNT, reserved: AMOUNT });
  });

  it('refuses more than the available balance, including funds already reserved', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice, AMOUNT);
    await api.create(alice);

    const { status, body } = await api.create(alice);

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'INSUFFICIENT_BALANCE' });
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: 0n, reserved: AMOUNT });
  });

  it('never reserves more than the balance across concurrent orders', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice, AMOUNT);

    const results = await Promise.all([api.create(alice), api.create(alice), api.create(alice)]);

    // Requests can arrive out of order, so a refusal can be either the balance or an old nonce.
    expect(results.filter(({ status }) => status === 200)).toHaveLength(1);
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: 0n, reserved: AMOUNT });
  });

  it('refuses a replayed nonce', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    await api.create(alice, { nonce: 50n });

    const { status, body } = await api.create(alice, { nonce: 50n });

    expect(status).toBe(409);
    expect(body).toEqual({ error: 'NONCE_USED' });
    expect(nativeBalance(enclave, alice.address).reserved).toBe(AMOUNT);
  });

  it('refuses an order not signed by the owner', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);

    const { status, body } = await api.create(alice, { signer: bob });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'BAD_SIGNATURE' });
    expect(nativeBalance(enclave, alice.address).reserved).toBe(0n);
  });

  it('refuses an expired order', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);

    const { status, body } = await api.create(alice, { expiresAt: expiry(-3600) });

    expect(status).toBe(400);
    expect(body).toEqual({ error: 'EXPIRED' });
  });

  it.each([
    ['a "price at or below" order', { comparator: 1 }, 'INVALID_PAYLOAD'],
    ['a zero amount', { amountIn: 0n }, 'INVALID_PAYLOAD'],
    ['an amount above the cap', { amountIn: parseEther('1') + 1n }, 'INVALID_PAYLOAD'],
    ['a zero limit price', { triggerPrice: 0n }, 'INVALID_PAYLOAD'],
    ['another input token', { tokenIn: alice.address }, 'UNSUPPORTED_ASSET'],
    ['another output token', { tokenOut: alice.address }, 'UNSUPPORTED_ASSET'],
  ])('refuses %s without spending the nonce', async (_name, overrides, code) => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const nonce = 40n;

    const { status, body } = await api.create(alice, { ...overrides, nonce });

    expect(status).toBe(400);
    expect(body).toEqual({ error: code });
    expect((await api.create(alice, { nonce })).status).toBe(200);
  });

  it('restores the order and its reservation after a restart, without reserving twice', async () => {
    const first = await harness.boot();
    const api = client(first, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice, { triggerPrice: 10n ** 30n });
    await first.stop();

    const second = await harness.boot();

    expect(statusOf(second, body.intentId)).toBe('pending');
    expect(nativeBalance(second, alice.address)).toMatchObject({ available: DEPOSIT - AMOUNT, reserved: AMOUNT });
  });
});

describe('POST /intents/status', () => {
  it("returns only the owner's orders", async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    await api.fund(bob);
    const { body: own } = await api.create(alice);
    await api.create(bob);

    const { status, body } = await api.status(alice, privateKeyToAccount(generatePrivateKey()));

    expect(status).toBe(200);
    expect(body).toEqual({ intents: [{ id: own.intentId, status: 'pending' }] });
  });

  it('needs a session key signature', async () => {
    const enclave = await harness.boot();
    const expires = expiry();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const api = apiClient(enclave);
    const signature = await api.sign(stranger, 'SessionQuery', { owner: alice.address, expiry: BigInt(expires) } as never);

    const { status, body } = await api.post('/intents/status', {
      message: { owner: alice.address, expiry: String(expires) },
      signature,
    });

    expect(status).toBe(401);
    expect(body).toEqual({ error: 'UNKNOWN_SESSION' });
  });
});

describe('POST /intents/cancel', () => {
  it('cancels a pending order and releases its funds once', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice);

    const cancelled = await api.cancel(alice, body.intentId as string);
    const again = await api.cancel(alice, body.intentId as string);

    expect(cancelled.body).toEqual({ status: 'cancelled' });
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: 'INTENT_NOT_FOUND' });
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });

  it("gives the same answer for another owner's order as for one that doesn't exist", async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice);

    const others = await api.cancel(bob, body.intentId as string);
    const missing = await api.cancel(bob, keccak256(toHex('missing')));

    expect(others.status).toBe(404);
    expect(others.body).toEqual(missing.body);
    expect(statusOf(enclave, body.intentId)).toBe('pending');
  });

  it('refuses a replayed nonce', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice);
    await api.cancel(alice, body.intentId as string, 60n);

    const { status, body: refused } = await api.cancel(alice, body.intentId as string, 60n);

    expect(status).toBe(409);
    expect(refused).toEqual({ error: 'NONCE_USED' });
  });

  it('keeps a cancelled order cancelled after a restart', async () => {
    const first = await harness.boot();
    const api = client(first, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice);
    await api.cancel(alice, body.intentId as string);
    await first.stop();

    const second = await harness.boot();

    expect(statusOf(second, body.intentId)).toBe('cancelled');
    expect(nativeBalance(second, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });

  it('cannot start a swap with funds that a cancel is releasing', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice);
    const runIntent = vi.spyOn(enclave.parts.executor, 'runIntent');

    const append = enclave.parts.journal.append.bind(enclave.parts.journal);
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedJournal = () => undefined as void;
    const writing = new Promise<void>((resolve) => {
      reachedJournal = resolve;
    });
    vi.spyOn(enclave.parts.journal, 'append').mockImplementation(async (event: JournalEvent) => {
      if (event.t === 'INTENT_CANCELLED') {
        reachedJournal();
        await gate;
      }
      return append(event);
    });

    const cancelling = api.cancel(alice, body.intentId as string);
    await writing;
    await enclave.parts.pipeline.handleReport(report(harness.token()));
    release();

    expect((await cancelling).status).toBe(200);
    expect(runIntent).not.toHaveBeenCalled();
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });

  it('leaves the order pending and funded when the journal write fails', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice);
    const append = enclave.parts.journal.append.bind(enclave.parts.journal);
    vi.spyOn(enclave.parts.journal, 'append').mockImplementation(async (event: JournalEvent) => {
      if (event.t === 'INTENT_CANCELLED') throw new Error('disk full');
      return append(event);
    });

    const { status, body: refused } = await api.cancel(alice, body.intentId as string);

    expect(status).toBe(500);
    expect(refused).toEqual({ error: 'INTERNAL_ERROR' });
    expect(statusOf(enclave, body.intentId)).toBe('pending');
    expect(nativeBalance(enclave, alice.address).reserved).toBe(AMOUNT);
  });
});

describe('expiry', () => {
  it('ends an expired order on a timer and releases its funds', async () => {
    const enclave = await harness.boot({ config: harness.config({ PRICE_POLL_INTERVAL_SEC: '1' }) });
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice, { expiresAt: expiry(1), triggerPrice: 10n ** 30n });

    await vi.waitFor(() => expect(statusOf(enclave, body.intentId)).toBe('expired'), { timeout: 5_000, interval: 100 });

    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });

  it('ends an order that expired while the service was down', async () => {
    const first = await harness.boot();
    const api = client(first, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice, { expiresAt: expiry(1), triggerPrice: 10n ** 30n });
    await first.stop();
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    const second = await harness.boot();

    expect(statusOf(second, body.intentId)).toBe('expired');
    expect(nativeBalance(second, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });

  it('never expires a running order', async () => {
    const enclave = await harness.boot();
    const api = client(enclave, harness.token());
    await api.fund(alice);
    const { body } = await api.create(alice, { expiresAt: expiry(1), triggerPrice: 10n ** 30n });
    enclave.parts.intents.mark(body.intentId as string, 'executing');
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(await enclave.parts.intentOrders.expireDue()).toBe(0);

    expect(nativeBalance(enclave, alice.address).reserved).toBe(AMOUNT);
    enclave.parts.intents.mark(body.intentId as string, 'pending');
  });
});

describe('running an order through the pipeline', () => {
  it('goes from signed order to settled swap, started by the real price poller', async () => {
    const { enclave, token } = await bootForSwaps({ PRICE_POLL_INTERVAL_SEC: '1' });
    await harness.send(swapAccount.address, parseEther('1'));
    await enclave.parts.inventory.refresh();
    const api = client(enclave, token);
    await api.fund(alice);
    const { body } = await api.create(alice);

    await vi.waitFor(() => expect(statusOf(enclave, body.intentId)).toBe('done'), { timeout: 12_000, interval: 100 });

    const out = (AMOUNT * 2_000_000_000n) / parseEther('1');
    const fee = (out * 10n) / 10_000n;
    const { body: read } = await api.status(alice, privateKeyToAccount(generatePrivateKey()));
    expect(read).toEqual({ intents: [{ id: body.intentId, status: 'done', amountOut: String(out - fee) }] });
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: DEPOSIT - AMOUNT, reserved: 0n });
    expect(enclave.parts.ledger.getBalance(alice.address, token).available).toBe(out - fee);
  });

  it('reports the same status after a restart', async () => {
    const { enclave, token } = await bootForSwaps({ PRICE_POLL_INTERVAL_SEC: '1' });
    await harness.send(swapAccount.address, parseEther('1'));
    await enclave.parts.inventory.refresh();
    const api = client(enclave, token);
    await api.fund(alice);
    const { body } = await api.create(alice);
    await vi.waitFor(() => expect(statusOf(enclave, body.intentId)).toBe('done'), { timeout: 12_000, interval: 100 });
    const settled = enclave.parts.intents.get(body.intentId as string)?.settledAmountOut;
    await enclave.stop();

    const second = await harness.boot({
      config: harness.config({ TOKEN_OUT_ADDRESS: token }),
      openKeys: harness.openKeysWith(SwapAllowedKeys),
    });

    expect(statusOf(second, body.intentId)).toBe('done');
    expect(second.parts.intents.get(body.intentId as string)?.settledAmountOut).toBe(settled);
    expect(nativeBalance(second, alice.address)).toMatchObject({ available: DEPOSIT - AMOUNT, reserved: 0n });
  });

  it('does not run an order below its limit', async () => {
    const { enclave, token } = await bootForSwaps();
    await harness.send(swapAccount.address, parseEther('1'));
    await enclave.parts.inventory.refresh();
    const api = client(enclave, token);
    await api.fund(alice);
    const { body } = await api.create(alice, { triggerPrice: 2_001n * PRICE_SCALE });

    expect(await enclave.parts.pipeline.handleReport(report(token))).toEqual([]);

    expect(statusOf(enclave, body.intentId)).toBe('pending');
  });

  it('keeps an order pending for the next price check when no inventory can run it', async () => {
    // The real key manager's addresses start empty, unlike the shared swap account.
    const { enclave, token } = await bootForSwaps({}, KeyManager);
    const api = client(enclave, token);
    await api.fund(alice);
    const { body } = await api.create(alice);

    const outcomes = await enclave.parts.pipeline.handleReport(report(token));

    expect(outcomes).toEqual([{ status: 'pending', reason: 'NO_INVENTORY' }]);
    expect(statusOf(enclave, body.intentId)).toBe('pending');
    expect(nativeBalance(enclave, alice.address).reserved).toBe(AMOUNT);
  });

  it('runs an order once across overlapping price reports', async () => {
    const { enclave, token } = await bootForSwaps();
    await harness.send(swapAccount.address, parseEther('1'));
    await enclave.parts.inventory.refresh();
    const runIntent = vi.spyOn(enclave.parts.executor, 'runIntent');
    const api = client(enclave, token);
    await api.fund(alice);
    const { body } = await api.create(alice);

    await Promise.all([
      enclave.parts.pipeline.handleReport(report(token)),
      enclave.parts.pipeline.handleReport(report(token)),
    ]);

    expect(runIntent).toHaveBeenCalledTimes(1);
    expect(statusOf(enclave, body.intentId)).toBe('done');
  });

  it('fails the order and returns the funds while the real signer refuses swaps', async () => {
    const uniswap = await harness.localUniswap();
    const enclave = await harness.boot({
      config: harness.config({ TOKEN_OUT_ADDRESS: uniswap.token, UNIVERSAL_ROUTER_ADDRESS: uniswap.router }),
      quoter: uniswap.quoter,
    });
    await harness.send(enclave.parts.keys.list()[0]!.address, parseEther('1'));
    await enclave.parts.inventory.refresh();
    const api = client(enclave, uniswap.token);
    await api.fund(alice);
    const { body } = await api.create(alice);

    const outcomes = await enclave.parts.pipeline.handleReport(report(uniswap.token));

    expect(outcomes).toEqual([{ status: 'failed', reason: 'PREPARE_FAILED' }]);
    expect(statusOf(enclave, body.intentId)).toBe('failed');
    expect(nativeBalance(enclave, alice.address)).toMatchObject({ available: DEPOSIT, reserved: 0n });
  });
});
