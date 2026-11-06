'use client';

import { useState } from 'react';
import type { Address } from 'viem';
import { useMarginLendingAction } from '@/hooks/use-actions';
import { useMarginLending } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { formatUnitsDisplay } from '@/lib/format/units';
import { lendingChange } from '@/lib/margin/lending';

/** A target, not a rate anyone receives: the enclave charges and pays no interest yet. */
export const PLANNED_LENDING_APY = '7%';

/**
 * Information about lending to margin traders, with no way to opt in here. Funds someone has already
 * lent can still be taken back, because they couldn't be withdrawn otherwise.
 */
export function LendingOption({ token, symbol, decimals }: { token: Address; symbol: string; decimals: number }) {
  const lending = useMarginLending();
  const redeem = useMarginLendingAction('redeem');
  const [showInfo, setShowInfo] = useState(false);

  const pool = lending.data?.lending.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const supplied = pool ? BigInt(pool.supplied) : 0n;
  const change = lendingChange({ available: 0n, supplied, poolAvailable: pool ? BigInt(pool.available) : 0n }, 0);
  const show = (value: bigint) => formatUnitsDisplay(value, decimals, decimals === 18 ? 5 : 3);

  return (
    <section aria-label="Lending" className="mt-3 px-3 text-xs text-fg-subtle">
      <p className="flex flex-wrap items-center gap-1.5">
        <span>Lending to margin traders: {PLANNED_LENDING_APY} APY (planned, not paid yet)</span>
        <button
          type="button"
          aria-expanded={showInfo}
          aria-label="What are the risks of lending?"
          onClick={() => setShowInfo((value) => !value)}
          className="flex h-4 w-4 items-center justify-center rounded-full border border-ink-500 text-[10px] text-fg-muted hover:border-accent hover:text-accent"
        >
          ?
        </button>
      </p>

      {showInfo && (
        <div className="mt-2 space-y-1.5 text-fg-muted">
          <p>Traders borrow lent funds to open positions, which close automatically if they fall too far.</p>
          <p><span className="text-bad">Lenders can lose money.</span> If the price moves too fast, closing a position may not cover its loan.</p>
          <p>Funds out on loan can't be withdrawn until they're repaid, and a loss freezes withdrawals from the pool until it's resolved.</p>
          <p>No interest is paid yet. {PLANNED_LENDING_APY} is a planned rate, not a promise. Nothing here is insured.</p>
        </div>
      )}

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
