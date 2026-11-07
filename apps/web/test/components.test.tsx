import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks: wallet libraries and the app's data hooks. No backend is implied by these. ---
const owner = vi.hoisted(() => ({ value: { owner: undefined as string | undefined, isConnected: false, isConnecting: false, walletChainId: undefined as number | undefined, wrongChain: false, ready: false, connectorName: undefined } }));
const enclave = vi.hoisted(() => ({ value: { identity: null as null | Record<string, unknown>, binding: null, isLoading: false, error: null, refetch: () => undefined, isFetching: false } }));
const margin = vi.hoisted(() => ({ value: { availability: 'disabled', errorCode: 'ROUTE_NOT_FOUND' } }));
const intents = vi.hoisted(() => ({ value: { data: { intents: [] as Array<{ id: string; status: string; amountOut?: string }> }, isLoading: false, error: null, isFetching: false, refetch: () => undefined } }));
const positions = vi.hoisted(() => ({ value: { data: { positions: [] as unknown[] }, isLoading: false, error: null, isFetching: false, refetch: () => undefined } }));

vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({ openConnectModal: vi.fn() }) }));
vi.mock('wagmi', () => ({ useSwitchChain: () => ({ switchChain: vi.fn(), isPending: false }) }));
vi.mock('@/hooks/use-owner', () => ({ useOwner: () => owner.value }));
vi.mock('@/hooks/use-enclave', () => ({ useEnclave: () => enclave.value, ENCLAVE_QUERY_KEY: ['enclave'] }));
vi.mock('@/hooks/use-session', () => ({ useSession: () => ({ active: true, session: null, unlock: { mutate: vi.fn(), isPending: false, error: null }, canUnlock: true, lastEndReason: null, end: vi.fn() }) }));
vi.mock('@/hooks/use-private-data', () => ({
  useMarginAvailability: () => margin.value,
  useIntentStatuses: () => intents.value,
  useMarginPositions: () => positions.value,
  useMarginLending: () => ({ data: undefined }),
  useBalances: () => ({ data: undefined }),
}));
const cancelMutate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/use-actions', () => ({
  useCancelIntent: () => ({ mutate: cancelMutate, isPending: false, error: null, reset: vi.fn() }),
  useMarginAddCollateral: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
  useMarginClose: () => ({ mutate: vi.fn(), isPending: false, error: null, reset: vi.fn() }),
}));
vi.mock('@/lib/config', async (original) => {
  const actual = await original<typeof import('@/lib/config')>();
  const appConfig = actual.parseConfig({ NEXT_PUBLIC_CLOAKROOM_API_URL: 'http://127.0.0.1:8787', NEXT_PUBLIC_TOKEN_OUT_ADDRESS: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' });
  return { ...actual, appConfig, knownTokens: () => actual.knownTokens(appConfig), tokenFor: (token: string) => actual.tokenFor(token, appConfig) };
});

import { RequireWallet } from '@/components/wallet/gates';
import { SigningReview } from '@/components/trading/signing-review';
import { SimBanner } from '@/components/layout/sim-banner';
import { AttestationBadge } from '@/components/dashboard/attestation-badge';
import { MarginGate } from '@/components/trading/margin/margin-gate';
import { IntentList } from '@/components/trading/intent-list';
import { PositionsTable } from '@/components/trading/margin/positions-table';
import { ToastProvider } from '@/components/ui/toast';

function wrap(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}><ToastProvider>{node}</ToastProvider></QueryClientProvider>);
}

beforeEach(() => {
  owner.value = { owner: undefined, isConnected: false, isConnecting: false, walletChainId: undefined, wrongChain: false, ready: false, connectorName: undefined };
  enclave.value = { identity: null, binding: null, isLoading: false, error: null, refetch: () => undefined, isFetching: false };
});

