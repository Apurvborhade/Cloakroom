'use client';

import { usePoolPrice } from '@/hooks/use-pool-price';
import { marketLimitPrice } from '@/lib/margin/quote';
import { explainAttempt } from '@/lib/swap/attempts';
import type { PositionItem } from '@cloakroom/shared';
import { Fragment, useMemo, useState } from 'react';
import type { Hex } from 'viem';
import { useMarginAddCollateral, useMarginClose } from '@/hooks/use-actions';
import { useOwner } from '@/hooks/use-owner';
import { useMarginPositions } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { AmountError, formatBps, formatPrice, formatUnitsExact, parsePercentToBps, parsePrice, parseUnitsStrict } from '@/lib/format/units';
import { OPEN_STATUSES } from '@/lib/margin/positions';
import { Address } from '../../ui/address';
import { Amount, TokenSymbol } from '../../ui/amount';
import { Button } from '../../ui/button';
import { Card, CardBody, CardHeader } from '../../ui/card';
import { EmptyState } from '../../ui/empty-state';
import { Field, Input } from '../../ui/field';
import { KeyValue, KeyValueList, Unavailable } from '../../ui/key-value';
import { LinkButton } from '../../ui/link-button';
import { Notice } from '../../ui/notice';
import { Skeleton } from '../../ui/skeleton';
import { PositionStatusBadge } from '../../ui/status';
import { useToast } from '../../ui/toast';
import { PoolPriceHint } from '../pool-price';
import { SigningReview } from '../signing-review';

const optionalPrice = (value: string | undefined) => (value === undefined ? <Unavailable /> : <>{formatPrice(value, 2)}</>);

function PositionDetail({ position }: { position: PositionItem }) {
  const usdc = appConfig.tokenOut!.address;
  return (
    <KeyValueList className="grid gap-x-8 sm:grid-cols-2 [&>*]:border-b [&>*]:border-ink-800">
      <KeyValue label="Position ID"><Address value={position.id} head={10} tail={8} /></KeyValue>
      <KeyValue label="Side">{position.side}</KeyValue>
      <KeyValue label="Collateral"><Amount value={position.collateral} token={usdc} /></KeyValue>
      <KeyValue label="Size"><Amount value={position.sizeUsd} token={usdc} /></KeyValue>
      <KeyValue label="Debt token"><TokenSymbol token={position.debtToken} /></KeyValue>
      <KeyValue label="Debt"><Amount value={position.debt} token={position.debtToken} maxFraction={8} /></KeyValue>
      <KeyValue label="Asset token"><TokenSymbol token={position.assetToken} /></KeyValue>
      <KeyValue label="Asset quantity"><Amount value={position.asset} token={position.assetToken} maxFraction={8} /></KeyValue>
      <KeyValue label="Entry price">{optionalPrice(position.entryPrice)}</KeyValue>
      <KeyValue label="Liquidation price">{optionalPrice(position.liquidationPrice)}</KeyValue>
      <KeyValue label="Equity">{position.equity === undefined ? <Unavailable /> : <Amount value={position.equity} token={usdc} signed />}</KeyValue>
      <KeyValue label="Payout">{position.payout === undefined ? <Unavailable /> : <Amount value={position.payout} token={usdc} />}</KeyValue>
      {position.reason && <KeyValue label="Last failure">{explainAttempt(position.reason)?.title ?? position.reason} ({position.reason})</KeyValue>}
      <KeyValue label="Shortfall" >{position.shortfall === undefined ? <Unavailable /> : <Amount value={position.shortfall} token={position.debtToken} maxFraction={8} />}</KeyValue>
    </KeyValueList>
  );
}

type Dialog = { kind: 'collateral' | 'close'; position: PositionItem } | null;

