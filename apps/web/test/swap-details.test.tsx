import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { explainAttempt } from '@/lib/swap/attempts';

vi.mock('@/hooks/use-activity', () => ({ useActivity: () => ({ intents: {} }) }));
vi.mock('@/hooks/use-private-data', () => ({ useBalances: () => ({ dataUpdatedAt: Date.now() - 3_000 }) }));
vi.mock('@/lib/config', () => ({ appConfig: { tokenOut: { symbol: 'USDC', decimals: 6 } } }));

const { SwapDetails } = await import('@/components/simple/swap-details');
const ID = `0x${'ab'.repeat(32)}`;

describe('swap details', () => {
  it('explains why a swap could not run, and shows the exact code', () => {
    render(<SwapDetails id={ID} status="pending" attempts={3} reason="NO_INVENTORY" poolPrice={null} />);
    expect(screen.getByText('NO_INVENTORY')).toBeTruthy();
    expect(screen.getByText('No pool address can run this swap')).toBeTruthy();
    expect(screen.getByText(/3 tries/)).toBeTruthy();
  });

  it('says when the server does not report a reason yet', () => {
    render(<SwapDetails id={ID} status="pending" poolPrice={null} />);
    expect(screen.getByText('Not reported by this server')).toBeTruthy();
  });

  it('counts a return from swapping to waiting as a retry', () => {
    const { rerender } = render(<SwapDetails id={ID} status="pending" poolPrice={null} />);
    rerender(<SwapDetails id={ID} status="executing" poolPrice={null} />);
    rerender(<SwapDetails id={ID} status="pending" poolPrice={null} />);
    expect(screen.getByText(/1 retry seen/)).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Waiting'),
      expect.stringContaining('Swapping'),
      expect.stringContaining('Waiting'),
    ]);
  });

  it('starts a new history for a new order', () => {
    const { rerender } = render(<SwapDetails id={ID} status="executing" poolPrice={null} />);
    rerender(<SwapDetails id={`0x${'cd'.repeat(32)}`} status="pending" poolPrice={null} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });
});

describe('time labels', () => {
  it('counts seconds, then minutes, and never goes negative', async () => {
    const { formatElapsed } = await import('@/components/simple/debug');
    expect(formatElapsed(100, 142)).toBe('42s');
    expect(formatElapsed(100, 225)).toBe('2m 05s');
    expect(formatElapsed(100, 90)).toBe('0s');
  });
});

describe('attempt explanations', () => {
  it('has plain words for every reason the executor gives', () => {
    for (const reason of ['NO_INVENTORY', 'INVENTORY_UNAVAILABLE', 'CONDITION_NOT_MET', 'NO_ROOM_ABOVE_LIMIT', 'QUOTE_UNAVAILABLE',
      'NO_TRANSACTION', 'UNEXPECTED_TRANSACTION', 'UNSAFE_CALLDATA', 'SIMULATION_FAILED', 'PREPARE_FAILED', 'REVERTED']) {
      expect(explainAttempt(reason)!.title).not.toBe(reason);
    }
  });

  it('shows an unknown code as it is, and nothing without a reason', () => {
    expect(explainAttempt('SOMETHING_NEW')!.title).toBe('SOMETHING_NEW');
    expect(explainAttempt(undefined)).toBeNull();
  });
});
