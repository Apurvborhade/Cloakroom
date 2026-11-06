'use client';

import { useMemo, useState } from 'react';
import { useMarginOpen } from '@/hooks/use-actions';
import { useOwner } from '@/hooks/use-owner';
import { describeError } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { leverageLabel } from '@/lib/margin/positions';
import { AmountError, formatBps, formatPrice, formatUnitsDisplay, formatUnitsExact, parsePercentToBps, parsePrice, parseUnitsStrict, positionSize } from '@/lib/format/units';
import { PRICE_PRECISION } from '@cloakroom/shared';
import { Button } from '../../ui/button';
import { Card, CardBody, CardHeader } from '../../ui/card';
import { Field, Input, Segmented } from '../../ui/field';
import { LinkButton } from '../../ui/link-button';
import { Notice } from '../../ui/notice';
import { useToast } from '../../ui/toast';
import { PoolPriceHint } from '../pool-price';
import { SigningReview } from '../signing-review';

const STEP_BPS = 2_500;

function parse<T>(text: string, fn: (value: string) => T): { value: T | null; error: string | null } {
  if (!text.trim()) return { value: null, error: null };
  try {
    return { value: fn(text), error: null };
  } catch (error) {
    return { value: null, error: error instanceof AmountError ? error.message : 'Invalid value' };
  }
}

