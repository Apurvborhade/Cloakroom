'use client';

import { usePoolPrice } from '@/hooks/use-pool-price';
import { appConfig } from '@/lib/config';
import { formatPrice } from '@/lib/format/units';

export function PoolPriceHint({ onUse }: { onUse?: (price: string) => void }) {
  const price = usePoolPrice();
  const symbol = appConfig.tokenOut?.symbol ?? 'token';
  if (!price.configured) return <span>Pool reference price: not configured (NEXT_PUBLIC_UNISWAP_POOL_ADDRESS)</span>;
  if (!price.available) return <span>Pool reference price: chain reads off</span>;
  if (price.isLoading) return <span>Pool reference price: loading…</span>;
  if (price.error || price.data === undefined) return <span>Pool reference price: unavailable</span>;
  const exact = formatPrice(price.data, 6).replace(/,/g, '');
  return (
    <span>
      Pool spot: <span className="text-fg-muted">{formatPrice(price.data, 2)} {symbol}/ETH</span>
      {onUse && (
        <button type="button" className="ml-2 text-accent hover:underline" onClick={() => onUse(exact)}>
          Use
        </button>
      )}
    </span>
  );
}
