import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  status: { route: 'anon-rpc', state: 'ready', apiRoute: 'anon-rpc' },
  enclave: { error: null as unknown, refetch: vi.fn() },
  setApiDirect: vi.fn(),
}));
vi.mock('@/hooks/use-chain-reader', () => ({ useChainReadStatus: () => state.status }));
vi.mock('@/hooks/use-enclave', () => ({ useEnclave: () => state.enclave }));
vi.mock('@/lib/chain', () => ({ chainReader: { setApiDirect: state.setApiDirect } }));

const { AnonRpcBanner } = await import('@/components/layout/anon-rpc-banner');

describe('private routing banner', () => {
  beforeEach(() => {
    state.setApiDirect.mockClear();
    state.enclave = { error: null, refetch: vi.fn() };
  });

  it('stays out of the way when routing is working', () => {
    state.status = { route: 'anon-rpc', state: 'ready', apiRoute: 'anon-rpc' };
    const { container } = render(<AnonRpcBanner />);
    expect(container.textContent).toBe('');
  });

  it('offers a direct connection only as a choice, and warns about the IP address', () => {
    state.status = { route: 'anon-rpc', state: 'failed', apiRoute: 'anon-rpc' };
    render(<AnonRpcBanner />);
    expect(screen.getByRole('alert').textContent).toContain('shows the server your IP address');
    expect(state.setApiDirect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect directly' }));
    expect(state.setApiDirect).toHaveBeenCalledWith(true);
  });

  it('keeps saying so while direct, and can switch back', () => {
    state.status = { route: 'anon-rpc', state: 'ready', apiRoute: 'direct' };
    render(<AnonRpcBanner />);
    expect(screen.getByRole('status').textContent).toContain('can see your IP address');
    fireEvent.click(screen.getByRole('button', { name: 'Use private routing' }));
    expect(state.setApiDirect).toHaveBeenCalledWith(false);
  });

  it('reloads the enclave key once a working route is available', () => {
    state.status = { route: 'anon-rpc', state: 'ready', apiRoute: 'anon-rpc' };
    state.enclave.error = new Error('network');
    render(<AnonRpcBanner />);
    expect(state.enclave.refetch).toHaveBeenCalled();
  });
});
