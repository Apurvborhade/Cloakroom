'use client';

import { useEffect, useState } from 'react';
import type { Address } from 'viem';
import { useMarginLendingAction } from '@/hooks/use-actions';
import { useBalances, useMarginAvailability, useMarginLending } from '@/hooks/use-private-data';
import { useSession } from '@/hooks/use-session';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { formatUnitsDisplay } from '@/lib/format/units';
import { lendingChange, lentPercent } from '@/lib/margin/lending';
import { Button } from '../ui/button';
import { StatusLine } from './parts';

const PERCENTS = [25, 50, 75, 100];

/**
 * Opting in to lend part of a balance to margin traders. It sits on the withdraw screen because lent
 * funds can't be withdrawn until they come back. Ticking the box moves nothing: only the button does.
 */
export function LendingOption({ token, symbol, decimals }: { token: Address; symbol: string; decimals: number }) {
  const { active } = useSession();
  const { availability } = useMarginAvailability();
  const balances = useBalances();
  const lending = useMarginLending();
  const supply = useMarginLendingAction('supply');
  const redeem = useMarginLendingAction('redeem');
  const [showInfo, setShowInfo] = useState(false);
  const [choice, setChoice] = useState<{ token: Address; checked: boolean; percent: number } | null>(null);

  const balance = balances.data?.balances.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const pool = lending.data?.lending.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const position = {
    available: balance ? BigInt(balance.available) : 0n,
    supplied: pool ? BigInt(pool.supplied) : 0n,
    poolAvailable: pool ? BigInt(pool.available) : 0n,
  };
  const current = lentPercent(position);

  // A choice belongs to one token: switching token starts again from what is lent there.
  useEffect(() => {
    setChoice(null);
  }, [token]);

  const unavailable = availability === 'disabled';
  const checked = choice?.checked ?? position.supplied > 0n;
  const percent = choice?.percent ?? (current > 0 ? current : 25);
  const change = lendingChange(position, checked ? percent : 0);
  const action = change.action === 'redeem' ? redeem : supply;
  const pending = supply.isPending || redeem.isPending;
  const error = supply.error ?? redeem.error;
  const atRisk = ((position.available + position.supplied) * BigInt(checked ? percent : 0)) / 100n;
  const show = (value: bigint) => formatUnitsDisplay(value, decimals, decimals === 18 ? 5 : 3);

  if (!active) return null;

  const submit = () => {
    if (change.action === 'none') return;
    action.mutate({ token, amount: change.amount }, { onSuccess: () => setChoice(null) });
  };

  return (
    <section aria-label="Lending" className="mt-4 rounded-3xl border border-ink-700 bg-ink-850 p-4">
      <div className="flex items-start justify-between gap-3">
        <label className={cn('flex items-center gap-3 text-sm font-medium text-fg', unavailable ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
          <input
            type="checkbox"
            checked={checked}
            disabled={unavailable}
            onChange={(event) => setChoice({ token, checked: event.target.checked, percent })}
            className="h-4 w-4 accent-[#8b9bff]"
          />
          Lend my {symbol} to margin traders
        </label>
        <button
          type="button"
          aria-expanded={showInfo}
          aria-label="What are the risks of lending?"
          onClick={() => setShowInfo((value) => !value)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink-500 text-xs text-fg-muted hover:border-accent hover:text-accent"
        >
          ?
        </button>
      </div>

      {showInfo && (
        <div className="mt-3 space-y-2 rounded-2xl bg-ink-800 p-3 text-xs text-fg-muted">
          <p><span className="font-medium text-fg">What it is:</span> traders borrow your funds to open positions. Every position has collateral and closes automatically if it falls too far.</p>
          <p><span className="font-medium text-bad">You can lose money.</span> If the price moves too fast, closing a position may not cover its loan, and that loss falls on the lending pool.</p>
          <p><span className="font-medium text-fg">You may have to wait.</span> Funds out on loan can't be withdrawn until they're repaid. After a loss, withdrawals from the pool freeze until it's resolved.</p>
          <p><span className="font-medium text-fg">You earn nothing right now.</span> No interest is paid yet, so this adds risk with no return.</p>
          <p><span className="font-medium text-fg">You're trusting the operator.</span> The enclave and its operator run all of this, and none of it is insured.</p>
        </div>
      )}

      {unavailable && <p className="mt-2 text-xs text-fg-subtle">Margin isn't live on this server yet, so lending is off.</p>}

      {checked && !unavailable && (
        <div className="mt-3">
          <p className="text-xs text-fg-subtle">How much of your {symbol} to put at risk</p>
          <div role="radiogroup" aria-label="Share of balance to lend" className="mt-1.5 grid grid-cols-4 gap-1.5">
            {PERCENTS.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={percent === value}
                onClick={() => setChoice({ token, checked: true, percent: value })}
                className={cn(
                  'rounded-xl py-1.5 text-sm font-medium transition-colors',
                  percent === value ? 'bg-accent-soft text-accent' : 'bg-ink-800 text-fg-subtle hover:text-fg',
                )}
              >
                {value}%
              </button>
            ))}
          </div>
        </div>
      )}

      {!unavailable && (
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-subtle">Lent now</dt>
            <dd className="text-fg-muted">{show(position.supplied)} {symbol}</dd>
          </div>
          {checked && (
            <div className="flex justify-between gap-4">
              <dt className="text-fg-subtle">At risk after this</dt>
              <dd className="text-fg-muted">{show(atRisk)} {symbol} ({percent}%)</dd>
            </div>
          )}
        </dl>
      )}

      {change.limited && !unavailable && (
        <p className="mt-2 text-xs text-warn">
          {change.action === 'none' ? 'All of this is out on loan, so none can come back yet.' : 'Part of this is out on loan, so only some can come back now.'}
        </p>
      )}
      {error && <div className="mt-2"><StatusLine tone="bad" title="Lending not changed">{describeError(error)}</StatusLine></div>}

      {change.action !== 'none' && !unavailable && (
        <Button size="md" variant="secondary" className="mt-3 w-full" loading={pending} disabled={pending} onClick={submit}>
          {pending ? 'Check your wallet' : change.action === 'supply' ? `Lend ${show(change.amount)} ${symbol}` : `Take back ${show(change.amount)} ${symbol}`}
        </Button>
      )}
    </section>
  );
}
