'use client';

import { useQuery } from '@tanstack/react-query';
import { readPoolSpotPrice } from '@/lib/chain/reads';
import { appConfig } from '@/lib/config';
import { useReadClient } from './use-chain-reader';

/**
 * The configured Uniswap v3 pool's spot price (tokenOut per ETH, 1e18 fixed point), read on-chain
 * through the chain reader. Reference only: the enclave triggers on its own Trading API quote.
 */
export function usePoolPrice() {
  const { client, available } = useReadClient();
  const pool = appConfig.uniswapPool;
  const tokenOut = appConfig.tokenOut?.address;
  const query = useQuery({
    queryKey: ['chain', 'pool-price', pool, tokenOut],
    enabled: Boolean(pool && tokenOut && available),
    queryFn: () => readPoolSpotPrice(client, pool!, tokenOut!),
    refetchInterval: 30_000,
    retry: 1,
  });
  return { ...query, configured: Boolean(pool && tokenOut), available };
}
