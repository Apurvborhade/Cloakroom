import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent, MarginOpenMsg, MarginOperation, PriceReport } from '@cloakroom/shared';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, toBytes } from 'viem';
import type { Address, Hex, TransactionReceipt } from 'viem';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import { Executor } from '../src/executor.js';
import type { ExecutorDeps } from '../src/executor.js';
import { JournaledMarginAccounting } from '../src/margin-accounting.js';
import { replayLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';

const LENDER: Address = '0x1111111111111111111111111111111111111111';
const TRADER: Address = '0x2222222222222222222222222222222222222222';
const OTHER: Address = '0x3333333333333333333333333333333333333333';
const USDC: Address = '0x4444444444444444444444444444444444444444';
const WETH: Address = '0x5555555555555555555555555555555555555555';
const USD = 10n ** 6n, ETH = 10n ** 18n;
const policy = { chainId: 1, maxGas: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, maxNativeValue: 1n };
let state: MemoryCipherBlobStore, snapshots: MemoryCipherBlobStore;
let runtime: Awaited<ReturnType<typeof openCustodyRuntime>>;
let accounting: JournaledMarginAccounting, queue: FifoSerialQueue, nonce: bigint, now: number;
const price = (value = 2_000n): PriceReport => ({ pair: `${NATIVE}/${USDC}`, price: value * ETH, ts: now, source: 'test' });
const envelope = (owner = TRADER) => ({ owner, nonce: ++nonce, expiry: BigInt(now + 120) });
const openMessage = (overrides: Partial<MarginOpenMsg> = {}): MarginOpenMsg => ({
  ...envelope(), side: 0, collateral: 250n * USD, leverageBps: 40_000,
  limitPrice: 2_100n * ETH, maxSlippageBps: 100, ...overrides,
});
const hash = (operation: MarginOperation) => keccak256(toBytes(operation.opId));
const result = (operation: MarginOperation, amountOut: bigint) => ({
  amountIn: operation.amountIn, amountOut, gasCost: 2n, txHash: hash(operation),
});

async function boot(allowCreate: boolean) {
  runtime = await openCustodyRuntime({
    vault: new AesGcmStateVault(state, simulationSealingKey('cd'.repeat(32), true), true),
    journalStore: snapshots, policy, buildHash: 'ef'.repeat(32), simMode: true, allowCreate,
    quote: async () => Buffer.from('test-quote'),
  });
  queue = new FifoSerialQueue();
  accounting = new JournaledMarginAccounting({ ...runtime, queue, usdc: USDC, usdcDecimals: 6, nowMs: () => now * 1000 });
}

async function append(event: JournalEvent) { await runtime.journal.append(event); runtime.ledger.apply(event); }
async function credit(owner: Address, amount: bigint) {
  const id = `credit-${++nonce}`;
  await append({ t: 'DEPOSIT_CREDITED', id, owner, amount: 1n, block: 1n });
  await append({ t: 'INTENT_CREATED', id, owner, intent: {
    owner, tokenIn: NATIVE, tokenOut: USDC, amountIn: 1n, comparator: 0, triggerPrice: 1n,
    maxSlippageBps: 50, nonce: 1n, expiry: 9_999_999_999n,
  } });
  await append({ t: 'EXEC_SETTLED', opId: `exec:${id}`, intentId: id, owner, tokenOut: USDC, amountOut: amount, fee: 0n });
}
async function broadcast(operation: MarginOperation) {
  await append({ t: 'MARGIN_OP_BROADCAST', opId: operation.opId, eoa: OTHER, nonce: 0, txHash: hash(operation), raw: '0x01' });
}
async function open() {
  const operation = await accounting.prepareOpen(TRADER, openMessage(), price());
  await broadcast(operation);
  await accounting.settle(operation.opId, result(operation, ETH / 2n));
  return operation;
}
async function close(positionId: Hex, limit = 2_000n) {
  return accounting.prepareClose(TRADER, { ...envelope(), positionId, limitPrice: limit * ETH, maxSlippageBps: 100 }, price());
}
async function events() {
  const all: JournalEvent[] = [];
  for await (const { event } of runtime.journal.replay()) all.push(event);
  return all;
}
async function restart() { await runtime.close(); await boot(false); }

beforeEach(async () => {
  state = new MemoryCipherBlobStore(); snapshots = new MemoryCipherBlobStore(); nonce = 0n; now = 1_000_000;
  await boot(true);
  await credit(LENDER, 1_000n * USD); await credit(TRADER, 250n * USD);
  await accounting.supply(LENDER, { ...envelope(LENDER), token: USDC, amount: 1_000n * USD });
});
afterEach(async () => { vi.restoreAllMocks(); await runtime?.close(); });

describe('long margin accounting', () => {
  it.each([1_100n, 850n])('repays the loan before crediting proceeds of %s USDC', async (proceeds) => {
    const opened = await open();
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ status: 'open', debt: 750n * USD,
      asset: ETH / 2n, equity: 250n * USD, entryPrice: 2_000n * ETH });
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(0n);
    expect(accounting.lending(LENDER)[0]?.available).toBe(250n * USD);
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe(250n * USD);
    expect(runtime.ledger.custodyClaims().get(NATIVE)).toBe(ETH / 2n);
    const operation = await close(opened.positionId, 1_600n);
    await broadcast(operation);
    await accounting.settle(operation.opId, result(operation, proceeds * USD));
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'closed', debt: 0n,
      asset: 0n, payout: (proceeds - 750n) * USD, shortfall: 0n });
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe((proceeds - 750n) * USD);
    expect(accounting.lending(LENDER)[0]?.available).toBe(1_000n * USD);
    await accounting.redeem(LENDER, { ...envelope(LENDER), token: USDC, amount: 1_000n * USD });
    expect(runtime.ledger.getBalance(LENDER, USDC).available).toBe(1_000n * USD);
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe((proceeds + 250n) * USD);
    expect(runtime.ledger.getOperationalGasSpent(NATIVE)).toBe(4n);
    const balances = runtime.ledger.totals(), positions = accounting.positions(TRADER, null);
    await restart();
    expect(runtime.ledger.totals()).toEqual(balances);
    expect(accounting.positions(TRADER, null)).toEqual(positions);
    runtime.ledger.assertInvariants();
  });

  it('approves and reserves atomically, and refuses releasing authorized funding', async () => {
    const before = (await events()).length, message = openMessage();
    const operation = await accounting.prepareOpen(TRADER, message, price());
    expect((await events()).slice(before).map((e) => e.t)).toEqual(['MARGIN_OP_APPROVED']);
    expect(runtime.ledger.getBalance(TRADER, USDC)).toMatchObject({ available: 0n, reserved: 250n * USD });
    await expect(accounting.releaseOpen(operation.opId)).rejects.toThrow('POSITION_BUSY');
    await restart();
    expect(await accounting.prepareOpen(TRADER, message, price())).toEqual(operation);
    expect((await events()).length).toBe(before + 1);
    expect(accounting.lending(LENDER)[0]?.available).toBe(250n * USD);
    await accounting.fail(operation.opId, { reason: 'INTERRUPTED' });
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'failed', debt: 0n });
    runtime.ledger.assertInvariants();
  });

  it('supports 1x without a lender or debt', async () => {
    await accounting.redeem(LENDER, { ...envelope(LENDER), token: USDC, amount: 1_000n * USD });
    const opened = await accounting.prepareOpen(TRADER, openMessage({ leverageBps: 10_000 }), price());
    await broadcast(opened); await accounting.settle(opened.opId, result(opened, ETH / 8n));
    const closing = await close(opened.positionId);
    await broadcast(closing); await accounting.settle(closing.opId, result(closing, 250n * USD));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    expect(accounting.positions(TRADER, null)[0]?.debt).toBe(0n);
    runtime.ledger.assertInvariants();
  });

  it('does not oversubscribe lending across concurrent opens', async () => {
    await credit(OTHER, 250n * USD);
    const outcomes = await Promise.allSettled([
      accounting.prepareOpen(TRADER, openMessage(), price()),
      accounting.prepareOpen(OTHER, openMessage({ owner: OTHER }), price()),
    ]);
    expect(outcomes.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(runtime.ledger.getBalance(OTHER, USDC).available).toBe(250n * USD);
    runtime.ledger.assertInvariants();
  });

  it.each(['NO_INVENTORY', 'REVERTED'])('restores a failed open after %s exactly once', async (reason) => {
    const opened = await accounting.prepareOpen(TRADER, openMessage(), price());
    if (reason === 'REVERTED') await broadcast(opened);
    const failure = reason === 'REVERTED' ? { reason, txHash: hash(opened), gasCost: 3n } : { reason };
    await accounting.fail(opened.opId, failure); await accounting.fail(opened.opId, failure);
    await expect(accounting.settle(opened.opId, result(opened, ETH / 2n))).rejects.toThrow('MARGIN_RESULT_CONFLICT');
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    expect(accounting.lending(LENDER)[0]?.available).toBe(1_000n * USD);
    expect(runtime.ledger.getOperationalGasSpent(NATIVE)).toBe(reason === 'REVERTED' ? 3n : 0n);
    await restart();
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
  });

  it('retains the loan and assets after a failed close, then permits a new close', async () => {
    const opened = await open(), first = await close(opened.positionId);
    await broadcast(first);
    await accounting.fail(first.opId, { reason: 'REVERTED', txHash: hash(first), gasCost: 1n });
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ status: 'open', debt: 750n * USD, asset: ETH / 2n });
    expect(accounting.lending(LENDER)[0]?.available).toBe(250n * USD);
    await restart();
    const second = await close(opened.positionId);
    await broadcast(second); await accounting.settle(second.opId, result(second, 1_000n * USD));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    runtime.ledger.assertInvariants();
  });

  it('does not let a voluntary close authorize losses beyond collateral', async () => {
    const opened = await open(), closing = await close(opened.positionId, 1n);
    expect(closing.minAmountOut).toBe(750n * USD);
    await broadcast(closing);
    await expect(accounting.settle(closing.opId, result(closing, 749n * USD))).rejects.toThrow('MARGIN_RESULT_INVALID');
    expect(accounting.positions(TRADER, null)[0]?.status).toBe('closing');
    expect(accounting.lending(LENDER)[0]?.available).toBe(250n * USD);
  });

  it('deduplicates results and rejects conflicting callbacks before writing', async () => {
    const opened = await open(), operation = await close(opened.positionId);
    await broadcast(operation);
    const settled = result(operation, 1_000n * USD);
    await accounting.settle(operation.opId, settled);
    await restart();
    const count = (await events()).length;
    await accounting.settle(opened.opId, result(opened, ETH / 2n));
    await accounting.settle(operation.opId, settled);
    await expect(accounting.settle(operation.opId, { ...settled, amountOut: 1_001n * USD })).rejects.toThrow('MARGIN_RESULT_CONFLICT');
    await expect(accounting.fail(operation.opId, { reason: 'NO_INVENTORY' })).rejects.toThrow('MARGIN_RESULT_CONFLICT');
    await expect(accounting.settle('absent', settled)).rejects.toThrow('MARGIN_OPERATION_NOT_FOUND');
    expect((await events()).length).toBe(count);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
  });

  it('keeps broadcast funds held on a missing receipt or mismatched result', async () => {
    const operation = await accounting.prepareOpen(TRADER, openMessage(), price());
    await expect(accounting.settle(operation.opId, result(operation, ETH / 2n))).rejects.toThrow('MARGIN_RESULT_UNCONFIRMED');
    await broadcast(operation); await restart();
    const count = (await events()).length;
    await expect(accounting.fail(operation.opId, { reason: 'TIMEOUT' })).rejects.toThrow('MARGIN_RESULT_UNCONFIRMED');
    await expect(accounting.settle(operation.opId, { ...result(operation, ETH / 2n), txHash: `0x${'ab'.repeat(32)}` })).rejects.toThrow('MARGIN_RESULT_UNCONFIRMED');
    await expect(accounting.settle(operation.opId, { ...result(operation, ETH / 2n), amountIn: 1n })).rejects.toThrow('MARGIN_RESULT_INVALID');
    await expect(accounting.settle(operation.opId, result(operation, operation.minAmountOut - 1n))).rejects.toThrow('MARGIN_RESULT_INVALID');
    expect((await events()).length).toBe(count);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(accounting.lending(LENDER)[0]?.available).toBe(250n * USD);
    await accounting.settle(operation.opId, result(operation, ETH / 2n));
    runtime.ledger.assertInvariants();
  });

  it('locks extra collateral and returns it with the eventual payout', async () => {
    const opened = await open(); await credit(TRADER, 100n * USD);
    const message = { ...envelope(), positionId: opened.positionId, amount: 100n * USD };
    await accounting.addCollateral(TRADER, message); await accounting.addCollateral(TRADER, message);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ collateral: 350n * USD, equity: 350n * USD });
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe(350n * USD);
    await restart();
    expect(accounting.positions(TRADER, price())[0]?.equity).toBe(350n * USD);
    const closing = await close(opened.positionId);
    await expect(accounting.addCollateral(TRADER, { ...message, ...envelope() })).rejects.toThrow('POSITION_BUSY');
    await broadcast(closing); await accounting.settle(closing.opId, result(closing, 1_000n * USD));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(350n * USD);
    runtime.ledger.assertInvariants();
  });

  it('liquidates once below maintenance and freezes lending if collateral cannot cover the loss', async () => {
    const opened = await open();
    expect(await accounting.liquidationCandidates(price())).toEqual([]);
    expect(await accounting.prepareLiquidation(opened.positionId, price())).toBeNull();
    expect(await accounting.liquidationCandidates(price(1_600n))).toEqual([opened.positionId]);
    const operation = await accounting.prepareLiquidation(opened.positionId, price(1_400n));
    expect(operation).not.toBeNull();
    expect(await accounting.prepareLiquidation(opened.positionId, price(1_400n))).toBeNull();
    await expect(close(opened.positionId)).rejects.toThrow('POSITION_BUSY');
    await broadcast(operation!); await accounting.settle(operation!.opId, result(operation!, 700n * USD));
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'liquidated', shortfall: 50n * USD, payout: 0n, debt: 50n * USD });
    expect(runtime.ledger.margin.shortfall(USDC)).toBe(50n * USD);
    expect(accounting.lending(LENDER)[0]).toMatchObject({ supplied: 1_000n * USD, available: 0n });
    await expect(accounting.redeem(LENDER, { ...envelope(LENDER), token: USDC, amount: 1n })).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    await credit(TRADER, 250n * USD);
    await expect(accounting.prepareOpen(TRADER, openMessage(), price())).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    // Bad debt is still a liability; reconciliation must not count it as healthy collateral.
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe(1_250n * USD);
    await restart();
    expect(runtime.ledger.margin.shortfall(USDC)).toBe(50n * USD);
    expect(accounting.lending(LENDER)[0]?.available).toBe(0n);
    runtime.ledger.assertInvariants();
  });

  it('rejects stale/wrong prices, excessive leverage, invalid sides, and unsafe limit prices without journaling', async () => {
    const count = (await events()).length;
    for (const report of [{ ...price(), ts: now - 91 }, { ...price(), ts: now + 1 }, { ...price(), pair: 'wrong' }]) {
      await expect(accounting.prepareOpen(TRADER, openMessage(), report)).rejects.toThrow('STALE_PRICE');
    }
    for (const overrides of [{ leverageBps: 40_001 }, { leverageBps: 9_999 }, { collateral: 0n }, { limitPrice: 10_000n * ETH }]) {
      await expect(accounting.prepareOpen(TRADER, openMessage(overrides), price())).rejects.toThrow('INSUFFICIENT_COLLATERAL');
    }
    await expect(accounting.prepareOpen(TRADER, openMessage({ side: 2 }), price())).rejects.toThrow('INVALID_PAYLOAD');
    await expect(accounting.prepareOpen(TRADER, openMessage({ expiry: BigInt(now) }), price())).rejects.toThrow('EXPIRED');
    expect((await events()).length).toBe(count);
  });

  it('enforces ownership and command nonce binding across lending and positions', async () => {
    const message = openMessage(), opened = await accounting.prepareOpen(TRADER, message, price());
    await expect(accounting.prepareOpen(OTHER, message, price())).rejects.toThrow('BAD_SIGNATURE');
    await expect(accounting.prepareOpen(TRADER, { ...message, collateral: 200n * USD }, price())).rejects.toThrow('MARGIN_OP_CONFLICT');
    await expect(accounting.supply(TRADER, { ...message, token: USDC, amount: 1n })).rejects.toThrow('MARGIN_OP_CONFLICT');
    await broadcast(opened); await accounting.settle(opened.opId, result(opened, ETH / 2n));
    await expect(accounting.prepareClose(OTHER, { ...envelope(OTHER), positionId: opened.positionId, limitPrice: ETH, maxSlippageBps: 100 }, price())).rejects.toThrow('POSITION_NOT_FOUND');
    expect(accounting.positions(OTHER, null)).toEqual([]);
    const exposed = accounting.positions(TRADER, null)[0]!; exposed.asset = 999n;
    expect(accounting.positions(TRADER, null)[0]?.asset).toBe(ETH / 2n);
  });

  it('copies queued commands and rechecks price age when the queue reaches them', async () => {
    let release!: () => void;
    const blocked = queue.run(() => new Promise<void>((resolve) => { release = resolve; }));
    await Promise.resolve();
    const message = openMessage(), report = price();
    const pending = accounting.prepareOpen(TRADER, message, report);
    message.collateral = 999n; report.ts += 100;
    now += 92; release(); await blocked;
    await expect(pending).rejects.toThrow('STALE_PRICE');
    expect(accounting.positions(TRADER, null)).toEqual([]);
  });

  it('leaves balances unchanged on a failed approval write and blocks further margin writes', async () => {
    const write = vi.spyOn(runtime.journal, 'append').mockRejectedValueOnce(new Error('write failed'));
    await expect(accounting.prepareOpen(TRADER, openMessage(), price())).rejects.toThrow('write failed');
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    await expect(accounting.redeem(LENDER, { ...envelope(LENDER), token: USDC, amount: 1n })).rejects.toThrow('MARGIN_FUNDING_UNAVAILABLE');
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore(); await restart();
    expect(accounting.positions(TRADER, null)).toEqual([]);
  });

  it('recovers a close committed before its acknowledgement was lost without paying twice', async () => {
    const opened = await open(), closing = await close(opened.positionId);
    await broadcast(closing);
    const cas = snapshots.compareAndSwap.bind(snapshots);
    vi.spyOn(snapshots, 'compareAndSwap').mockImplementationOnce(async (hash, bytes) => {
      await cas(hash, bytes); throw new Error('lost acknowledgement');
    });
    await expect(accounting.settle(closing.opId, result(closing, 1_000n * USD))).rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    await expect(runtime.keys.allocate('inventory')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    await restart();
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    await accounting.settle(closing.opId, result(closing, 1_000n * USD));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    expect((await replayLedger(runtime.journal)).custodyClaims()).toEqual(runtime.ledger.custodyClaims());
  });
});

