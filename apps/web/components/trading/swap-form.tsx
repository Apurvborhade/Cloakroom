'use client';

import { NATIVE } from '@cloakroom/shared';
import { useMemo, useState } from 'react';
import { intentLifetime, MAX_INTENT_LIFETIME_SEC, useCreateIntent } from '@/hooks/use-actions';
import { useBalances } from '@/hooks/use-private-data';
import { useOwner } from '@/hooks/use-owner';
import { describeError } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { formatBps, formatPrice, formatUnitsDisplay, formatUnitsExact, minimumOutForLimit } from '@/lib/format/units';
import { validateSwapForm } from '@/lib/swap/form';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input, Segmented, Select } from '../ui/field';
import { Notice } from '../ui/notice';
import { useToast } from '../ui/toast';
import { PoolPriceHint } from './pool-price';
import { SigningReview } from './signing-review';

const LIFETIMES = [60, 120, 180, 240, MAX_INTENT_LIFETIME_SEC];

export function SwapForm() {
  const tokenOut = appConfig.tokenOut!;
  const { owner } = useOwner();
  const balances = useBalances();
  const create = useCreateIntent();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [trigger, setTrigger] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [lifetime, setLifetime] = useState(String(MAX_INTENT_LIFETIME_SEC));
  const [reviewing, setReviewing] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const eth = balances.data?.balances.find((item) => item.token.toLowerCase() === NATIVE);
  const availableWei = eth ? BigInt(eth.available) : null;
  const form = useMemo(
    () => validateSwapForm({ amount, trigger, slippage }, { maxAmountWei: appConfig.maxAmountNativeWei, availableWei, maxSlippageBpsCap: appConfig.maxSlippageBpsCap }),
    [amount, trigger, slippage, availableWei],
  );
  const ready = form.amountIn !== null && form.triggerPrice !== null && form.maxSlippageBps !== null && Object.keys(form.errors).length === 0;
  const minOut = ready ? minimumOutForLimit(form.amountIn!, form.triggerPrice!, tokenOut.decimals) : null;
  const lifetimeSec = intentLifetime(Number(lifetime));

  const submit = () => {
    if (!ready) return;
    create.mutate(
      { tokenIn: NATIVE, tokenOut: tokenOut.address, amountIn: form.amountIn!, triggerPrice: form.triggerPrice!, comparator: 0, maxSlippageBps: form.maxSlippageBps!, lifetimeSec },
      {
        onSuccess: (result) => {
          setReviewing(false);
          setCreated(result.intentId);
          setAmount('');
          toast.push({ tone: 'ok', title: 'Intent created', description: `Status: ${result.status}. ETH is reserved until it executes, is cancelled, or expires.` });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader title="New conditional swap" description={`Sell ETH for ${tokenOut.symbol} when the enclave's price check reaches your trigger.`} />
      <CardBody className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="swap-in" label="You sell" hint="Only native ETH can be sold.">
            <Select id="swap-in" value="eth" disabled aria-readonly><option value="eth">ETH</option></Select>
          </Field>
          <Field id="swap-out" label="You receive" hint="The enclave's configured output token.">
            <Select id="swap-out" value="out" disabled aria-readonly><option value="out">{tokenOut.symbol}</option></Select>
          </Field>
        </div>
        <Field
          id="swap-amount"
          label="Amount"
          error={form.errors.amount}
          hint={`Max ${formatUnitsDisplay(appConfig.maxAmountNativeWei, 18)} ETH per intent.`}
          trailing={availableWei !== null ? <button type="button" className="hover:text-fg" onClick={() => setAmount(formatUnitsExact(availableWei < appConfig.maxAmountNativeWei ? availableWei : appConfig.maxAmountNativeWei, 18))}>Available: {formatUnitsDisplay(availableWei, 18)} ETH</button> : 'Available: unlock to view'}
        >
          <Input id="swap-amount" inputMode="decimal" placeholder="0.1" value={amount} onChange={(event) => setAmount(event.target.value)} suffix="ETH" invalid={Boolean(form.errors.amount)} />
        </Field>
        <Field id="swap-comparator" label="Condition" hint="Only “at or above” orders can execute: the enclave refuses “at or below” because it has no binding price floor.">
          <Segmented label="Condition" value="gte" onChange={() => undefined} options={[{ value: 'gte', label: 'Price ≥ trigger' }, { value: 'lte', label: 'Price ≤ trigger', disabled: true }]} />
        </Field>
        <Field id="swap-trigger" label={`Trigger price (${tokenOut.symbol} per ETH)`} error={form.errors.trigger} hint={<PoolPriceHint onUse={setTrigger} />}>
          <Input id="swap-trigger" inputMode="decimal" placeholder="2500" value={trigger} onChange={(event) => setTrigger(event.target.value)} suffix={`${tokenOut.symbol}/ETH`} invalid={Boolean(form.errors.trigger)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="swap-slippage" label="Max slippage" error={form.errors.slippage} hint={`Enclave cap: ${formatBps(appConfig.maxSlippageBpsCap)}.`}>
            <Input id="swap-slippage" inputMode="decimal" value={slippage} onChange={(event) => setSlippage(event.target.value)} suffix="%" invalid={Boolean(form.errors.slippage)} />
          </Field>
          <Field id="swap-lifetime" label="Order lifetime" hint="The signed expiry is also the order's lifetime; the enclave accepts at most 5 minutes.">
            <Select id="swap-lifetime" value={lifetime} onChange={(event) => setLifetime(event.target.value)}>
              {LIFETIMES.map((seconds) => <option key={seconds} value={seconds}>{seconds % 60 === 0 ? `${seconds / 60} min` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`}</option>)}
            </Select>
          </Field>
        </div>
        {form.warnings.map((warning) => <Notice key={warning} tone="warn">{warning}</Notice>)}

        <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Execution summary</p>
          {ready ? (
            <p className="mt-2 text-fg-muted">
              When the enclave's price check shows at least <span className="text-fg">{formatPrice(form.triggerPrice!)} {tokenOut.symbol}</span> per ETH within the next {Math.round(lifetimeSec / 60)} minutes, sell <span className="text-fg">{formatUnitsExact(form.amountIn!, 18)} ETH</span>. You are credited at least <span className="text-fg">{formatUnitsDisplay(minOut!, tokenOut.decimals)} {tokenOut.symbol}</span> after the {formatBps(appConfig.feeBps)} protocol fee, or the swap does not run. Otherwise the order expires and the ETH is released.
            </p>
          ) : (
            <p className="mt-2 text-fg-subtle">Enter an amount and a trigger price.</p>
          )}
        </div>
        <Button size="lg" className="w-full" disabled={!ready || create.isPending} onClick={() => { create.reset(); setReviewing(true); }}>
          Review intent
        </Button>
        {created && (
          <Notice tone="ok" title="Intent submitted">
            ID <span className="break-all font-mono text-xs">{created}</span>. It appears in the list below with its live status.
          </Notice>
        )}
      </CardBody>

      <SigningReview
        open={reviewing}
        onClose={() => setReviewing(false)}
        onConfirm={submit}
        title="Review conditional swap"
        primaryType="Intent"
        pending={create.isPending}
        error={create.error ? describeError(create.error) : undefined}
        rows={ready ? [
          { label: 'Owner', value: owner ?? '—', mono: true },
          { label: 'Sell (tokenIn)', value: `${formatUnitsExact(form.amountIn!, 18)} ETH` },
          { label: 'amountIn (wei)', value: form.amountIn!.toString(), mono: true },
          { label: 'Receive (tokenOut)', value: `${tokenOut.symbol} · ${tokenOut.address}`, mono: true },
          { label: 'Comparator', value: '0 — execute when price ≥ trigger' },
          { label: 'Trigger price', value: `${formatUnitsExact(form.triggerPrice!, 18)} ${tokenOut.symbol}/ETH` },
          { label: 'triggerPrice (1e18)', value: form.triggerPrice!.toString(), mono: true },
          { label: 'Max slippage', value: `${formatBps(form.maxSlippageBps!)} (${form.maxSlippageBps} bps)` },
          { label: 'Minimum net credit', value: `${formatUnitsDisplay(minOut!, tokenOut.decimals)} ${tokenOut.symbol}` },
          { label: 'Order lifetime', value: `${Math.round(lifetimeSec / 60)} min from signing (signed expiry)` },
        ] : []}
        authorises={
          <>
            Reserving this ETH and letting the enclave sell it through Uniswap from one of its custody addresses once its price check meets your trigger. The protocol fee ({formatBps(appConfig.feeBps)}) is deducted from the {tokenOut.symbol} output; the amount shown in your intent status is net of it. Slippage can reduce the quote but never below the trigger-based minimum.
          </>
        }
        warnings={
          <Notice tone="warn">
            The swap is a public transaction. Close to the limit, its on-chain minimum can reveal your trigger price; its timing and size are visible.
          </Notice>
        }
        confirmLabel="Sign intent"
      />
    </Card>
  );
}
