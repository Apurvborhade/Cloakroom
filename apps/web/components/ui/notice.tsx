import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'info' | 'warn' | 'error' | 'ok';
const TONES: Record<Tone, string> = {
  info: 'border-accent/25 bg-accent-soft text-fg',
  warn: 'border-warn/30 bg-warn/[0.07] text-fg',
  error: 'border-bad/30 bg-bad/[0.07] text-fg',
  ok: 'border-ok/30 bg-ok/[0.07] text-fg',
};
const MARKS: Record<Tone, string> = { info: 'text-accent', warn: 'text-warn', error: 'text-bad', ok: 'text-ok' };

export function Notice({ tone = 'info', title, children, className, action }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm', TONES[tone], className)}>
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current', MARKS[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
