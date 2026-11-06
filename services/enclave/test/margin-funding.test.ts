import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent, MarginFundingRequest, MarginSupplyMsg } from '@cloakroom/shared';
import type { Address, Hex } from 'viem';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import { replayLedger } from '../src/ledger.js';
import { MarginFunding } from '../src/margin-funding.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { WithdrawalOrders } from '../src/withdrawal-orders.js';

const LENDER: Address = '0x1111111111111111111111111111111111111111';
const TRADER: Address = '0x2222222222222222222222222222222222222222';
const OTHER: Address = '0x3333333333333333333333333333333333333333';
const USDC: Address = '0x4444444444444444444444444444444444444444';
const HASH: Hex = `0x${'ab'.repeat(32)}`;
const policy = { chainId: 1, maxGas: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, maxNativeValue: 1n };
let state: MemoryCipherBlobStore, snapshots: MemoryCipherBlobStore;
let runtime: Awaited<ReturnType<typeof openCustodyRuntime>>;
let funding: MarginFunding, queue: FifoSerialQueue, nextId: number;
let commandNonces: Map<string, bigint>;

async function boot(allowCreate: boolean) {
  runtime = await openCustodyRuntime({
    vault: new AesGcmStateVault(state, simulationSealingKey('cd'.repeat(32), true), true),
    journalStore: snapshots, policy, buildHash: 'ef'.repeat(32), simMode: true, allowCreate,
    quote: async () => Buffer.from('test-quote'),
  });
  queue = new FifoSerialQueue();
  funding = new MarginFunding({ ...runtime, queue, usdc: USDC });
}

async function append(event: JournalEvent) {
  await runtime.journal.append(event);
  runtime.ledger.apply(event);
}

async function credit(owner: Address, token: Address, amount: bigint) {
  const id = `credit-${nextId++}`;
  await append({ t: 'DEPOSIT_CREDITED', id, owner, amount: token === NATIVE ? amount : 1n, block: 1n });
  if (token === NATIVE) return;
  // USDC claims enter the existing ledger through a settled spot swap.
  await append({ t: 'INTENT_CREATED', id, owner, intent: {
    owner, tokenIn: NATIVE, tokenOut: token, amountIn: 1n, comparator: 0, triggerPrice: 1n,
    maxSlippageBps: 50, nonce: 1n, expiry: 9_999_999_999n,
  } });
  await append({ t: 'EXEC_SETTLED', opId: `exec:${id}`, intentId: id, owner,
    tokenOut: token, amountOut: amount, fee: 0n });
}

function message(id: string, amount: bigint, token: Address = USDC, owner = LENDER): MarginSupplyMsg {
  const nonce = commandNonces.get(id) ?? BigInt(commandNonces.size + 1);
  commandNonces.set(id, nonce);
  return { owner, token, amount, nonce, expiry: 9_999_999_999n };
}
const supply = (id: string, amount: bigint, token: Address = USDC) => funding.supply(LENDER, message(id, amount, token));
const redeem = (id: string, amount: bigint, token: Address = USDC) => funding.redeem(LENDER, message(id, amount, token));
const request = (opId: string, amount = 200n, owner = TRADER, token: Address = USDC): MarginFundingRequest => ({
  opId, owner, collateralUSDC: 100n, borrow: { token, amount },
});
async function countEvents() {
  let count = 0;
  for await (const _ of runtime.journal.replay()) count++;
  return count;
}

beforeEach(async () => {
  state = new MemoryCipherBlobStore(); snapshots = new MemoryCipherBlobStore(); nextId = 0; commandNonces = new Map();
  await boot(true);
});
afterEach(async () => { vi.restoreAllMocks(); await runtime?.close(); });

