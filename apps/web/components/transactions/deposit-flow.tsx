'use client';

import { CONFIRMATIONS_DEFAULT, DEPOSIT_SESSION_DEFAULT_TTL_SEC, NATIVE } from '@cloakroom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { Hash } from 'viem';
import { useSendTransaction } from 'wagmi';
import { useActivity } from '@/hooks/use-activity';
import { useOpenDepositSession } from '@/hooks/use-actions';
import { useReadClient } from '@/hooks/use-chain-reader';
import { useOwner } from '@/hooks/use-owner';
import { useBalances } from '@/hooks/use-private-data';
import { useSession } from '@/hooks/use-session';
import { describeError, isUserRejection } from '@/lib/api/errors';
import { readBlockNumber, readNativeBalance, readReceipt } from '@/lib/chain/reads';
import { appConfig } from '@/lib/config';
import { canSendNow, depositStage, MIN_SECONDS_TO_SEND } from '@/lib/deposit/lifecycle';
import type { DepositStage } from '@/lib/deposit/lifecycle';
import { updateDeposit } from '@/lib/state/activity';
import { formatClock } from '@/lib/format/time';
import { AmountError, formatUnitsDisplay, parseUnitsStrict } from '@/lib/format/units';
import { cn } from '@/lib/cn';
import { SigningReview } from '../trading/signing-review';
import { CopyButton } from '../ui/copy-button';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardBody, CardHeader } from '../ui/card';
import { Countdown, useSecondsLeft } from '../ui/countdown';
import { Field, Input } from '../ui/field';
import { Notice } from '../ui/notice';
import { useToast } from '../ui/toast';
import { SessionUnlock } from '../wallet/gates';
import { QrCode } from './qr-code';
import { TxLink } from './tx-link';

const STEPS: Array<{ stage: DepositStage[]; label: string }> = [
  { stage: ['awaiting-transfer', 'session-expired'], label: 'Address assigned' },
  { stage: ['submitted', 'reverted'], label: 'Transaction submitted' },
  { stage: ['confirmed-on-chain'], label: 'Confirmed on-chain' },
  { stage: ['credited'], label: 'Credited by the enclave' },
];

function Stepper({ stage }: { stage: DepositStage }) {
  const index = STEPS.findIndex((step) => step.stage.includes(stage));
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Deposit progress">
      {STEPS.map((step, i) => {
        const state = i < index || stage === 'credited' ? 'done' : i === index ? 'current' : 'todo';
        return (
          <li key={step.label} aria-current={state === 'current' ? 'step' : undefined} className={cn('rounded-lg border px-3 py-2 text-xs', state === 'done' ? 'border-ok/30 bg-ok/5 text-ok' : state === 'current' ? 'border-accent/40 bg-accent-soft text-accent' : 'border-ink-700 text-fg-faint')}>
            <span className="font-mono">{i + 1}</span> · {step.label}
          </li>
        );
      })}
    </ol>
  );
}

