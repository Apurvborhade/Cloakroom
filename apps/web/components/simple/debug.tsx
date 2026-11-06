'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useBalances } from '@/hooks/use-private-data';

function useNowSec(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Seconds since a moment, as `42s` or `2m 05s`. Never negative if the clocks disagree slightly. */
export function formatElapsed(fromSec: number, nowSec: number): string {
  const total = Math.max(0, nowSec - fromSec);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

export function Elapsed({ fromSec }: { fromSec: number }) {
  return <>{formatElapsed(fromSec, useNowSec())}</>;
}

/** How fresh the balance on screen is, which shows that it is still updating. */
export function BalanceFreshness() {
  const { dataUpdatedAt } = useBalances();
  const now = useNowSec();
  if (!dataUpdatedAt) return null;
  return <>{formatElapsed(Math.floor(dataUpdatedAt / 1000), now)} ago</>;
}

export function DebugItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 break-words text-right text-fg-muted">{children}</dd>
    </div>
  );
}

export function DebugPanel({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded-2xl bg-ink-800 px-4 py-3 text-xs"
    >
      <summary className="cursor-pointer select-none text-sm font-medium text-fg-muted">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
