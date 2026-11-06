import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marginQuote, marketLimitPrice } from '@/lib/margin/quote';

const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const dollars = (value: bigint) => value * 10n ** 18n;
const usd = (value: bigint) => value * 1_000_000n;

const state = vi.hoisted(() => ({
  availability: 'enabled',
  price: 26_000n * 10n ** 18n as bigint | undefined,
  available: 1_000_000_000n,
  positions: [] as Array<Record<string, unknown>>,
  mutate: vi.fn(),
  error: null as unknown,
}));

vi.mock('@/hooks/use-actions', () => ({
  useMarginOpen: () => ({ mutate: state.mutate, reset: vi.fn(), isPending: false, error: state.error }),
}));
vi.mock('@/hooks/use-pool-price', () => ({ usePoolPrice: () => ({ data: state.price, isLoading: false }) }));
vi.mock('@/hooks/use-private-data', () => ({
  useBalances: () => ({ data: { balances: [{ token: USDC, available: String(state.available), reserved: '0', pending: '0' }] } }),
  useMarginAvailability: () => ({ availability: state.availability }),
  useMarginPositions: () => ({ data: { positions: state.positions } }),
}));
vi.mock('@/lib/config', () => ({
  appConfig: {
    tokenOut: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', decimals: 6 },
    marginMaxLeverageBps: 40_000,
    maxSlippageBpsCap: 100,
  },
}));
vi.mock('@/components/ui/address', () => ({ Address: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/simple/debug', () => ({
  DebugItem: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  DebugPanel: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}));
vi.mock('@/components/simple/parts', () => ({
  ActionButton: ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
    <button type="button" data-testid="main" disabled={disabled} onClick={onClick}>{label}</button>
  ),
  AmountBox: ({ id, label, value, onChange, readOnly }: { id: string; label: string; value: string; onChange?: (value: string) => void; readOnly?: boolean }) => (
    <label>{label}<input id={id} value={value} readOnly={readOnly} onChange={(event) => onChange?.(event.target.value)} /></label>
  ),
  Detail: ({ label, children }: { label: string; children: unknown }) => <p>{label}: {children as never}</p>,
  PrivateBalance: () => null,
  StatusLine: ({ title, children }: { title: string; children?: unknown }) => <div role="status"><b>{title}</b>{children as never}</div>,
}));

const { MarginTrade } = await import('@/components/simple/margin-trade');
const main = () => screen.getByTestId('main') as HTMLButtonElement;
const setCollateral = (value: string) => fireEvent.change(screen.getByLabelText('Collateral'), { target: { value } });
const setLeverage = (value: number) => fireEvent.change(screen.getByLabelText('Leverage'), { target: { value: String(value) } });

describe('margin quote', () => {
  const input = { collateral: usd(1_000n), price: dollars(2_000n), usdcDecimals: 6 };

  it('matches the enclave rules for a 4x long', () => {
    const quote = marginQuote({ ...input, side: 'long', leverageBps: 40_000 });
    expect(quote).toMatchObject({ sizeUsdc: usd(4_000n), sizeEth: 2n * 10n ** 18n, borrowed: usd(3_000n), borrowedToken: 'USDC' });
    // A long is liquidated at -16.7%.
    expect(quote.liquidationPrice! / 10n ** 18n).toBe(1_666n);
  });

  it('matches the enclave rules for a 4x short', () => {
    const quote = marginQuote({ ...input, side: 'short', leverageBps: 40_000 });
    expect(quote).toMatchObject({ sizeEth: 2n * 10n ** 18n, borrowed: 2n * 10n ** 18n, borrowedToken: 'ETH' });
    // A short is liquidated at +13.6%.
    expect(quote.liquidationPrice! / 10n ** 18n).toBe(2_272n);
  });

  it('has no liquidation price for a 1x long, which has no loan', () => {
    const quote = marginQuote({ ...input, side: 'long', leverageBps: 10_000 });
    expect(quote.borrowed).toBe(0n);
    expect(quote.liquidationPrice).toBeNull();
  });

  it('gives a market order room in the direction that hurts the trader', () => {
    expect(marketLimitPrice('long', dollars(2_000n))).toBe(dollars(2_060n));
    expect(marketLimitPrice('short', dollars(2_000n))).toBe(dollars(1_940n));
  });
});

