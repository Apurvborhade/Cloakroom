'use client';

import { useState } from 'react';
import type { Address } from 'viem';
import { useMarginLendingAction } from '@/hooks/use-actions';
import { useMarginLending } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { formatUnitsDisplay } from '@/lib/format/units';
import { lendingChange } from '@/lib/margin/lending';

/** A target, not a rate anyone receives: the enclave charges and pays no interest yet. */
export const PLANNED_LENDING_APY = '7%';

interface LendingOptionProps {
  token: Address;
  symbol: string;
  decimals: number;
  /** Lend this deposit once it is credited. Off unless the user turns it on. */
  lendDeposit: boolean;
  onLendDepositChange: (on: boolean) => void;
  /** The deposit has finished, so the switch can no longer change what happens to it. */
  locked?: boolean;
}

/**
 * The switch to lend a deposit to margin traders, with the risks one hover or tap away. Funds someone
 * has already lent can be taken back here too, because they couldn't be withdrawn otherwise.
 */
export function LendingOption({ token, symbol, decimals, lendDeposit, onLendDepositChange, locked = false }: LendingOptionProps) {
  const lending = useMarginLending();
  const redeem = useMarginLendingAction('redeem');
  const [hovering, setHovering] = useState(false);
  // Touch screens have no hover, so a tap keeps the risks open.
  const [pinned, setPinned] = useState(false);
  const showInfo = hovering || pinned;

  const pool = lending.data?.lending.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const supplied = pool ? BigInt(pool.supplied) : 0n;
  const change = lendingChange({ available: 0n, supplied, poolAvailable: pool ? BigInt(pool.available) : 0n }, 0);
  const show = (value: bigint) => formatUnitsDisplay(value, decimals, decimals === 18 ? 5 : 3);

  return (
    <section aria-label="Lending" className="mt-3 px-3 text-xs text-fg-subtle">
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={lendDeposit}
          aria-label="Lend this deposit to margin traders"
          disabled={locked}
          onClick={() => onLendDepositChange(!lendDeposit)}
          className={cn(
            'relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:opacity-50',
            lendDeposit ? 'bg-accent' : 'bg-ink-500',
          )}
        >
          <span className={cn('absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white transition-transform', lendDeposit && 'translate-x-3')} />
        </button>
        <span>Lend to margin traders: {PLANNED_LENDING_APY} APY (planned, not paid yet)</span>
        <span className="relative" onMouseEnter={() => setHovering(true)} onMouseLeave={() => setHovering(false)}>
          <button
            type="button"
            aria-expanded={showInfo}
            aria-label="What are the risks of lending?"
            onClick={() => setPinned((value) => !value)}
            onFocus={() => setHovering(true)}
            onBlur={() => setHovering(false)}
            className="flex h-4 w-4 items-center justify-center rounded-full border border-ink-500 text-[10px] text-fg-muted hover:border-accent hover:text-accent"
          >
            ?
          </button>
          {showInfo && (
            <div role="tooltip" className="absolute bottom-full right-0 z-20 w-72 pb-2">
              <div className="space-y-1.5 rounded-xl border border-ink-600 bg-ink-800 p-3 text-fg-muted shadow-panel">
                <p>Traders borrow lent funds to open positions, which close automatically if they fall too far.</p>
                <p><span className="text-bad">Lenders can lose money.</span> If the price moves too fast, closing a position may not cover its loan.</p>
                <p>Funds out on loan can't be withdrawn until they're repaid, and a loss freezes withdrawals from the pool until it's resolved.</p>
                <p>No interest is paid yet. {PLANNED_LENDING_APY} is a planned rate, not a promise. Nothing here is insured.</p>
              </div>
            </div>
          )}
        </span>
      </div>

      {lendDeposit && !locked && <p className="mt-1.5">Once your deposit arrives, your wallet asks you to sign once more to lend it.</p>}

      {supplied > 0n && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5">
          <span>You have {show(supplied)} {symbol} lent.</span>
          {change.action === 'redeem' && (
            <button
              type="button"
              disabled={redeem.isPending}
              onClick={() => redeem.mutate({ token, amount: change.amount })}
              className="font-medium text-accent hover:text-accent-strong disabled:opacity-50"
            >
              {redeem.isPending ? 'Check your wallet' : `Take back ${show(change.amount)} ${symbol}`}
            </button>
          )}
          {change.limited && <span className="text-warn">The rest is out on loan.</span>}
        </p>
      )}
      {redeem.error && <p role="alert" className="mt-1 text-bad">{describeError(redeem.error)}</p>}
    </section>
  );
}