describe('margin funding', () => {
  it('moves only existing claims into lending and supports partial and full redemption', async () => {
    await credit(LENDER, USDC, 500n);
    await supply('supply-a', 200n); await supply('supply-b', 100n);
    expect(runtime.ledger.getBalance(LENDER, USDC)).toMatchObject({ available: 200n, reserved: 300n });
    await redeem('redeem-a', 40n);
    expect(funding.lending(LENDER)[0]).toMatchObject({ supplied: 260n, available: 260n });
    expect(runtime.ledger.getBalance(LENDER, USDC)).toMatchObject({ available: 240n, reserved: 260n });
    await redeem('redeem-b', 260n);
    expect(runtime.ledger.getBalance(LENDER, USDC)).toMatchObject({ available: 500n, reserved: 0n });
    expect(funding.lending(LENDER)).toEqual([]);
    runtime.ledger.assertInvariants();
  });

  it.each([USDC, NATIVE])('holds collateral and %s lending liquidity without issuing spendable debt', async (token) => {
    await credit(LENDER, token, 300n); await credit(TRADER, USDC, 100n);
    await supply('supply', 300n, token);
    const totals = runtime.ledger.totals();
    await funding.reserveOpen(request('open', 250n, TRADER, token));
    expect(runtime.ledger.getBalance(TRADER, USDC)).toMatchObject({ available: 0n, reserved: 100n });
    expect(runtime.ledger.margin.pool(token)).toEqual({ supplied: 300n, reserved: 250n, available: 50n });
    expect(funding.lending(LENDER)).toEqual([{ token, supplied: 300n, available: 50n }]);
    await expect(redeem('too-much', 51n, token)).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    await redeem('partial', 50n, token);
    await funding.releaseOpen('open'); await funding.releaseOpen('open');
    await redeem('rest', 250n, token);
    expect(runtime.ledger.getBalance(TRADER, USDC)).toMatchObject({ available: 100n, reserved: 0n });
    expect(runtime.ledger.getBalance(LENDER, token).available).toBe(300n);
    for (const [asset, before] of totals) {
      const after = runtime.ledger.totals().get(asset)!;
      expect(after.available + after.reserved).toBe(before.available + before.reserved);
    }
    runtime.ledger.assertInvariants();
  });

  it('does not treat uncommitted wallet balances as lending liquidity', async () => {
    await credit(LENDER, USDC, 1_000n); await credit(TRADER, USDC, 100n);
    const before = await countEvents();
    await expect(funding.reserveOpen(request('open'))).rejects.toThrow('INSUFFICIENT_LENDING_LIQUIDITY');
    expect(await countEvents()).toBe(before);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(100n);
  });

  it('reserves fully funded collateral without requiring a loan', async () => {
    await credit(TRADER, USDC, 100n);
    await funding.reserveOpen(request('unleveraged', 0n));
    expect(runtime.ledger.getBalance(TRADER, USDC)).toMatchObject({ available: 0n, reserved: 100n });
    expect(runtime.ledger.margin.pool(USDC)).toEqual({ supplied: 0n, reserved: 0n, available: 0n });
    await funding.releaseOpen('unleveraged');
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(100n);
    runtime.ledger.assertInvariants();
  });

  it('cannot supply reserved collateral or use a lending claim as collateral', async () => {
    await credit(LENDER, USDC, 300n); await credit(TRADER, USDC, 100n);
    await supply('supply', 300n);
    await expect(funding.reserveOpen(request('self-collateral', 200n, LENDER))).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    await funding.reserveOpen(request('open'));
    await expect(funding.supply(TRADER, message('reuse', 1n, USDC, TRADER))).rejects.toThrow('INSUFFICIENT_BALANCE');
  });

  it.each(['supply', 'withdraw'] as const)('serializes lending against withdrawals when %s arrives first', async (first) => {
    await credit(LENDER, USDC, 300n);
    const executor = { runWithdrawal: vi.fn(async () => ({ finished: Promise.resolve({ status: 'unresolved' as const, txHash: HASH }) })) };
    const withdrawals = new WithdrawalOrders({ ...runtime, executor, queue });
    const lend = () => supply('supply', 300n);
    const withdraw = () => withdrawals.create(LENDER, { owner: LENDER, token: USDC, amount: 300n,
      to: OTHER, nonce: 1n, expiry: 9_999_999_999n });
    const results = await Promise.allSettled(first === 'supply' ? [lend(), withdraw()] : [withdraw(), lend()]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('INSUFFICIENT_BALANCE');
    expect(runtime.ledger.getBalance(LENDER, USDC)).toMatchObject({ available: 0n, reserved: 300n });
    expect(runtime.ledger.margin.pool(USDC).supplied).toBe(first === 'supply' ? 300n : 0n);
    runtime.ledger.assertInvariants();
  });

  it('reserves lending liquidity once across concurrent borrowers', async () => {
    await credit(LENDER, USDC, 200n); await supply('supply', 200n);
    await credit(TRADER, USDC, 100n); await credit(OTHER, USDC, 100n);
    const outcomes = await Promise.allSettled([
      funding.reserveOpen(request('first', 150n)), funding.reserveOpen(request('second', 150n, OTHER)),
    ]);
    expect(outcomes.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect((outcomes[1] as PromiseRejectedResult).reason.message).toBe('INSUFFICIENT_LENDING_LIQUIDITY');
    expect(runtime.ledger.getBalance(OTHER, USDC).available).toBe(100n);
    expect(runtime.ledger.margin.pool(USDC).reserved).toBe(150n);
    runtime.ledger.assertInvariants();
  });

  it('deduplicates commands and rejects conflicting reuse before writing', async () => {
    await credit(LENDER, USDC, 300n); await credit(TRADER, USDC, 100n);
    await Promise.all([supply('supply', 300n), supply('supply', 300n)]);
    await funding.reserveOpen(request('open'));
    const before = await countEvents();
    await supply('supply', 300n); await funding.reserveOpen(request('open'));
    await expect(supply('supply', 299n)).rejects.toThrow('MARGIN_OP_CONFLICT');
    await expect(redeem('supply', 1n)).rejects.toThrow('MARGIN_OP_CONFLICT');
    await expect(funding.reserveOpen(request('open', 199n))).rejects.toThrow('MARGIN_OP_CONFLICT');
    await expect(funding.reserveOpen(request('open', 200n, OTHER))).rejects.toThrow('MARGIN_OP_CONFLICT');
    expect(await countEvents()).toBe(before);
    await funding.releaseOpen('open');
    expect((await funding.reserveOpen(request('open'))).status).toBe('released');
    await redeem('redeem', 300n); await redeem('redeem', 300n);
    expect(runtime.ledger.getBalance(LENDER, USDC).available).toBe(300n);
    runtime.ledger.assertInvariants();
  });

  it.each([0n, -1n, '10' as unknown as bigint])('rejects invalid amounts %s without changing the journal', async (amount) => {
    await credit(LENDER, USDC, 300n); await credit(TRADER, USDC, 100n);
    const before = await countEvents();
    await expect(supply('bad', amount)).rejects.toThrow('MARGIN_AMOUNT_INVALID');
    await expect(funding.reserveOpen({ ...request('bad'), collateralUSDC: amount })).rejects.toThrow('MARGIN_AMOUNT_INVALID');
    if (amount !== 0n) await expect(funding.reserveOpen(request('bad', amount))).rejects.toThrow('MARGIN_AMOUNT_INVALID');
    expect(await countEvents()).toBe(before);
  });

  it('rejects missing claims, unknown holds and unsupported tokens without writing', async () => {
    const before = await countEvents();
    await expect(redeem('missing', 1n)).rejects.toThrow('INSUFFICIENT_LENDING_CLAIM');
    await expect(funding.releaseOpen('missing')).rejects.toThrow('MARGIN_RESERVATION_NOT_FOUND');
    await expect(supply('bad-token', 1n, OTHER)).rejects.toThrow('MARGIN_TOKEN_INVALID');
    await expect(funding.supply(LENDER, { ...message('bad-nonce', 1n), nonce: 0n })).rejects.toThrow('MARGIN_AMOUNT_INVALID');
    await expect(funding.supply(OTHER, message('wrong-owner', 1n))).rejects.toThrow('BAD_SIGNATURE');
    expect(await countEvents()).toBe(before);
  });

  it('copies queued commands and returned reservations', async () => {
    await credit(LENDER, USDC, 300n); await supply('supply', 300n); await credit(TRADER, USDC, 100n);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = queue.run(() => new Promise<void>((resolve) => { release = resolve; entered(); }));
    await started;
    const command = request('open');
    const pending = funding.reserveOpen(command);
    command.borrow.amount = 999n; command.collateralUSDC = 999n;
    release(); await blocked;
    const hold = await pending;
    hold.borrow.amount = 999n; hold.status = 'released';
    const copy = runtime.ledger.margin.reservations()[0]!; copy.collateral.amount = 999n;
    expect(runtime.ledger.margin.reservation('open')).toMatchObject({ status: 'reserved', borrow: { amount: 200n }, collateral: { amount: 100n } });
    runtime.ledger.assertInvariants();
  });

  it('restores claims, collateral and pending holds through ordinary ledger replay', async () => {
    await credit(LENDER, USDC, 300n); await credit(TRADER, USDC, 100n); await supply('supply', 300n);
    await funding.reserveOpen(request('open')); await redeem('partial', 50n);
    const totals = runtime.ledger.totals(), holds = runtime.ledger.margin.reservations();
    await runtime.close(); await boot(false);
    expect(runtime.ledger.totals()).toEqual(totals);
    expect(runtime.ledger.margin.reservations()).toEqual(holds);
    expect(funding.lending(LENDER)).toEqual([{ token: USDC, supplied: 250n, available: 50n }]);
    const before = await countEvents();
    await supply('supply', 300n); await funding.reserveOpen(request('open')); await redeem('partial', 50n);
    expect(await countEvents()).toBe(before);
    await funding.releaseOpen('open'); await redeem('rest', 250n);
    await runtime.close(); await boot(false);
    expect(runtime.ledger.getBalance(LENDER, USDC).available).toBe(300n);
    expect(runtime.ledger.getBalance(TRADER, USDC).available).toBe(100n);
    expect(runtime.ledger.margin.reservations()).toEqual([]);
    runtime.ledger.assertInvariants();
  });

  it('does not mutate balances on a failed write and stops until recovery', async () => {
    await credit(LENDER, USDC, 300n);
    const write = vi.spyOn(runtime.journal, 'append').mockRejectedValueOnce(new Error('write failed'));
    await expect(supply('supply', 300n)).rejects.toThrow('write failed');
    expect(runtime.ledger.getBalance(LENDER, USDC)).toMatchObject({ available: 300n, reserved: 0n });
    await expect(supply('other', 300n)).rejects.toThrow('MARGIN_FUNDING_UNAVAILABLE');
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
    const restored = await replayLedger(runtime.journal);
    const next = new MarginFunding({ ledger: restored, journal: runtime.journal, queue, usdc: USDC });
    await next.supply(LENDER, message('supply', 300n));
    expect(restored.margin.balance(LENDER, USDC).supplied).toBe(300n);
    restored.assertInvariants();
  });

  it('recovers a committed write whose acknowledgement was lost without crediting twice', async () => {
    await credit(LENDER, USDC, 300n);
    const cas = snapshots.compareAndSwap.bind(snapshots);
    vi.spyOn(snapshots, 'compareAndSwap').mockImplementationOnce(async (hash, bytes) => {
      await cas(hash, bytes); throw new Error('lost acknowledgement');
    });
    await expect(supply('supply', 300n)).rejects.toThrow('JOURNAL_UNAVAILABLE');
    await expect(supply('retry', 300n)).rejects.toThrow('MARGIN_FUNDING_UNAVAILABLE');
    await expect(runtime.keys.allocate('inventory')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    await runtime.close(); await boot(false);
    expect(runtime.ledger.getBalance(LENDER, USDC)).toMatchObject({ available: 0n, reserved: 300n });
    const before = await countEvents();
    await supply('supply', 300n);
    expect(await countEvents()).toBe(before);
    expect(runtime.ledger.margin.pool(USDC)).toEqual({ supplied: 300n, reserved: 0n, available: 300n });
    runtime.ledger.assertInvariants();
  });
});
