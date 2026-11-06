'use client';

import { useEffect, useState } from 'react';
import { formatDuration, nowSec } from '@/lib/format/time';

export function useSecondsLeft(deadline: number | null): number | null {
  const [now, setNow] = useState(nowSec());
  useEffect(() => {
    if (deadline === null) return;
    const timer = setInterval(() => setNow(nowSec()), 1_000);
    return () => clearInterval(timer);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, deadline - now);
}

export function Countdown({ deadline, expiredLabel = 'Expired' }: { deadline: number; expiredLabel?: string }) {
  const left = useSecondsLeft(deadline) ?? 0;
  return <span className="font-mono tabular-nums">{left > 0 ? formatDuration(left) : expiredLabel}</span>;
}
