import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/app-shell';
import { MarginGate } from '@/components/trading/margin/margin-gate';
import { MarginNav } from '@/components/trading/margin/margin-nav';
import { MarginConfigGuard } from '@/components/trading/margin/margin-config-guard';

export default function MarginLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Margin" description="Isolated ETH positions with USDC collateral, funded by a private lending pool. MVP scope: up to 4x, full closes only." />
      <MarginNav />
      <MarginConfigGuard>
        <MarginGate>{children}</MarginGate>
      </MarginConfigGuard>
    </>
  );
}
