'use client';

import { NATIVE } from '@cloakroom/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { encodeFunctionData, erc20Abi } from 'viem';
import type { Address, Hash } from 'viem';
import { useSendTransaction } from 'wagmi';
import { useMarginLendingAction, useOpenDepositSession } from '@/hooks/use-actions';
import { useReadClient } from '@/hooks/use-chain-reader';
import { useOwner } from '@/hooks/use-owner';
import { useBalances, useDepositStatuses } from '@/hooks/use-private-data';
import { describeError, errorCode, isUserRejection } from '@/lib/api/errors';
import { readNativeBalance, readTokenBalance } from '@/lib/chain/reads';
import { cn } from '@/lib/cn';
import { appConfig, knownTokens, tokenFor } from '@/lib/config';
import { canSendNow } from '@/lib/deposit/lifecycle';
import { depositTransfers, missingFunds } from '@/lib/deposit/funding';
import { nowSec } from '@/lib/format/time';
import { formatUnitsDisplay, formatUnitsExact, parseUnitsStrict } from '@/lib/format/units';
import { ChainReceipt } from '../transactions/chain-receipt';
import { TxLink } from '../transactions/tx-link';
import { Address as AddressText } from '../ui/address';
import { Countdown } from '../ui/countdown';
import { BalanceFreshness, DebugItem, DebugPanel, Elapsed } from './debug';
import { LendingOption } from './lending-option';
import { ActionButton, AmountBox, Detail, SimpleCard, StatusLine } from './parts';

interface ActiveDeposit {
  sessionId: string;
  address: Address;
  asset: Address;
  gasReserveWei: bigint;
  expiresAt: number;
  /** What the user wants credited, in base units. Null when resuming after a refresh. */
  amount: bigint | null;
  /** The ETH chosen to send beside USDC, at least the reserve. Null for ETH deposits or on resume. */
  gasToSend: bigint | null;
  startedAt: number;
}

interface SentFunds {
  native?: Hash;
  token?: Hash;
}

const USDC_UNAVAILABLE = "The nony.money server doesn't accept USDC deposits yet, so nothing was sent. Choose ETH to deposit now, then swap it for USDC.";

const STATUS_LABEL: Record<string, string> = {
  awaiting_funds: 'Waiting for your transfer',
  awaiting_gas: 'USDC received, waiting for ETH',
  awaiting_token: 'ETH received, waiting for USDC',
  credited: 'Credited',
  expired: 'Expired',
};

function parseAmount(text: string, decimals: number): bigint | null {
  if (!text.trim()) return null;
  try {
    const value = parseUnitsStrict(text, decimals);
    return value > 0n ? value : null;
  } catch {
    return null;
  }
}

const display = (value: bigint, decimals: number) => formatUnitsDisplay(value, decimals, decimals === 18 ? 5 : 3);