export function OpenPositionForm() {
  const usdc = appConfig.tokenOut!;
  const { owner } = useOwner();
  const open = useMarginOpen();
  const toast = useToast();
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [collateralText, setCollateralText] = useState('');
  const [leverageBps, setLeverageBps] = useState(20_000);
  const [limitText, setLimitText] = useState('');
  const [slippageText, setSlippageText] = useState('0.5');
  const [reviewing, setReviewing] = useState(false);
  const [opened, setOpened] = useState<{ id: string; status: string } | null>(null);

  const collateral = useMemo(() => {
    const parsed = parse(collateralText, (value) => parseUnitsStrict(value, usdc.decimals));
    if (parsed.value === 0n) return { value: null, error: 'Enter collateral above zero' };
    return parsed;
  }, [collateralText, usdc.decimals]);
  const limit = useMemo(() => {
    const parsed = parse(limitText, parsePrice);
    if (parsed.value === 0n) return { value: null, error: 'Enter a price above zero' };
    return parsed;
  }, [limitText]);
  const slippage = useMemo(() => parse(slippageText, parsePercentToBps), [slippageText]);

  const ready = collateral.value !== null && limit.value !== null && slippage.value !== null;
  const size = collateral.value !== null ? positionSize(collateral.value, leverageBps) : null;
  // Approximate ETH exposure at the limit price: size (USDC) / price. Display only.
  const ethAtLimit = size !== null && limit.value ? (size * 10n ** 18n * PRICE_PRECISION) / (limit.value * 10n ** BigInt(usdc.decimals)) : null;
  const sideCode = side === 'long' ? 0 : 1;
  const leverageOptions: number[] = [];
  for (let bps = 10_000; bps <= appConfig.marginMaxLeverageBps; bps += STEP_BPS) leverageOptions.push(bps);

  const submit = () => {
    if (!ready) return;
    open.mutate(
      { side: sideCode, collateral: collateral.value!, leverageBps, limitPrice: limit.value!, maxSlippageBps: slippage.value! },
      {
        onSuccess: (result) => {
          setReviewing(false);
          setOpened({ id: result.positionId, status: result.status });
          toast.push({ tone: 'info', title: 'Position opening', description: 'Approved. The opening swap runs asynchronously; follow it on the positions page.' });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader title="Open a position" description={`Isolated ETH/${usdc.symbol} position with ${usdc.symbol} collateral, up to ${leverageLabel(appConfig.marginMaxLeverageBps)}.`} />
      <CardBody className="space-y-5">
        <Segmented label="Direction" value={side} onChange={setSide} options={[{ value: 'long', label: 'Long ETH' }, { value: 'short', label: 'Short ETH' }]} />
        <Field id="margin-collateral" label={`Collateral (${usdc.symbol})`} error={collateral.error}>
          <Input id="margin-collateral" inputMode="decimal" placeholder="100" value={collateralText} onChange={(event) => setCollateralText(event.target.value)} suffix={usdc.symbol} invalid={Boolean(collateral.error)} />
        </Field>
        <Field id="margin-leverage" label="Leverage" trailing={<span className="font-mono text-fg">{leverageLabel(leverageBps)}</span>} hint={`MVP limit ${leverageLabel(appConfig.marginMaxLeverageBps)}. The wire format allows more, but the documented margin scope does not.`}>
          <input
            id="margin-leverage"
            type="range"
            min={10_000}
            max={appConfig.marginMaxLeverageBps}
            step={STEP_BPS}
            value={leverageBps}
            onChange={(event) => setLeverageBps(Number(event.target.value))}
            className="w-full accent-[#5cc8f0]"
            aria-valuetext={leverageLabel(leverageBps)}
            list="leverage-marks"
          />
          <datalist id="leverage-marks">{leverageOptions.map((bps) => <option key={bps} value={bps} label={leverageLabel(bps)} />)}</datalist>
        </Field>
        <Field
          id="margin-limit"
          label={side === 'long' ? `Limit price: highest you will pay (${usdc.symbol}/ETH)` : `Limit price: lowest you will sell at (${usdc.symbol}/ETH)`}
          error={limit.error}
          hint={<PoolPriceHint onUse={setLimitText} />}
        >
          <Input id="margin-limit" inputMode="decimal" placeholder="2500" value={limitText} onChange={(event) => setLimitText(event.target.value)} suffix={`${usdc.symbol}/ETH`} invalid={Boolean(limit.error)} />
        </Field>
        <Field id="margin-slippage" label="Max slippage" error={slippage.error} hint={`Enclave cap: ${formatBps(appConfig.maxSlippageBpsCap)}.`}>
          <Input id="margin-slippage" inputMode="decimal" value={slippageText} onChange={(event) => setSlippageText(event.target.value)} suffix="%" invalid={Boolean(slippage.error)} />
        </Field>

        <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-900/60 p-4 text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">Risk summary</p>
          {ready && size !== null ? (
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              <li>Position size: <span className="text-fg">{formatUnitsDisplay(size, usdc.decimals, 2)} {usdc.symbol}</span> ({leverageLabel(leverageBps)} × {formatUnitsDisplay(collateral.value!, usdc.decimals, 2)} collateral).</li>
              {ethAtLimit !== null && <li>About <span className="text-fg">{formatUnitsDisplay(ethAtLimit, 18, 5)} ETH</span> of exposure at your limit price; the fill decides the exact amount.</li>}
              <li>{side === 'long'
                ? `A long buys ETH with the full size, borrowing ${formatUnitsDisplay(size - collateral.value!, usdc.decimals, 2)} ${usdc.symbol} from the pool.`
                : `A short borrows ETH worth the full size from the pool and sells it for ${usdc.symbol}.`}</li>
              <li>Liquidation: if equity falls below the maintenance margin at the enclave's risk price, the position is closed automatically and you can lose all collateral. The liquidation price is calculated by the enclave's accounting after the position opens and shown on the positions page.</li>
              <li>Not available in this MVP: stop-loss, take-profit, partial close, increasing size, removing collateral.</li>
            </ul>
          ) : (
            <p className="text-fg-subtle">Enter collateral and a limit price.</p>
          )}
        </div>
        <Button size="lg" className="w-full" disabled={!ready || open.isPending} onClick={() => { open.reset(); setReviewing(true); }}>
          Review {side === 'long' ? 'long' : 'short'}
        </Button>
        {opened && (
          <Notice tone="info" title="Position opening" action={<LinkButton href="/margin/positions" size="sm" variant="secondary">View positions</LinkButton>}>
            ID <span className="break-all font-mono text-xs">{opened.id}</span>. Status “{opened.status}” means approved, not filled. It is open only once the positions list says so.
          </Notice>
        )}
      </CardBody>

      <SigningReview
        open={reviewing}
        onClose={() => setReviewing(false)}
        onConfirm={submit}
        title={`Review ${side} position`}
        primaryType="MarginOpen"
        pending={open.isPending}
        error={open.error ? describeError(open.error) : undefined}
        rows={ready ? [
          { label: 'Owner', value: owner ?? '—', mono: true },
          { label: 'Side', value: `${sideCode} — ${side}` },
          { label: 'Collateral', value: `${formatUnitsExact(collateral.value!, usdc.decimals)} ${usdc.symbol} (${collateral.value!.toString()} base units)` },
          { label: 'leverageBps', value: `${leverageBps} (${leverageLabel(leverageBps)})` },
          { label: 'Limit price', value: `${formatPrice(limit.value!)} ${usdc.symbol}/ETH` },
          { label: 'limitPrice (1e18)', value: limit.value!.toString(), mono: true },
          { label: 'Max slippage', value: `${formatBps(slippage.value!)} (${slippage.value} bps)` },
        ] : []}
        authorises={`Opening a leveraged ${side} position. The enclave reserves your collateral, borrows from the lending pool and swaps on Uniswap from a custody address, at a price no worse than your limit. The position can be liquidated.`}
        warnings={<Notice tone="warn">Opening and closing swaps are public and larger than an unleveraged trade, so they are easier to match on-chain.</Notice>}
        confirmLabel="Sign and open"
      />
    </Card>
  );
}
