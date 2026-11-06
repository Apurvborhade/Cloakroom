import { NATIVE } from '@cloakroom/shared';
import type { JournalEvent, MarginOpenMsg, MarginOperation, PriceReport } from '@cloakroom/shared';
import { parseEther } from 'viem';
import type { Address, Hex } from 'viem';
import { beforeEach, describe, expect, it } from 'vitest';
import { LiquidationMonitor } from '../src/liquidation.js';
import { MockMarginAccounting } from '../src/margin-mock.js';

const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const TRADER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const STRANGER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const TX: Hex = `0x${'ab'.repeat(32)}`;
const USD = 1_000_000n;
const price = (dollars: bigint): PriceReport => ({ pair: 'test', price: dollars * 10n ** 18n, ts: 1, source: 'test' });
const MARKET = price(2_000n);

describe('margin accounting stand-in', () => {
  let events: JournalEvent[];
  let accounting: MockMarginAccounting;

  const openMessage = (side: 'long' | 'short'): MarginOpenMsg => ({
    owner: TRADER,
    side: side === 'long' ? 0 : 1,
    collateral: 1_000n * USD,
    leverageBps: 40_000,
    limitPrice: side === 'long' ? 2_100n * 10n ** 18n : 1_900n * 10n ** 18n,
    maxSlippageBps: 100,
    nonce: 1n,
    expiry: 1n,
  });
  const fill = (op: MarginOperation, amountIn: bigint, amountOut: bigint) =>
    accounting.settle(op.opId, { amountIn, amountOut, gasCost: 0n, txHash: TX });
  const view = () => accounting.positions(TRADER, MARKET)[0]!;

  /** $4,000 of ETH at $2,000: 2 ETH on $3,000 of debt. */
  const openLong = async () => {
    const op = await accounting.prepareOpen(TRADER, openMessage('long'), MARKET);
    await fill(op, 4_000n * USD, parseEther('2'));
    return op.positionId;
  };
  /** 2 ETH of debt sold for $4,000, with $1,000 of collateral beside it. */
  const openShort = async () => {
    const op = await accounting.prepareOpen(TRADER, openMessage('short'), MARKET);
    await fill(op, parseEther('2'), 4_000n * USD);
    return op.positionId;
  };
  const closeMessage = (positionId: Hex, limitDollars: bigint) => ({
    owner: TRADER,
    positionId,
    limitPrice: limitDollars * 10n ** 18n,
    maxSlippageBps: 100,
    nonce: 2n,
    expiry: 2n,
  });

  beforeEach(async () => {
    events = [];
    accounting = new MockMarginAccounting({
      journal: {
        append: async (event) => {
          events.push(event);
          return {} as never;
        },
      },
      queue: { run: (task) => task() },
      usdc: USDC,
      usdcDecimals: 6,
    });
    await accounting.supply(STRANGER, { owner: STRANGER, token: USDC, amount: 10_000n * USD, nonce: 1n, expiry: 1n });
    await accounting.supply(STRANGER, { owner: STRANGER, token: NATIVE, amount: parseEther('10'), nonce: 2n, expiry: 1n });
  });

  it('sizes a 4x long and a 4x short', async () => {
    const long = await accounting.prepareOpen(TRADER, openMessage('long'), MARKET);
    expect(long).toMatchObject({ tokenIn: USDC, tokenOut: NATIVE, amountIn: 4_000n * USD });
    const short = await accounting.prepareOpen(TRADER, openMessage('short'), MARKET);
    expect(short).toMatchObject({ tokenIn: NATIVE, tokenOut: USDC, amountIn: parseEther('2') });
    expect(accounting.positions(TRADER, MARKET).map(({ debt }) => debt)).toEqual([3_000n * USD, parseEther('2')]);
  });

  it('pays a long what is left after the loan', async () => {
    const id = await openLong();
    const op = await accounting.prepareClose(TRADER, closeMessage(id, 2_000n), price(2_500n));
    await fill(op, parseEther('2'), 5_000n * USD);
    expect(view()).toMatchObject({ status: 'closed', payout: 2_000n * USD, shortfall: 0n });
  });

  it('returns collateral added to a long after it opened', async () => {
    const id = await openLong();
    await accounting.addCollateral(TRADER, { owner: TRADER, positionId: id, amount: 500n * USD, nonce: 3n, expiry: 1n });
    const op = await accounting.prepareClose(TRADER, closeMessage(id, 2_000n), MARKET);
    await fill(op, parseEther('2'), 4_000n * USD);
    expect(view()).toMatchObject({ status: 'closed', payout: 1_500n * USD, shortfall: 0n });
  });

  it('pays a short the USDC it did not need to buy the ETH back', async () => {
    const id = await openShort();
    const op = await accounting.prepareClose(TRADER, closeMessage(id, 1_600n), price(1_500n));
    await fill(op, 3_000n * USD, parseEther('2'));
    expect(view()).toMatchObject({ status: 'closed', payout: 2_000n * USD, shortfall: 0n });
  });

  it('records a shortfall when a long sells for less than its loan', async () => {
    await openLong();
    const op = await accounting.prepareLiquidation(view().id, price(1_400n));
    await fill(op!, parseEther('2'), 2_800n * USD);
    expect(view()).toMatchObject({ status: 'liquidated', payout: 0n, shortfall: 200n * USD });
  });

  it('liquidates a long at -16.7% and a short at +13.6%, but not before', async () => {
    const long = await openLong();
    expect(await accounting.liquidationCandidates(price(1_667n))).toEqual([]);
    expect(await accounting.liquidationCandidates(price(1_666n))).toEqual([long]);
    await accounting.prepareLiquidation(long, price(1_666n));

    const short = await openShort();
    expect(await accounting.liquidationCandidates(price(2_272n))).toEqual([]);
    expect(await accounting.liquidationCandidates(price(2_273n))).toEqual([short]);
  });

  it('moves the liquidation line when collateral is added', async () => {
    const id = await openShort();
    await accounting.addCollateral(TRADER, { owner: TRADER, positionId: id, amount: 1_000n * USD, nonce: 3n, expiry: 1n });
    expect(await accounting.liquidationCandidates(price(2_273n))).toEqual([]);
  });

  it('lets only one of a close and a liquidation win, whichever comes first', async () => {
    const id = await openLong();
    await accounting.prepareClose(TRADER, closeMessage(id, 1_000n), price(1_500n));
    expect(await accounting.prepareLiquidation(id, price(1_500n))).toBeNull();
    expect(await accounting.liquidationCandidates(price(1_500n))).toEqual([]);

    const second = await openLong();
    expect(await accounting.prepareLiquidation(second, price(1_500n))).not.toBeNull();
    await expect(accounting.prepareClose(TRADER, closeMessage(second, 1_000n), price(1_500n))).rejects.toThrow('POSITION_BUSY');
  });

  it('keeps the debt and reopens the position when a close fails', async () => {
    const id = await openLong();
    const op = await accounting.prepareClose(TRADER, closeMessage(id, 1_000n), MARKET);
    await accounting.fail(op.opId, { reason: 'REVERTED' });
    expect(view()).toMatchObject({ status: 'open', debt: 3_000n * USD, asset: parseEther('2') });
    expect(events.at(-1)).toMatchObject({ t: 'MARGIN_OP_FAILED', reason: 'REVERTED' });
  });

  it('returns the loan to the pool when an open fails, so a lender can redeem', async () => {
    const op = await accounting.prepareOpen(TRADER, openMessage('long'), MARKET);
    const redeem = { owner: STRANGER, token: USDC, amount: 10_000n * USD, nonce: 3n, expiry: 1n };
    await expect(accounting.redeem(STRANGER, redeem)).rejects.toThrow('INSUFFICIENT_LIQUIDITY');
    await accounting.fail(op.opId, { reason: 'NO_INVENTORY' });
    expect(view().status).toBe('failed');
    await expect(accounting.redeem(STRANGER, redeem)).resolves.toBeUndefined();
  });

  it("hides another owner's position", async () => {
    const id = await openLong();
    await expect(accounting.prepareClose(STRANGER, closeMessage(id, 1_000n), MARKET)).rejects.toThrow('POSITION_NOT_FOUND');
    await expect(accounting.addCollateral(STRANGER, { owner: STRANGER, positionId: id, amount: 1n, nonce: 1n, expiry: 1n })).rejects.toThrow('POSITION_NOT_FOUND');
  });
});

