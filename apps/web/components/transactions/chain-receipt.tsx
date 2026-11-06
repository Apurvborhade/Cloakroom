'use client';

import { useQuery } from '@tanstack/react-query';
import type { Hash } from 'viem';
import { useReadClient } from '@/hooks/use-chain-reader';
import { readReceipt } from '@/lib/chain/reads';
import { Badge } from '../ui/badge';

/**
 * An independent on-chain check of a transaction hash the API reported, read through the chain
 * reader (Anon-RPC by default). It never replaces the API status; it corroborates it.
 */
export function ChainReceipt({ hash, label = 'On-chain' }: { hash: Hash; label?: string }) {
  const { client, available, status } = useReadClient();
  const receipt = useQuery({
    queryKey: ['chain', 'receipt', hash],
    enabled: available,
    queryFn: () => readReceipt(client, hash),
    refetchInterval: (query) => (query.state.data ? false : 6_000),
    retry: 1,
  });
  if (!available) return <Badge tone="neutral" className="cursor-help">{label}: reads off</Badge>;
  const via = status.route === 'anon-rpc' ? 'via Anon-RPC' : 'via direct dev RPC';
  if (receipt.isLoading) return <Badge tone="neutral">{label}: checking {via}</Badge>;
  if (receipt.error) return <Badge tone="neutral">{label}: read failed</Badge>;
  if (!receipt.data) return <Badge tone="warn">{label}: not mined yet</Badge>;
  return receipt.data.status === 'success'
    ? <span title={`Block ${receipt.data.blockNumber.toString()} ${via}`}><Badge tone="ok">{label}: mined in block {receipt.data.blockNumber.toString()}</Badge></span>
    : <Badge tone="bad">{label}: reverted</Badge>;
}
