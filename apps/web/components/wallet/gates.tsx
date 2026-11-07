'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import type { ReactNode } from 'react';
import { useSwitchChain } from 'wagmi';
import { describeError } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import { formatClock } from '@/lib/format/time';
import { useEnclave } from '@/hooks/use-enclave';
import { useOwner } from '@/hooks/use-owner';
import { useSession } from '@/hooks/use-session';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Notice } from '../ui/notice';
import { Countdown } from '../ui/countdown';

function GateCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-start gap-3 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <div className="mt-1 text-sm text-fg-subtle">{children}</div>
      </div>
      {action}
    </Card>
  );
}

/** Children render only with a connected wallet on the configured chain. */
export function RequireWallet({ children, purpose = 'use nony.money' }: { children: ReactNode; purpose?: string }) {
  const { isConnected, isConnecting, wrongChain, walletChainId } = useOwner();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending } = useSwitchChain();
  if (isConnecting) return <GateCard title="Connecting wallet…">Waiting for your wallet.</GateCard>;
  if (!isConnected) {
    return (
      <GateCard title="Connect a wallet" action={<Button onClick={openConnectModal}>Connect wallet</Button>}>
        Connect the Ethereum wallet you want to {purpose} with. It signs structured EIP-712 messages; nony.money never sees its private key.
      </GateCard>
    );
  }
  if (wrongChain) {
    return (
      <GateCard
        title="Wrong network"
        action={
          <Button variant="secondary" loading={isPending} onClick={() => switchChain({ chainId: appConfig.chainId })}>
            Switch to {appConfig.chain.name}
          </Button>
        }
      >
        Your wallet is on chain {walletChainId}. Every signature is bound to chain {appConfig.chainId}.
      </GateCard>
    );
  }
  return <>{children}</>;
}

/** Children render only once the enclave key is loaded. */
export function RequireEnclave({ children }: { children: ReactNode }) {
  const { identity, isLoading, error, refetch, isFetching } = useEnclave();
  if (isLoading) return <GateCard title="Loading enclave key…">Fetching the enclave's public key and attestation.</GateCard>;
  if (error || !identity) {
    return (
      <GateCard title="Enclave unavailable" action={<Button variant="secondary" loading={isFetching} onClick={() => refetch()}>Retry</Button>}>
        {describeError(error)} Requests cannot be encrypted or signed without the enclave key.
      </GateCard>
    );
  }
  return <>{children}</>;
}

const END_REASON: Record<string, string> = {
  expired: 'Your read session expired.',
  'account-changed': 'The connected account changed, so the previous read session was discarded.',
  'chain-changed': 'The wallet network changed, so the read session was discarded.',
  'enclave-changed': 'The enclave key changed, so the read session was discarded.',
  'rejected-by-enclave': 'The enclave no longer recognises the read session (it may have restarted).',
};

/** The "unlock" step: one primary-wallet signature authorises a 30-minute read-only session key. */
export function SessionUnlock({ compact = false }: { compact?: boolean }) {
  const { unlock, canUnlock, lastEndReason } = useSession();
  const body = (
    <>
      Sign one <span className="font-mono text-fg-muted">SessionGrant</span> to create a browser-held, read-only key valid for up to 30 minutes. It can read your balances and statuses, and cannot sign deposits, swaps, cancellations, withdrawals or margin actions. It lives in memory only: a page refresh asks again.
    </>
  );
  const action = (
    <Button onClick={() => unlock.mutate()} loading={unlock.isPending} disabled={!canUnlock}>
      Unlock private view
    </Button>
  );
  return (
    <div className="space-y-3">
      {lastEndReason && END_REASON[lastEndReason] && <Notice tone="warn">{END_REASON[lastEndReason]}</Notice>}
      {unlock.error && <Notice tone="error" title="Could not start the read session">{describeError(unlock.error)}</Notice>}
      {compact ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-xs text-fg-subtle">{body}</p>
          {action}
        </div>
      ) : (
        <GateCard title="Unlock your private view" action={action}>
          {body}
        </GateCard>
      )}
    </div>
  );
}

/** Wallet, enclave and read session, in that order. */
export function RequireSession({ children, purpose }: { children: ReactNode; purpose?: string }) {
  return (
    <RequireWallet purpose={purpose}>
      <RequireEnclave>
        <SessionContent>{children}</SessionContent>
      </RequireEnclave>
    </RequireWallet>
  );
}

function SessionContent({ children }: { children: ReactNode }) {
  const { active } = useSession();
  return active ? <>{children}</> : <SessionUnlock />;
}

export function SessionIndicator() {
  const { session, end } = useSession();
  if (!session) return <span className="text-xs text-fg-subtle">No read session</span>;
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
      Read session · expires {formatClock(session.expiresAt)} (<Countdown deadline={session.expiresAt} />)
      <button type="button" onClick={end} className="text-fg-muted underline hover:text-fg">
        End
      </button>
    </span>
  );
}
