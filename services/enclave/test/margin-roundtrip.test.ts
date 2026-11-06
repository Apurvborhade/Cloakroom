import { NATIVE, PERMIT2_ADDRESS } from '@cloakroom/shared';
import type { EIP712_TYPES, JournalEvent } from '@cloakroom/shared';
import { getAddress, http, parseEther } from 'viem';
import type { Address, Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import { replayLedger } from '../src/ledger.js';
import { JournaledMarginAccounting } from '../src/margin-accounting.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import type { RunningEnclave } from '../src/server.js';
import { apiClient, enclaveHarness, waitForDeposit } from './helpers/enclave.js';
import { marginRouter } from './helpers/margin-router.js';

const harness = enclaveHarness(18_805, 18_806);
const ETH = 10n ** 18n, USD = 10n ** 6n;
const newAccount = () => privateKeyToAccount(generatePrivateKey());
const expiry = () => BigInt(Math.floor(Date.now() / 1000) + 120);
type Side = 'long' | 'short';

async function roundtrip(side: Side) {
  const market = await marginRouter(harness.chain, http('http://127.0.0.1:18805'));
  const sealed = new MemoryCipherBlobStore(), snapshots = new MemoryCipherBlobStore();
  const prices = { latest: () => ({
    pair: `${NATIVE}/${market.token}`, price: market.price(), ts: Math.floor(Date.now() / 1000), source: 'test',
  }) };
  const boot = (allowCreate: boolean) => harness.boot({
    config: harness.config({
      MARGIN_ENABLED: 'true', FEE_BPS: '0', INVENTORY_EOA_COUNT: '3', DEPOSIT_SESSION_TTL_SEC: '900',
      TOKEN_OUT_ADDRESS: market.token, TOKEN_OUT_DECIMALS: '6', WETH_ADDRESS: market.weth,
      UNIVERSAL_ROUTER_ADDRESS: market.router,
    }),
    openKeys: undefined,
    openRuntime: (policy) => openCustodyRuntime({
      vault: new AesGcmStateVault(sealed, simulationSealingKey('cd'.repeat(32), true), true),
      journalStore: snapshots, policy, allowCreate, simMode: true, buildHash: 'ef'.repeat(32),
      quote: async () => Buffer.from('test-quote'),
    }),
    marginAccounting: (parts) => new JournaledMarginAccounting({ ...parts, usdc: market.token, usdcDecimals: 6 }),
    quoter: market.quoter,
    riskPrices: prices,
  });
  let enclave: RunningEnclave = await boot(true);
  const trader = newAccount(), lender = newAccount();
  const loanToken = side === 'long' ? market.token : NATIVE;
  const supplied = side === 'long' ? 1_000n * USD : ETH;
  const borrowed = side === 'long' ? 750n * USD : ETH / 2n;

  // Test liquidity for address separation; deposits and their ledger credits still use the API/watcher.
  await harness.send(market.router, 10n * ETH);
  for (const eoa of enclave.parts.keys.list()) {
    await harness.send(eoa.address, 2n * ETH);
    await market.seedTokens(eoa.address, 2_000n * USD);
  }
  const float = await enclave.parts.inventory.getPhysicalBalances();

  const events = async () => {
    const result: JournalEvent[] = [];
    for await (const { event } of enclave.parts.journal.replay()) result.push(event);
    return result;
  };
  const mutate = async (
    owner: PrivateKeyAccount, type: keyof typeof EIP712_TYPES, path: string,
    fields: Record<string, unknown>, wire: Record<string, unknown> = {},
  ) => {
    const api = apiClient(enclave);
    const message = { owner: owner.address, ...fields, nonce: enclave.parts.ledger.getLastNonce(owner.address) + 1n, expiry: expiry() };
    const response = await api.post(path, {
      message: { ...Object.fromEntries(Object.entries(message).map(([key, value]) =>
        [key, typeof value === 'bigint' ? String(value) : value])), ...wire },
      signature: await api.sign(owner, type, message as never),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body;
  };
  const query = async (owner: PrivateKeyAccount, path: string) => {
    const api = apiClient(enclave), session = newAccount(), expires = expiry();
    const grant = { owner: owner.address, sessionKey: session.address, expiry: expires };
    expect((await api.post('/session', {
      message: { ...grant, expiry: String(expires) },
      signature: await api.sign(owner, 'SessionGrant', grant as never),
    })).status).toBe(200);
    const message = { owner: owner.address, expiry: expires };
    const response = await api.post(path, {
      message: { ...message, expiry: String(expires) },
      signature: await api.sign(session, 'SessionQuery', message as never),
    });
    expect(response.status).toBe(200);
    return response.body;
  };
  const deposit = async (owner: PrivateKeyAccount, amount: bigint) => {
    const body = await mutate(owner, 'DepositRequest', '/deposit-session', { asset: NATIVE });
    await harness.send(body.depositAddress as Address, amount);
    await waitForDeposit(enclave, body.sessionId as string, amount);
  };
  const toUsdc = async (owner: PrivateKeyAccount, amountIn: bigint) => {
    const body = await mutate(owner, 'Intent', '/intents', {
      tokenIn: NATIVE, tokenOut: market.token, amountIn,
      comparator: 0, triggerPrice: 1_900n * ETH, maxSlippageBps: 100,
    });
    const intent = enclave.parts.intents.get(body.intentId as string)!;
    expect((await enclave.parts.executor.runIntent(intent)).status).toBe('settled');
  };
  const position = async () => (await query(trader, '/margin/positions')).positions as Array<Record<string, string>>;
  const waitPosition = async (status: string) => {
    await vi.waitFor(async () => {
      expect((await position())[0]?.status).toBe(status);
      expect(enclave.parts.margin!.orders.inFlightCount).toBe(0);
    }, { timeout: 8_000, interval: 100 });
    return (await position())[0]!;
  };
  const reconcile = async () => {
    const { ledger, inventory, journal } = enclave.parts;
    const physical = await inventory.getPhysicalBalances(), claims = ledger.custodyClaims();
    expect(physical.get(market.token)! - (claims.get(market.token) ?? 0n)).toBe(float.get(market.token));
    expect(physical.get(NATIVE)! - (claims.get(NATIVE) ?? 0n) + ledger.getOperationalGasSpent(NATIVE)).toBe(float.get(NATIVE));
    ledger.assertInvariants();
    const replay = await replayLedger(journal);
    expect(replay.custodyClaims()).toEqual(claims);
    expect(replay.getOperationalGasTotals()).toEqual(ledger.getOperationalGasTotals());
    expect(replay.marginPositions.positions()).toEqual(ledger.marginPositions.positions());
  };
  const withdraw = async (owner: PrivateKeyAccount, token: Address, amount: bigint) => {
    const to = newAccount().address;
    const body = await mutate(owner, 'Withdrawal', '/withdrawals', { token, amount, to });
    await vi.waitFor(() => {
      expect(enclave.parts.withdrawalStatuses.listByOwner(owner.address).find((w) => w.id === body.withdrawalId)?.status).toBe('confirmed');
      expect(enclave.parts.withdrawalOrders.inFlightCount).toBe(0);
    }, { timeout: 8_000, interval: 100 });
    const withdrawals = (await query(owner, '/withdrawals/status')).withdrawals as Array<Record<string, string>>;
    const paid = withdrawals.find((w) => w.id === body.withdrawalId)!;
    expect(paid.status).toBe('confirmed');
    const tx = await harness.chain.getTransaction({ hash: paid.txHash as Hex });
    expect(enclave.parts.inventory.eoasLinkedTo(owner.address).has(getAddress(tx.from))).toBe(false);
    expect(token === NATIVE ? await harness.chain.getBalance({ address: to }) : await market.tokenBalance(to)).toBe(amount);
    expect(enclave.parts.ledger.getBalance(owner.address, token)).toMatchObject({ available: 0n, reserved: 0n, pending: 0n });
  };

  await deposit(lender, side === 'long' ? ETH / 2n : ETH);
  if (side === 'long') await toUsdc(lender, ETH / 2n);
  await mutate(lender, 'MarginSupply', '/margin/lending/supply', { token: loanToken, amount: supplied });
  await deposit(trader, ETH / 8n);
  await toUsdc(trader, ETH / 8n);
  await reconcile();
  const { positionId } = await mutate(trader, 'MarginOpen', '/margin/positions/open', {
    side: side === 'long' ? 0 : 1, collateral: 250n * USD, leverageBps: 40_000,
    limitPrice: (side === 'long' ? 2_100n : 1_900n) * ETH, maxSlippageBps: 100,
  }, { side });
  const opened = await waitPosition('open');
  expect(opened).toMatchObject({
    id: positionId, side, debt: String(borrowed), equity: String(250n * USD),
    asset: String(side === 'long' ? ETH / 2n : 1_000n * USD),
  });
  expect(enclave.parts.ledger.margin.balance(lender.address, loanToken).available).toBe(supplied - borrowed);
  await reconcile();

  return {
    market, events, reconcile, waitPosition, position,
    enclave: () => enclave,
    restart: async () => { await enclave.stop(); enclave = await boot(false); },
    close: () => mutate(trader, 'MarginClose', '/margin/positions/close', {
      positionId, limitPrice: (side === 'long' ? 1_900n : 2_100n) * ETH, maxSlippageBps: 100,
    }),
    liquidate: () => enclave.parts.margin!.liquidations.onReport(prices.latest()),
    finish: async (status: string, payout: bigint, payoutNative = 0n) => {
      const settled = await waitPosition(status);
      expect(settled).toMatchObject({ debt: '0', asset: '0', payout: String(payout), shortfall: '0' });
      expect(BigInt(settled.payoutNative ?? '0')).toBe(payoutNative);
      expect(enclave.parts.ledger.margin.balance(lender.address, loanToken).available).toBe(supplied);
      await reconcile();
      await withdraw(trader, market.token, payout);
      if (payoutNative > 0n) await withdraw(trader, NATIVE, payoutNative);
      await mutate(lender, 'MarginRedeem', '/margin/lending/redeem', { token: loanToken, amount: supplied });
      await withdraw(lender, loanToken, supplied);
      expect((await query(lender, '/margin/lending')).lending).toEqual([]);
      expect(enclave.parts.ledger.margin.balance(lender.address, loanToken)).toMatchObject({ supplied: 0n, available: 0n });
      await reconcile();
      const registered = (await events()).filter((e) => e.t === 'SIGNING_REGISTERED' && e.opId.startsWith('approval:'));
      expect(registered).toEqual(expect.arrayContaining([
        expect.objectContaining({ to: market.token }), expect.objectContaining({ to: PERMIT2_ADDRESS }),
      ]));
    },
  };
}

beforeAll(() => harness.start());
afterAll(() => harness.finish());
beforeEach(() => harness.reset());
afterEach(async () => { vi.restoreAllMocks(); await harness.cleanup(); });

describe('margin roundtrip on Anvil with a fixed-price router', () => {
  it('restarts an open long, closes it, and pays out collateral and lender funds', async () => {
    const test = await roundtrip('long');
    const before = await test.position();
    await test.restart();
    expect(await test.position()).toEqual(before);
    await test.reconcile();
    await test.close();
    await test.finish('closed', 250n * USD);
  }, 30_000);

  it('recovers a mined short buyback after a lost receipt, paying its ETH surplus exactly once', async () => {
    const test = await roundtrip('short');
    const original = harness.chain.waitForTransactionReceipt.bind(harness.chain);
    let lostHash: Hex | undefined;
    const receipt = vi.spyOn(harness.chain, 'waitForTransactionReceipt').mockImplementation(async (request) => {
      const result = await original(request);
      const journal = await test.events();
      const broadcast = journal.find((e) => e.t === 'MARGIN_OP_BROADCAST' && e.txHash === request.hash);
      if (broadcast?.t === 'MARGIN_OP_BROADCAST' && journal.some((e) =>
        e.t === 'MARGIN_OP_APPROVED' && e.opId === broadcast.opId && e.kind === 'close')) {
        lostHash = request.hash;
        throw new Error('Receipt response lost after mining');
      }
      return result;
    });
    await test.close();
    expect(await test.waitPosition('closing')).toMatchObject({ debt: String(ETH / 2n), asset: String(1_000n * USD) });
    expect(lostHash).toBeDefined();
    receipt.mockRestore();
    await test.restart();
    await test.finish('closed', 230n * USD, parseEther('0.01'));
    const settlements = (await test.events()).filter((e) => e.t === 'MARGIN_OP_SETTLED' && e.txHash === lostHash);
    expect(settlements).toHaveLength(1);
    await test.restart();
    await test.reconcile();
    expect((await test.events()).filter((e) => e.t === 'MARGIN_OP_SETTLED' && e.txHash === lostHash)).toHaveLength(1);
  }, 30_000);

  it.each(['long', 'short'] as const)('liquidates a %s and returns the remaining collateral and loan', async (side) => {
    const test = await roundtrip(side);
    await test.market.configure(side === 'long' ? 1_600n : 2_400n);
    await test.liquidate();
    await test.finish('liquidated', (side === 'long' ? 50n : 26n) * USD, side === 'short' ? parseEther('0.01') : 0n);
  }, 30_000);
});
