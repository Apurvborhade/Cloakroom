import { NATIVE, PERMIT2_ADDRESS } from '@cloakroom/shared';
import type { JournalEvent, PriceReport } from '@cloakroom/shared';
import { encodeFunctionData, keccak256, parseAbi, parseEther } from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunningEnclave } from '../src/server.js';
import { apiClient, enclaveHarness } from './helpers/enclave.js';

const harness = enclaveHarness(18_803, 18_804);
const PRICE_SCALE = 10n ** 18n;
const MARKET_PRICE = 2_000n * PRICE_SCALE;
const COLLATERAL = 250_000_000n; // 250 USDC
const FOUR_X = 40_000;
const newAccount = () => privateKeyToAccount(generatePrivateKey());
const expiry = () => Math.floor(Date.now() / 1000) + 120;

/** A price a test can move, or take away. */
function testPrice() {
  let price: bigint | null = MARKET_PRICE;
  return {
    set: (value: bigint | null) => { price = value; },
    latest: (): PriceReport | null => (price === null ? null : {
      pair: 'test', price, ts: Math.floor(Date.now() / 1000), source: 'test',
    }),
  };
}

async function bootMargin(overrides: Record<string, string> = { MARGIN_ENABLED: 'true' }) {
  const uniswap = await harness.localUniswap();
  const prices = testPrice();
  const enclave = await harness.boot({
    config: harness.config({
      TOKEN_OUT_ADDRESS: uniswap.token,
      UNIVERSAL_ROUTER_ADDRESS: uniswap.router,
      ...overrides,
    }),
    quoter: uniswap.quoter,
    riskPrices: prices,
  });
  await harness.send(enclave.parts.keys.list()[0]!.address, parseEther('2'));
  await enclave.parts.inventory.refresh();
  return { enclave, prices, uniswap };
}

function client(enclave: RunningEnclave) {
  const api = apiClient(enclave);
  let nonce = 0n;
  const signed = async (owner: PrivateKeyAccount, type: string, path: string, wire: Record<string, unknown>, typed: Record<string, unknown>) => {
    nonce += 1n;
    const expires = expiry();
    const signature = await api.sign(owner, type as never, {
      owner: owner.address, ...typed, nonce, expiry: BigInt(expires),
    } as never);
    return api.post(path, {
      message: { owner: owner.address, ...wire, nonce: String(nonce), expiry: String(expires) },
      signature,
    });
  };
  return {
    supply: (owner: PrivateKeyAccount, token: Address, amount: bigint) =>
      signed(owner, 'MarginSupply', '/margin/lending/supply', { token, amount: String(amount) }, { token, amount }),
    open: (owner: PrivateKeyAccount, side: 'long' | 'short', options: Partial<{ leverageBps: number; limitPrice: bigint }> = {}) => {
      const leverageBps = options.leverageBps ?? FOUR_X;
      const limitPrice = options.limitPrice ?? 1_900n * PRICE_SCALE;
      return signed(owner, 'MarginOpen', '/margin/positions/open', {
        side, collateral: String(COLLATERAL), leverageBps, limitPrice: String(limitPrice), maxSlippageBps: 100,
      }, {
        side: side === 'long' ? 0 : 1, collateral: COLLATERAL, leverageBps, limitPrice, maxSlippageBps: 100,
      });
    },
    positions: async (owner: PrivateKeyAccount) => {
      const session = newAccount();
      const expires = expiry();
      await api.post('/session', {
        message: { owner: owner.address, sessionKey: session.address, expiry: String(expires) },
        signature: await api.sign(owner, 'SessionGrant', {
          owner: owner.address, sessionKey: session.address, expiry: BigInt(expires),
        } as never),
      });
      const { body } = await api.post('/margin/positions', {
        message: { owner: owner.address, expiry: String(expires) },
        signature: await api.sign(session, 'SessionQuery', {
          owner: owner.address, expiry: BigInt(expires),
        } as never),
      });
      return body.positions as Array<Record<string, string>>;
    },
  };
}

async function events(enclave: RunningEnclave): Promise<JournalEvent[]> {
  const all: JournalEvent[] = [];
  for await (const { event } of enclave.parts.journal.replay()) all.push(event);
  return all;
}

beforeAll(() => harness.start());
afterAll(() => harness.finish());
beforeEach(() => harness.reset());
afterEach(async () => {
  vi.restoreAllMocks();
  await harness.cleanup();
});

