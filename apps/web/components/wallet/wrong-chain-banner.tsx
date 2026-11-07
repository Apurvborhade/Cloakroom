'use client';

import { useSwitchChain } from 'wagmi';
import { appConfig } from '@/lib/config';
import { useOwner } from '@/hooks/use-owner';
import { Button } from '../ui/button';

export function WrongChainBanner() {
  const { wrongChain, walletChainId } = useOwner();
  const { switchChain, isPending } = useSwitchChain();
  if (!wrongChain) return null;
  return (
    <div role="alert" className="border-b border-bad/30 bg-bad/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm sm:px-6">
        <p className="text-fg">
          Your wallet is on chain {walletChainId}. nony.money signs for <strong>{appConfig.chain.name}</strong> ({appConfig.chainId}); signing is disabled until you switch.
        </p>
        <Button size="sm" variant="secondary" loading={isPending} onClick={() => switchChain({ chainId: appConfig.chainId })}>
          Switch to {appConfig.chain.name}
        </Button>
      </div>
    </div>
  );
}
