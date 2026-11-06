'use client';

import { useState } from 'react';
import type { Hex } from 'viem';
import { useActivity } from '@/hooks/use-activity';
import { useCancelIntent } from '@/hooks/use-actions';
import { useIntentStatuses } from '@/hooks/use-private-data';
import { appConfig } from '@/lib/config';
import { describeError } from '@/lib/api/errors';
import { formatClock, formatDateTime } from '@/lib/format/time';
import { formatBps, formatPrice } from '@/lib/format/units';
import { Address } from '../ui/address';
import { Amount, TokenSymbol } from '../ui/amount';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { EmptyState } from '../ui/empty-state';
import { Unavailable } from '../ui/key-value';
import { LinkButton } from '../ui/link-button';
import { Notice } from '../ui/notice';
import { Skeleton } from '../ui/skeleton';
import { IntentStatusBadge } from '../ui/status';
import { useToast } from '../ui/toast';
import { SigningReview } from './signing-review';

export function IntentList({ limit, title = 'Intents' }: { limit?: number; title?: string }) {
  const statuses = useIntentStatuses();
  const { intents: local } = useActivity();
  const cancel = useCancelIntent();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<Hex | null>(null);

  const rows = [...(statuses.data?.intents ?? [])].reverse();
  const shown = limit ? rows.slice(0, limit) : rows;

  const confirmCancel = () => {
    if (!cancelling) return;
    cancel.mutate(cancelling, {
      onSuccess: () => {
        toast.push({ tone: 'ok', title: 'Intent cancelled', description: 'Reserved ETH was released to your available balance.' });
        setCancelling(null);
      },
    });
  };

  return (
    <Card>
      <CardHeader
        title={title}
        description="Status from /intents/status. Pair, amount and trigger are shown only for intents signed in this browser tab: the API returns ids and statuses only."
        action={
          <>
            {limit && rows.length > limit && <LinkButton href="/swap" size="sm" variant="ghost">View all</LinkButton>}
            <Button variant="ghost" size="sm" onClick={() => statuses.refetch()} loading={statuses.isFetching && !statuses.isLoading}>Refresh</Button>
          </>
        }
      />
      <CardBody className="p-0">
        {statuses.isLoading && <div className="space-y-2 p-5"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>}
        {statuses.error && <div className="p-5"><Notice tone="error" title="Could not load intents">{describeError(statuses.error)}</Notice></div>}
        {statuses.data && shown.length === 0 && (
          <EmptyState title="No intents yet" description="Create a conditional swap to have the enclave sell ETH once the price reaches your trigger." action={appConfig.tokenOut ? <LinkButton href="/swap" size="sm">New swap</LinkButton> : undefined} />
        )}
        {shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-fg-faint">
                  <th scope="col" className="px-5 py-2 font-medium">Intent</th>
                  <th scope="col" className="px-3 py-2 font-medium">Pair</th>
                  <th scope="col" className="px-3 py-2 font-medium">Input</th>
                  <th scope="col" className="px-3 py-2 font-medium">Trigger (≥)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Net received</th>
                  <th scope="col" className="px-3 py-2 font-medium">Order expiry</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {shown.map((intent) => {
                  const detail = local[intent.id.toLowerCase()];
                  return (
                    <tr key={intent.id} className="align-middle">
                      <td className="px-5 py-3"><Address value={intent.id} head={8} tail={6} /></td>
                      <td className="px-3 py-3 text-fg-muted">
                        {detail ? <><TokenSymbol token={detail.tokenIn} /> → <TokenSymbol token={detail.tokenOut} /></> : <Unavailable label="Not in this tab" />}
                      </td>
                      <td className="px-3 py-3">{detail ? <Amount value={detail.amountIn} token={detail.tokenIn} /> : <Unavailable label="—" />}</td>
                      <td className="px-3 py-3">
                        {detail ? (
                          <span title={`Slippage ${formatBps(detail.maxSlippageBps)} · signed ${formatDateTime(detail.signedAt)}`}>
                            {formatPrice(detail.triggerPrice)} <span className="text-fg-subtle"><TokenSymbol token={detail.tokenOut} />/<TokenSymbol token={detail.tokenIn} /></span>
                          </span>
                        ) : <Unavailable label="—" />}
                      </td>
                      <td className="px-3 py-3"><IntentStatusBadge status={intent.status} /></td>
                      <td className="px-3 py-3">
                        {intent.amountOut !== undefined && appConfig.tokenOut ? <Amount value={intent.amountOut} token={appConfig.tokenOut.address} /> : <Unavailable label="—" />}
                      </td>
                      <td className="px-3 py-3 text-xs text-fg-subtle">
                        {detail ? <span title={`Signed ${formatDateTime(detail.signedAt)}`}>{formatClock(detail.expiresAt)}</span> : <Unavailable label="—" />}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {intent.status === 'pending' && (
                          <Button size="sm" variant="secondary" onClick={() => { cancel.reset(); setCancelling(intent.id as Hex); }} disabled={cancel.isPending}>
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
      <SigningReview
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onConfirm={confirmCancel}
        title="Cancel intent"
        primaryType="CancelIntent"
        pending={cancel.isPending}
        error={cancel.error ? describeError(cancel.error) : undefined}
        rows={cancelling ? [{ label: 'Intent ID', value: <span className="break-all">{cancelling}</span>, mono: true }] : []}
        authorises="Cancelling this pending intent. If the enclave has not started executing it, the reserved ETH returns to your available balance. If it already started or finished, the enclave answers INTENT_NOT_FOUND and nothing changes."
        confirmLabel="Sign cancellation"
      />
    </Card>
  );
}
