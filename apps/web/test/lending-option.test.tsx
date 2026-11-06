import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lendingChange } from '@/lib/margin/lending';

const NATIVE = '0x0000000000000000000000000000000000000000';
const ETH = 10n ** 18n;

const state = vi.hoisted(() => ({
  supplied: 0n,
  poolAvailable: 0n,
  redeem: vi.fn(),
}));

vi.mock('@/hooks/use-actions', () => ({
  useMarginLendingAction: () => ({ mutate: state.redeem, isPending: false, error: null }),
}));
vi.mock('@/hooks/use-private-data', () => ({
  useMarginLending: () => ({ data: { lending: [{ token: '0x0000000000000000000000000000000000000000', supplied: String(state.supplied), available: String(state.poolAvailable) }] } }),
}));

const { LendingOption } = await import('@/components/simple/lending-option');
const renderOption = () => render(<LendingOption token={NATIVE} symbol="ETH" decimals={18} />);

describe('lending change', () => {
  it('takes back everything when the pool can pay it', () => {
    expect(lendingChange({ available: 0n, supplied: 100n, poolAvailable: 100n }, 0)).toEqual({ action: 'redeem', amount: 100n, limited: false });
  });

  it('only takes back what is not out on loan, and says so', () => {
    expect(lendingChange({ available: 0n, supplied: 100n, poolAvailable: 30n }, 0)).toEqual({ action: 'redeem', amount: 30n, limited: true });
    expect(lendingChange({ available: 0n, supplied: 100n, poolAvailable: 0n }, 0)).toEqual({ action: 'none', amount: 0n, limited: true });
  });

  it('does nothing when nothing is lent', () => {
    expect(lendingChange({ available: 0n, supplied: 0n, poolAvailable: 100n }, 0).action).toBe('none');
  });
});

describe('lending info', () => {
  beforeEach(() => {
    state.supplied = 0n;
    state.poolAvailable = 0n;
    state.redeem = vi.fn();
  });

  it('is information only, with no checkbox or way to lend', () => {
    renderOption();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByRole('button', { name: /Lend/ })).toBeNull();
  });

  it('never shows the APY without saying it is not paid yet', () => {
    renderOption();
    expect(screen.getByText('Lending to margin traders: 7% APY (planned, not paid yet)')).toBeTruthy();
  });

  it('explains the risks on request', () => {
    renderOption();
    expect(screen.queryByText(/Lenders can lose money/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What are the risks of lending?' }));
    expect(screen.getByText(/Lenders can lose money/)).toBeTruthy();
    expect(screen.getByText(/No interest is paid yet/)).toBeTruthy();
  });

  it('lets someone with lent funds take them back', () => {
    state.supplied = ETH / 2n;
    state.poolAvailable = ETH;
    renderOption();
    fireEvent.click(screen.getByRole('button', { name: 'Take back 0.5 ETH' }));
    expect(state.redeem.mock.calls[0]![0]).toEqual({ token: NATIVE, amount: ETH / 2n });
  });

  it('says when lent funds are out on loan', () => {
    state.supplied = ETH;
    renderOption();
    expect(screen.getByText('The rest is out on loan.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });
});
