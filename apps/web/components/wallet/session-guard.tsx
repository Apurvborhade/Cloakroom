'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useEnclave } from '@/hooks/use-enclave';
import { useOwner } from '@/hooks/use-owner';
import { PRIVATE_QUERY_ROOT } from '@/hooks/use-private-read';
import { sessionStore } from '@/lib/session/session-store';
import { bindActivityOwner } from '@/lib/state/activity';

/**
 * Invalidates everything private when the account, wallet chain or enclave key changes: the read
 * session key is dropped, cached private data is removed, and the in-memory activity is cleared.
 */
export function SessionGuard() {
  const { owner, walletChainId } = useOwner();
  const { identity } = useEnclave();
  const queryClient = useQueryClient();
  const previous = useRef<{ owner?: string; chain?: number; key?: string }>({});

  useEffect(() => {
    const current = { owner: owner?.toLowerCase(), chain: walletChainId, key: identity?.enclavePubKey };
    const before = previous.current;
    if (before.owner !== undefined && before.owner !== current.owner) {
      sessionStore.end('account-changed');
      queryClient.removeQueries({ queryKey: [PRIVATE_QUERY_ROOT] });
    } else if (before.chain !== undefined && before.chain !== current.chain) {
      sessionStore.end('chain-changed');
    }
    if (before.key !== undefined && current.key !== undefined && before.key !== current.key) {
      sessionStore.end('enclave-changed');
      queryClient.removeQueries({ queryKey: [PRIVATE_QUERY_ROOT] });
    }
    if (!current.owner) queryClient.removeQueries({ queryKey: [PRIVATE_QUERY_ROOT] });
    bindActivityOwner(owner ?? null);
    previous.current = current;
  }, [owner, walletChainId, identity?.enclavePubKey, queryClient]);

  return null;
}
