'use client';

import type { ReactNode } from 'react';
import { useEnclave } from '@/hooks/use-enclave';
import { useMarginAvailability } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { ApiError } from '@/lib/api/errors';
import { Card } from '../../ui/card';
import { Notice } from '../../ui/notice';
import { Skeleton } from '../../ui/skeleton';
import { RequireSession } from '../../wallet/gates';

/**
 * Margin is shown only when the enclave actually serves its routes. There is no capability
 * endpoint, so availability comes from a session-signed /margin/lending read.
 */
export function MarginGate({ children }: { children: ReactNode }) {
  return (
    <RequireSession purpose="trade on margin">
      <MarginAvailabilityGate>{children}</MarginAvailabilityGate>
    </RequireSession>
  );
}

function MarginAvailabilityGate({ children }: { children: ReactNode }) {
  const { availability, errorCode } = useMarginAvailability();
  if (availability === 'off-by-config') {
    return <Notice tone="info" title="Margin UI is turned off">NEXT_PUBLIC_MARGIN_UI=off in this build.</Notice>;
  }
  if (availability === 'checking' || availability === 'needs-session') {
    return <Card className="p-6"><Skeleton className="h-24" /></Card>;
  }
  if (availability === 'disabled') {
    return (
      <Notice tone="info" title="Margin trading is not enabled on this enclave">
        The enclave does not serve the margin routes (they exist only with MARGIN_ENABLED=true). Nothing here is live.
      </Notice>
    );
  }
  if (availability === 'error') {
    return <Notice tone="error" title="Could not check margin availability">{describeError(new ApiError(errorCode ?? 'INTERNAL_ERROR'))}</Notice>;
  }
  return (
    <div className="space-y-6">
      <MarginModeBanner />
      {children}
    </div>
  );
}

export function MarginModeBanner() {
  const { identity } = useEnclave();
  if (identity?.mode === 'simulated') {
    return (
      <Notice tone="warn" title="Mock margin accounting (simulation)">
        This enclave runs in simulation, where margin uses the in-memory MockMarginAccounting stand-in. Positions and lending balances are not settled financial positions: they vanish on restart, supply and redeem do not move funds in your private balance, collateral is not debited from it, and no interest is charged. Opening and closing swaps may still execute on-chain against test liquidity.
      </Notice>
    );
  }
  return (
    <Notice tone="warn" title="Margin accounting cannot be verified from the browser">
      Outside simulation the enclave refuses to start margin without a real accounting implementation, but this app cannot tell which one is wired in. Treat margin as experimental MVP functionality (up to 4x, full closes only).
    </Notice>
  );
}
