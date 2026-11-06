'use client';

import { useAccount } from 'wagmi';
import { appConfig } from '@/lib/config';

/** The connected primary wallet and whether it is on the configured chain. */
export function useOwner() {
  const { address, isConnected, isConnecting, isReconnecting, chainId, connector } = useAccount();
  const wrongChain = isConnected && chainId !== undefined && chainId !== appConfig.chainId;
  return {
    owner: isConnected ? address : undefined,
    isConnected,
    isConnecting: isConnecting || isReconnecting,
    walletChainId: chainId,
    wrongChain,
    ready: Boolean(isConnected && address && !wrongChain),
    connectorName: connector?.name,
  };
}
