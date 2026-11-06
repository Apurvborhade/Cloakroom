import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NATIVE = '0x0000000000000000000000000000000000000000';
const HASH = `0x${'ab'.repeat(32)}`;
const state = vi.hoisted(() => ({
  withdrawals: undefined as unknown,
  intents: undefined as unknown,
  local: { withdrawals: {}, intents: {} } as { withdrawals: Record<string, unknown>; intents: Record<string, unknown> },
  cancel: { mutate: vi.fn(), isPending: false, error: null as unknown },
}));

vi.mock('@/hooks/use-actions', () => ({ useCancelIntent: () => state.cancel }));

vi.mock('@/hooks/use-private-data', () => ({
  useWithdrawalStatuses: () => ({ data: state.withdrawals }),
  useIntentStatuses: () => ({ data: state.intents }),
}));
vi.mock('@/hooks/use-activity', () => ({ useActivity: () => state.local }));
vi.mock('@/lib/config', () => ({
  appConfig: { tokenOut: { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', decimals: 6 }, explorerUrl: 'https://sepolia.etherscan.io' },
  tokenFor: () => ({ symbol: 'ETH', decimals: 18 }),
}));

const { RecentSwaps, RecentWithdrawals } = await import('@/components/simple/recent-history');

describe('recent history', () => {
  beforeEach(() => {
    state.withdrawals = undefined;
    state.intents = undefined;
    state.local = { withdrawals: {}, intents: {} };
    state.cancel = { mutate: vi.fn(), isPending: false, error: null };
  });

  it('shows nothing before the user has signed in', () => {
    const { container } = render(<><RecentWithdrawals /><RecentSwaps /></>);
    expect(container.textContent).toBe('');
  });

  it('says so when there is no history yet', () => {
    state.withdrawals = { withdrawals: [] };
    render(<RecentWithdrawals />);
    expect(screen.getByText('Your withdrawals will show up here.')).toBeTruthy();
  });

  it('lists the newest first, with amounts only where this tab knows them', () => {
    state.withdrawals = {
      withdrawals: [
        { id: 'old', status: 'failed' },
        { id: 'new', status: 'confirmed', txHash: HASH },
      ],
    };
    state.local.withdrawals = { new: { id: 'new', token: NATIVE, amount: 10n ** 16n, to: NATIVE, createdAt: 1 } };
    render(<RecentWithdrawals />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('0.01 ETH');
    expect(rows[0]!.textContent).toContain('Sent');
    expect(rows[1]!.textContent).toContain('Withdrawal');
    expect(rows[1]!.textContent).toContain('Failed, funds returned');
  });

  it('shows at most five rows and links to the rest', () => {
    state.withdrawals = { withdrawals: Array.from({ length: 6 }, (_, index) => ({ id: String(index), status: 'confirmed' })) };
    render(<RecentWithdrawals />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('link', { name: 'View all' }).getAttribute('href')).toBe('/activity');
  });

  it('offers cancel only while a swap is waiting, and cancels that swap', () => {
    state.intents = {
      intents: [
        { id: '0xdone', status: 'done' },
        { id: '0xrunning', status: 'executing' },
        { id: '0xwaiting', status: 'pending' },
      ],
    };
    render(<RecentSwaps />);
    const buttons = screen.getAllByRole('button', { name: 'Cancel' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(state.cancel.mutate).toHaveBeenCalledWith('0xwaiting');
  });

  it('says so when a cancel is refused', () => {
    state.intents = { intents: [{ id: '0xwaiting', status: 'pending' }] };
    state.cancel.error = new Error('too late');
    render(<RecentSwaps />);
    expect(screen.getByRole('alert').textContent).toContain("Couldn't cancel");
  });

  it('shows what a swap paid, and plain words when it did not fill', () => {
    state.intents = {
      intents: [
        { id: '0xAA', status: 'expired' },
        { id: '0xBB', status: 'done', amountOut: '258260000' },
      ],
    };
    state.local.intents = { '0xbb': { amountIn: 10n ** 16n, signedAt: 1 } };
    render(<RecentSwaps />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('0.01 ETH → 258.26 USDC');
    expect(rows[0]!.textContent).toContain('Complete');
    expect(rows[1]!.textContent).toContain("Didn't fill, ETH returned");
  });
});
