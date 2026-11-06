'use client';

import { useEffect, useRef, useState } from 'react';
import { useActivity } from '@/hooks/use-activity';
import { appConfig } from '@/lib/config';
import { formatClock } from '@/lib/format/time';
import { formatPrice, formatUnitsDisplay } from '@/lib/format/units';
import { explainAttempt } from '@/lib/swap/attempts';
import { Address } from '../ui/address';
import { Countdown } from '../ui/countdown';
import { BalanceFreshness, DebugItem as Item, DebugPanel, Elapsed } from './debug';

interface StatusChange {
  status: string;
  at: number;
}

const MAX_CHANGES = 12;

/** The status changes this tab has seen. The server only ever reports the current one. */
function useStatusChanges(id: string, status: string): StatusChange[] {
  const [changes, setChanges] = useState<StatusChange[]>([]);
  const owner = useRef(id);
  useEffect(() => {
    setChanges((current) => {
      const previous = owner.current === id ? current : [];
      owner.current = id;
      if (previous.at(-1)?.status === status) return previous;
      return [...previous, { status, at: Math.floor(Date.now() / 1000) }].slice(-MAX_CHANGES);
    });
  }, [id, status]);
  return changes;
}

const LABEL: Record<string, string> = {
  pending: 'Waiting',
  executing: 'Swapping',
  done: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/**
 * Debugging detail for the current swap. `attempts` and `reason` come from the server, and an older
 * server omits them; the status history is what this tab saw, so it starts when the tab did.
 */
export function SwapDetails({
  id,
  status,
  attempts,
  reason,
  poolPrice,
  placedAt,
}: {
  id: string;
  status: string;
  attempts?: number;
  reason?: string;
  poolPrice: bigint | null;
  /** Unix seconds. Set while this tab knows when the order was placed. */
  placedAt?: number;
}) {
  const changes = useStatusChanges(id, status);
  const open = status === 'pending' || status === 'executing';
  const local = useActivity().intents[id.toLowerCase()];
  const explanation = explainAttempt(reason);
  const tokenOut = appConfig.tokenOut;
  const retries = changes.filter((change, index) => change.status === 'pending' && changes[index - 1]?.status === 'executing').length;

  return (
    <DebugPanel
      defaultOpen
      summary={`Swap details${attempts ? ` · ${attempts} ${attempts === 1 ? 'try' : 'tries'}` : retries > 0 ? ` · ${retries} ${retries === 1 ? 'retry' : 'retries'} seen` : ''}`}
    >
      <dl className="space-y-0.5">
        <Item label="Status">{LABEL[status] ?? status}</Item>
        {placedAt !== undefined && open && <Item label="Time so far"><Elapsed fromSec={placedAt} /></Item>}
        <Item label="Balance updated"><BalanceFreshness /></Item>
        <Item label="Tries on the server">{attempts ?? 'Not reported'}</Item>
        <Item label="Last result">{reason ? <code className="font-mono">{reason}</code> : attempts === undefined ? 'Not reported by this server' : 'None yet'}</Item>
        {local && (
          <>
            <Item label="Selling">{formatUnitsDisplay(local.amountIn, 18, 5)} ETH</Item>
            <Item label="Your trigger">{formatPrice(local.triggerPrice, 2)} {tokenOut?.symbol}</Item>
            {poolPrice !== null && <Item label="Pool price now">{formatPrice(poolPrice, 2)} {tokenOut?.symbol}</Item>}
            <Item label="Max slippage">{(local.maxSlippageBps / 100).toFixed(2)}%</Item>
            <Item label="Signed at">{formatClock(local.signedAt)}</Item>
            <Item label="Expires in"><Countdown deadline={local.expiresAt} expiredLabel="Expired" /></Item>
          </>
        )}
        <Item label="Order ID"><Address value={id} head={10} tail={8} /></Item>
      </dl>

      {explanation && (
        <div className="mt-3 border-t border-ink-700 pt-3">
          <p className="font-medium text-fg">{explanation.title}</p>
          <p className="mt-1 text-fg-subtle">{explanation.detail}</p>
          <p className="mt-1 text-fg-muted">{explanation.action}</p>
        </div>
      )}

      {changes.length > 0 && (
        <div className="mt-3 border-t border-ink-700 pt-3">
          <p className="mb-1 text-fg-subtle">Status changes seen in this tab</p>
          <ol className="space-y-0.5 font-mono">
            {changes.map((change, index) => (
              <li key={`${change.at}-${index}`} className="flex justify-between gap-4 text-fg-muted">
                <span>{LABEL[change.status] ?? change.status}</span>
                <span className="text-fg-subtle">{formatClock(change.at)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </DebugPanel>
  );
}
