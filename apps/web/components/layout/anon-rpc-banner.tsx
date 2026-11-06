'use client';

import { useEffect } from 'react';
import { useEnclave } from '@/hooks/use-enclave';
import { useChainReadStatus } from '@/hooks/use-chain-reader';
import { chainReader } from '@/lib/chain';

/**
 * Anon-RPC never falls back on its own, because that would quietly show the operator the user's
 * IP. If it is down the app can't reach the API, so this explains why and offers the choice.
 */
export function AnonRpcBanner() {
  const { apiRoute, route, state } = useChainReadStatus();
  const { error, refetch } = useEnclave();
  const failed = route === 'anon-rpc' && state === 'failed' && apiRoute === 'anon-rpc';
  const direct = route === 'anon-rpc' && apiRoute === 'direct';

  // The enclave key may have failed to load while routing was down, or before the user's choice.
  useEffect(() => {
    if (error && (state === 'ready' || apiRoute === 'direct')) void refetch();
  }, [apiRoute, error, refetch, state]);

  if (!failed && !direct) return null;
  return (
    <div role={failed ? 'alert' : 'status'} className="bg-accent-soft">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-xs text-fg-muted sm:px-6">
        <span>
          {failed
            ? "Private routing is down, so Cloakroom can't be reached. Retrying… A direct connection works now, but shows the server your IP address."
            : 'You are connected directly, so the Cloakroom server can see your IP address.'}
        </span>
        <button
          type="button"
          onClick={() => chainReader.setApiDirect(failed)}
          className="shrink-0 font-medium text-accent hover:text-accent-strong"
        >
          {failed ? 'Connect directly' : 'Use private routing'}
        </button>
      </div>
    </div>
  );
}
