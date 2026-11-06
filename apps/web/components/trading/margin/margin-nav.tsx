'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS = [
  { href: '/margin', label: 'Trade' },
  { href: '/margin/positions', label: 'Positions' },
];

export function MarginNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Margin" className="mb-4 overflow-x-auto">
      <ul className="flex justify-center gap-1">
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
