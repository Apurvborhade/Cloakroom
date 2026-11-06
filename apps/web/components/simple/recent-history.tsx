'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useActivity } from '@/hooks/use-activity';
import { useIntentStatuses, useWithdrawalStatuses } from '@/hooks/use-private-data';
import { cn } from '@/lib/cn';
import { appConfig, tokenFor } from '@/lib/config';
import { formatClock } from '@/lib/format/time';
import { formatUnitsDisplay } from '@/lib/format/units';
import { TxLink } from '../transactions/tx-link';
import type { StatusTone } from './parts';

const SHOWN = 5;

const WITHDRAWAL_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  locked: { label: 'Preparing', tone: 'working' },
  sent: { label: 'Sending', tone: 'working' },
  confirmed: { label: 'Sent', tone: 'ok' },
  failed: { label: 'Failed, funds returned', tone: 'bad' },
};

const SWAP_STATUS: Record<string, { label: string; tone: StatusTone }> = {
  pending: { label: 'Waiting', tone: 'working' },
  executing: { label: 'Swapping', tone: 'working' },
  done: { label: 'Complete', tone: 'ok' },
  failed: { label: 'Failed', tone: 'bad' },
  cancelled: { label: 'Cancelled, ETH returned', tone: 'bad' },
  expired: { label: "Didn't fill, ETH returned", tone: 'bad' },
};

function Row({
  title,
  detail,
  status,
}: {
  title: ReactNode;
  detail?: ReactNode;
  status: { label: string; tone: StatusTone };
}) {
  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        {detail && <div className="mt-0.5 text-xs text-fg-subtle">{detail}</div>}
      </div>
      <span
        className={cn(
          'shrink-0 text-right text-xs font-medium',
          status.tone === 'ok' && 'text-ok',
          status.tone === 'bad' && 'text-bad',
          status.tone === 'working' && 'text-accent',
        )}
      >
        {status.label}
      </span>
    </li>
  );
}

function HistoryCard({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="mt-4 rounded-3xl border border-ink-700 bg-ink-850">
      <div className="flex items-center justify-between px-4 pb-1 pt-4">
        <h2 className="text-sm font-medium text-fg-muted">{title}</h2>
        {count > SHOWN && <Link href="/activity" className="text-xs font-medium text-accent hover:text-accent-strong">View all</Link>}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 pb-4 pt-2 text-sm text-fg-subtle">{children}</p>;
}

/**
 * The API returns only ids, statuses and hashes. Amounts and times are known only for actions made
 * in this tab, so older rows just show their status and transaction.
 */
export function RecentWithdrawals() {
  const statuses = useWithdrawalStatuses();
  const { withdrawals: local } = useActivity();
  if (!statuses.data) return null;
  const rows = [...statuses.data.withdrawals].reverse();
  return (
    <HistoryCard title="Recent withdrawals" count={rows.length}>
      {rows.length === 0 && <Empty>Your withdrawals will show up here.</Empty>}
      <ul className="divide-y divide-ink-800 pb-1">
        {rows.slice(0, SHOWN).map((item) => {
          const detail = local[item.id];
          const token = detail ? tokenFor(detail.token) : undefined;
          return (
            <Row
              key={item.id}
              title={detail && token ? `${formatUnitsDisplay(detail.amount, token.decimals, 5)} ${token.symbol}` : 'Withdrawal'}
              detail={item.txHash ? <TxLink hash={item.txHash} /> : detail ? formatClock(detail.createdAt) : undefined}
              status={WITHDRAWAL_STATUS[item.status] ?? { label: item.status, tone: 'working' }}
            />
          );
        })}
      </ul>
    </HistoryCard>
  );
}

export function RecentSwaps() {
  const statuses = useIntentStatuses();
  const { intents: local } = useActivity();
  const tokenOut = appConfig.tokenOut;
  if (!statuses.data || !tokenOut) return null;
  const rows = [...statuses.data.intents].reverse();
  return (
    <HistoryCard title="Recent swaps" count={rows.length}>
      {rows.length === 0 && <Empty>Your swaps will show up here.</Empty>}
      <ul className="divide-y divide-ink-800 pb-1">
        {rows.slice(0, SHOWN).map((item) => {
          const detail = local[item.id.toLowerCase()];
          const sold = detail ? `${formatUnitsDisplay(detail.amountIn, 18, 5)} ETH` : 'ETH';
          const bought = item.amountOut ? `${formatUnitsDisplay(item.amountOut, tokenOut.decimals, 2)} ${tokenOut.symbol}` : tokenOut.symbol;
          return (
            <Row
              key={item.id}
              title={`${sold} → ${bought}`}
              detail={detail ? formatClock(detail.signedAt) : undefined}
              status={SWAP_STATUS[item.status] ?? { label: item.status, tone: 'working' }}
            />
          );
        })}
      </ul>
    </HistoryCard>
  );
}
