'use client';

import { useMarginLending, useMarginPositions } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { marginTotals, riskPriceFreshness } from '@/lib/margin/positions';
import { Amount, TokenSymbol } from '../../ui/amount';
import { Badge } from '../../ui/badge';
import { Card, CardBody, CardHeader } from '../../ui/card';
import { LinkButton } from '../../ui/link-button';
import { Notice } from '../../ui/notice';
import { Skeleton } from '../../ui/skeleton';

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-4" title={hint}>
      <p className="text-[11px] uppercase tracking-wider text-fg-faint">{label}</p>
      <div className="mt-1.5 text-lg font-semibold text-fg">{children}</div>
    </div>
  );
}

export function MarginOverview({ compact = false }: { compact?: boolean }) {
  const positions = useMarginPositions();
  const lending = useMarginLending();
  const usdc = appConfig.tokenOut;
  const totals = positions.data ? marginTotals(positions.data.positions) : null;
  const freshness = totals ? riskPriceFreshness(totals) : 'unknown';

  return (
    <Card>
      <CardHeader
        title="Margin overview"
        description="Computed only from /margin/positions and /margin/lending."
        action={compact ? <LinkButton href="/margin" size="sm" variant="ghost">Open margin</LinkButton> : undefined}
      />
      <CardBody className="space-y-4">
        {(positions.isLoading || lending.isLoading) && <Skeleton className="h-24" />}
        {positions.error && <Notice tone="error" title="Positions unavailable">{describeError(positions.error)}</Notice>}
        {lending.error && <Notice tone="error" title="Lending unavailable">{describeError(lending.error)}</Notice>}
        {totals && usdc && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Active positions">{totals.activeCount}</Stat>
            <Stat label="Total collateral"><Amount value={totals.collateral} token={usdc.address} maxFraction={2} /></Stat>
            <Stat label="Total debt">
              {Object.keys(totals.debtByToken).length === 0 ? <span className="text-fg-subtle">None</span> : (
                <span className="flex flex-col text-base">
                  {Object.entries(totals.debtByToken).map(([token, value]) => <Amount key={token} value={value} token={token} maxFraction={4} />)}
                </span>
              )}
            </Stat>
            <Stat label="Equity (reported)" hint="Sum of equity for positions where the enclave reported it.">
              {totals.equityReported === 0 ? <span className="text-sm text-fg-subtle">Unavailable</span> : <Amount value={totals.equity} token={usdc.address} maxFraction={2} />}
            </Stat>
          </div>
        )}
        {totals && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
            <span>Risk price:</span>
            {freshness === 'fresh' && <Badge tone="ok" dot>Fresh (equity reported for every open position)</Badge>}
            {freshness === 'stale' && <Badge tone="warn" dot>Stale or unavailable: equity and liquidation price are missing; opening is refused</Badge>}
            {freshness === 'unknown' && <Badge tone="neutral">Unknown (no open position to infer it from)</Badge>}
          </div>
        )}
        {!compact && lending.data && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="pb-2 text-left text-xs text-fg-subtle">Lending pools</caption>
              <thead>
                <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-fg-faint">
                  <th scope="col" className="py-2 font-medium">Token</th>
                  <th scope="col" className="py-2 font-medium">You supplied</th>
                  <th scope="col" className="py-2 font-medium" title="Supplied by everyone and not currently lent out">Pool available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {lending.data.lending.map((item) => (
                  <tr key={item.token}>
                    <td className="py-2"><TokenSymbol token={item.token} /></td>
                    <td className="py-2"><Amount value={item.supplied} token={item.token} /></td>
                    <td className="py-2"><Amount value={item.available} token={item.token} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
