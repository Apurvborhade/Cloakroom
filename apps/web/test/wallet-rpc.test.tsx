import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn(async () => null));
vi.mock('wagmi', () => ({ useAccount: () => ({ connector: { getProvider: async () => ({ request }) } }) }));

const { WalletRpc } = await import('@/components/simple/wallet-rpc');

describe('wallet RPC button', () => {
  it('asks the wallet to add rpc.nony.money for the app chain', async () => {
    render(<WalletRpc />);
    fireEvent.click(screen.getByRole('button', { name: 'Use nony.money RPC in my wallet' }));
    expect(await screen.findByText(/Check it's the selected RPC/)).toBeTruthy();
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'wallet_addEthereumChain',
      params: [expect.objectContaining({ rpcUrls: ['https://rpc.nony.money'] })],
    }));
  });
});