export function SimpleDeposit() {
  const { owner } = useOwner();
  const tokens = knownTokens();
  const openSession = useOpenDepositSession();
  const lend = useMarginLendingAction('supply');
  const send = useSendTransaction();
  const balances = useBalances();
  const statuses = useDepositStatuses();
  const { client, available: chainReadsOn } = useReadClient();

  const [asset, setAsset] = useState<Address>(tokens[0]!.address);
  const [amountText, setAmountText] = useState('');
  /** Null until edited, so the field follows the minimum. */
  const [gasText, setGasText] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveDeposit | null>(null);
  const [sent, setSent] = useState<SentFunds>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceBefore, setBalanceBefore] = useState<bigint | null>(null);
  const [creditedByBalance, setCreditedByBalance] = useState(false);
  const [lendDeposit, setLendDeposit] = useState(false);
  const lendAsked = useRef(false);

  const nativeAsset = appConfig.native.address;
  // The route and USDC deposits shipped together, so its absence means USDC would be refused.
  const usdcUnavailable = statuses.error ? errorCode(statuses.error) === 'ROUTE_NOT_FOUND' : false;
  // Never change the chosen token for the user: the amount typed would carry over to the other one.
  const chosenAsset = asset;
  const token = tokenFor(active?.asset ?? chosenAsset) ?? appConfig.native;
  const isEth = token.address === nativeAsset;
  const typedAmount = useMemo(() => parseAmount(amountText, token.decimals), [amountText, token.decimals]);
  const amount = active?.amount ?? typedAmount;

  // A server without this route has no USDC deposits or reserve, and credits everything sent.
  const statusRoute = !usdcUnavailable;
  const session = active ? statuses.data?.deposits.find((item) => item.sessionId === active.sessionId) : undefined;
  const status = session?.status ?? null;

  const wallet = useQuery({
    queryKey: ['chain', 'native-balance', owner],
    enabled: Boolean(owner) && chainReadsOn,
    queryFn: () => readNativeBalance(client, owner!),
    refetchInterval: 30_000,
  });
  const walletToken = useQuery({
    queryKey: ['chain', 'token-balance', owner, appConfig.tokenOut?.address],
    enabled: Boolean(owner && appConfig.tokenOut) && chainReadsOn,
    queryFn: () => readTokenBalance(client, appConfig.tokenOut!.address, owner!),
    refetchInterval: 30_000,
  });

  // After a refresh, pick up a deposit that has received part of its funds.
  useEffect(() => {
    if (active) return;
    const partial = statuses.data?.deposits.find((item) => item.singleUse && (item.status === 'awaiting_gas' || item.status === 'awaiting_token'));
    if (!partial) return;
    setActive({
      sessionId: partial.sessionId,
      address: partial.depositAddress as Address,
      asset: (partial.asset ?? NATIVE) as Address,
      gasReserveWei: BigInt(partial.gasReserveWei ?? '0'),
      expiresAt: partial.expiresAt,
      amount: null,
      gasToSend: null,
      startedAt: nowSec(),
    });
    setSent({});
  }, [active, statuses.data]);

  const assetBalance = balances.data?.balances.find((item) => item.token.toLowerCase() === token.address.toLowerCase());
  const assetTotal = assetBalance ? BigInt(assetBalance.available) + BigInt(assetBalance.reserved) + BigInt(assetBalance.pending) : null;

  useEffect(() => {
    if (statusRoute || !active || (!sent.native && !sent.token) || amount === null) return;
    if (balanceBefore !== null && assetTotal !== null && assetTotal >= balanceBefore + amount) setCreditedByBalance(true);
  }, [active, amount, assetTotal, balanceBefore, sent, statusRoute]);

  const credited = status === 'credited' || creditedByBalance;
  const expired = status === 'expired';

  // Only what this deposit credited in the chosen token, never the rest of the balance.
  const creditedAmount = session
    ? BigInt(isEth ? session.nativeCredited : session.tokenCredited)
    : credited ? amount ?? 0n : 0n;
  const lendAmount = credited && lendDeposit ? creditedAmount : 0n;
  const lendToken = token.address;
  const lendMutate = lend.mutate;

  // The backend can only lend what is already in the balance, so this signature comes after the credit.
  useEffect(() => {
    if (lendAmount <= 0n || lendAsked.current) return;
    lendAsked.current = true;
    lendMutate({ token: lendToken, amount: lendAmount });
  }, [lendAmount, lendMutate, lendToken]);

  const minGas = BigInt(statuses.data?.deposits.find((item) => item.singleUse)?.gasReserveWei ?? appConfig.depositGasReserveWei);
  const gasValue = gasText ?? formatUnitsExact(minGas, 18);
  const gasWei = parseAmount(gasValue, 18);
  const gasProblem = isEth
    ? null
    : gasWei === null
      ? 'Enter the ETH for gas'
      : gasWei < minGas
        ? `Needs at least ${display(minGas, 18)} ETH for gas`
        : wallet.data !== undefined && gasWei > wallet.data
          ? 'Not enough ETH in your wallet for gas'
          : null;

  const nativeReceived = BigInt(session?.nativeReceived ?? '0');
  const tokenReceived = BigInt(session?.tokenReceived ?? '0');
  const missing = active
    ? missingFunds(
        { asset: active.asset, gasReserveWei: active.gasReserveWei, nativeReceived, tokenReceived },
        amount,
      )
    : null;
  // Received amounts lag behind the chain, so never ask again for something just sent.
  const chosenGasLeft = active?.gasToSend != null && active.gasToSend > nativeReceived ? active.gasToSend - nativeReceived : 0n;
  const toSend = {
    native: missing && !sent.native ? (chosenGasLeft > missing.native ? chosenGasLeft : missing.native) : 0n,
    token: missing && !sent.token ? missing.token : 0n,
  };
  // After a refresh the planned USDC amount is gone, so the user has to say how much to send.
  const needsTokenAmount = Boolean(active) && !isEth && active?.amount === null && tokenReceived === 0n && !sent.token;
  const waiting = Boolean(active) && !credited && !expired && toSend.native === 0n && toSend.token === 0n;
  const showFunding = Boolean(active) && !credited && !expired;

  const planned = active && amount !== null ? depositTransfers(active.asset, amount, active.gasToSend ?? active.gasReserveWei) : null;
  const extraEth = active?.gasToSend != null && active.gasToSend > active.gasReserveWei ? active.gasToSend - active.gasReserveWei : 0n;
  const walletEth = wallet.data;
  const shortOfEth = walletEth !== undefined && toSend.native > walletEth;
  const shortOfToken = !isEth && walletToken.data !== undefined && toSend.token !== null && toSend.token > walletToken.data;
  const footerBalance = isEth ? walletEth : walletToken.data;
  const usdcBlocked = !active && !isEth && usdcUnavailable;
  const canStart = !active && !usdcBlocked && typedAmount !== null && !gasProblem && (footerBalance === undefined || typedAmount <= footerBalance);

  const getAddress = async () => {
    if (!canStart || typedAmount === null) return;
    setError(null);
    setBalanceBefore(assetTotal);
    setCreditedByBalance(false);
    try {
      // An address given to this wallet for this asset and still unfunded needs no new signature.
      const unused = statuses.data?.deposits.find((item) =>
        item.singleUse && item.status === 'awaiting_funds' && (item.asset ?? NATIVE).toLowerCase() === chosenAsset.toLowerCase()
        && canSendNow(item.expiresAt - nowSec()));
      const opened = unused ?? await openSession.mutateAsync(chosenAsset);
      const reserve = BigInt(opened.gasReserveWei ?? '0');
      setActive({
        sessionId: opened.sessionId,
        address: opened.depositAddress as Address,
        asset: chosenAsset,
        gasReserveWei: reserve,
        expiresAt: opened.expiresAt,
        amount: typedAmount,
        // The server's reserve decides, in case it is above what was shown.
        gasToSend: chosenAsset === nativeAsset ? null : gasWei !== null && gasWei > reserve ? gasWei : reserve,
        startedAt: nowSec(),
      });
      setSent({});
    } catch (cause) {
      setError(
        isUserRejection(cause)
          ? 'You rejected it in your wallet. Nothing was sent.'
          : errorCode(cause) === 'UNSUPPORTED_ASSET'
            ? USDC_UNAVAILABLE
            : describeError(cause),
      );
    }
  };

  const sendFunds = async () => {
    if (!active || sending) return;
    setError(null);
    setSending(true);
    try {
      if (!isEth && toSend.token !== null && toSend.token > 0n) {
        const hash = await send.sendTransactionAsync({
          to: active.asset,
          data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [active.address, toSend.token] }),
          chainId: appConfig.chainId,
        });
        setSent((current) => ({ ...current, token: hash }));
      }
      if (toSend.native > 0n) {
        const hash = await send.sendTransactionAsync({ to: active.address, value: toSend.native, chainId: appConfig.chainId });
        setSent((current) => ({ ...current, native: hash }));
      }
    } catch (cause) {
      setError(isUserRejection(cause) ? 'You rejected it in your wallet. Press the button to send what is left.' : describeError(cause));
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setActive(null);
    setSent({});
    setError(null);
    setAmountText('');
    setGasText(null);
    setCreditedByBalance(false);
    setBalanceBefore(null);
    setLendDeposit(false);
    lendAsked.current = false;
    lend.reset();
    openSession.reset();
  };

  const sendsToken = !isEth && toSend.token !== 0n;
  const sendLabel = sendsToken && toSend.native > 0n ? 'Send USDC and ETH' : sendsToken ? 'Send USDC' : 'Send ETH';
  const label = active
    ? sending
      ? 'Check your wallet'
      : waiting
        ? 'Depositing…'
        : needsTokenAmount && typedAmount === null
          ? 'Enter the USDC amount'
          : shortOfEth
            ? 'Not enough ETH in your wallet'
            : shortOfToken
              ? 'Not enough USDC in your wallet'
              : sendLabel
    : usdcBlocked
      ? 'USDC deposits unavailable'
      : openSession.isPending
      ? 'Check your wallet'
      : typedAmount === null
        ? (amountText.trim() ? 'Enter a valid amount' : 'Enter an amount')
        : gasProblem
          ? gasProblem
          : canStart
            ? 'Get deposit address'
            : `Not enough ${token.symbol} in your wallet`;

  const hashes = [sent.token, sent.native].filter((hash): hash is Hash => Boolean(hash));

  return (
    <SimpleCard title="Deposit" after={<LendingOption token={token.address} symbol={token.symbol} decimals={token.decimals} lendDeposit={lendDeposit} onLendDepositChange={setLendDeposit} locked={credited || expired} />}>
      {tokens.length > 1 && !active && (
        <div className="flex gap-1.5 px-1 pb-1">
          {tokens.map((item) => (
            <button
              key={item.address}
              type="button"
              aria-pressed={item.address === chosenAsset}
              onClick={() => { setAsset(item.address); setAmountText(''); setError(null); }}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                item.address === chosenAsset ? 'bg-accent-soft text-accent' : 'text-fg-subtle hover:text-fg',
              )}
            >
              {item.symbol}
            </button>
          ))}
        </div>
      )}

      {(!active || needsTokenAmount) && (
        <AmountBox
          id="deposit-amount"
          label={needsTokenAmount ? 'USDC to send' : 'Amount'}
          symbol={token.symbol}
          value={amountText}
          onChange={setAmountText}
          footer={footerBalance !== undefined ? <span>Wallet: {display(footerBalance, token.decimals)} {token.symbol}</span> : undefined}
        />
      )}

      {!active && !isEth && (
        <AmountBox
          id="deposit-gas"
          label="ETH for gas"
          symbol="ETH"
          value={gasValue}
          onChange={setGasText}
          footer={<span>Minimum {display(minGas, 18)} ETH{walletEth !== undefined ? ` · Wallet: ${display(walletEth, 18)} ETH` : ''}</span>}
        />
      )}

      {!active && (
        <div className="py-1">
          {usdcBlocked && <StatusLine tone="bad" title="USDC deposits aren't available yet">{USDC_UNAVAILABLE}</StatusLine>}
          {!isEth && !usdcBlocked && <p className="px-3 py-1 text-sm text-fg-subtle">This ETH goes to the same address as your USDC. The minimum pays for gas later and isn't credited. Anything above it is added to your balance.</p>}
          {assetBalance && <Detail label="Your nony.money balance">{display(BigInt(assetBalance.available), token.decimals)} {token.symbol}</Detail>}
        </div>
      )}

      {showFunding && active && (
        <div className="py-1">
          {amount !== null && <Detail label="You'll be credited">{display(amount, token.decimals)} {token.symbol}</Detail>}
          {extraEth > 0n && <Detail label="Also credited">{display(extraEth, 18)} ETH</Detail>}
          {active.gasReserveWei > 0n && <Detail label="Gas reserve, not credited">{display(active.gasReserveWei, 18)} ETH</Detail>}
          {planned && (
            <Detail label="Total from your wallet">
              {!isEth && `${display(planned.token, token.decimals)} ${token.symbol} + `}{display(planned.native, 18)} ETH
            </Detail>
          )}
          {active.gasReserveWei > 0n && (
            <p className="px-3 pt-1 text-xs text-fg-subtle">The reserve stays on this address to pay for gas, and you don't get it back.</p>
          )}
        </div>
      )}

      {error && !usdcBlocked && <StatusLine tone="bad" title="Deposit not finished">{error}</StatusLine>}
      {showFunding && !waiting && active?.amount === null && (
        <StatusLine tone="working" title="Finish your deposit">This address has received part of a deposit. Send the rest to complete it.</StatusLine>
      )}
      {showFunding && !waiting && !sending && sendsToken && toSend.native > 0n && (
        <StatusLine tone="working" title="Your wallet will open twice">Once for the USDC, then once for the ETH.</StatusLine>
      )}
      {waiting && (
        <StatusLine tone="working" title={status ? (STATUS_LABEL[status] ?? 'Waiting for confirmation') : 'Waiting for confirmation'}>
          It usually takes under a minute.
        </StatusLine>
      )}
      {credited && (
        <StatusLine tone="ok" title="Deposit complete">
          {session && BigInt(session.tokenCredited) > 0n
            ? `${display(BigInt(session.tokenCredited), token.decimals)} ${token.symbol}${BigInt(session.nativeCredited) > 0n ? ` and ${display(BigInt(session.nativeCredited), 18)} ETH` : ''} ${BigInt(session.nativeCredited) > 0n ? 'are' : 'is'} now in your nony.money balance.`
            : session && BigInt(session.nativeCredited) > 0n
              ? `${display(BigInt(session.nativeCredited), 18)} ETH is now in your nony.money balance.`
              : amount !== null
                ? `${display(amount, token.decimals)} ${token.symbol} is now in your nony.money balance.`
                : 'Your balance has been updated.'}
        </StatusLine>
      )}
      {lendAmount > 0n && lend.isPending && (
        <StatusLine tone="working" title="Lending your deposit">Sign in your wallet to lend {display(lendAmount, token.decimals)} {token.symbol} to margin traders.</StatusLine>
      )}
      {lendAmount > 0n && lend.isSuccess && (
        <StatusLine tone="ok" title="Deposit lent">{display(lendAmount, token.decimals)} {token.symbol} moved from your balance to lending. You can take it back below when it isn't out on loan.</StatusLine>
      )}
      {lendAmount > 0n && lend.error && (
        <StatusLine tone="bad" title="Your deposit wasn't lent">
          <span className="block">{isUserRejection(lend.error) ? 'You rejected it in your wallet.' : describeError(lend.error)} The money is safe in your balance.</span>
          <button type="button" onClick={() => lend.mutate({ token: lendToken, amount: lendAmount })} className="mt-1 font-medium text-accent hover:text-accent-strong">
            Try lending again
          </button>
        </StatusLine>
      )}
      {expired && <StatusLine tone="bad" title="This deposit address expired">Don't send anything else to it. Start a new deposit.</StatusLine>}

      {active && (
        <DebugPanel summary="Deposit details" defaultOpen>
          <dl className="space-y-0.5">
            <DebugItem label="Status">{status ? <code className="font-mono">{status}</code> : statusRoute ? 'Checking…' : 'Not reported by this server'}</DebugItem>
            {waiting && <DebugItem label="Time so far"><Elapsed fromSec={active.startedAt} /></DebugItem>}
            <DebugItem label="Balance updated"><BalanceFreshness /></DebugItem>
            <DebugItem label="ETH received">{session ? `${display(BigInt(session.nativeReceived), 18)} ETH` : 'Not reported'}</DebugItem>
            {!isEth && <DebugItem label="USDC received">{session ? `${display(tokenReceived, token.decimals)} USDC` : 'Not reported'}</DebugItem>}
            <DebugItem label="Deposit address"><AddressText value={active.address} head={8} tail={6} /></DebugItem>
            {!credited && <DebugItem label="Address valid for"><Countdown deadline={active.expiresAt} expiredLabel="Expired" /></DebugItem>}
            {hashes.map((hash) => (
              <DebugItem key={hash} label="Transaction">
                <span className="flex flex-wrap items-center justify-end gap-2"><TxLink hash={hash} /><ChainReceipt hash={hash} /></span>
              </DebugItem>
            ))}
          </dl>
        </DebugPanel>
      )}

      {credited || expired ? (
        <ActionButton label="Start a new deposit" onClick={reset} disabled={lend.isPending} />
      ) : active ? (
        <ActionButton
          label={label}
          onClick={() => void sendFunds()}
          disabled={waiting || sending || shortOfEth || shortOfToken || (needsTokenAmount && typedAmount === null)}
          loading={sending}
        />
      ) : (
        <ActionButton label={label} onClick={() => void getAddress()} disabled={!canStart || openSession.isPending} loading={openSession.isPending} />
      )}
      <p className="px-3 pb-1 pt-1 text-center text-xs text-fg-subtle">
        Your deposit is public on-chain. What stays private is which swap or withdrawal is yours.
      </p>
    </SimpleCard>
  );
}
