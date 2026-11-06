'use client';

import { useMemo, useState } from 'react';
import type { Address } from 'viem';
import { useCreateWithdrawal } from '@/hooks/use-actions';
import { useOwner } from '@/hooks/use-owner';
import { useBalances, useWithdrawalStatuses } from '@/hooks/use-private-data';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { appConfig, knownTokens, tokenFor } from '@/lib/config';
import { formatUnitsDisplay } from '@/lib/format/units';
import { validateWithdrawForm } from '@/lib/withdraw/form';
import { TxLink } from '../transactions/tx-link';
import { RecentWithdrawals } from './recent-history';
import { ActionButton, AmountBox, PrivateBalance, SimpleCard, StatusLine } from './parts';

export function SimpleWithdraw() {
  const { owner } = useOwner();
  const tokens = knownTokens();
  const balances = useBalances();
  const statuses = useWithdrawalStatuses();
  const create = useCreateWithdrawal();
  const [tokenAddress, setTokenAddress] = useState<Address>(tokens[0]!.address);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [latest, setLatest] = useState<{ id: string; amount: bigint; decimals: number; symbol: string } | null>(null);

  const token = tokenFor(tokenAddress)!;
  const balance = balances.data?.balances.find((item) => item.token.toLowerCase() === tokenAddress.toLowerCase());
  const available = balance ? BigInt(balance.available) : null;
  const form = useMemo(
    () => validateWithdrawForm(
      { token: tokenAddress, decimals: token.decimals, amount, destination },
      { availableBaseUnits: available, maxNativeWei: appConfig.maxAmountNativeWei, owner },
    ),
    [tokenAddress, token.decimals, amount, destination, available, owner],
  );

  const current = latest ? statuses.data?.withdrawals.find((item) => item.id === latest.id) : undefined;
  const status = current?.status ?? (latest ? 'locked' : null);
  const open = status === 'locked' || status === 'sent';
  const ready = form.amount !== null && form.to !== null && Object.keys(form.errors).length === 0 && !open;

  const label = form.errors.amount
    ?? (!amount.trim() ? 'Enter an amount' : form.errors.destination ?? (!destination.trim() ? 'Enter an address' : open ? 'Sending…' : create.isPending ? 'Check your wallet' : 'Withdraw'));

  const submit = () => {
    if (!ready) return;
    const sending = { amount: form.amount!, decimals: token.decimals, symbol: token.symbol };
    create.mutate(
      { token: tokenAddress, amount: form.amount!, to: form.to! },
      {
        onSuccess: (response) => {
          setLatest({ id: response.withdrawalId, ...sending });
          setAmount('');
          setDestination('');
        },
      },
    );
  };

  return (
    <SimpleCard title="Withdraw" after={<RecentWithdrawals />}>
      <div className="flex gap-1.5 px-1 pb-1">
        {tokens.map((item) => (
          <button
            key={item.address}
            type="button"
            aria-pressed={item.address === tokenAddress}
            onClick={() => { setTokenAddress(item.address); setAmount(''); }}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              item.address === tokenAddress ? 'bg-accent-soft text-accent' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {item.symbol}
          </button>
        ))}
      </div>
      <AmountBox
        id="withdraw-amount"
        label="Amount"
        symbol={token.symbol}
        value={amount}
        onChange={setAmount}
        footer={<PrivateBalance token={tokenAddress} decimals={token.decimals} symbol={token.symbol} onMax={setAmount} />}
      />
      <div className="rounded-2xl bg-ink-800 p-4">
        <label htmlFor="withdraw-to" className="text-sm text-fg-subtle">To address</label>
        <input
          id="withdraw-to"
          placeholder="0x…"
          autoComplete="off"
          spellCheck={false}
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          className="mt-2 w-full bg-transparent font-mono text-sm text-fg outline-none placeholder:text-fg-faint"
        />
        <p className="mt-2 text-xs text-fg-subtle">Use a new address. Sending back to your deposit wallet links the two publicly.</p>
      </div>

      {form.warnings.map((warning) => <StatusLine key={warning} tone="working" title={warning} />)}
      {create.error && <StatusLine tone="bad" title="Withdrawal not sent">{describeError(create.error)}</StatusLine>}
      {open && <StatusLine tone="working" title="Sending">{current?.txHash ? <TxLink hash={current.txHash} /> : 'This usually takes under a minute.'}</StatusLine>}
      {status === 'confirmed' && latest && (
        <StatusLine tone="ok" title={`Sent ${formatUnitsDisplay(latest.amount, latest.decimals, 5)} ${latest.symbol}`}>
          {current?.txHash && <TxLink hash={current.txHash} />}
        </StatusLine>
      )}
      {status === 'failed' && <StatusLine tone="bad" title="Withdrawal failed">Your funds are back in your balance. Try again, or try a smaller amount.</StatusLine>}

      <ActionButton label={label} onClick={submit} disabled={!ready} loading={create.isPending} />
    </SimpleCard>
  );
}
