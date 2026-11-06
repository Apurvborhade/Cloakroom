import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function KeyValue({ label, children, className, mono = false }: { label: ReactNode; children: ReactNode; className?: string; mono?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2 text-sm', className)}>
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className={cn('min-w-0 text-right text-fg', mono && 'font-mono text-xs leading-5')}>{children}</dd>
    </div>
  );
}

export function KeyValueList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn('divide-y divide-ink-700', className)}>{children}</dl>;
}

/** Shown for optional fields the backend did not provide. Never rendered as zero. */
export function Unavailable({ label = 'Unavailable' }: { label?: string }) {
  return <span className="text-fg-faint">{label}</span>;
}
