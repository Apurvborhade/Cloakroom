'use client';

import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { useMarginLendingAction } from '@/hooks/use-actions';
import { useOwner } from '@/hooks/use-owner';
import { useBalances, useMarginLending } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { appConfig, knownTokens, tokenFor } from '@/lib/config';
import { AmountError, formatUnitsDisplay, formatUnitsExact, parseUnitsStrict } from '@/lib/format/units';
import { Amount, TokenSymbol } from '../../ui/amount';
import { Button } from '../../ui/button';
import { Card, CardBody, CardHeader } from '../../ui/card';
import { Field, Input, Segmented, Select } from '../../ui/field';
import { Notice } from '../../ui/notice';
import { Skeleton } from '../../ui/skeleton';
import { useToast } from '../../ui/toast';
import { SigningReview } from '../signing-review';

export function LendingPanel() {
  const { owner } = useOwner();
  const lending = useMarginLending();
  const balances = useBalances();
  const toast = useToast();
  const tokens = knownTokens();
  const [mode, setMode] = useState<'supply' | 'redeem'>('supply');
  const [token, setToken] = useState<Address>((appConfig.tokenOut ?? appConfig.native).address);
  const [amountText, setAmountText] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const supply = useMarginLendingAction('supply');
  const redeem = useMarginLendingAction('redeem');
  const action = mode === 'supply' ? supply : redeem;

  const config = tokenFor(token)!;
  const pool = lending.data?.lending.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const balance = balances.data?.balances.find((item) => item.token.toLowerCase() === token.toLowerCase());
  const supplied = pool ? BigInt(pool.supplied) : null;
  const poolAvailable = pool ? BigInt(pool.available) : null;
  const redeemable = supplied !== null && poolAvailable !== null ? (supplied < poolAvailable ? supplied : poolAvailable) : null;

  const amount = useMemo(() => {
    if (!amountText.trim()) return { value: null as bigint | null, error: null as string | null };
    try {
      const value = parseUnitsStrict(amountText, config.decimals);
      if (value === 0n) return { value: null, error: 'Enter an amount above zero' };
      if (mode === 'redeem' && supplied !== null && value > supplied) return { value: null, error: 'More than you supplied' };
      if (mode === 'redeem' && poolAvailable !== null && value > poolAvailable) return { value: null, error: 'More than the pool can return right now (funds are lent out)' };
      return { value, error: null };
    } catch (error) {
      return { value: null, error: error instanceof AmountError ? error.message : 'Invalid amount' };
    }
  }, [amountText, config.decimals, mode, supplied, poolAvailable]);

  const submit = () => {
    if (amount.value === null) return;
    action.mutate(
      { token, amount: amount.value },
      {
        onSuccess: () => {
          setReviewing(false);
          setAmountText('');
          toast.push({ tone: 'ok', title: mode === 'supply' ? 'Supplied' : 'Redeemed', description: 'The enclave accepted the request. Lending figures refresh below.' });
        },
      },
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader title="Supply or redeem" description="Lend to the pool that funds leveraged positions." />
        <CardBody className="space-y-4">
          <Segmented label="Lending action" value={mode} onChange={(value) => { setMode(value); action.reset(); }} options={[{ value: 'supply', label: 'Supply' }, { value: 'redeem', label: 'Redeem' }]} />
          <Field id="lend-token" label="Token">
            <Select id="lend-token" value={token} onChange={(event) => { setToken(event.target.value as Address); setAmountText(''); }}>
              {tokens.map((item) => <option key={item.address} value={item.address}>{item.symbol}</option>)}
            </Select>
          </Field>
          <Field
            id="lend-amount"
            label="Amount"
            error={amount.error}
            trailing={
              mode === 'redeem'
                ? redeemable !== null ? <button type="button" className="hover:text-fg" onClick={() => setAmountText(formatUnitsExact(redeemable, config.decimals))}>Redeemable: {formatUnitsDisplay(redeemable, config.decimals)} {config.symbol}</button> : 'Redeemable: loading'
                : balance ? <>Private balance: {formatUnitsDisplay(balance.available, config.decimals)} {config.symbol}</> : 'Private balance: loading'
            }
          >
            <Input id="lend-amount" inputMode="decimal" placeholder="0.0" value={amountText} onChange={(event) => setAmountText(event.target.value)} suffix={config.symbol} invalid={Boolean(amount.error)} />
          </Field>
          <Button className="w-full" disabled={amount.value === null || action.isPending} onClick={() => { action.reset(); setReviewing(true); }}>
            Review {mode}
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your lending" description="From /margin/lending." action={<Button variant="ghost" size="sm" onClick={() => lending.refetch()} loading={lending.isFetching && !lending.isLoading}>Refresh</Button>} />
        <CardBody>
          {lending.isLoading && <Skeleton className="h-20" />}
          {lending.error && <Notice tone="error">{describeError(lending.error)}</Notice>}
          {lending.data && (
            <dl className="grid gap-3 sm:grid-cols-2">
              {lending.data.lending.map((item) => (
                <div key={item.token} className="rounded-lg border border-ink-700 bg-ink-900/60 p-4">
                  <dt className="text-xs font-medium uppercase tracking-wider text-fg-subtle"><TokenSymbol token={item.token} /></dt>
                  <dd className="mt-2 space-y-1 text-sm">
                    <p><span className="text-fg-subtle">Supplied by you </span><Amount value={item.supplied} token={item.token} /></p>
                    <p><span className="text-fg-subtle">Pool available </span><Amount value={item.available} token={item.token} /></p>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-xs text-fg-subtle">“Pool available” is everyone's supply not currently lent out; you can redeem at most the smaller of your supply and that amount. No interest is paid in this MVP.</p>
        </CardBody>
      </Card>

      <SigningReview
        open={reviewing}
        onClose={() => setReviewing(false)}
        onConfirm={submit}
        title={mode === 'supply' ? 'Review supply' : 'Review redeem'}
        primaryType={mode === 'supply' ? 'MarginSupply' : 'MarginRedeem'}
        pending={action.isPending}
        error={action.error ? describeError(action.error) : undefined}
        rows={amount.value !== null ? [
          { label: 'Owner', value: owner ?? '—', mono: true },
          { label: 'Token', value: `${config.symbol} · ${config.address}`, mono: true },
          { label: 'Amount', value: `${formatUnitsExact(amount.value, config.decimals)} ${config.symbol}` },
          { label: 'amount (base units)', value: amount.value.toString(), mono: true },
        ] : []}
        authorises={mode === 'supply'
          ? 'Supplying this amount to the margin lending pool, where it can be lent to leveraged traders. Lenders may bear losses beyond a position’s collateral (recorded as shortfall).'
          : 'Redeeming this amount from the lending pool back to you.'}
        confirmLabel={mode === 'supply' ? 'Sign supply' : 'Sign redeem'}
      />
    </div>
  );
}
