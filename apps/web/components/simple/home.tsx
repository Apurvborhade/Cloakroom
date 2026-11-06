'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useBalances } from '@/hooks/use-private-data';
import { useSession } from '@/hooks/use-session';
import { describeError } from '@/lib/api/errors';
import { knownTokens } from '@/lib/config';
import { formatUnitsDisplay } from '@/lib/format/units';
import { BalanceFreshness } from './debug';
import { ActionButton, StatusLine } from './parts';

const ACTIONS: Array<{ href: string; title: string; description: string; icon: string }> = [
  { href: '/deposit', title: 'Deposit', description: 'Add ETH or USDC to your private balance', icon: '↓' },
  { href: '/swap', title: 'Swap', description: 'Swap ETH for USDC from an address not linked to you', icon: '⇄' },
  { href: '/withdraw', title: 'Withdraw', description: 'Send funds to any address', icon: '↑' },
];

function display(value: bigint, decimals: number): string {
  return formatUnitsDisplay(value, decimals, decimals === 18 ? 5 : 3);
}

function TokenBalance({ symbol, decimals, available, onHold }: { symbol: string; decimals: number; available: bigint; onHold: bigint }) {
  return (
    <div className="flex-1 rounded-2xl bg-ink-800 p-4">
      <p className="text-sm text-fg-subtle">{symbol}</p>
      <p className="mt-1 truncate text-3xl font-medium text-fg">{display(available, decimals)}</p>
      {onHold > 0n && <p className="mt-1 text-xs text-fg-subtle">{display(onHold, decimals)} in progress</p>}
    </div>
  );
}

function BalanceBody(): ReactNode {
  const { active } = useSession();
  const balances = useBalances();
  // The button covers connecting, switching network and signing in, whichever is still needed.
  if (!active) {
    return <ActionButton label="" onClick={() => undefined} />;
  }
  if (balances.error) return <StatusLine tone="bad" title="Couldn't load your balance">{describeError(balances.error)}</StatusLine>;
  if (!balances.data) return <div className="h-[104px] animate-pulse rounded-2xl bg-ink-800" aria-label="Loading balance" />;
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row">
      {knownTokens().map((token) => {
        const balance = balances.data.balances.find((item) => item.token.toLowerCase() === token.address.toLowerCase());
        return (
          <TokenBalance
            key={token.address}
            symbol={token.symbol}
            decimals={token.decimals}
            available={balance ? BigInt(balance.available) : 0n}
            onHold={balance ? BigInt(balance.reserved) + BigInt(balance.pending) : 0n}
          />
        );
      })}
    </div>
  );
}

export function Home() {
  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4 pt-4 sm:pt-12">
      <section aria-label="Private balance" className="rounded-3xl border border-ink-700 bg-ink-850 p-2 shadow-panel">
        <div className="flex items-baseline justify-between gap-4 px-3 pb-3 pt-2">
          <h1 className="text-lg font-medium text-fg">Your private balance</h1>
          <span className="text-xs text-fg-subtle"><BalanceFreshness /></span>
        </div>
        <BalanceBody />
      </section>
      <nav aria-label="Actions" className="grid gap-4 sm:grid-cols-3">
        {ACTIONS.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-3xl border border-ink-700 bg-ink-850 p-5 transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-lg text-accent">
              {action.icon}
            </span>
            <span className="mt-4 block text-base font-medium text-fg">{action.title}</span>
            <span className="mt-1 block text-sm text-fg-subtle">{action.description}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
