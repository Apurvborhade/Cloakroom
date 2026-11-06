'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS = [
  { href: '/margin', label: 'Overview' },
  { href: '/margin/trade', label: 'Open position' },
  { href: '/margin/positions', label: 'Positions' },
  { href: '/margin/lending', label: 'Lending' },
];

export function MarginNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Margin" className="mb-6 overflow-x-auto">
      <ul className="flex gap-1 border-b border-ink-700">
        {TABS.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={pathname === tab.href ? 'page' : undefined}
              className={cn('-mb-px block whitespace-nowrap border-b-2 px-4 py-2 text-sm', pathname === tab.href ? 'border-accent text-fg' : 'border-transparent text-fg-subtle hover:text-fg')}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
