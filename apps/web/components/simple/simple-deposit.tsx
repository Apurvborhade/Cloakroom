'use client';

import { NATIVE } from '@cloakroom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Address, Hash } from 'viem';
import { useSendTransaction } from 'wagmi';
import { useActivity } from '@/hooks/use-activity';
import { useOpenDepositSession } from '@/hooks/use-actions';
import { useReadClient } from '@/hooks/use-chain-reader';
import { useOwner } from '@/hooks/use-owner';
import { useBalances } from '@/hooks/use-private-data';
import { describeError, isUserRejection } from '@/lib/api/errors';
import { readNativeBalance } from '@/lib/chain/reads';
import { appConfig } from '@/lib/config';
import { canSendNow } from '@/lib/deposit/lifecycle';
import { nowSec } from '@/lib/format/time';
import { formatUnitsDisplay, parseUnitsStrict } from '@/lib/format/units';
import { updateDeposit } from '@/lib/state/activity';
import { TxLink } from '../transactions/tx-link';
import { ActionButton, AmountBox, Detail, SimpleCard, StatusLine } from './parts';

type Step = 'idle' | 'address' | 'send' | 'confirming' | 'done';
const BALANCE_CHECK_MS = 8_000;

function parseAmount(text: string): bigint | null {
  if (!text.trim()) return null;
  try {
    const value = parseUnitsStrict(text, 18);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

export function SimpleDeposit() {
  const { owner } = useOwner();
  const { deposits } = useActivity();
  const openSession = useOpenDepositSession();
  const send = useSendTransaction();
  const balances = useBalances();
  const { client, available: chainReadsOn } = useReadClient();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ hash: Hash; wei: bigint; before: bigint | null } | null>(null);

  const wei = useMemo(() => parseAmount(amount), [amount]);
  const wallet = useQuery({
    queryKey: ['chain', 'native-balance', owner],
    enabled: Boolean(owner) && chainReadsOn,
    queryFn: () => readNativeBalance(client, owner!),
    refetchInterval: 30_000,
  });

  const eth = balances.data?.balances.find((item) => item.token.toLowerCase() === NATIVE);
  const total = eth ? BigInt(eth.available) + BigInt(eth.reserved) + BigInt(eth.pending) : null;

  useEffect(() => {
    if (step !== 'confirming') return;
    const timer = setInterval(() => void balances.refetch(), BALANCE_CHECK_MS);
    return () => clearInterval(timer);
  }, [step, balances]);

  useEffect(() => {
    if (step === 'confirming' && sent && total !== null && sent.before !== null && total >= sent.before + sent.wei) setStep('done');
  }, [step, sent, total]);

  const busy = step === 'address' || step === 'send' || step === 'confirming';
  const tooMuch = wei !== null && wallet.data !== undefined && wei > wallet.data;
  const canDeposit = wei !== null && !tooMuch && !busy;

  const deposit = async () => {
    if (!canDeposit) return;
    setError(null);
    try {
      // An address this wallet was given but never used needs no second signature.
      const unused = deposits.find((item) => !item.txHash && canSendNow(item.expiresAt - nowSec()));
      let sessionId = unused?.sessionId;
      let address: Address | undefined = unused?.depositAddress as Address | undefined;
      if (!unused) {
        setStep('address');
        const session = await openSession.mutateAsync();
        sessionId = session.sessionId;
        address = session.depositAddress as Address;
      }
      setStep('send');
      const before = total;
      const hash = await send.sendTransactionAsync({ to: address!, value: wei!, chainId: appConfig.chainId });
      updateDeposit(sessionId!, { txHash: hash, amountWei: wei! });
      setSent({ hash, wei: wei!, before });
      setAmount('');
      setStep('confirming');
    } catch (cause) {
      setStep('idle');
      setError(isUserRejection(cause) ? 'You rejected it in your wallet. Nothing was sent.' : describeError(cause));
    }
  };

  const label = wei === null
    ? (amount.trim() ? 'Enter a valid amount' : 'Enter an amount')
    : tooMuch
      ? 'Not enough ETH in your wallet'
      : step === 'address' || step === 'send'
        ? 'Check your wallet'
        : step === 'confirming'
          ? 'Depositing…'
          : 'Deposit';

  return (
    <SimpleCard title="Deposit">
      <AmountBox
        id="deposit-amount"
        label="Amount"
        symbol="ETH"
        value={amount}
        onChange={(value) => { setAmount(value); if (step === 'done') setStep('idle'); }}
        footer={wallet.data !== undefined ? <span>Wallet: {formatUnitsDisplay(wallet.data, 18, 5)} ETH</span> : undefined}
      />
      {eth && (
        <div className="py-1">
          <Detail label="Your Cloakroom balance">{formatUnitsDisplay(BigInt(eth.available), 18, 5)} ETH</Detail>
        </div>
      )}

      {error && <StatusLine tone="bad" title="Deposit not sent">{error}</StatusLine>}
      {step === 'address' && <StatusLine tone="working" title="Step 1 of 2">Sign to get your deposit address.</StatusLine>}
      {step === 'send' && <StatusLine tone="working" title="Almost there">Confirm the transfer in your wallet.</StatusLine>}
      {step === 'confirming' && sent && (
        <StatusLine tone="working" title="Waiting for confirmation">
          <span className="flex flex-wrap items-center gap-2">It usually takes under a minute. <TxLink hash={sent.hash} /></span>
        </StatusLine>
      )}
      {step === 'done' && sent && (
        <StatusLine tone="ok" title="Deposit complete">
          {formatUnitsDisplay(sent.wei, 18, 5)} ETH is now in your Cloakroom balance.
        </StatusLine>
      )}

      <ActionButton label={label} onClick={() => void deposit()} disabled={!canDeposit} loading={step === 'address' || step === 'send'} />
      <p className="px-3 pb-1 pt-1 text-center text-xs text-fg-subtle">
        Your deposit is public on-chain. What stays private is which swap or withdrawal is yours.
      </p>
    </SimpleCard>
  );
}
