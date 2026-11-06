import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NATIVE = '0x0000000000000000000000000000000000000000';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const state = vi.hoisted(() => ({ active: false, balances: {} as { data?: unknown; error?: unknown } }));

vi.mock('@/hooks/use-session', () => ({ useSession: () => ({ active: state.active }) }));
vi.mock('@/hooks/use-private-data', () => ({ useBalances: () => state.balances }));
vi.mock('@/lib/config', () => ({
  knownTokens: () => [
    { address: NATIVE, symbol: 'ETH', decimals: 18 },
    { address: USDC, symbol: 'USDC', decimals: 6 },
  ],
}));
vi.mock('@/components/simple/parts', () => ({
  ActionButton: () => <button type="button">Sign in</button>,
  StatusLine: ({ title }: { title: string }) => <p>{title}</p>,
}));

const { Home } = await import('@/components/simple/home');

describe('home page', () => {
  beforeEach(() => {
    state.active = false;
    state.balances = {};
  });

  it('always offers deposit, swap and withdraw', () => {
    render(<Home />);
    expect(screen.getByRole('link', { name: /Deposit/ }).getAttribute('href')).toBe('/deposit');
    expect(screen.getByRole('link', { name: /Swap/ }).getAttribute('href')).toBe('/swap');
    expect(screen.getByRole('link', { name: /Withdraw/ }).getAttribute('href')).toBe('/withdraw');
  });

  it('asks to sign in before showing a balance', () => {
    render(<Home />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('ETH')).toBeNull();
  });

  it('shows each balance, with a token missing from the reply as zero', () => {
    state.active = true;
    state.balances = { data: { balances: [{ token: NATIVE, available: '20000000000000000', reserved: '0', pending: '0' }] } };
    render(<Home />);
    expect(screen.getByText('0.02')).toBeTruthy();
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.queryByText(/in progress/)).toBeNull();
  });

  it('shows funds held by an order or a withdrawal separately', () => {
    state.active = true;
    state.balances = { data: { balances: [{ token: NATIVE, available: '0', reserved: '10000000000000000', pending: '0' }] } };
    render(<Home />);
    expect(screen.getByText('0.01 in progress')).toBeTruthy();
  });

  it('says so when the balance cannot load', () => {
    state.active = true;
    state.balances = { error: new Error('down') };
    render(<Home />);
    expect(screen.getByText("Couldn't load your balance")).toBeTruthy();
  });
});