export function DepositFlow() {
  const { owner } = useOwner();
  const { active: sessionActive } = useSession();
  const { deposits } = useActivity();
  const current = deposits[0] ?? null;
  const openSession = useOpenDepositSession();
  const send = useSendTransaction();
  const toast = useToast();
  const balances = useBalances();
  const { client, available: chainReadsOn, status: chainStatus } = useReadClient();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [totalAtSend, setTotalAtSend] = useState<bigint | null>(null);

  const secondsLeft = useSecondsLeft(current?.expiresAt ?? null) ?? 0;

  const amount = useMemo(() => {
    if (!amountText.trim()) return { value: null, error: null };
    try {
      const value = parseUnitsStrict(amountText, 18);
      return value > 0n ? { value, error: null } : { value: null, error: 'Enter an amount above zero' };
    } catch (error) {
      return { value: null, error: error instanceof AmountError ? error.message : 'Invalid amount' };
    }
  }, [amountText]);

  const walletBalance = useQuery({
    queryKey: ['chain', 'native-balance', owner],
    enabled: Boolean(owner) && chainReadsOn,
    queryFn: () => readNativeBalance(client, owner!),
    refetchInterval: 30_000,
  });

  const txHash = (current?.txHash ?? null) as Hash | null;
  const receipt = useQuery({
    queryKey: ['chain', 'receipt', txHash],
    enabled: Boolean(txHash) && chainReadsOn,
    queryFn: () => readReceipt(client, txHash!),
    refetchInterval: (query) => (query.state.data ? false : 5_000),
  });
  const head = useQuery({
    queryKey: ['chain', 'block-number'],
    enabled: Boolean(receipt.data) && chainReadsOn,
    queryFn: () => readBlockNumber(client),
    refetchInterval: 8_000,
  });

  const ethBalance = balances.data?.balances.find((item) => item.token.toLowerCase() === NATIVE);
  const totalNow = ethBalance ? BigInt(ethBalance.available) + BigInt(ethBalance.reserved) : null;

  const stage = depositStage({
    hasSession: Boolean(current),
    secondsLeft,
    txHash,
    receiptStatus: receipt.data ? receipt.data.status : null,
    privateTotalNow: totalNow,
    privateTotalAtSend: totalAtSend,
    amountWei: current?.amountWei ?? null,
  });

  // While waiting for the credit, refresh the private balance more often.
  useEffect(() => {
    if (stage !== 'submitted' && stage !== 'confirmed-on-chain') return;
    const timer = setInterval(() => void balances.refetch(), 8_000);
    return () => clearInterval(timer);
  }, [stage, balances]);

  useEffect(() => {
    if (stage === 'credited') toast.push({ tone: 'ok', title: 'Deposit credited', description: 'The enclave reports the ETH in your private balance.' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const requestAddress = () => {
    openSession.mutate(undefined, {
      onSuccess: () => {
        setReviewOpen(false);
        setAmountText('');
        setTotalAtSend(null);
        toast.push({ tone: 'ok', title: 'Deposit address assigned' });
      },
    });
  };

  const sendFromWallet = async () => {
    if (!current || amount.value === null) return;
    setSendError(null);
    if (!canSendNow(secondsLeft)) {
      setSendError('Too little time is left in this deposit session. Request a new address.');
      return;
    }
    try {
      setTotalAtSend(totalNow);
      const hash = await send.sendTransactionAsync({ to: current.depositAddress, value: amount.value, chainId: appConfig.chainId });
      updateDeposit(current.sessionId, { txHash: hash, amountWei: amount.value });
      toast.push({ tone: 'info', title: 'Transaction submitted', description: 'Waiting for it to be mined. Submitted is not credited.' });
    } catch (error) {
      setTotalAtSend(null);
      setSendError(isUserRejection(error) ? 'The transaction was rejected in your wallet.' : 'The wallet could not send the transaction.');
    }
  };

  const confirmations = receipt.data && head.data ? head.data - receipt.data.blockNumber + 1n : null;
  const explorer = appConfig.explorerUrl;

  return (
    <div className="space-y-6">
      {!current && (
        <Card>
          <CardHeader title="Request a deposit address" description="Native ETH only. Each request assigns a new custody address for this session." />
          <CardBody className="space-y-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-subtle">
              <li>You sign a <span className="font-mono text-fg-muted">DepositRequest</span>; it is encrypted to the enclave.</li>
              <li>The enclave assigns one address, valid for a limited time ({Math.round(DEPOSIT_SESSION_DEFAULT_TTL_SEC / 60)} minutes in the default configuration).</li>
              <li>You send ETH to it from your wallet. It is credited once the transfer has enough confirmations and was mined before the session ends.</li>
            </ol>
            <Notice tone="warn">
              The transfer is public: anyone can see your wallet sent this amount to this address. Cloakroom hides which later swap or payout it funds, not the deposit itself.
            </Notice>
            <Notice tone="info">
              USDC deposits are not supported by the v1 deposit flow. Deposit ETH and swap it if you need USDC.
            </Notice>
            <Button onClick={() => { openSession.reset(); setReviewOpen(true); }}>Request deposit address</Button>
          </CardBody>
        </Card>
      )}

      {current && (
        <Card>
          <CardHeader
            title="Your deposit address"
            description={`Session expires at ${formatClock(current.expiresAt)}.`}
            action={
              <Button variant="ghost" size="sm" onClick={() => { openSession.reset(); setReviewOpen(true); }}>
                New address
              </Button>
            }
          />
          <CardBody className="space-y-5">
            <Stepper stage={stage} />
            <div className="flex flex-col gap-5 sm:flex-row">
              <QrCode value={`ethereum:${current.depositAddress}@${appConfig.chainId}`} label={`QR code for deposit address ${current.depositAddress}`} />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-xs text-fg-subtle">Send native ETH on {appConfig.chain.name} to</p>
                  <p className="mt-1 break-all font-mono text-sm text-fg">{current.depositAddress}</p>
                  <div className="mt-2"><CopyButton value={current.depositAddress} label="Copy address" /></div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-fg-subtle">Time left</span>
                  <Badge tone={secondsLeft < MIN_SECONDS_TO_SEND ? 'warn' : 'accent'}>
                    <Countdown deadline={current.expiresAt} expiredLabel="Session expired" />
                  </Badge>
                </div>
              </div>
            </div>

            {stage === 'session-expired' && (
              <Notice tone="warn" title="Deposit session expired">
                Do not send to this address any more: transfers mined after the session ends are not credited. Request a new address.
              </Notice>
            )}

            {stage === 'awaiting-transfer' && (
              <div className="space-y-3 rounded-lg border border-ink-700 bg-ink-900/50 p-4">
                <Field
                  id="deposit-amount"
                  label="Amount to send"
                  error={amount.error}
                  trailing={
                    walletBalance.data !== undefined
                      ? <>Wallet: {formatUnitsDisplay(walletBalance.data, 18, 6)} ETH</>
                      : chainReadsOn ? 'Wallet balance: loading' : 'Wallet balance: chain reads off'
                  }
                >
                  <Input id="deposit-amount" inputMode="decimal" placeholder="0.05" value={amountText} onChange={(event) => setAmountText(event.target.value)} suffix="ETH" invalid={Boolean(amount.error)} />
                </Field>
                {walletBalance.data !== undefined && amount.value !== null && amount.value > walletBalance.data && (
                  <Notice tone="warn">This is more than your wallet holds (gas is extra).</Notice>
                )}
                {secondsLeft < MIN_SECONDS_TO_SEND && <Notice tone="warn">Less than {MIN_SECONDS_TO_SEND} seconds left. Request a new address instead.</Notice>}
                {sendError && <Notice tone="error">{sendError}</Notice>}
                <Button onClick={sendFromWallet} loading={send.isPending} disabled={amount.value === null || !canSendNow(secondsLeft)}>
                  Send from wallet
                </Button>
                <p className="text-xs text-fg-subtle">Your wallet sends a plain ETH transfer using its own RPC. You can also send from any wallet you control; it is credited to you either way.</p>
              </div>
            )}

            {txHash && (
              <div className="space-y-2 rounded-lg border border-ink-700 bg-ink-900/50 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-3"><span className="text-fg-subtle">Transaction</span><TxLink hash={txHash} /></div>
                {current.amountWei !== undefined && <p className="text-fg-subtle">Amount: <span className="text-fg">{formatUnitsDisplay(current.amountWei, 18, 8)} ETH</span></p>}
                {!chainReadsOn && (
                  <Notice tone="warn">
                    Browser chain reads are off ({chainStatus.detail}) so the receipt cannot be monitored here. Check the explorer; the private balance below still updates once the enclave credits it.
                  </Notice>
                )}
                {stage === 'submitted' && chainReadsOn && <p className="text-fg-muted">Submitted. Waiting for the transaction to be mined…</p>}
                {stage === 'reverted' && <Notice tone="error">The transaction reverted on-chain. Nothing was deposited.</Notice>}
                {stage === 'confirmed-on-chain' && (
                  <p className="text-fg-muted">
                    Mined in block {receipt.data?.blockNumber.toString()}
                    {confirmations !== null && <> · {confirmations.toString()} confirmation{confirmations === 1n ? '' : 's'}</>}. The enclave credits it after {CONFIRMATIONS_DEFAULT} confirmations by default; waiting for the private balance to reflect it…
                  </p>
                )}
                {stage === 'credited' && <Notice tone="ok" title="Credited">The enclave's ledger now shows this deposit in your private balance.</Notice>}
                {!sessionActive && (
                  <div className="pt-2"><p className="mb-2 text-xs text-fg-subtle">Unlock your private view to see when the deposit is credited.</p><SessionUnlock compact /></div>
                )}
              </div>
            )}
            {explorer === null && <p className="text-xs text-fg-faint">No explorer configured for chain {appConfig.chainId}.</p>}
          </CardBody>
        </Card>
      )}

      <SigningReview
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onConfirm={requestAddress}
        title="Request a deposit address"
        primaryType="DepositRequest"
        pending={openSession.isPending}
        error={openSession.error ? describeError(openSession.error) : undefined}
        rows={[
          { label: 'Owner', value: owner ?? '—', mono: true },
          { label: 'Asset', value: 'Native ETH (0x000…000)' },
        ]}
        authorises="Opening a deposit session: the enclave assigns you one custody address and credits native ETH received there while the session is open. It moves no funds."
        confirmLabel="Sign request"
      />
    </div>
  );
}
