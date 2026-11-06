'use client';

import type { Hash } from 'viem';
import { useActivity } from '@/hooks/use-activity';
import { useWithdrawalStatuses } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { Address } from '../ui/address';
import { Amount } from '../ui/amount';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Unavailable } from '../ui/key-value';
import { LinkButton } from '../ui/link-button';
import { Notice } from '../ui/notice';
import { Skeleton } from '../ui/skeleton';
import { WithdrawalStatusBadge } from '../ui/status';
import { ChainReceipt } from './chain-receipt';
import { TxLink } from './tx-link';

export function WithdrawalList({ limit, title = 'Withdrawals', highlight }: { limit?: number; title?: string; highlight?: string | null }) {
  const statuses = useWithdrawalStatuses();
  const { withdrawals: local } = useActivity();
  const rows = [...(statuses.data?.withdrawals ?? [])].reverse();
  const shown = limit ? rows.slice(0, limit) : rows;

  return (
    <Card>
      <CardHeader
          title={title}
          description="Status from /withdrawals/status. A payout hash is cross-checked on-chain through the chain reader."
          action={
            <>
              {limit && rows.length > limit && <LinkButton href="/withdraw" size="sm" variant="ghost">View all</LinkButton>}
              <Button variant="ghost" size="sm" onClick={() => statuses.refetch()} loading={statuses.isFetching && !statuses.isLoading}>Refresh</Button>
            </>
          }
        />
      <CardBody className="p-0">
        {statuses.isLoading && <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        {statuses.error && <div className="p-5"><Notice tone="error" title="Could not load withdrawals">{describeError(statuses.error)}</Notice></div>}
        {statuses.data && shown.length === 0 && <EmptyState title="No withdrawals yet" description="Withdrawals you request appear here with their payout transaction." />}
        {shown.length > 0 && (
          <ul className="divide-y divide-ink-800">
            {shown.map((item) => {
              const detail = local[item.id];
              return (
                <li key={item.id} className={item.id === highlight ? 'bg-accent-soft/40 px-5 py-3' : 'px-5 py-3'}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <WithdrawalStatusBadge status={item.status} />
                      <span className="text-sm text-fg">
                        {detail ? <Amount value={detail.amount} token={detail.token} /> : <Unavailable label="Amount not in this tab" />}
                      </span>
                      {detail && <span className="text-xs text-fg-subtle">to <Address value={detail.to} copy={false} /></span>}
                    </div>
                    <span className="text-[11px] text-fg-faint">ID <span className="font-mono">{item.id.slice(0, 10)}…</span></span>
                  </div>
                  {(item.txHash || item.reason) && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      {item.txHash && <TxLink hash={item.txHash} />}
                      {item.txHash && <ChainReceipt hash={item.txHash as Hash} label="Payout" />}
                      {item.reason && <span className="text-bad">Reason: {item.reason}</span>}
                    </div>
                  )}
                  {item.status === 'locked' && <p className="mt-1 text-xs text-fg-subtle">Funds reserved and a paying address assigned. The payout has not been sent yet.</p>}
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