describe('margin trade card', () => {
  beforeEach(() => {
    state.availability = 'enabled';
    state.price = dollars(26_000n);
    state.available = usd(1_000n);
    state.positions = [];
    state.mutate = vi.fn();
    state.error = null;
  });

  it('opens a long at market, with the worst price set above the market price', () => {
    render(<MarginTrade />);
    expect(main().textContent).toBe('Enter collateral');
    setCollateral('100');
    setLeverage(40_000);
    expect(main().textContent).toBe('Open Long');
    expect(screen.getByText(/Position size: 400 USDC/)).toBeTruthy();
    expect(screen.getByText(/Borrowed: 300 USDC/)).toBeTruthy();
    fireEvent.click(main());
    expect(state.mutate.mock.calls[0]![0]).toEqual({
      side: 0, collateral: usd(100n), leverageBps: 40_000, limitPrice: dollars(26_780n), maxSlippageBps: 50,
    });
  });

  it('opens a short, with the worst price set below the market price', () => {
    render(<MarginTrade />);
    fireEvent.click(screen.getByRole('tab', { name: 'short' }));
    setCollateral('100');
    expect(main().textContent).toBe('Open Short');
    fireEvent.click(main());
    expect(state.mutate.mock.calls[0]![0]).toMatchObject({ side: 1, limitPrice: dollars(25_220n) });
  });

  it('offers market orders only, and waits for a price', () => {
    state.price = undefined;
    render(<MarginTrade />);
    expect(screen.queryByLabelText('Order type')).toBeNull();
    setCollateral('100');
    expect(main().textContent).toBe('Getting the price…');
    expect(main().disabled).toBe(true);
  });

  it('blocks more collateral than the balance, and slippage above the cap', () => {
    render(<MarginTrade />);
    setCollateral('2000');
    expect(main().textContent).toBe('Not enough USDC. Deposit first');
    expect(main().disabled).toBe(true);
    setCollateral('100');
    fireEvent.change(screen.getByLabelText('Slippage'), { target: { value: '5' } });
    expect(main().textContent).toBe('Slippage must be up to 1%');
    expect(main().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Slippage'), { target: { value: '1' } });
    expect(main().disabled).toBe(false);
  });

  it('says so when margin is off, rather than hiding the card', () => {
    state.availability = 'disabled';
    render(<MarginTrade />);
    setCollateral('100');
    expect(main().textContent).toBe("Margin isn't live on this server yet");
    expect(main().disabled).toBe(true);
    expect(screen.getByLabelText('Leverage')).toBeTruthy();
  });

  it('colours the chosen side green for long and red for short', () => {
    render(<MarginTrade />);
    expect(screen.getByRole('tab', { name: 'long' }).className).toContain('text-ok');
    expect(screen.getByRole('tab', { name: 'short' }).className).not.toContain('text-bad');
    fireEvent.click(screen.getByRole('tab', { name: 'short' }));
    expect(screen.getByRole('tab', { name: 'short' }).className).toContain('text-bad');
    expect(screen.getByRole('tab', { name: 'long' }).className).not.toContain('text-ok');
  });

  it('explains a refused short in plain words', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    state.error = new ApiError('UNSUPPORTED_ASSET');
    render(<MarginTrade />);
    fireEvent.click(screen.getByRole('tab', { name: 'short' }));
    expect(screen.getByText(/Shorts aren't live on this server yet/)).toBeTruthy();
  });

  it('follows the position until it is open', async () => {
    state.mutate = vi.fn((_input, options) => options.onSuccess({ positionId: '0xabc', status: 'opening' }));
    const { rerender } = render(<MarginTrade />);
    setCollateral('100');
    fireEvent.click(main());
    expect(screen.getByText('Opening your position')).toBeTruthy();
    state.positions = [{ id: '0xabc', status: 'open', entryPrice: String(dollars(26_000n)) }];
    rerender(<MarginTrade />);
    await waitFor(() => expect(screen.getByText('Position open')).toBeTruthy());
    expect(screen.getByRole('link', { name: 'View your positions' }).getAttribute('href')).toBe('/margin/positions');
  });
});