describe('wallet gate', () => {
  it('asks to connect when disconnected', () => {
    wrap(<RequireWallet><p>private content</p></RequireWallet>);
    expect(screen.getByText('Connect a wallet')).toBeTruthy();
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('blocks signing on the wrong chain', () => {
    owner.value = { ...owner.value, owner: '0xabc', isConnected: true, walletChainId: 1, wrongChain: true };
    wrap(<RequireWallet><p>private content</p></RequireWallet>);
    expect(screen.getByText('Wrong network')).toBeTruthy();
    expect(screen.queryByText('private content')).toBeNull();
  });

  it('renders content when connected on the right chain', () => {
    owner.value = { ...owner.value, owner: '0xabc', isConnected: true, walletChainId: 11155111, ready: true };
    wrap(<RequireWallet><p>private content</p></RequireWallet>);
    expect(screen.getByText('private content')).toBeTruthy();
  });
});

describe('signing review', () => {
  it('shows the exact values and signs only from the confirm button', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    wrap(
      <SigningReview open onClose={onClose} onConfirm={onConfirm} title="Review withdrawal" primaryType="Withdrawal" pending={false}
        rows={[{ label: 'Destination', value: '0xDEST' }, { label: 'amount (base units)', value: '250000000000000000' }]}
        authorises="Paying exactly this amount." />,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('0xDEST')).toBeTruthy();
    expect(screen.getByText('250000000000000000')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Sign in wallet'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed or resubmitted while pending', () => {
    const onConfirm = vi.fn();
    wrap(<SigningReview open onClose={vi.fn()} onConfirm={onConfirm} title="t" primaryType="Intent" pending rows={[]} authorises="x" />);
    const button = screen.getByText('Waiting for wallet…').closest('button')!;
    expect(button.disabled).toBe(true);
    expect((screen.getByLabelText('Close dialog') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TEE status', () => {
  it('shows the TEE-SIMULATED banner for a simulated key', () => {
    enclave.value = { ...enclave.value, identity: { mode: 'simulated' } };
    wrap(<><SimBanner /><AttestationBadge /></>);
    expect(screen.getByText('TEE-SIMULATED')).toBeTruthy();
    expect(screen.getByText('TEE-simulated')).toBeTruthy();
  });

  it('never claims verification just because /attestation answered', () => {
    enclave.value = { ...enclave.value, identity: { mode: 'attested-unverified' } };
    const { container } = wrap(<><SimBanner /><AttestationBadge /></>);
    expect(container.textContent).toMatch(/Attestation available/);
    expect(container.textContent).not.toMatch(/\bverified\b/i);
    expect(screen.queryByText('TEE-SIMULATED')).toBeNull();
  });
});

describe('margin gate', () => {
  it('says margin is not enabled when the routes are absent', () => {
    owner.value = { ...owner.value, owner: '0xabc', isConnected: true, walletChainId: 11155111, ready: true };
    enclave.value = { ...enclave.value, identity: { mode: 'attested-unverified' } };
    margin.value = { availability: 'disabled', errorCode: 'ROUTE_NOT_FOUND' };
    wrap(<MarginGate><p>margin ui</p></MarginGate>);
    expect(screen.getByText(/not enabled on this enclave/)).toBeTruthy();
    expect(screen.queryByText('margin ui')).toBeNull();
  });

  it('labels mock accounting in simulation', () => {
    owner.value = { ...owner.value, owner: '0xabc', isConnected: true, walletChainId: 11155111, ready: true };
    enclave.value = { ...enclave.value, identity: { mode: 'simulated' } };
    margin.value = { availability: 'enabled', errorCode: null as never };
    wrap(<MarginGate><p>margin ui</p></MarginGate>);
    expect(screen.getByText('margin ui')).toBeTruthy();
    expect(screen.getByText(/Mock margin accounting/)).toBeTruthy();
  });
});

describe('action eligibility', () => {
  it('offers cancel only for pending intents', () => {
    intents.value = { ...intents.value, data: { intents: [
      { id: `0x${'01'.repeat(32)}`, status: 'pending' },
      { id: `0x${'02'.repeat(32)}`, status: 'executing' },
      { id: `0x${'03'.repeat(32)}`, status: 'cancelled' },
      { id: `0x${'04'.repeat(32)}`, status: 'done', amountOut: '300000000' },
    ] } };
    wrap(<IntentList />);
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    expect(screen.getByText('300')).toBeTruthy();
  });

  it('offers position actions only when open, and shows missing fields as unavailable, not zero', () => {
    const base = { side: 'long', collateral: '100000000', sizeUsd: '200000000', debtToken: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', debt: '100000000', assetToken: '0x0000000000000000000000000000000000000000', asset: '0' };
    positions.value = { ...positions.value, data: { positions: [
      { ...base, id: `0x${'0a'.repeat(32)}`, status: 'opening' },
      { ...base, id: `0x${'0b'.repeat(32)}`, status: 'open' },
    ] } };
    wrap(<PositionsTable />);
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Add collateral' })).toHaveLength(1);
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThanOrEqual(4);
  });

  it('shows why a close failed on the row, and still lets the user retry', () => {
    const base = { side: 'long', collateral: '100000000', sizeUsd: '200000000', debtToken: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238', debt: '100000000', assetToken: '0x0000000000000000000000000000000000000000', asset: '1' };
    positions.value = { ...positions.value, data: { positions: [
      { ...base, id: `0x${'0c'.repeat(32)}`, status: 'open', reason: 'NO_INVENTORY' },
    ] } };
    wrap(<PositionsTable />);
    expect(screen.getByText(/Last close didn't go through: No pool address can run this swap/)).toBeTruthy();
    expect(screen.getByText(/\(NO_INVENTORY\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });
});
