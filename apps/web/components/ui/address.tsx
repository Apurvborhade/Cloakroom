'use client';

import { useState } from 'react';
import { truncateMiddle } from '@/lib/format/address';
import { cn } from '@/lib/cn';
import { CopyButton } from './copy-button';

/** Truncated by default; the full value is one click away and always in the title and copy. */
export function Address({ value, head = 6, tail = 4, copy = true, className, href }: { value: string; head?: number; tail?: number; copy?: boolean; className?: string; href?: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const text = expanded ? value : truncateMiddle(value, head, tail);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-2', className)}>
      <button
        type="button"
        title={value}
        onClick={() => setExpanded((open) => !open)}
        className={cn('font-mono text-xs text-fg hover:text-accent', expanded && 'break-all text-left')}
        aria-label={expanded ? `Collapse ${value}` : `Show full value ${value}`}
      >
        {text}
      </button>
      {copy && <CopyButton value={value} />}
      {href && (
        <a href={href} target="_blank" rel="noreferrer noopener" className="text-[11px] text-accent hover:underline">
          Explorer ↗
        </a>
      )}
    </span>
  );
}
