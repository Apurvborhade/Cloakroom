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
import { AnonRpcBadge } from './anon-rpc-badge';
import { AnonRpcBanner } from './anon-rpc-banner';
import { ConfigBanner } from './config-banner';
import { Logo } from './logo';
import { SimBanner } from './sim-banner';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/swap', label: 'Swap' },
  { href: '/deposit', label: 'Deposit' },
  { href: '/withdraw', label: 'Withdraw' },
];

/** Kept for testing and verification, out of the way of the three main actions. */
const MORE = [
  { href: '/activity', label: 'Activity' },
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
      <AnonRpcBanner />
      <WrongChainBanner />
      <header className="sticky top-0 z-40 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-8">
            <Link href="/" aria-label="Cloakroom home">
              <Logo />
            </Link>
            <nav aria-label="Primary" className="hidden sm:block">
              <ul className="flex items-center gap-1">
                {NAV.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-base transition-colors',
                        isActive(pathname, item.href) ? 'text-fg' : 'text-fg-subtle hover:text-fg',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden xl:block">
              <AttestationBadge />
            </div>
            <AnonRpcBadge />
            <NetworkBadge />
            <WalletButton />
          </div>
        </div>
        <nav aria-label="Primary mobile" className="sm:hidden">
          <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 py-2">
            {NAV.map((item) => (
              <li key={item.href} className="shrink-0">
                <Link
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={cn('block rounded-full px-3 py-1.5 text-sm', isActive(pathname, item.href) ? 'text-fg' : 'text-fg-subtle')}
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
      <footer>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-[11px] text-fg-faint sm:px-6">
          <p>Not a mixer. Amounts and timing are public on-chain, and you are trusting the enclave and its operator.</p>
          <nav aria-label="More" className="flex flex-wrap gap-3">
            {MORE.map((item) => <Link key={item.href} href={item.href} className="hover:text-fg-muted">{item.label}</Link>)}
          </nav>
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
