import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lendingChange, lentPercent } from '@/lib/margin/lending';

const NATIVE = '0x0000000000000000000000000000000000000000';
const ETH = 10n ** 18n;

const state = vi.hoisted(() => ({
  active: true,
  availability: 'enabled',
  available: 10n ** 18n,
  supplied: 0n,
  poolAvailable: 0n,
  supply: vi.fn(),
  redeem: vi.fn(),
  error: null as unknown,
}));

vi.mock('@/hooks/use-session', () => ({ useSession: () => ({ active: state.active }) }));
vi.mock('@/hooks/use-actions', () => ({
  useMarginLendingAction: (kind: string) => ({ mutate: kind === 'supply' ? state.supply : state.redeem, isPending: false, error: kind === 'supply' ? state.error : null }),
}));
vi.mock('@/hooks/use-private-data', () => ({
  useBalances: () => ({ data: { balances: [{ token: '0x0000000000000000000000000000000000000000', available: String(state.available), reserved: '0', pending: '0' }] } }),
  useMarginAvailability: () => ({ availability: state.availability }),
  useMarginLending: () => ({ data: { lending: [{ token: '0x0000000000000000000000000000000000000000', supplied: String(state.supplied), available: String(state.poolAvailable) }] } }),
}));
vi.mock('@/components/simple/parts', () => ({
  StatusLine: ({ title }: { title: string }) => <div role="status">{title}</div>,
}));

const { LendingOption } = await import('@/components/simple/lending-option');
const renderOption = () => render(<LendingOption token={NATIVE} symbol="ETH" decimals={18} />);
const box = () => screen.getByRole('checkbox') as HTMLInputElement;

describe('lending change', () => {
  it('lends the difference to reach the percent chosen', () => {
    expect(lendingChange({ available: 75n, supplied: 25n, poolAvailable: 0n }, 50)).toEqual({ action: 'supply', amount: 25n, limited: false });
  });

  it('takes back the difference when lowering the percent', () => {
    expect(lendingChange({ available: 50n, supplied: 50n, poolAvailable: 100n }, 25)).toEqual({ action: 'redeem', amount: 25n, limited: false });
  });

  it('does nothing when already at the percent', () => {
    expect(lendingChange({ available: 50n, supplied: 50n, poolAvailable: 100n }, 50).action).toBe('none');
  });

  it('only takes back what is not out on loan, and says so', () => {
    expect(lendingChange({ available: 0n, supplied: 100n, poolAvailable: 30n }, 0)).toEqual({ action: 'redeem', amount: 30n, limited: true });
    expect(lendingChange({ available: 0n, supplied: 100n, poolAvailable: 0n }, 0)).toEqual({ action: 'none', amount: 0n, limited: true });
  });

  it('reports the share lent, including an empty balance', () => {
    expect(lentPercent({ available: 75n, supplied: 25n, poolAvailable: 0n })).toBe(25);
    expect(lentPercent({ available: 0n, supplied: 0n, poolAvailable: 0n })).toBe(0);
  });
});

describe('lending option', () => {
  beforeEach(() => {
    state.active = true;
    state.availability = 'enabled';
    state.available = ETH;
    state.supplied = 0n;
    state.poolAvailable = 0n;
    state.supply = vi.fn();
    state.redeem = vi.fn();
    state.error = null;
  });

  it('starts unticked, and ticking it moves nothing until the button is pressed', () => {
    renderOption();
    expect(box().checked).toBe(false);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(box());
    expect(state.supply).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Lend 0.25 ETH' })).toBeTruthy();
  });

  it('lends the percent chosen, and shows what is at risk', () => {
    renderOption();
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('radio', { name: '50%' }));
    expect(screen.getByText('0.5 ETH (50%)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Lend 0.5 ETH' }));
    expect(state.supply.mock.calls[0]![0]).toEqual({ token: NATIVE, amount: ETH / 2n });
  });

  it('explains the risks on request, including that it earns nothing', () => {
    renderOption();
    expect(screen.queryByText(/You can lose money/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'What are the risks of lending?' }));
    expect(screen.getByText(/You can lose money/)).toBeTruthy();
    expect(screen.getByText(/You earn nothing right now/)).toBeTruthy();
    expect(screen.getByText(/You may have to wait/)).toBeTruthy();
  });

  it('takes funds back when unticked', () => {
    state.available = ETH / 2n;
    state.supplied = ETH / 2n;
    state.poolAvailable = ETH;
    renderOption();
    expect(box().checked).toBe(true);
    fireEvent.click(box());
    fireEvent.click(screen.getByRole('button', { name: 'Take back 0.5 ETH' }));
    expect(state.redeem.mock.calls[0]![0]).toEqual({ token: NATIVE, amount: ETH / 2n });
  });

  it('says when lent funds are out on loan and cannot come back yet', () => {
    state.available = 0n;
    state.supplied = ETH;
    renderOption();
    fireEvent.click(box());
    expect(screen.getByText(/out on loan, so none can come back yet/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Take back/ })).toBeNull();
  });

  it('is off, and says why, when margin is not live', () => {
    state.availability = 'disabled';
    renderOption();
    expect(box().disabled).toBe(true);
    expect(screen.getByText(/Margin isn't live on this server yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'What are the risks of lending?' })).toBeTruthy();
  });

  it('stays hidden until signed in', () => {
    state.active = false;
    const { container } = renderOption();
    expect(container.textContent).toBe('');
  });
});
