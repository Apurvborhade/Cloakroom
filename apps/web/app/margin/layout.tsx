import type { ReactNode } from 'react';
import { MarginConfigGuard } from '@/components/trading/margin/margin-config-guard';
import { MarginNav } from '@/components/trading/margin/margin-nav';

export default function MarginLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pt-2 sm:pt-6">
      <MarginNav />
      <MarginConfigGuard>{children}</MarginConfigGuard>
    </div>
  );
}
