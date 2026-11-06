'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { appConfig } from '@/lib/config';
import { AttestationBadge } from '../dashboard/attestation-badge';
import { NetworkBadge } from '../wallet/network-badge';
import { WalletButton } from '../wallet/wallet-button';
import { WrongChainBanner } from '../wallet/wrong-chain-banner';
import { ConfigBanner } from './config-banner';
import { Logo } from './logo';
import { SimBanner } from './sim-banner';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/deposit', label: 'Deposit' },
  { href: '/swap', label: 'Swap' },
  { href: '/withdraw', label: 'Withdraw' },
  ...(appConfig.marginUi === 'off' ? [] : [{ href: '/margin', label: 'Margin' }]),
  { href: '/attestation', label: 'Attestation' },
  { href: '/diagnostics', label: 'Diagnostics' },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink-800 focus:px-3 focus:py-2">
        Skip to content
      </a>
      <SimBanner />
      <ConfigBanner />
      <WrongChainBanner />
      <header className="sticky top-0 z-40 border-b border-ink-700 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-8">
            <Link href="/" aria-label="Cloakroom dashboard">
              <Logo />
            </Link>
            <nav aria-label="Primary" className="hidden lg:block">
              <ul className="flex items-center gap-1">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-sm transition-colors',
                        isActive(pathname, item.href) ? 'bg-ink-800 text-fg' : 'text-fg-subtle hover:text-fg',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <AttestationBadge />
            </div>
            <NetworkBadge />
            <WalletButton />
          </div>
        </div>
        <nav aria-label="Primary mobile" className="border-t border-ink-800 lg:hidden">
          <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 py-2">
            {NAV.map((item) => (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={cn('block rounded-md px-3 py-1.5 text-xs', isActive(pathname, item.href) ? 'bg-ink-800 text-fg' : 'text-fg-subtle')}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-fg-faint sm:px-6">
          <p>
            Cloakroom is not a mixer and does not make transactions invisible. Amounts and timing are public on-chain; the enclave and its operator are part of the trust model.
          </p>
          <p>No analytics. No trackers.</p>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-subtle">{description}</p>}
      </div>
      {action}
    </div>
  );
}
