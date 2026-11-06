import { NATIVE } from '@cloakroom/shared';
import type { PositionItem } from '@cloakroom/shared';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { canSendNow, depositStage } from '@/lib/deposit/lifecycle';
import { marginTotals, riskPriceFreshness, leverageLabel } from '@/lib/margin/positions';
import { validateSwapForm } from '@/lib/swap/form';
import { validateWithdrawForm } from '@/lib/withdraw/form';
import { intentLifetime, MAX_INTENT_LIFETIME_SEC } from '@/hooks/use-actions';

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;
const ETH = 10n ** 18n;

describe('deposit lifecycle', () => {
  const base = { hasSession: true, secondsLeft: 600, txHash: null, receiptStatus: null, privateTotalNow: null, privateTotalAtSend: null, amountWei: null };

  it('never reports credited from a submission alone', () => {
    expect(depositStage({ ...base, txHash: '0x1' })).toBe('submitted');
    expect(depositStage({ ...base, txHash: '0x1', receiptStatus: 'success' })).toBe('confirmed-on-chain');
    expect(depositStage({ ...base, txHash: '0x1', receiptStatus: 'success', privateTotalAtSend: 0n, privateTotalNow: ETH / 2n, amountWei: ETH })).toBe('confirmed-on-chain');
  });

  it('reports credited only when the enclave balance rose by the amount', () => {
    expect(depositStage({ ...base, txHash: '0x1', receiptStatus: 'success', privateTotalAtSend: 0n, privateTotalNow: ETH, amountWei: ETH })).toBe('credited');
    // Credit observed even if receipt reads are unavailable.
    expect(depositStage({ ...base, txHash: '0x1', privateTotalAtSend: 0n, privateTotalNow: ETH, amountWei: ETH })).toBe('credited');
  });

  it('distinguishes reverted and expired', () => {
    expect(depositStage({ ...base, txHash: '0x1', receiptStatus: 'reverted' })).toBe('reverted');
    expect(depositStage({ ...base, secondsLeft: 0 })).toBe('session-expired');
    expect(depositStage({ ...base, hasSession: false })).toBe('no-session');
  });

  it('refuses to send close to the session end', () => {
    expect(canSendNow(600)).toBe(true);
    expect(canSendNow(30)).toBe(false);
  });
});

describe('swap form', () => {
  const limits = { maxAmountWei: ETH, availableWei: 2n * ETH, maxSlippageBpsCap: 100 };

  it('produces exact base units for a valid intent', () => {
    const result = validateSwapForm({ amount: '0.1', trigger: '3000', slippage: '0.5' }, limits);
    expect(result).toMatchObject({ amountIn: ETH / 10n, triggerPrice: 3_000n * ETH, maxSlippageBps: 50, errors: {} });
  });

  it('enforces the per-intent maximum and available balance', () => {
    expect(validateSwapForm({ amount: '1.5', trigger: '1', slippage: '0.5' }, limits).errors.amount).toMatch(/maximum/);
    expect(validateSwapForm({ amount: '0.5', trigger: '1', slippage: '0.5' }, { ...limits, availableWei: ETH / 10n }).errors.amount).toMatch(/available/);
    expect(validateSwapForm({ amount: '0', trigger: '1', slippage: '0.5' }, limits).errors.amount).toBeDefined();
  });

  it('warns that slippage above the enclave cap is reduced', () => {
    expect(validateSwapForm({ amount: '0.1', trigger: '1', slippage: '3' }, limits).warnings.join()).toMatch(/caps slippage/);
  });

  it('keeps intent lifetimes inside the enclave expiry window', () => {
    expect(intentLifetime(10_000)).toBe(MAX_INTENT_LIFETIME_SEC);
    expect(MAX_INTENT_LIFETIME_SEC).toBeLessThan(300);
    expect(intentLifetime(1)).toBe(30);
  });
});

describe('withdraw form', () => {
  const owner = '0x00000000000000000000000000000000000000aa' as const;
  const fresh = '0x00000000000000000000000000000000000000bb';

  it('accepts a valid ETH withdrawal and checksums the destination', () => {
    const result = validateWithdrawForm({ token: NATIVE, decimals: 18, amount: '0.25', destination: fresh }, { availableBaseUnits: ETH, maxNativeWei: ETH, owner });
    expect(result.amount).toBe(ETH / 4n);
    expect(result.to).toBe(getAddress(fresh));
    expect(result.errors).toEqual({});
  });

  it('rejects zero, invalid and badly checksummed destinations', () => {
    const limits = { availableBaseUnits: ETH, maxNativeWei: ETH, owner };
    expect(validateWithdrawForm({ token: NATIVE, decimals: 18, amount: '1', destination: NATIVE }, limits).errors.destination).toMatch(/zero/);
    expect(validateWithdrawForm({ token: NATIVE, decimals: 18, amount: '1', destination: '0x1234' }, limits).errors.destination).toBeDefined();
    expect(validateWithdrawForm({ token: NATIVE, decimals: 18, amount: '1', destination: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7239'.replace('D4B', 'd4B') }, limits).errors.destination).toBeDefined();
  });

  it('warns when paying out to the connected wallet', () => {
    expect(validateWithdrawForm({ token: NATIVE, decimals: 18, amount: '0.1', destination: owner }, { availableBaseUnits: ETH, maxNativeWei: ETH, owner }).warnings[0]).toMatch(/links/);
  });

  it('caps ETH but not the output token by MAX_AMOUNT_NATIVE_WEI', () => {
    expect(validateWithdrawForm({ token: NATIVE, decimals: 18, amount: '2', destination: fresh }, { availableBaseUnits: 5n * ETH, maxNativeWei: ETH, owner }).errors.amount).toMatch(/maximum/);
    expect(validateWithdrawForm({ token: USDC, decimals: 6, amount: '5000', destination: fresh }, { availableBaseUnits: 10n ** 12n, maxNativeWei: ETH, owner }).errors).toEqual({});
  });
});

describe('margin aggregates', () => {
  const position = (patch: Partial<PositionItem>): PositionItem => ({
    id: `0x${'11'.repeat(32)}`, side: 'long', status: 'open', collateral: '100', sizeUsd: '200', debtToken: USDC.toLowerCase() as never,
    debt: '100', assetToken: NATIVE, asset: '5', ...patch,
  } as PositionItem);

  it('sums only reported values and never invents equity', () => {
    const totals = marginTotals([
      position({ equity: '-20' }),
      position({ status: 'opening' }),
      position({ status: 'closed', collateral: '999' }),
      position({ side: 'short', debtToken: NATIVE as never, debt: '7' }),
    ]);
    expect(totals.activeCount).toBe(3);
    expect(totals.collateral).toBe(300n);
    expect(totals.debtByToken[USDC.toLowerCase()]).toBe(200n);
    expect(totals.debtByToken[NATIVE]).toBe(7n);
    expect(totals.equity).toBe(-20n);
    expect(totals.equityReported).toBe(1);
    expect(totals.openWithoutEquity).toBe(1);
    expect(riskPriceFreshness(totals)).toBe('stale');
  });

  it('reports freshness as unknown with nothing open', () => {
    expect(riskPriceFreshness(marginTotals([position({ status: 'closed' })]))).toBe('unknown');
    expect(leverageLabel(40_000)).toBe('4x');
    expect(leverageLabel(25_000)).toBe('2.5x');
  });
});