function recovery(receipt?: TransactionReceipt) {
  const unavailable = vi.fn(async () => { throw new Error('offline'); });
  const inventory = { pick: vi.fn(), hold: vi.fn(), free: vi.fn(), refresh: vi.fn(async () => {}),
    restoreHold: vi.fn(), linkOwner: vi.fn(), eoasLinkedTo: vi.fn(() => []) };
  const deps = {
    ...runtime, queue, chainId: 1, confirmations: 0n, receiptTimeoutMs: 1, gasMarginPercent: 120n, inventorySettleAttempts: 1,
    chain: { getTransactionCount: vi.fn(async () => 1), getTransactionReceipt: receipt ? vi.fn(async () => receipt) : unavailable,
      waitForTransactionReceipt: receipt ? vi.fn(async () => receipt) : unavailable },
    signer: { registerOp: vi.fn(), sign: vi.fn() }, inventory,
    margin: { accounting, quoter: { quote: vi.fn() }, inventory: { depositEoasOf: () => [] },
      ledger: runtime.ledger, reader: {}, routerAddress: LENDER, wethAddress: WETH, maxSlippageBpsCap: 100 },
  } as unknown as ExecutorDeps;
  return { executor: new Executor(deps), inventory };
}

describe('real accounting through executor recovery', () => {
  it('releases an approved open that never broadcast', async () => {
    const operation = await accounting.prepareOpen(TRADER, openMessage(), price());
    await restart();
    expect(await recovery().executor.recover(runtime.journal.replay())).toEqual([{ opId: operation.opId, status: 'released' }]);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
  });

  it('opens from confirmed USDC spending and WETH unwrap amounts after a restart', async () => {
    const operation = await accounting.prepareOpen(TRADER, openMessage(), price());
    await broadcast(operation); await restart();
    const receipt = { status: 'success', gasUsed: 2n, effectiveGasPrice: 1n, logs: [{
      address: USDC, topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        eventName: 'Transfer', args: { from: OTHER, to: LENDER } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [1_000n * USD]),
    }, {
      address: WETH, topics: encodeEventTopics({ abi: parseAbi(['event Withdrawal(address indexed src, uint256 wad)']),
        eventName: 'Withdrawal', args: { src: LENDER } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [ETH / 2n]),
    }] } as TransactionReceipt;
    expect(await recovery(receipt).executor.recover(runtime.journal.replay())).toEqual([{ opId: operation.opId, status: 'settled' }]);
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ status: 'open', asset: ETH / 2n, debt: 750n * USD });
    expect(accounting.lending(LENDER)[0]?.available).toBe(250n * USD);
    expect(runtime.ledger.getBalance(TRADER, USDC)).toMatchObject({ available: 0n, reserved: 0n });
    runtime.ledger.assertInvariants();
  });

  it('retains an unresolved broadcast then settles a confirmed close exactly once', async () => {
    const opened = await open(), closing = await close(opened.positionId);
    await broadcast(closing); await restart();
    const pending = recovery();
    expect(await pending.executor.recover(runtime.journal.replay())).toEqual([{ opId: closing.opId, status: 'unresolved' }]);
    expect(pending.inventory.restoreHold).toHaveBeenCalledWith(OTHER, NATIVE, ETH / 2n, closing.opId);
    expect(accounting.positions(TRADER, null)[0]?.status).toBe('closing');
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    const receipt = { status: 'success', gasUsed: 2n, effectiveGasPrice: 1n, logs: [{
      address: USDC, topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        eventName: 'Transfer', args: { from: LENDER, to: OTHER } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [1_000n * USD]),
    }] } as TransactionReceipt;
    const confirmed = recovery(receipt);
    expect(await confirmed.executor.recover(runtime.journal.replay())).toEqual([{ opId: closing.opId, status: 'settled' }]);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    expect(await confirmed.executor.recover(runtime.journal.replay())).toEqual([]);
    expect(confirmed.inventory.free).toHaveBeenCalledTimes(1);
    runtime.ledger.assertInvariants();
  });
});

