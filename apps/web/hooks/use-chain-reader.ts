'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { chainReader } from '@/lib/chain';
import { createReadClient } from '@/lib/chain/reads';
import { appConfig } from '@/lib/config';
import { useOwner } from './use-owner';

const isolationKeys = new Map<string, string>();

/**
 * A per-account random isolation key, asking the Anon-RPC network not to link reads made for
 * different accounts. Memory only.
 */
function isolationKeyFor(owner: string | undefined): string | undefined {
  if (!owner) return undefined;
  const key = owner.toLowerCase();
  let value = isolationKeys.get(key);
  if (!value) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    isolationKeys.set(key, value);
  }
  return value;
}

export function useChainReadStatus() {
  return useSyncExternalStore(chainReader.subscribe, chainReader.getStatus, chainReader.getStatus);
}

/** A viem client routed through the ChainReader, isolated per connected account. */
export function useReadClient() {
  const { owner } = useOwner();
  const status = useChainReadStatus();
  const client = useMemo(() => createReadClient(chainReader, appConfig.chain, isolationKeyFor(owner)), [owner]);
  return { client, status, available: status.route !== 'none' && status.state !== 'failed' };
}
