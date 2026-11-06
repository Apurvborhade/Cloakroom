'use client';

import { NATIVE } from '@cloakroom/shared';
import { useEffect, useMemo, useState } from 'react';
import { MAX_INTENT_LIFETIME_SEC, useCreateIntent } from '@/hooks/use-actions';
import { useChainReadStatus } from '@/hooks/use-chain-reader';
import { usePoolPrice } from '@/hooks/use-pool-price';
import { useBalances, useIntentStatuses } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { isStepInput } from '@/lib/format/steps';
import { formatPrice, formatUnitsDisplay, minimumOutForLimit, parseUnitsStrict } from '@/lib/format/units';
import { chooseTrigger } from '@/lib/swap/trigger';
import { explainAttempt } from '@/lib/swap/attempts';
import { CancelButton, RecentSwaps, useCancelSwap } from './recent-history';
import { SwapDetails } from './swap-details';
import { ActionButton, AmountBox, Detail, PrivateBalance, SimpleCard, StatusLine } from './parts';

const MAX_SLIPPAGE_BPS = 100;
const BPS = 10_000n;
/** After this long a pending order is probably waiting on pool funds, not on the next price check. */
const SLOW_AFTER_MS = 120_000;

function parseAmount(text: string): bigint | null {
  if (!text.trim()) return null;
  try {
    const value = parseUnitsStrict(text, 18);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export function SimpleSwap() {
  const tokenOut = appConfig.tokenOut;
  const [amount, setAmount] = useState('');
  const [triggerText, setTriggerText] = useState('');
  const [order, setOrder] = useState<{ id: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const price = usePoolPrice();
  const chain = useChainReadStatus();
  const balances = useBalances();
  const statuses = useIntentStatuses();
  const create = useCreateIntent();
  const cancel = useCancelSwap();

  const amountIn = useMemo(() => parseAmount(amount), [amount]);
  const invalid = amount.trim() !== '' && amountIn === null;
  const eth = balances.data?.balances.find((item) => item.token.toLowerCase() === NATIVE);
  const available = eth ? BigInt(eth.available) : null;
  const tooMuch = amountIn !== null && available !== null && amountIn > available;
  const overLimit = amountIn !== null && amountIn > appConfig.maxAmountNativeWei;

  const current = order ? statuses.data?.intents.find((item) => item.id === order.id) : undefined;
  const status = current?.status ?? (order ? 'pending' : null);
  const open = status === 'pending' || status === 'executing';
  const attempt = open ? explainAttempt(current?.reason) : null;

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [open]);

  // The balance otherwise refreshes on a slow timer, which makes a finished swap look unfinished.
  const finished = status !== null && !open;
  const refetchBalances = balances.refetch;
  useEffect(() => {
    if (finished) void refetchBalances();
  }, [finished, refetchBalances]);

  if (!tokenOut) return <SimpleCard title="Swap"><StatusLine tone="bad" title="Swaps aren't configured" /></SimpleCard>;

  const spot = price.data ?? null;
  const choice = chooseTrigger(triggerText, spot, appConfig.feeBps);
  const limit = choice.trigger;
  const feeKept = BPS - BigInt(appConfig.feeBps);
  const estimate = amountIn !== null && spot !== null ? (minimumOutForLimit(amountIn, spot, tokenOut.decimals) * feeKept) / BPS : null;
  const minimum = amountIn !== null && limit !== null ? minimumOutForLimit(amountIn, limit, tokenOut.decimals) : null;
  const canSwap = amountIn !== null && limit !== null && !tooMuch && !overLimit && !open;

  const label = invalid
    ? 'Enter a valid amount'
    : amountIn === null
      ? 'Enter an amount'
      : tooMuch
        ? 'Not enough ETH. Deposit first'
        : overLimit
          ? `Max ${formatUnitsDisplay(appConfig.maxAmountNativeWei, 18)} ETH per swap`
          : choice.invalid
            ? 'Enter a valid trigger price'
            : limit === null
              ? (chain.state === 'starting' || price.isLoading ? 'Getting the price privately…' : 'Price unavailable. Enter a trigger price')
              : open
                ? 'Swapping…'
                : create.isPending
                  ? 'Check your wallet'
                  : 'Swap';

  const submit = () => {
    if (!canSwap) return;
    create.mutate(
      {
        tokenIn: NATIVE,
        tokenOut: tokenOut.address,
        amountIn: amountIn!,
        triggerPrice: limit!,
        comparator: 0,
        maxSlippageBps: Math.min(MAX_SLIPPAGE_BPS, appConfig.maxSlippageBpsCap),
        lifetimeSec: MAX_INTENT_LIFETIME_SEC,
      },
      {
        onSuccess: (result) => {
          setOrder({ id: result.intentId, at: Date.now() });
          setNow(Date.now());
          setAmount('');
          setTriggerText('');
        },
      },
    );
  };

  return (
    <SimpleCard title="Swap" after={<RecentSwaps />}>
      <AmountBox
        id="swap-sell"
        label="Sell"
        symbol="ETH"
        value={amount}
        onChange={setAmount}
        footer={<PrivateBalance token={NATIVE} decimals={18} symbol="ETH" onMax={setAmount} />}
      />
      <AmountBox
        id="swap-buy"
        label="Buy"
        symbol={tokenOut.symbol}
        readOnly
        value={estimate !== null ? formatUnitsDisplay(estimate, tokenOut.decimals, 2) : ''}
        footer={<PrivateBalance token={tokenOut.address} decimals={tokenOut.decimals} symbol={tokenOut.symbol} onMax={() => undefined} />}
      />
      <div className="py-1">
        <Detail label="Price">
          {spot !== null
            ? `1 ETH ≈ ${formatPrice(spot, 2)} ${tokenOut.symbol}`
            : price.isLoading || chain.state === 'starting' ? 'Connecting privately…' : 'Unavailable'}
        </Detail>
        <div className="flex items-center justify-between gap-4 px-3 py-1 text-sm">
          <label htmlFor="swap-trigger" className="shrink-0 text-fg-subtle">Trigger price</label>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {!choice.isAuto && (
              <button type="button" className="shrink-0 text-xs font-medium text-accent hover:text-accent-strong" onClick={() => setTriggerText('')}>
                Use auto
              </button>
            )}
            <input
              id="swap-trigger"
              inputMode="decimal"
              autoComplete="off"
              aria-describedby="swap-trigger-unit"
              placeholder={limit !== null && choice.isAuto ? `Auto · ${formatPrice(limit, 2).replace(/,/g, '')}` : 'Auto'}
              value={triggerText}
              onChange={(event) => {
                if (isStepInput(event.target.value)) setTriggerText(event.target.value);
              }}
              className="w-36 min-w-0 rounded-lg border border-ink-600 bg-ink-800 px-2 py-1 text-right text-fg-muted outline-none placeholder:text-fg-subtle focus:border-accent"
            />
            <span id="swap-trigger-unit" className="shrink-0 text-fg-subtle">{tokenOut.symbol}</span>
          </div>
        </div>
        {minimum !== null && (
          <Detail label="You get at least">{formatUnitsDisplay(minimum, tokenOut.decimals, 2)} {tokenOut.symbol}</Detail>
        )}
        <Detail label="Fee">{(appConfig.feeBps / 100).toFixed(2)}%</Detail>
      </div>

      {choice.aboveMarket && (
        <StatusLine tone="working" title="This trigger is above what the swap can pay right now">
          The swap only runs if the price rises to it. If that doesn't happen within about 4.5 minutes, the order ends and your ETH comes back.
        </StatusLine>
      )}
      {create.error && <StatusLine tone="bad" title="Swap not sent">{describeError(create.error)}</StatusLine>}
      {open && order && (
        <StatusLine tone="working" title="Swapping">
          {attempt
            ? `${attempt.title}. ${attempt.action}`
            : now - order.at < SLOW_AFTER_MS
            ? 'This usually takes a minute or two. You can leave this page open.'
            : "This is taking longer than usual. The pool may not have enough funds to run it yet. If it doesn't fill, your ETH comes back."}
          {status === 'pending' && (
            <div className="mt-3">
              <CancelButton onClick={() => cancel.start(order.id)} pending={cancel.isCancelling(order.id)} disabled={cancel.busy} />
            </div>
          )}
        </StatusLine>
      )}
      {cancel.error && <StatusLine tone="bad" title="Couldn't cancel">{describeError(cancel.error)}</StatusLine>}
      {status === 'done' && (
        <StatusLine tone="ok" title="Swap complete">
          {current?.amountOut
            ? `You received ${formatUnitsDisplay(current.amountOut, tokenOut.decimals, 2)} ${tokenOut.symbol}.`
            : 'Your balance has been updated.'}
        </StatusLine>
      )}
      {status === 'expired' && <StatusLine tone="bad" title="Swap didn't fill in time">Your ETH is back in your balance. You can try again.</StatusLine>}
      {status === 'failed' && <StatusLine tone="bad" title="Swap failed">Check your balance, then try again.</StatusLine>}
      {status === 'cancelled' && <StatusLine tone="bad" title="Swap cancelled">Your ETH is back in your balance.</StatusLine>}

      {order && status && (
        <SwapDetails id={order.id} status={status} attempts={current?.attempts} reason={current?.reason} poolPrice={price.data ?? null} placedAt={Math.floor(order.at / 1000)} />
      )}

      <ActionButton label={label} onClick={submit} disabled={!canSwap} loading={create.isPending} />
    </SimpleCard>
  );
}