async function creditNative(owner: Address, amount: bigint) {
  await append({ t: 'DEPOSIT_CREDITED', id: `native-${++nonce}`, owner, amount, block: 1n });
}
const shortMessage = (overrides: Partial<MarginOpenMsg> = {}) => openMessage({ side: 1, limitPrice: 1_900n * ETH, ...overrides });
async function openShort() {
  const operation = await accounting.prepareOpen(TRADER, shortMessage(), price());
  await broadcast(operation); await accounting.settle(operation.opId, result(operation, 1_000n * USD));
  return operation;
}
async function closeShort(positionId: Hex, market = 2_000n, limit = market * 105n / 100n) {
  return accounting.prepareClose(TRADER, { ...envelope(), positionId, limitPrice: limit * ETH, maxSlippageBps: 100 }, price(market));
}
const lending = (token: Address) => accounting.lending(LENDER).find((entry) => entry.token === token)!;

describe('short margin accounting', () => {
  beforeEach(async () => {
    await creditNative(LENDER, ETH);
    await accounting.supply(LENDER, { ...envelope(LENDER), token: NATIVE, amount: ETH });
  });

  it('borrows ETH and locks both USDC collateral and sale proceeds', async () => {
    const opened = await openShort();
    expect(opened).toMatchObject({ amountIn: ETH / 2n, tokenIn: NATIVE, tokenOut: USDC, minAmountOut: 950n * USD });
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ side: 'short', status: 'open', collateral: 250n * USD,
      sizeUsd: 1_000n * USD, debtToken: NATIVE, debt: ETH / 2n, assetToken: USDC, asset: 1_000n * USD,
      entryPrice: 2_000n * ETH, equity: 250n * USD });
    expect(runtime.ledger.getBalance(TRADER, USDC)).toMatchObject({ available: 0n, reserved: 0n });
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(0n);
    expect(lending(NATIVE).available).toBe(ETH / 2n);
    expect(lending(USDC).available).toBe(1_000n * USD);
    expect(runtime.ledger.custodyClaims().get(NATIVE)).toBe(ETH / 2n);
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe(2_250n * USD);
    await expect(accounting.supply(TRADER, { ...envelope(), token: USDC, amount: 1n })).rejects.toThrow('INSUFFICIENT_BALANCE');
    await expect(accounting.redeem(LENDER, { ...envelope(LENDER), token: NATIVE, amount: ETH / 2n + 1n })).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    const positions = accounting.positions(TRADER, price()), claims = runtime.ledger.custodyClaims();
    await restart();
    expect(accounting.positions(TRADER, price())).toEqual(positions);
    expect(runtime.ledger.custodyClaims()).toEqual(claims);
    runtime.ledger.assertInvariants();
  });

  it.each([
    { market: 1_600n, spent: 816n, payout: 434n, equity: 450n },
    { market: 2_000n, spent: 1_020n, payout: 230n, equity: 250n },
    { market: 2_200n, spent: 1_122n, payout: 128n, equity: 150n },
  ])('repays ETH and credits both remainders at a $market USDC price', async ({ market, spent, payout, equity }) => {
    const opened = await openShort();
    expect(accounting.positions(TRADER, price(market))[0]?.equity).toBe(equity * USD);
    const operation = await closeShort(opened.positionId, market);
    expect(operation).toMatchObject({ tokenIn: USDC, tokenOut: NATIVE, amountIn: spent * USD, minAmountOut: ETH / 2n });
    await broadcast(operation);
    await accounting.settle(operation.opId, result(operation, 51n * ETH / 100n));
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'closed', debt: 0n, asset: 0n,
      payout: payout * USD, payoutNative: ETH / 100n, shortfall: 0n });
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(payout * USD);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(ETH / 100n);
    expect(lending(NATIVE).available).toBe(ETH);
    expect(runtime.ledger.custodyClaims().get(NATIVE)).toBe(101n * ETH / 100n);
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe((2_250n - spent) * USD);
    await accounting.redeem(LENDER, { ...envelope(LENDER), token: NATIVE, amount: ETH });
    expect(runtime.ledger.getBalance(LENDER, NATIVE).available).toBe(ETH);
    await restart();
    await accounting.settle(operation.opId, result(operation, 51n * ETH / 100n));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(payout * USD);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(ETH / 100n);
    expect(runtime.ledger.getOperationalGasSpent(NATIVE)).toBe(4n);
    runtime.ledger.assertInvariants();
  });

  it('handles a buyback that returns exactly the ETH debt with no surplus credit', async () => {
    const opened = await openShort(), closing = await closeShort(opened.positionId);
    await broadcast(closing); await accounting.settle(closing.opId, result(closing, ETH / 2n));
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(0n);
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ payout: 230n * USD, payoutNative: 0n, shortfall: 0n });
    runtime.ledger.assertInvariants();
  });

  it('reserves a 1x short loan, unlike a fully funded long', async () => {
    const operation = await accounting.prepareOpen(TRADER, shortMessage({ leverageBps: 10_000 }), price());
    expect(operation.amountIn).toBe(ETH / 8n);
    expect(lending(NATIVE).available).toBe(7n * ETH / 8n);
    await broadcast(operation); await accounting.settle(operation.opId, result(operation, 250n * USD));
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ debt: ETH / 8n, sizeUsd: 250n * USD, equity: 250n * USD });
    runtime.ledger.assertInvariants();
  });

  it('cannot replace ETH lending liquidity with available USDC', async () => {
    await accounting.redeem(LENDER, { ...envelope(LENDER), token: NATIVE, amount: ETH });
    const count = (await events()).length;
    await expect(accounting.prepareOpen(TRADER, shortMessage(), price())).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    expect((await events()).length).toBe(count);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
  });

  it('rejects an opening limit that would immediately put the short below maintenance', async () => {
    const count = (await events()).length;
    await expect(accounting.prepareOpen(TRADER, shortMessage({ limitPrice: 1_500n * ETH }), price())).rejects.toThrow('INSUFFICIENT_COLLATERAL');
    expect((await events()).length).toBe(count);
    expect(lending(NATIVE).available).toBe(ETH);
  });

  it.each(['NO_INVENTORY', 'REVERTED'])('releases the right currencies after an open fails with %s', async (reason) => {
    const message = shortMessage(), operation = await accounting.prepareOpen(TRADER, message, price());
    await expect(accounting.prepareOpen(TRADER, { ...message, side: 0 }, price())).rejects.toThrow('MARGIN_OP_CONFLICT');
    await expect(accounting.releaseOpen(operation.opId)).rejects.toThrow('POSITION_BUSY');
    if (reason === 'REVERTED') await broadcast(operation);
    await restart();
    const failure = reason === 'REVERTED' ? { reason, txHash: hash(operation), gasCost: 3n } : { reason };
    await accounting.fail(operation.opId, failure); await accounting.fail(operation.opId, failure);
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'failed', debt: 0n, asset: 0n });
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(250n * USD);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(0n);
    expect(lending(NATIVE).available).toBe(ETH);
    expect(lending(USDC).available).toBe(1_000n * USD);
    runtime.ledger.assertInvariants();
  });

  it('takes additional collateral in USDC and includes it in risk and payouts', async () => {
    const opened = await openShort();
    await credit(TRADER, 100n * USD); await creditNative(TRADER, ETH / 5n);
    const message = { ...envelope(), positionId: opened.positionId, amount: 100n * USD };
    expect(await accounting.liquidationCandidates(price(2_400n))).toEqual([opened.positionId]);
    await accounting.addCollateral(TRADER, message); await accounting.addCollateral(TRADER, message);
    expect(await accounting.liquidationCandidates(price(2_400n))).toEqual([]);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(ETH / 5n);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ collateral: 350n * USD, equity: 350n * USD });
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe(2_350n * USD);
    await restart();
    const closing = await closeShort(opened.positionId);
    await broadcast(closing); await accounting.settle(closing.opId, result(closing, 51n * ETH / 100n));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(330n * USD);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(21n * ETH / 100n);
    runtime.ledger.assertInvariants();
  });

  it('retains both assets and the ETH loan after a reverted close', async () => {
    const opened = await openShort(), closing = await closeShort(opened.positionId);
    await broadcast(closing);
    const failure = { reason: 'REVERTED', txHash: hash(closing), gasCost: 1n };
    await accounting.fail(closing.opId, failure); await restart();
    await accounting.fail(closing.opId, failure);
    expect(accounting.positions(TRADER, price())[0]).toMatchObject({ status: 'open', asset: 1_000n * USD, debt: ETH / 2n, equity: 250n * USD });
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(lending(NATIVE).available).toBe(ETH / 2n);
    const retry = await closeShort(opened.positionId);
    await broadcast(retry); await accounting.settle(retry.opId, result(retry, ETH / 2n));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(230n * USD);
    runtime.ledger.assertInvariants();
  });

  it('caps a voluntary buyback at held funds but still requires the entire ETH debt', async () => {
    const opened = await openShort(), closing = await closeShort(opened.positionId, 3_000n);
    expect(closing).toMatchObject({ amountIn: 1_250n * USD, minAmountOut: ETH / 2n });
    await broadcast(closing);
    await expect(accounting.settle(closing.opId, result(closing, ETH / 2n - 1n))).rejects.toThrow('MARGIN_RESULT_INVALID');
    await expect(accounting.settle(closing.opId, { ...result(closing, ETH / 2n), amountIn: 1_250n * USD + 1n })).rejects.toThrow('MARGIN_RESULT_INVALID');
    expect(accounting.positions(TRADER, null)[0]?.status).toBe('closing');
    expect(lending(NATIVE).available).toBe(ETH / 2n);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
  });

  it('requires full repayment if a liquidation leaves any USDC to pay out', async () => {
    const opened = await openShort();
    expect(await accounting.prepareLiquidation(opened.positionId, price())).toBeNull();
    expect(await accounting.liquidationCandidates(price(2_400n))).toEqual([opened.positionId]);
    const closing = (await accounting.prepareLiquidation(opened.positionId, price(2_400n)))!;
    expect(closing).toMatchObject({ kind: 'liquidate', amountIn: 1_224n * USD, minAmountOut: ETH / 2n });
    expect(await accounting.prepareLiquidation(opened.positionId, price(2_400n))).toBeNull();
    await broadcast(closing);
    await expect(accounting.settle(closing.opId, result(closing, ETH / 2n - 1n))).rejects.toThrow('MARGIN_RESULT_INVALID');
    await accounting.settle(closing.opId, result(closing, 51n * ETH / 100n));
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'liquidated', debt: 0n,
      payout: 26n * USD, payoutNative: ETH / 100n, shortfall: 0n });
    expect(lending(NATIVE).available).toBe(ETH);
    runtime.ledger.assertInvariants();
  });

  it('records an underwater liquidation loss in ETH and freezes only that lending pool', async () => {
    const opened = await openShort(), closing = (await accounting.prepareLiquidation(opened.positionId, price(3_000n)))!;
    expect(closing.amountIn).toBe(1_250n * USD);
    expect(closing.minAmountOut).toBeLessThan(ETH / 2n);
    await broadcast(closing); await accounting.settle(closing.opId, result(closing, 42n * ETH / 100n));
    expect(accounting.positions(TRADER, null)[0]).toMatchObject({ status: 'liquidated', debt: 8n * ETH / 100n,
      shortfall: 8n * ETH / 100n, payout: 0n, payoutNative: 0n });
    expect(runtime.ledger.margin.shortfall(NATIVE)).toBe(8n * ETH / 100n);
    expect(runtime.ledger.margin.shortfall(USDC)).toBe(0n);
    expect(lending(NATIVE)).toMatchObject({ supplied: ETH, available: 0n });
    expect(lending(USDC).available).toBe(1_000n * USD);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(0n);
    // The missing ETH remains an uncovered claim rather than a performing loan.
    expect(runtime.ledger.custodyClaims().get(NATIVE)).toBe(ETH);
    expect(runtime.ledger.custodyClaims().get(USDC)).toBe(1_000n * USD);
    await restart();
    await expect(accounting.redeem(LENDER, { ...envelope(LENDER), token: NATIVE, amount: 1n })).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    await accounting.redeem(LENDER, { ...envelope(LENDER), token: USDC, amount: 1_000n * USD });
    expect(runtime.ledger.getBalance(LENDER, USDC).available).toBe(1_000n * USD);
    runtime.ledger.assertInvariants();
  });

  it('keeps funds locked on an unknown broadcast then recovers both payouts from the receipt', async () => {
    const opened = await openShort(), closing = await closeShort(opened.positionId);
    await broadcast(closing); await restart();
    const pending = recovery();
    expect(await pending.executor.recover(runtime.journal.replay())).toEqual([{ opId: closing.opId, status: 'unresolved' }]);
    expect(pending.inventory.restoreHold).toHaveBeenCalledWith(OTHER, USDC, 1_020n * USD, closing.opId);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    const receipt = { status: 'success', gasUsed: 2n, effectiveGasPrice: 1n, logs: [{
      address: USDC, topics: encodeEventTopics({ abi: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
        eventName: 'Transfer', args: { from: OTHER, to: LENDER } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [1_020n * USD]),
    }, {
      address: WETH, topics: encodeEventTopics({ abi: parseAbi(['event Withdrawal(address indexed src, uint256 wad)']),
        eventName: 'Withdrawal', args: { src: LENDER } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [51n * ETH / 100n]),
    }] } as TransactionReceipt;
    expect(await recovery(receipt).executor.recover(runtime.journal.replay())).toEqual([{ opId: closing.opId, status: 'settled' }]);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(230n * USD);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(ETH / 100n);
    await restart();
    expect(await recovery(receipt).executor.recover(runtime.journal.replay())).toEqual([]);
    expect((await replayLedger(runtime.journal)).custodyClaims()).toEqual(runtime.ledger.custodyClaims());
  });

  it('recovers a close with a lost acknowledgement without duplicating either payout', async () => {
    const opened = await openShort(), closing = await closeShort(opened.positionId);
    await broadcast(closing);
    const cas = snapshots.compareAndSwap.bind(snapshots);
    vi.spyOn(snapshots, 'compareAndSwap').mockImplementationOnce(async (hash, bytes) => {
      await cas(hash, bytes); throw new Error('lost acknowledgement');
    });
    await expect(accounting.settle(closing.opId, result(closing, 51n * ETH / 100n))).rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(0n);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(0n);
    await restart();
    await accounting.settle(closing.opId, result(closing, 51n * ETH / 100n));
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(230n * USD);
    expect(runtime.ledger.getBalance(TRADER, NATIVE).available).toBe(ETH / 100n);
    expect(lending(NATIVE).available).toBe(ETH);
    runtime.ledger.assertInvariants();
  });
});
