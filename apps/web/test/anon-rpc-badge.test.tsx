import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: { route: 'anon-rpc', state: 'idle', totalReads: 0, apiRoute: 'anon-rpc', apiRequests: 0 },
  start: vi.fn(async () => undefined),
  reset: vi.fn(),
}));
vi.mock('@/hooks/use-chain-reader', () => ({ useChainReadStatus: () => state.status }));
vi.mock('@/lib/chain', () => ({ chainReader: { start: state.start, reset: state.reset } }));

const { AnonRpcBadge } = await import('@/components/layout/anon-rpc-badge');

describe('private reads badge', () => {
  beforeEach(() => {
    state.start.mockClear();
    state.reset.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('starts Anon-RPC on load', () => {
    render(<AnonRpcBadge />);
    expect(state.start).toHaveBeenCalledOnce();
    expect(screen.getByText('Connecting privately…')).toBeTruthy();
  });

  it('counts reads and API requests once ready', () => {
    state.status = { route: 'anon-rpc', state: 'ready', totalReads: 7, apiRoute: 'anon-rpc', apiRequests: 5 };
    render(<AnonRpcBadge />);
    expect(screen.getByText('Private · 12')).toBeTruthy();
    expect(state.start).not.toHaveBeenCalled();
  });

  it('retries after a failure, and says so meanwhile', () => {
    state.status = { route: 'anon-rpc', state: 'failed', totalReads: 0, apiRoute: 'anon-rpc', apiRequests: 0 };
    render(<AnonRpcBadge />);
    expect(screen.getByText('Private routing failed')).toBeTruthy();
    expect(state.reset).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(30_000));
    expect(state.reset).toHaveBeenCalledOnce();
  });

  it('does not claim everything is private after choosing a direct API connection', () => {
    state.status = { route: 'anon-rpc', state: 'ready', totalReads: 4, apiRoute: 'direct', apiRequests: 0 };
    render(<AnonRpcBadge />);
    expect(screen.getByText('Private reads only · 4')).toBeTruthy();
  });

  it('never claims reads are private when they are not', () => {
    state.status = { route: 'direct-dev', state: 'ready', totalReads: 3, apiRoute: 'direct', apiRequests: 0 };
    render(<AnonRpcBadge />);
    expect(screen.getByText('Reads not private')).toBeTruthy();
    expect(state.start).not.toHaveBeenCalled();
  });
});
