'use client';

import { appConfig } from '@/lib/config';
import { BalancePanel } from '../dashboard/balance-panel';
import { Notice } from '../ui/notice';
import { RequireSession } from '../wallet/gates';
import { IntentList } from './intent-list';
import { SwapForm } from './swap-form';

export function SwapPageContent() {
  if (!appConfig.tokenOut) {
    return <Notice tone="error" title="Swaps are not configured">Set NEXT_PUBLIC_TOKEN_OUT_ADDRESS to the enclave's TOKEN_OUT_ADDRESS.</Notice>;
  }
  return (
    <RequireSession purpose="swap">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <SwapForm />
          <div className="space-y-6">
            <BalancePanel showActions={false} />
            <Notice tone="info" title="How triggering works">
              The enclave polls a Uniswap Trading API quote about once a minute. On Sepolia the pool price is far from the market price, so set the trigger relative to the pool, not to real ETH prices.
            </Notice>
          </div>
        </div>
        <IntentList />
      </div>
    </RequireSession>
  );
}