describe('margin API', () => {
  it('does not exist unless switched on', async () => {
    const { enclave } = await bootMargin({});
    const response = await enclave.app.inject({ method: 'POST', url: '/margin/positions/open', payload: {} });
    expect(response.statusCode).toBe(404);
    expect(enclave.parts.margin).toBeUndefined();
  });

  it('opens a short through the real signer, from an address the owner did not fund', async () => {
    const { enclave } = await bootMargin();
    const api = client(enclave);
    const trader = newAccount();
    expect((await api.supply(newAccount(), NATIVE, parseEther('1'))).status).toBe(200);

    const opened = await api.open(trader, 'short');
    expect(opened.status).toBe(200);
    expect(opened.body.status).toBe('opening');

    await vi.waitFor(async () => {
      expect((await api.positions(trader))[0]?.status).toBe('open');
    }, { timeout: 8000, interval: 100 });

    const [position] = await api.positions(trader);
    // 250 USDC at 4x borrows 1,000 USDC of ETH at 2,000, and the router pays 2,000 per ETH.
    expect(position!.debt).toBe(parseEther('0.5').toString());
    expect(position!.asset).toBe('1000000000');
    expect(BigInt(position!.equity!)).toBe(COLLATERAL);

    const types = (await events(enclave)).map((event) => event.t);
    expect(types).toEqual(expect.arrayContaining(['MARGIN_OP_APPROVED', 'SIGNING_REGISTERED', 'MARGIN_OP_BROADCAST', 'MARGIN_OP_SETTLED']));
  });

  it('refuses new risk without a fresh price, and past the leverage cap or the lending pool', async () => {
    const { enclave, prices } = await bootMargin();
    const api = client(enclave);
    const trader = newAccount();

    expect((await api.open(trader, 'short')).body.error).toBe('INSUFFICIENT_LIQUIDITY');
    await api.supply(newAccount(), NATIVE, parseEther('1'));
    expect((await api.open(trader, 'short', { leverageBps: 40_001 })).body.error).toBe('INSUFFICIENT_COLLATERAL');

    prices.set(null);
    const stale = await api.open(trader, 'short');
    expect(stale.status).toBe(503);
    expect(stale.body.error).toBe('STALE_PRICE');
    expect(await api.positions(trader)).toEqual([]);
  });

  it('never signs a margin swap accounting did not approve, or a stray approval', async () => {
    const { enclave, uniswap } = await bootMargin();
    const eoa = enclave.parts.keys.list()[0]!.address;
    const data: Hex = '0x1234';
    const expected = { eoa, to: uniswap.router, value: 0n, dataHash: keccak256(data), data };
    await expect(enclave.parts.keys.registerOp(`margin:${'ab'.repeat(32)}`, expected)).rejects.toThrow('SIGNING_DENIED');
    await expect(enclave.parts.keys.registerOp(`approval:${eoa}:0:x`, expected)).rejects.toThrow('SIGNING_DENIED');
  });

  it('signs the one-time approval for Permit2, but not one naming another spender', async () => {
    const { enclave, uniswap } = await bootMargin();
    const eoa = enclave.parts.keys.list()[0]!.address;
    const abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)']);
    const approval = (spender: Address) => {
      const data = encodeFunctionData({ abi, functionName: 'approve', args: [spender, 2n ** 256n - 1n] });
      return { eoa, to: uniswap.token, value: 0n, dataHash: keccak256(data), data };
    };
    await expect(enclave.parts.keys.registerOp(`approval:${eoa}:0:a`, approval(PERMIT2_ADDRESS))).resolves.toBeUndefined();
    await expect(enclave.parts.keys.registerOp(`approval:${eoa}:1:a`, approval(newAccount().address))).rejects.toThrow('SIGNING_DENIED');
  });

  it('keeps the debt when a liquidation cannot run', async () => {
    const { enclave, prices } = await bootMargin();
    const api = client(enclave);
    const trader = newAccount();
    await api.supply(newAccount(), NATIVE, parseEther('1'));
    await api.open(trader, 'short');
    await vi.waitFor(async () => {
      expect((await api.positions(trader))[0]?.status).toBe('open');
    }, { timeout: 8000, interval: 100 });

    // ETH up 20%: past the 13.6% line. Buying the ETH back takes more USDC than one address holds.
    prices.set(2_400n * PRICE_SCALE);
    await enclave.parts.margin!.liquidations.onReport(prices.latest()!);
    await vi.waitFor(() => expect(enclave.parts.margin!.orders.inFlightCount).toBe(0), { timeout: 5000 });

    const [position] = await api.positions(trader);
    expect(position!.status).toBe('open');
    expect(position!.debt).toBe(parseEther('0.5').toString());
    const failed = (await events(enclave)).find((event) => event.t === 'MARGIN_OP_FAILED');
    expect(failed).toMatchObject({ reason: 'NO_INVENTORY' });
    expect(position!.reason).toBe('NO_INVENTORY');
    expect(await api.positions(newAccount())).toEqual([]);
  });

  it('releases an operation a restart interrupted before anything was sent', async () => {
    const { enclave, uniswap } = await bootMargin();
    const opId = `margin:${'cd'.repeat(32)}`;
    await enclave.parts.journal.append({
      t: 'MARGIN_OP_APPROVED',
      opId,
      kind: 'close',
      positionId: `0x${'cd'.repeat(32)}`,
      owner: newAccount().address,
      tokenIn: NATIVE,
      tokenOut: uniswap.token,
      amountIn: parseEther('0.1'),
      minAmountOut: 1n,
      maxSlippageBps: 100,
      expiry: expiry(),
    });
    await enclave.stop();

    const restarted = await harness.boot({
      config: harness.config({ MARGIN_ENABLED: 'true', TOKEN_OUT_ADDRESS: uniswap.token, UNIVERSAL_ROUTER_ADDRESS: uniswap.router }),
      quoter: uniswap.quoter,
      riskPrices: testPrice(),
    });
    expect(restarted.recovery).toContainEqual({ opId, status: 'released' });
    expect((await events(restarted)).at(-1)).toMatchObject({ t: 'MARGIN_OP_FAILED', opId, reason: 'INTERRUPTED' });
  });
});
