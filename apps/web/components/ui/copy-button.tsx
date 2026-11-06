'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 1_500);
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={cn('rounded-md border border-ink-600 px-2 py-0.5 text-[11px] font-medium text-fg-muted transition-colors hover:border-ink-500 hover:text-fg', className)}
      aria-label={`${label}: ${state === 'copied' ? 'copied' : 'copy to clipboard'}`}
    >
      {state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label}
    </button>
  );
}
