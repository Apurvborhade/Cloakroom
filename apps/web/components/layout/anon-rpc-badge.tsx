'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useChainReadStatus } from '@/hooks/use-chain-reader';
import { chainReader } from '@/lib/chain';
import { Badge } from '../ui/badge';
import { AnonRpcIcon } from './anon-rpc-icon';

const RETRY_AFTER_MS = 30_000;

/**
 * Shows where this browser's chain reads go. It starts Anon-RPC on load, so the first read has no
 * wait, and retries after a failure rather than leaving reads off until the page is reloaded.
 */
export function AnonRpcBadge() {
  const { apiRequests, apiRoute, route, state, totalReads } = useChainReadStatus();

  useEffect(() => {
    if (route !== 'anon-rpc' || state !== 'idle') return;
    chainReader.start().catch(() => undefined);
  }, [route, state]);

  useEffect(() => {
    if (route !== 'anon-rpc' || state !== 'failed') return;
    const timer = setTimeout(() => chainReader.reset(), RETRY_AFTER_MS);
    return () => clearTimeout(timer);
  }, [route, state]);

  const label = route === 'direct-dev'
    ? 'Reads not private'
    : route === 'none'
      ? 'Chain reads off'
      : state === 'ready'
        ? apiRoute === 'direct' ? `Private reads only · ${totalReads}` : `Private · ${totalReads + apiRequests}`
        : state === 'failed'
          ? 'Private routing failed'
          : 'Connecting privately…';
  const tone = route === 'anon-rpc' && state === 'ready' && apiRoute === 'anon-rpc' ? 'ok' : route === 'anon-rpc' && state !== 'failed' && state !== 'ready' ? 'accent' : 'warn';

  return (
    <Link href="/diagnostics" title="This browser's chain reads and Cloakroom API requests go through Anon-RPC. See the details on Diagnostics.">
      <Badge tone={tone}><AnonRpcIcon />{label}</Badge>
    </Link>
  );
}
