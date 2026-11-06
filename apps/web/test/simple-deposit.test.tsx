import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NATIVE = '0x0000000000000000000000000000000000000000';
const USDC = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const RESERVE = '10000000000000000';
const ETH_18 = 10n ** 18n;
const session = { sessionId: '0xaa', depositAddress: ADDRESS, expiresAt: 4_000_000_000, gasReserveWei: RESERVE, singleUse: true };

const state = vi.hoisted(() => ({
  statuses: {} as { data?: { deposits: Array<Record<string, unknown>> }; error?: unknown },
  balances: {} as { data?: unknown },
  mutateAsync: vi.fn(),
  send: vi.fn(),
  wallet: 10n ** 18n,
  walletToken: 1_000_000_000n,
}));

vi.mock('wagmi', () => ({ useSendTransaction: () => ({ sendTransactionAsync: state.send }) }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[1] === 'native-balance' ? state.wallet : state.walletToken }),
}));
vi.mock('@/hooks/use-actions', () => ({ useOpenDepositSession: () => ({ mutateAsync: state.mutateAsync, isPending: false, reset: () => undefined }) }));
vi.mock('@/hooks/use-chain-reader', () => ({ useReadClient: () => ({ client: {}, available: true }) }));
vi.mock('@/hooks/use-owner', () => ({ useOwner: () => ({ owner: ADDRESS }) }));
vi.mock('@/hooks/use-private-data', () => ({ useBalances: () => state.balances, useDepositStatuses: () => state.statuses }));
vi.mock('@/lib/chain/reads', () => ({ readNativeBalance: vi.fn(), readTokenBalance: vi.fn() }));
vi.mock('@/lib/config', () => {
  const native = { address: '0x0000000000000000000000000000000000000000', symbol: 'ETH', decimals: 18 };
  const tokenOut = { address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', symbol: 'USDC', decimals: 6 };
  return {
    appConfig: { native, tokenOut, chainId: 11155111, explorerUrl: null, depositGasReserveWei: 10000000000000000n },
    knownTokens: () => [native, tokenOut],
    tokenFor: (address: string) => [native, tokenOut].find((token) => token.address.toLowerCase() === address.toLowerCase()) ?? null,
  };
});
vi.mock('@/components/transactions/chain-receipt', () => ({ ChainReceipt: () => null }));
vi.mock('@/components/transactions/tx-link', () => ({ TxLink: ({ hash }: { hash: string }) => <span>{hash}</span> }));
vi.mock('@/components/ui/address', () => ({ Address: ({ value }: { value: string }) => <span>{value}</span> }));
vi.mock('@/components/simple/debug', () => ({
  BalanceFreshness: () => null,
  Elapsed: () => null,
  DebugItem: ({ children }: { children: unknown }) => <div>{children as never}</div>,
  DebugPanel: ({ children }: { children: unknown }) => <div>{children as never}</div>,
}));
vi.mock('@/components/simple/parts', async () => {
  const { useState: _unused } = await import('react');
  void _unused;
  return {
    ActionButton: ({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) => (
      <button type="button" data-testid="main" disabled={disabled} onClick={onClick}>{label}</button>
    ),
    AmountBox: ({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) => (
      <label>{label}<input id={id} value={value} onChange={(event) => onChange(event.target.value)} /></label>
    ),
    Detail: ({ label, children }: { label: string; children: unknown }) => <p>{label}: {children as never}</p>,
    SimpleCard: ({ children }: { children: unknown }) => <div>{children as never}</div>,
    StatusLine: ({ title, children }: { title: string; children?: unknown }) => <div role="status"><b>{title}</b>{children as never}</div>,
  };
});

const { SimpleDeposit } = await import('@/components/simple/simple-deposit');

const main = () => screen.getByTestId('main') as HTMLButtonElement;
const typeAmount = (value: string) => fireEvent.change(screen.getByLabelText(/Amount|USDC to send/), { target: { value } });
const status = (overrides: Record<string, unknown>) => ({
  ...session, asset: NATIVE, status: 'awaiting_funds', nativeReceived: '0', tokenReceived: '0', nativeCredited: '0', tokenCredited: '0', ...overrides,
});

describe('deposit screen', () => {
  beforeEach(() => {
    state.statuses = { data: { deposits: [] } };
    state.balances = {};
    state.wallet = ETH_18;
    state.walletToken = 1_000_000_000n;
    state.mutateAsync = vi.fn(async (asset: string) => ({ ...session, asset }));
    state.send = vi.fn(async ({ value }: { value?: bigint }) => (value ? '0xeth' : '0xusdc'));
  });

  it('shows the reserve before any funds are sent, and adds it on top of an ETH amount', async () => {
    render(<SimpleDeposit />);
    typeAmount('0.03');
    fireEvent.click(main());
    expect(await screen.findByText(/You'll be credited: 0.03 ETH/)).toBeTruthy();
    expect(screen.getByText(/Gas reserve, not credited: 0.01 ETH/)).toBeTruthy();
    expect(screen.getByText(/Total from your wallet: 0.04 ETH/)).toBeTruthy();
    expect(state.mutateAsync).toHaveBeenCalledWith(NATIVE);
    expect(state.send).not.toHaveBeenCalled();

    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    expect(state.send.mock.calls[0]![0]).toMatchObject({ to: ADDRESS, value: 40_000_000_000_000_000n });
  });

  it('sends USDC and the ETH reserve to the same address, in two transfers', async () => {
    render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    fireEvent.click(main());
    expect(await screen.findByText('Your wallet will open twice')).toBeTruthy();
    expect(screen.getByText(/Total from your wallet: 100 USDC \+ 0.01 ETH/)).toBeTruthy();
    expect(state.mutateAsync).toHaveBeenCalledWith(USDC);

    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[0]![0]).toMatchObject({ to: USDC });
    expect(state.send.mock.calls[0]![0].data).toContain(ADDRESS.slice(2).toLowerCase());
    expect(state.send.mock.calls[1]![0]).toMatchObject({ to: ADDRESS, value: BigInt(RESERVE) });
  });

  it('shows the ETH for gas with USDC before signing, filled in with the minimum', () => {
    render(<SimpleDeposit />);
    expect(screen.queryByLabelText('ETH for gas')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    expect((screen.getByLabelText('ETH for gas') as HTMLInputElement).value).toBe('0.01');
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it('refuses less ETH than the minimum, or more than the wallet holds', () => {
    render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    fireEvent.change(screen.getByLabelText('ETH for gas'), { target: { value: '0.005' } });
    expect(main().textContent).toBe('Needs at least 0.01 ETH for gas');
    expect(main().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('ETH for gas'), { target: { value: '2' } });
    expect(main().textContent).toBe('Not enough ETH in your wallet for gas');
    expect(main().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('ETH for gas'), { target: { value: '' } });
    expect(main().textContent).toBe('Enter the ETH for gas');
    fireEvent.change(screen.getByLabelText('ETH for gas'), { target: { value: '0.01' } });
    expect(main().textContent).toBe('Get deposit address');
  });

  it('sends the chosen ETH, and says the part above the minimum is credited', async () => {
    render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    fireEvent.change(screen.getByLabelText('ETH for gas'), { target: { value: '0.02' } });
    fireEvent.click(main());
    expect(await screen.findByText(/Also credited: 0.01 ETH/)).toBeTruthy();
    expect(screen.getByText(/Total from your wallet: 100 USDC \+ 0.02 ETH/)).toBeTruthy();
    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1]![0]).toMatchObject({ to: ADDRESS, value: 20_000_000_000_000_000n });
  });

  it("raises the ETH to the server's reserve if it is above what was shown", async () => {
    state.mutateAsync = vi.fn(async (asset: string) => ({ ...session, asset, gasReserveWei: '30000000000000000' }));
    render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    fireEvent.click(main());
    expect(await screen.findByText(/Total from your wallet: 100 USDC \+ 0.03 ETH/)).toBeTruthy();
    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(2));
    expect(state.send.mock.calls[1]![0]).toMatchObject({ value: 30_000_000_000_000_000n });
  });

  it('asks only for the ETH if the user rejected it after sending the USDC', async () => {
    state.send = vi.fn()
      .mockResolvedValueOnce('0xusdc')
      .mockRejectedValueOnce(Object.assign(new Error('rejected'), { code: 4001 }))
      .mockResolvedValueOnce('0xeth');
    render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    fireEvent.click(main());
    await screen.findByText('Your wallet will open twice');
    fireEvent.click(main());
    await waitFor(() => expect(main().textContent).toBe('Send ETH'));

    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledTimes(3));
    expect(state.send.mock.calls[2]![0]).toMatchObject({ to: ADDRESS, value: BigInt(RESERVE) });
  });

  it('reuses an unfunded address for the same asset without a new signature', async () => {
    state.statuses = { data: { deposits: [status({ asset: NATIVE })] } };
    render(<SimpleDeposit />);
    typeAmount('0.02');
    fireEvent.click(main());
    expect(await screen.findByText(/Total from your wallet: 0.03 ETH/)).toBeTruthy();
    expect(state.mutateAsync).not.toHaveBeenCalled();
  });

  it('never reuses an unfunded address for a different asset', async () => {
    state.statuses = { data: { deposits: [status({ asset: USDC })] } };
    render(<SimpleDeposit />);
    typeAmount('0.02');
    fireEvent.click(main());
    await waitFor(() => expect(state.mutateAsync).toHaveBeenCalledWith(NATIVE));
  });

  it('resumes a partly funded deposit after a refresh, asking only for the missing ETH', async () => {
    state.statuses = { data: { deposits: [status({ asset: USDC, status: 'awaiting_gas', tokenReceived: '100000000' })] } };
    render(<SimpleDeposit />);
    expect(await screen.findByText('Finish your deposit')).toBeTruthy();
    expect(main().textContent).toBe('Send ETH');
    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    expect(state.send.mock.calls[0]![0]).toMatchObject({ to: ADDRESS, value: BigInt(RESERVE) });
  });

  it('after a refresh, asks how much USDC to send if only the ETH arrived, and keeps the field while typing', async () => {
    state.statuses = { data: { deposits: [status({ asset: USDC, status: 'awaiting_token', nativeReceived: RESERVE })] } };
    render(<SimpleDeposit />);
    await waitFor(() => expect(main().textContent).toBe('Enter the USDC amount'));
    expect(main().disabled).toBe(true);
    typeAmount('50');
    expect(screen.getByLabelText('USDC to send')).toBeTruthy();
    expect(main().textContent).toBe('Send USDC');
    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    expect(state.send.mock.calls[0]![0]).toMatchObject({ to: USDC });
  });

  it('shows what was credited, excluding the reserve, then offers a new address', async () => {
    const { rerender } = render(<SimpleDeposit />);
    typeAmount('0.03');
    fireEvent.click(main());
    await screen.findByText(/You'll be credited/);
    state.statuses = { data: { deposits: [status({ status: 'credited', nativeReceived: '40000000000000000', nativeCredited: '30000000000000000' })] } };
    rerender(<SimpleDeposit />);
    expect(await screen.findByText('Deposit complete')).toBeTruthy();
    expect(screen.getByText(/0.03 ETH is now in your Cloakroom balance/)).toBeTruthy();
    expect(main().textContent).toBe('Start a new deposit');
    fireEvent.click(main());
    expect(screen.getByLabelText('Amount')).toBeTruthy();
  });

  it('stops a user sending more than their wallet holds, counting the reserve', async () => {
    state.wallet = 35_000_000_000_000_000n;
    render(<SimpleDeposit />);
    typeAmount('0.03');
    fireEvent.click(main());
    await screen.findByText(/You'll be credited/);
    expect(main().textContent).toBe('Not enough ETH in your wallet');
    expect(main().disabled).toBe(true);
  });

  it('never switches token by itself when the server turns out not to support USDC', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    const { rerender } = render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    state.statuses = { error: new ApiError('ROUTE_NOT_FOUND') };
    rerender(<SimpleDeposit />);

    expect(screen.getByRole('button', { name: 'USDC' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('100');
    expect(screen.getByText("USDC deposits aren't available yet")).toBeTruthy();
    expect(main().textContent).toBe('USDC deposits unavailable');
    expect(main().disabled).toBe(true);
    fireEvent.click(main());
    expect(state.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'ETH' }));
    typeAmount('0.02');
    expect(main().textContent).toBe('Get deposit address');
  });

  it('explains a USDC refusal in plain words, if the server refuses before that is known', async () => {
    const { ApiError } = await import('@/lib/api/errors');
    state.mutateAsync = vi.fn(async () => { throw new ApiError('UNSUPPORTED_ASSET'); });
    render(<SimpleDeposit />);
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    typeAmount('100');
    fireEvent.click(main());
    expect(await screen.findByText(/doesn't accept USDC deposits yet, so nothing was sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'USDC' }).getAttribute('aria-pressed')).toBe('true');
    expect(state.send).not.toHaveBeenCalled();
  });

  it("still takes ETH on today's server, which has no status route or reserve", async () => {
    const { ApiError } = await import('@/lib/api/errors');
    state.statuses = { error: new ApiError('ROUTE_NOT_FOUND') };
    state.mutateAsync = vi.fn(async () => ({ sessionId: '0xaa', depositAddress: ADDRESS, expiresAt: 4_000_000_000 }));
    state.balances = { data: { balances: [{ token: NATIVE, available: '0', reserved: '0', pending: '0' }] } };
    const { rerender } = render(<SimpleDeposit />);
    rerender(<SimpleDeposit />);
    typeAmount('0.03');
    fireEvent.click(main());
    expect(await screen.findByText(/Total from your wallet: 0.03 ETH/)).toBeTruthy();
    expect(screen.queryByText(/Gas reserve/)).toBeNull();
    fireEvent.click(main());
    await waitFor(() => expect(state.send).toHaveBeenCalledOnce());
    state.balances = { data: { balances: [{ token: NATIVE, available: '30000000000000000', reserved: '0', pending: '0' }] } };
    rerender(<SimpleDeposit />);
    expect(await screen.findByText('Deposit complete')).toBeTruthy();
  });
});
