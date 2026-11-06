'use client';

import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { useCreateWithdrawal } from '@/hooks/use-actions';
import { useOwner } from '@/hooks/use-owner';
import { useBalances } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { appConfig, knownTokens, tokenFor } from '@/lib/config';
import { formatUnitsDisplay, formatUnitsExact } from '@/lib/format/units';
import { validateWithdrawForm } from '@/lib/withdraw/form';
import { SigningReview } from '../trading/signing-review';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Field, Input, Select } from '../ui/field';
import { Notice } from '../ui/notice';
import { useToast } from '../ui/toast';
import { WithdrawalStatusBadge } from '../ui/status';

export function WithdrawFlow({ onCreated }: { onCreated: (id: string) => void }) {
  const { owner } = useOwner();
  const balances = useBalances();
  const create = useCreateWithdrawal();
  const toast = useToast();
  const tokens = knownTokens();
  const [tokenAddress, setTokenAddress] = useState<Address>(tokens[0]!.address);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [result, setResult] = useState<{ id: string; status: string } | null>(null);

  const token = tokenFor(tokenAddress)!;
  const balance = balances.data?.balances.find((item) => item.token.toLowerCase() === tokenAddress.toLowerCase());
  const available = balance ? BigInt(balance.available) : null;
  const form = useMemo(
    () => validateWithdrawForm({ token: tokenAddress, decimals: token.decimals, amount, destination }, { availableBaseUnits: available, maxNativeWei: appConfig.maxAmountNativeWei, owner }),
    [tokenAddress, token.decimals, amount, destination, available, owner],
  );
  const ready = form.amount !== null && form.to !== null && Object.keys(form.errors).length === 0;

  const submit = () => {
    if (!ready) return;
    create.mutate(
      { token: tokenAddress, amount: form.amount!, to: form.to! },
      {
        onSuccess: (response) => {
          setReviewing(false);
          setResult({ id: response.withdrawalId, status: response.status });
          onCreated(response.withdrawalId);
          setAmount('');
          toast.push({ tone: 'info', title: 'Withdrawal locked', description: 'Funds are reserved and a paying address is assigned. Follow the status below.' });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader title="Withdraw" description="Pay out from your private balance to any address. No withdrawal fee in this MVP." />
      <CardBody className="space-y-5">
        <Field id="withdraw-token" label="Token">
          <Select id="withdraw-token" value={tokenAddress} onChange={(event) => { setTokenAddress(event.target.value as Address); setAmount(''); }}>
            {tokens.map((item) => <option key={item.address} value={item.address}>{item.symbol}</option>)}
          </Select>
        </Field>
        <Field
          id="withdraw-amount"
          label="Amount"
          error={form.errors.amount}
          hint={token.address === appConfig.native.address ? `Max ${formatUnitsDisplay(appConfig.maxAmountNativeWei, 18)} ETH per withdrawal.` : undefined}
          trailing={available !== null ? <button type="button" className="hover:text-fg" onClick={() => setAmount(formatUnitsExact(available, token.decimals))}>Available: {formatUnitsDisplay(available, token.decimals)} {token.symbol}</button> : 'Available: unknown'}
        >
          <Input id="withdraw-amount" inputMode="decimal" placeholder="0.0" value={amount} onChange={(event) => setAmount(event.target.value)} suffix={token.symbol} invalid={Boolean(form.errors.amount)} />
        </Field>
        <Field id="withdraw-to" label="Destination address" error={form.errors.destination} hint="A fresh address you control gives the most separation from your deposit.">
          <Input id="withdraw-to" placeholder="0x…" value={destination} onChange={(event) => setDestination(event.target.value)} className="font-mono" invalid={Boolean(form.errors.destination)} />
        </Field>
        {form.warnings.map((warning) => <Notice key={warning} tone="warn">{warning}</Notice>)}
        <Button size="lg" className="w-full" disabled={!ready || create.isPending} onClick={() => { create.reset(); setReviewing(true); }}>
          Review withdrawal
        </Button>
        {result && (
          <Notice tone="info" title="Withdrawal requested">
            <span className="flex flex-wrap items-center gap-2">ID <span className="break-all font-mono text-xs">{result.id}</span> <WithdrawalStatusBadge status={result.status} /></span>
            <span className="mt-1 block">Locked means funds are reserved and an address is assigned, not that the payout was sent.</span>
          </Notice>
        )}
      </CardBody>
      <SigningReview
        open={reviewing}
        onClose={() => setReviewing(false)}
        onConfirm={submit}
        title="Review withdrawal"
        primaryType="Withdrawal"
        pending={create.isPending}
        error={create.error ? describeError(create.error) : undefined}
        rows={ready ? [
          { label: 'Owner', value: owner ?? '—', mono: true },
          { label: 'Token', value: `${token.symbol} · ${token.address}`, mono: true },
          { label: 'Amount', value: `${formatUnitsExact(form.amount!, token.decimals)} ${token.symbol}` },
          { label: 'amount (base units)', value: form.amount!.toString(), mono: true },
          { label: 'Destination', value: form.to!, mono: true },
          { label: 'Fee', value: 'None (MVP)' },
        ] : []}
        authorises="Paying exactly this amount from your private balance to this destination. The destination is part of the signature, so it cannot be changed after you sign. The payout is a normal public transfer from a custody address."
        warnings={<Notice tone="warn">Amount and timing are public. A payout that matches a recent deposit amount is easy to link.</Notice>}
        confirmLabel="Sign withdrawal"
      />
    </Card>
  );
}