describe('liquidation monitor', () => {
  const report: PriceReport = { pair: 'test', price: 1n, ts: 1, source: 'test' };
  const operation = { opId: 'margin:a' } as MarginOperation;

  it('keeps closing other positions when one fails, and skips those no longer eligible', async () => {
    const executed: MarginOperation[] = [];
    const errors: unknown[] = [];
    const monitor = new LiquidationMonitor({
      accounting: {
        liquidationCandidates: async () => ['0x01', '0x02', '0x03'],
        prepareLiquidation: async (id) => {
          if (id === '0x01') throw new Error('BROKEN');
          return id === '0x02' ? null : operation;
        },
      },
      orders: { execute: (op) => executed.push(op) },
      onError: (error) => errors.push(error),
    });
    await monitor.onReport(report);
    expect(executed).toEqual([operation]);
    expect(errors).toHaveLength(1);
  });

  it('ignores a price that arrives while it is still checking', async () => {
    let release: () => void = () => undefined;
    let checks = 0;
    const monitor = new LiquidationMonitor({
      accounting: {
        liquidationCandidates: () => {
          checks += 1;
          return new Promise((resolve) => { release = () => resolve([]); });
        },
        prepareLiquidation: async () => null,
      },
      orders: { execute: () => undefined },
      onError: () => undefined,
    });
    const first = monitor.onReport(report);
    await monitor.onReport(report);
    release();
    await first;
    expect(checks).toBe(1);
  });
});