export function PositionsTable() {
  const positions = useMarginPositions();
  const poolPrice = usePoolPrice();
  const { owner } = useOwner();
  const toast = useToast();
  const addCollateral = useMarginAddCollateral();
  const close = useMarginClose();
  const usdc = appConfig.tokenOut!;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [amountText, setAmountText] = useState('');
  const [limitText, setLimitText] = useState('');
  const [slippageText, setSlippageText] = useState('0.5');
  const [showClosed, setShowClosed] = useState(false);

  const rows = [...(positions.data?.positions ?? [])].reverse().filter((p) => showClosed || OPEN_STATUSES.has(p.status));
  const closedCount = (positions.data?.positions ?? []).filter((p) => !OPEN_STATUSES.has(p.status)).length;

  const parsed = useMemo(() => {
    const read = <T,>(text: string, fn: (value: string) => T) => {
      if (!text.trim()) return { value: null as T | null, error: null as string | null };
      try { return { value: fn(text), error: null }; } catch (error) { return { value: null, error: error instanceof AmountError ? error.message : 'Invalid value' }; }
    };
    return {
      amount: read(amountText, (value) => parseUnitsStrict(value, usdc.decimals)),
      limit: read(limitText, parsePrice),
      slippage: read(slippageText, parsePercentToBps),
    };
  }, [amountText, limitText, slippageText, usdc.decimals]);

  const openDialog = (kind: 'collateral' | 'close', position: PositionItem) => {
    addCollateral.reset();
    close.reset();
    setAmountText('');
    // A market close: the worst price is 3% from the pool price, in the direction that hurts.
    const closeSide = position.side === 'long' ? 'short' : 'long';
    setLimitText(kind === 'close' && poolPrice.data !== undefined ? formatPrice(marketLimitPrice(closeSide, poolPrice.data), 2).replace(/,/g, '') : '');
    setDialog({ kind, position });
  };

  const confirm = () => {
    if (!dialog) return;
    const positionId = dialog.position.id as Hex;
    if (dialog.kind === 'collateral' && parsed.amount.value) {
      addCollateral.mutate({ positionId, amount: parsed.amount.value }, {
        onSuccess: () => { setDialog(null); toast.push({ tone: 'ok', title: 'Collateral added' }); },
      });
    }
    if (dialog.kind === 'close' && parsed.limit.value && parsed.slippage.value !== null) {
      close.mutate({ positionId, limitPrice: parsed.limit.value, maxSlippageBps: parsed.slippage.value }, {
        onSuccess: () => { setDialog(null); toast.push({ tone: 'info', title: 'Closing', description: 'Approved. The position is closed only when the list says so.' }); },
      });
    }
  };

  const dialogReady = dialog?.kind === 'collateral'
    ? Boolean(parsed.amount.value && parsed.amount.value > 0n)
    : Boolean(parsed.limit.value && parsed.limit.value > 0n && parsed.slippage.value !== null);
  const pending = addCollateral.isPending || close.isPending;
  const actionError = addCollateral.error ?? close.error;
  const longSide = dialog?.position.side === 'long';

  return (
    <Card>
      <CardHeader
        title="Positions"
        description="From /margin/positions, refreshed every few seconds while any position is changing."
        action={
          <>
            {closedCount > 0 && <Button variant="ghost" size="sm" onClick={() => setShowClosed((value) => !value)}>{showClosed ? 'Hide' : 'Show'} settled ({closedCount})</Button>}
            <Button variant="ghost" size="sm" onClick={() => positions.refetch()} loading={positions.isFetching && !positions.isLoading}>Refresh</Button>
          </>
        }
      />
      <CardBody className="p-0">
        {positions.isLoading && <div className="p-5"><Skeleton className="h-16" /></div>}
        {positions.error && <div className="p-5"><Notice tone="error">{describeError(positions.error)}</Notice></div>}
        {positions.data && rows.length === 0 && <EmptyState title="No active positions" action={<LinkButton href="/margin" size="sm">Open a position</LinkButton>} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-ink-700 text-left text-[11px] uppercase tracking-wider text-fg-faint">
                  <th scope="col" className="px-5 py-2 font-medium">Position</th>
                  <th scope="col" className="px-3 py-2 font-medium">Side</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 font-medium">Collateral</th>
                  <th scope="col" className="px-3 py-2 font-medium">Size</th>
                  <th scope="col" className="px-3 py-2 font-medium">Entry</th>
                  <th scope="col" className="px-3 py-2 font-medium">Liq. price</th>
                  <th scope="col" className="px-3 py-2 font-medium">Equity</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {rows.map((position) => (
                  <Fragment key={position.id}>
                    <tr>
                      <td className="px-5 py-3">
                        <button type="button" className="font-mono text-xs text-fg hover:text-accent" aria-expanded={expanded === position.id} onClick={() => setExpanded(expanded === position.id ? null : position.id)}>
                          {expanded === position.id ? '▾' : '▸'} {position.id.slice(0, 10)}…
                        </button>
                      </td>
                      <td className={position.side === 'long' ? 'px-3 py-3 text-ok' : 'px-3 py-3 text-bad'}>{position.side}</td>
                      <td className="px-3 py-3"><PositionStatusBadge status={position.status} /></td>
                      <td className="px-3 py-3"><Amount value={position.collateral} token={usdc.address} maxFraction={2} /></td>
                      <td className="px-3 py-3"><Amount value={position.sizeUsd} token={usdc.address} maxFraction={2} /></td>
                      <td className="px-3 py-3">{optionalPrice(position.entryPrice)}</td>
                      <td className="px-3 py-3">{optionalPrice(position.liquidationPrice)}</td>
                      <td className="px-3 py-3">{position.equity === undefined ? <Unavailable /> : <Amount value={position.equity} token={usdc.address} maxFraction={2} signed />}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          {position.status === 'open' && (
                            <>
                              <Button size="sm" variant="secondary" onClick={() => openDialog('collateral', position)} disabled={pending}>Add collateral</Button>
                              <Button size="sm" variant="danger" onClick={() => openDialog('close', position)} disabled={pending}>Close</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded === position.id && (
                      <tr><td colSpan={9} className="bg-ink-900/50 px-5 py-4"><PositionDetail position={position} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>

      <SigningReview
        open={dialog !== null}
        onClose={() => setDialog(null)}
        onConfirm={confirm}
        title={dialog?.kind === 'collateral' ? 'Add collateral' : 'Close position'}
        primaryType={dialog?.kind === 'collateral' ? 'MarginAddCollateral' : 'MarginClose'}
        pending={pending}
        error={actionError ? describeError(actionError) : undefined}
        confirmLabel={dialog?.kind === 'collateral' ? 'Sign and add' : 'Sign and close'}
        canConfirm={dialogReady}
        rows={dialog ? [
          { label: 'Owner', value: owner ?? '—', mono: true },
          { label: 'Position ID', value: <span className="break-all">{dialog.position.id}</span>, mono: true },
          ...(dialog.kind === 'collateral' && parsed.amount.value
            ? [{ label: 'Amount', value: `${formatUnitsExact(parsed.amount.value, usdc.decimals)} ${usdc.symbol} (${parsed.amount.value.toString()} base units)` }]
            : []),
          ...(dialog.kind === 'close' && parsed.limit.value && parsed.slippage.value !== null
            ? [
                { label: 'Limit price', value: `${formatPrice(parsed.limit.value)} ${usdc.symbol}/ETH` },
                { label: 'limitPrice (1e18)', value: parsed.limit.value.toString(), mono: true },
                { label: 'Max slippage', value: `${formatBps(parsed.slippage.value)} (${parsed.slippage.value} bps)` },
              ]
            : []),
        ] : []}
        authorises={dialog?.kind === 'collateral'
          ? `Adding ${usdc.symbol} collateral to this open position, which lowers its liquidation risk. Collateral cannot be removed later in this MVP.`
          : `Fully closing this position: the enclave ${longSide ? 'sells its ETH' : 'buys back the borrowed ETH'} at a price no ${longSide ? 'lower' : 'higher'} than your limit, repays the loan, and records your payout. Partial closes are not supported.`}
      >
        {dialog?.kind === 'collateral' && (
          <Field id="add-collateral" label={`Amount (${usdc.symbol})`} error={parsed.amount.error}>
            <Input id="add-collateral" inputMode="decimal" placeholder="50" value={amountText} onChange={(event) => setAmountText(event.target.value)} suffix={usdc.symbol} invalid={Boolean(parsed.amount.error)} />
          </Field>
        )}
        {dialog?.kind === 'close' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="close-limit" label={longSide ? 'Lowest sell price' : 'Highest buy price'} error={parsed.limit.error} hint={<PoolPriceHint onUse={setLimitText} />}>
              <Input id="close-limit" inputMode="decimal" placeholder="2500" value={limitText} onChange={(event) => setLimitText(event.target.value)} suffix={`${usdc.symbol}/ETH`} invalid={Boolean(parsed.limit.error)} />
            </Field>
            <Field id="close-slippage" label="Max slippage" error={parsed.slippage.error}>
              <Input id="close-slippage" inputMode="decimal" value={slippageText} onChange={(event) => setSlippageText(event.target.value)} suffix="%" invalid={Boolean(parsed.slippage.error)} />
            </Field>
          </div>
        )}
      </SigningReview>
    </Card>
  );
}
