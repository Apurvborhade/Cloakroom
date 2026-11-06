'use client';

import { appConfig } from '@/lib/config';
import { useOwner } from '@/hooks/use-owner';
import { Badge } from '../ui/badge';

export function NetworkBadge() {
  const { isConnected, wrongChain } = useOwner();
  if (isConnected && wrongChain) return <Badge tone="bad" dot>Wrong network</Badge>;
  return (
    <Badge tone="neutral" dot className="hidden sm:inline-flex">
      {appConfig.chain.name}
    </Badge>
  );
}
