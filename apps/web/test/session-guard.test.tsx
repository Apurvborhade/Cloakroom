import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ owner: '0x00000000000000000000000000000000000000a1' as string | undefined, chain: 11155111, key: '0xkey1' }));
vi.mock('@/hooks/use-owner', () => ({ useOwner: () => ({ owner: state.owner, walletChainId: state.chain }) }));
vi.mock('@/hooks/use-enclave', () => ({ useEnclave: () => ({ identity: { enclavePubKey: state.key } }) }));

import { SessionGuard } from '@/components/wallet/session-guard';
import { sessionStore } from '@/lib/session/session-store';
import { activityStore, recordWithdrawal } from '@/lib/state/activity';

describe('account change invalidation', () => {
  it('drops the read session, cached private data and local activity when the account changes', () => {
    const client = new QueryClient();
    const end = vi.spyOn(sessionStore, 'end');
    const ui = () => <QueryClientProvider client={client}><SessionGuard /></QueryClientProvider>;
    const view = render(ui());
    client.setQueryData(['private', state.owner, '0xkey1', 'balance'], { balances: [] });
    recordWithdrawal({ id: 'w1', token: '0x0000000000000000000000000000000000000000', amount: 1n, to: '0x00000000000000000000000000000000000000b2', createdAt: 0 });
    expect(Object.keys(activityStore.getSnapshot().withdrawals)).toEqual(['w1']);

    state.owner = '0x00000000000000000000000000000000000000c3';
    view.rerender(ui());
    expect(end).toHaveBeenCalledWith('account-changed');
    expect(client.getQueryCache().findAll({ queryKey: ['private'] })).toHaveLength(0);
    expect(activityStore.getSnapshot().owner).toBe(state.owner);
    expect(activityStore.getSnapshot().withdrawals).toEqual({});
  });

  it('drops the session when the enclave key changes (restart with a new vault)', () => {
    const client = new QueryClient();
    const end = vi.spyOn(sessionStore, 'end');
    const ui = () => <QueryClientProvider client={client}><SessionGuard /></QueryClientProvider>;
    const view = render(ui());
    state.key = '0xkey2';
    view.rerender(ui());
    expect(end).toHaveBeenCalledWith('enclave-changed');
  });

  it('drops the session when the wallet switches chain', () => {
    const client = new QueryClient();
    const end = vi.spyOn(sessionStore, 'end');
    const ui = () => <QueryClientProvider client={client}><SessionGuard /></QueryClientProvider>;
    const view = render(ui());
    state.chain = 1;
    view.rerender(ui());
    expect(end).toHaveBeenCalledWith('chain-changed');
  });
});
