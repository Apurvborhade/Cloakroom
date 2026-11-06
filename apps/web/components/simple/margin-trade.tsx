'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMarginLendingAction, useMarginOpen } from '@/hooks/use-actions';
import { usePoolPrice } from '@/hooks/use-pool-price';
import { useBalances, useMarginAvailability, useMarginPositions } from '@/hooks/use-private-data';
import { describeError, errorCode } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { appConfig } from '@/lib/config';
import { formatPrice, formatUnitsDisplay, parseUnitsStrict } from '@/lib/format/units';
import { leverageLabel } from '@/lib/margin/positions';
import { marginQuote, marketLimitPrice } from '@/lib/margin/quote';
import { explainAttempt } from '@/lib/swap/attempts';
import type { MarginSide } from '@/lib/margin/quote';
import { Address as AddressText } from '../ui/address';
import { DebugItem, DebugPanel } from './debug';
import { ActionButton, AmountBox, Detail, PrivateBalance, StatusLine } from './parts';

const MIN_LEVERAGE_BPS = 10_000;
const LEVERAGE_STEP_BPS = 2_500;
const DEFAULT_SLIPPAGE = '0.5';

function parseUsdc(text: string, decimals: number): bigint | null {
  if (!text.trim()) return null;
  try {
    const value = parseUnitsStrict(text, decimals);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

/** The percentage typed, as basis points, or null if it isn't a usable number. */
function parseSlippage(text: string, capBps: number): number | null {
  if (!/^\d*\.?\d{0,2}$/.test(text) || !text.trim() || text === '.') return null;
  const bps = Math.round(Number(text) * 100);
  return bps > 0 && bps <= capBps ? bps : null;
}

export function MarginTrade() {
  const usdc = appConfig.tokenOut;
  const maxLeverage = appConfig.marginMaxLeverageBps;
  const [side, setSide] = useState<MarginSide>('long');
  const [collateralText, setCollateralText] = useState('');
  const [leverageBps, setLeverageBps] = useState(Math.min(20_000, maxLeverage));
  const [slippageText, setSlippageText] = useState(DEFAULT_SLIPPAGE);
  const [openedId, setOpenedId] = useState<string | null>(null);

  const price = usePoolPrice();
  const balances = useBalances();
  const positions = useMarginPositions();
  const { availability } = useMarginAvailability();
  const open = useMarginOpen();
  const lend = useMarginLendingAction('supply');

  const decimals = usdc?.decimals ?? 6;
  const collateral = useMemo(() => parseUsdc(collateralText, decimals), [collateralText, decimals]);
  const spot = price.data ?? null;
  const limit = spot !== null ? marketLimitPrice(side, spot) : null;
  const quote = collateral !== null && spot !== null
    ? marginQuote({ side, collateral, leverageBps, price: spot, usdcDecimals: decimals })
    : null;
  const slippageBps = parseSlippage(slippageText, appConfig.maxSlippageBpsCap);

  const held = usdc && balances.data?.balances.find((item) => item.token.toLowerCase() === usdc.address.toLowerCase());
  const available = held ? BigInt(held.available) : null;
  const tooMuch = collateral !== null && available !== null && collateral > available;

  const opened = openedId ? positions.data?.positions.find((item) => item.id === openedId) : undefined;
  const openedStatus = opened?.status ?? (openedId ? 'opening' : null);

  if (!usdc) return <StatusLine tone="bad" title="Margin isn't configured">Set the USDC token address for this app.</StatusLine>;

  const label = availability === 'disabled'
    ? "Margin isn't live on this server yet"
    : open.isPending
      ? 'Check your wallet'
      : collateral === null
        ? (collateralText.trim() ? 'Enter a valid amount' : 'Enter collateral')
        : tooMuch
          ? 'Not enough USDC. Deposit first'
          : limit === null
            ? 'Getting the price…'
            : slippageBps === null
              ? `Slippage must be up to ${appConfig.maxSlippageBpsCap / 100}%`
              : side === 'long' ? 'Open Long' : 'Open Short';

  const canOpen = availability !== 'disabled' && collateral !== null && !tooMuch && limit !== null && slippageBps !== null && !open.isPending;

  const submit = () => {
    if (!canOpen) return;
    open.mutate(
      { side: side === 'long' ? 0 : 1, collateral: collateral!, leverageBps, limitPrice: limit!, maxSlippageBps: slippageBps! },
      {
        onSuccess: (result) => {
          setOpenedId(result.positionId);
          setCollateralText('');
        },
      },
    );
  };

  const shortsEnabled = appConfig.marginShortsEnabled;
  const failure = explainAttempt(opened?.reason);
  // The pool has too little to lend. Funding it from this balance needs the collateral as well.
  const poolShort = open.error && errorCode(open.error) === 'INSUFFICIENT_LIQUIDITY';
  const needed = quote && quote.borrowedToken === 'USDC' ? quote.borrowed : null;
  const canFundPool = poolShort && needed !== null && needed > 0n && collateral !== null && available !== null && available >= collateral + needed;
  const fundPool = () => {
    if (!canFundPool || needed === null) return;
    lend.mutate({ token: usdc.address, amount: needed }, { onSuccess: () => open.reset() });
  };

  const shortRefused = open.error && side === 'short' && errorCode(open.error) === 'UNSUPPORTED_ASSET';
  const fillPercent = maxLeverage > MIN_LEVERAGE_BPS ? ((leverageBps - MIN_LEVERAGE_BPS) * 100) / (maxLeverage - MIN_LEVERAGE_BPS) : 0;
  const marks: number[] = [];
  for (let bps = MIN_LEVERAGE_BPS; bps <= maxLeverage; bps += 10_000) marks.push(bps);

  return (
    <div className="mx-auto w-full max-w-[480px]">
      <div className="space-y-1.5 rounded-3xl border border-ink-700 bg-ink-850 p-2 shadow-panel">
        <div role="tablist" aria-label="Position side" className="grid grid-cols-2 gap-1 rounded-2xl bg-ink-800 p-1">
          {(['long', 'short'] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={side === item}
              disabled={item === 'short' && !shortsEnabled}
              onClick={() => { setSide(item); open.reset(); }}
              className={cn(
                'rounded-xl py-2.5 text-sm font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                side !== item && 'text-fg-subtle hover:text-fg',
                side === item && item === 'long' && 'bg-ok/20 text-ok',
                side === item && item === 'short' && 'bg-bad/20 text-bad',
              )}
            >
              {item}{item === 'short' && !shortsEnabled ? ' · Coming soon' : ''}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl bg-ink-800 p-4">
          <p className="text-sm text-fg-subtle">Market price</p>
          <p className="truncate text-sm font-medium text-fg">
            {spot !== null ? `$${formatPrice(spot, 2)}` : price.isLoading ? 'Loading…' : 'Unavailable'}
          </p>
        </div>

        <AmountBox
          id="margin-collateral"
          label="Collateral"
          symbol={usdc.symbol}
          value={collateralText}
          onChange={setCollateralText}
          footer={<PrivateBalance token={usdc.address} decimals={decimals} symbol={usdc.symbol} onMax={setCollateralText} />}
        />
        <AmountBox
          id="margin-size"
          label="Estimated size"
          symbol="ETH"
          readOnly
          value={quote ? formatUnitsDisplay(quote.sizeEth, 18, 5) : ''}
        />

        <div className="rounded-2xl bg-ink-800 p-4">
          <div className="flex items-center justify-between">
            <label htmlFor="margin-leverage" className="text-xs text-fg-subtle">Leverage</label>
            <span className="text-sm font-medium text-fg">{leverageLabel(leverageBps)}</span>
          </div>
          <input
            id="margin-leverage"
            type="range"
            min={MIN_LEVERAGE_BPS}
            max={maxLeverage}
            step={LEVERAGE_STEP_BPS}
            value={leverageBps}
            aria-valuetext={leverageLabel(leverageBps)}
            onChange={(event) => setLeverageBps(Number(event.target.value))}
            style={{ background: `linear-gradient(to right, var(--leverage-fill) ${fillPercent}%, var(--leverage-track) ${fillPercent}%)` }}
            className="leverage-slider mt-3 w-full"
          />
          <div aria-hidden className="mt-1 flex justify-between text-[11px] text-fg-subtle">
            {marks.map((bps) => <span key={bps}>{bps / 10_000}x</span>)}
          </div>
        </div>

        <div className="py-1">
          <div className="flex items-center justify-between gap-4 px-3 py-1 text-sm">
            <label htmlFor="margin-slippage" className="text-fg-subtle">Slippage</label>
            <span className="flex items-center gap-1 text-fg-muted">
              <input
                id="margin-slippage"
                inputMode="decimal"
                autoComplete="off"
                value={slippageText}
                onChange={(event) => setSlippageText(event.target.value)}
                className="w-12 rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-right outline-none focus:border-accent"
              />
              %
            </span>
          </div>
          {quote && (
            <>
              <Detail label="Position size">{formatUnitsDisplay(quote.sizeUsdc, decimals, 2)} {usdc.symbol}</Detail>
              <Detail label="Borrowed">
                {quote.borrowedToken === 'USDC'
                  ? `${formatUnitsDisplay(quote.borrowed, decimals, 2)} USDC`
                  : `${formatUnitsDisplay(quote.borrowed, 18, 5)} ETH`}
              </Detail>
              <Detail label="Liquidation price">
                {quote.liquidationPrice !== null ? `≈ $${formatPrice(quote.liquidationPrice, 2)}` : 'None at 1x'}
              </Detail>
            </>
          )}
        </div>

        {open.error && !poolShort && (
          <StatusLine tone="bad" title="Position not opened">
            {shortRefused ? "Shorts aren't live on this server yet. Longs work once margin is on." : describeError(open.error)}
          </StatusLine>
        )}
        {poolShort && (
          <StatusLine tone="bad" title="Not enough in the lending pool for this loan">
            {canFundPool && needed !== null ? (
              <span className="block space-y-2">
                <span className="block">You can lend what it needs from your own balance, then open the position. You're taking the lender's risk on that money. Take it back on Deposit after closing.</span>
                <button
                  type="button"
                  disabled={lend.isPending}
                  onClick={fundPool}
                  className="block font-medium text-accent hover:text-accent-strong disabled:opacity-50"
                >
                  {lend.isPending ? 'Check your wallet' : `Lend ${formatUnitsDisplay(needed, decimals, 2)} ${usdc.symbol} to the pool`}
                </button>
              </span>
            ) : (
              'Lower the leverage, or use 1x, which borrows nothing. Your balance is too small to fund this loan yourself as well as the collateral.'
            )}
          </StatusLine>
        )}
        {lend.error && <StatusLine tone="bad" title="Couldn't lend">{describeError(lend.error)}</StatusLine>}
        {openedStatus === 'opening' && <StatusLine tone="working" title="Opening your position">The swap is running. This usually takes under a minute.</StatusLine>}
        {openedStatus === 'open' && (
          <StatusLine tone="ok" title="Position open">
            <Link href="/margin/positions" className="font-medium text-accent hover:text-accent-strong">View your positions</Link>
          </StatusLine>
        )}
        {openedStatus === 'failed' && (
          <StatusLine tone="bad" title={failure?.title ?? "Position didn't open"}>
            {failure ? `${failure.detail} ${failure.action}` : "The swap didn't complete, and your collateral was returned."}
          </StatusLine>
        )}

        {opened && openedId && (
          <DebugPanel summary="Position details">
            <dl className="space-y-0.5">
              <DebugItem label="Status"><code className="font-mono">{opened.status}</code></DebugItem>
              {opened.reason && <DebugItem label="Reason"><code className="font-mono">{opened.reason}</code></DebugItem>}
              {opened.entryPrice && <DebugItem label="Entry price">${formatPrice(opened.entryPrice, 2)}</DebugItem>}
              {opened.liquidationPrice && <DebugItem label="Liquidation price">${formatPrice(opened.liquidationPrice, 2)}</DebugItem>}
              <DebugItem label="Position ID"><AddressText value={openedId} head={10} tail={8} /></DebugItem>
            </dl>
          </DebugPanel>
        )}

        <ActionButton
          label={label}
          onClick={submit}
          disabled={!canOpen}
          loading={open.isPending}
          className={canOpen ? (side === 'long' ? '!bg-ok hover:!bg-ok/85' : '!bg-bad hover:!bg-bad/85') : undefined}
        />
      </div>
      <p className="mt-3 px-3 text-center text-xs text-fg-subtle">
        If the price crosses your liquidation price, the position closes automatically. These swaps are public and larger than a normal trade.
      </p>
    </div>
  );
}
