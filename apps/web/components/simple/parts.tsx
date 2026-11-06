'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import type { ReactNode } from 'react';
import { useSwitchChain } from 'wagmi';
import { useEnclave } from '@/hooks/use-enclave';
import { useOwner } from '@/hooks/use-owner';
import { useBalances } from '@/hooks/use-private-data';
import { useSession } from '@/hooks/use-session';
import { describeError } from '@/lib/api/errors';
import { cn } from '@/lib/cn';
import { appConfig } from '@/lib/config';
import { floorToStep, isStepInput, stepAmount } from '@/lib/format/steps';
import { formatUnitsDisplay } from '@/lib/format/units';
import { Button } from '../ui/button';

export function SimpleCard({ title, children, after }: { title: string; children: ReactNode; after?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[480px] pt-4 sm:pt-12">
      <h1 className="mb-3 px-2 text-lg font-medium text-fg">{title}</h1>
      <div className="space-y-1.5 rounded-3xl border border-ink-700 bg-ink-850 p-2 shadow-panel">{children}</div>
      {after}
    </div>
  );
}

function StepButton({ label, symbol, onClick }: { label: string; symbol: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-ink-600 bg-ink-900 text-base text-fg-muted transition-colors hover:border-accent hover:text-accent"
    >
      <span aria-hidden>{symbol}</span>
    </button>
  );
}

export function AmountBox({
  label,
  symbol,
  value,
  onChange,
  readOnly = false,
  footer,
  id,
}: {
  label: string;
  symbol: ReactNode;
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  footer?: ReactNode;
  id: string;
}) {
  return (
    <div className="rounded-2xl bg-ink-800 p-4">
      <label htmlFor={id} className="text-sm text-fg-subtle">{label}</label>
      <div className="mt-2 flex items-center gap-3">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          readOnly={readOnly}
          onChange={(event) => {
            if (isStepInput(event.target.value)) onChange?.(event.target.value);
          }}
          onKeyDown={(event) => {
            if (readOnly || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
            event.preventDefault();
            onChange?.(stepAmount(value, event.key === 'ArrowUp' ? 1 : -1));
          }}
          className="w-0 min-w-0 flex-1 bg-transparent text-4xl font-medium text-fg outline-none placeholder:text-fg-faint"
        />
        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1.5">
            <StepButton label="Decrease by 0.01" symbol="−" onClick={() => onChange?.(stepAmount(value, -1))} />
            <StepButton label="Increase by 0.01" symbol="+" onClick={() => onChange?.(stepAmount(value, 1))} />
          </div>
        )}
        <span className="shrink-0 rounded-full border border-ink-600 bg-ink-900 px-3 py-1.5 text-sm font-medium text-fg">{symbol}</span>
      </div>
      {footer && <div className="mt-2 flex min-h-5 items-center justify-end gap-2 text-sm text-fg-subtle">{footer}</div>}
    </div>
  );
}

/** A private balance with a Max button, rounded down to whole steps. Hidden until sign-in. */
export function PrivateBalance({
  token,
  decimals,
  symbol,
  onMax,
}: {
  token: string;
  decimals: number;
  symbol: string;
  onMax: (value: string) => void;
}) {
  const balances = useBalances();
  const balance = balances.data?.balances.find((item) => item.token.toLowerCase() === token.toLowerCase());
  if (!balance) return null;
  const available = BigInt(balance.available);
  const max = floorToStep(available, decimals);
  return (
    <>
      <span>{formatUnitsDisplay(available, decimals, decimals === 18 ? 5 : 2)} {symbol}</span>
      {max !== null && (
        <button type="button" className="font-medium text-accent hover:text-accent-strong" onClick={() => onMax(max)}>
          Max
        </button>
      )}
    </>
  );
}

export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-1 text-sm">
      <span className="text-fg-subtle">{label}</span>
      <span className="text-right text-fg-muted">{children}</span>
    </div>
  );
}

export type StatusTone = 'working' | 'ok' | 'bad';

export function StatusLine({ tone, title, children }: { tone: StatusTone; title: string; children?: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-2xl p-4 text-sm',
        tone === 'ok' && 'bg-ok/10 text-ok',
        tone === 'bad' && 'bg-bad/10 text-bad',
        tone === 'working' && 'bg-accent-soft text-accent',
      )}
    >
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-fg-muted">{children}</div>}
    </div>
  );
}

/**
 * The one main button. It walks through whatever is missing, in order: connect, switch network,
 * sign in once, then the action. Nothing asks for a signature until the user presses it.
 */
export function ActionButton({
  label,
  onClick,
  disabled = false,
  loading = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { isConnected, isConnecting, wrongChain } = useOwner();
  const { openConnectModal } = useConnectModal();
  const { switchChain, isPending: switching } = useSwitchChain();
  const { binding, error: enclaveError, refetch, isFetching, isLoading: enclaveLoading } = useEnclave();
  const { active, unlock, canUnlock } = useSession();
  const big = 'h-14 w-full rounded-2xl text-base';

  if (isConnecting) return <Button size="lg" className={big} loading>Connecting…</Button>;
  if (!isConnected) return <Button size="lg" className={big} onClick={openConnectModal}>Connect wallet</Button>;
  if (wrongChain) {
    return (
      <Button size="lg" className={big} loading={switching} onClick={() => switchChain({ chainId: appConfig.chainId })}>
        Switch to {appConfig.chain.name}
      </Button>
    );
  }
  if (!binding) {
    return (
      <div className="space-y-1.5">
        {enclaveError && <StatusLine tone="bad" title="Can't reach Cloakroom">{describeError(enclaveError)}</StatusLine>}
        <Button size="lg" className={big} loading={enclaveLoading || isFetching} onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (!active) {
    return (
      <div className="space-y-1.5">
        {unlock.error && <StatusLine tone="bad" title="Sign-in didn't finish">{describeError(unlock.error)}</StatusLine>}
        <Button size="lg" className={big} loading={unlock.isPending} disabled={!canUnlock} onClick={() => unlock.mutate()}>
          {unlock.isPending ? 'Check your wallet' : 'Sign in to see your balance'}
        </Button>
        <p className="px-3 pb-1 text-center text-xs text-fg-subtle">
          One signature, good for 30 minutes. It can only read your balance and can't move funds.
        </p>
      </div>
    );
  }
  return <Button size="lg" className={big} loading={loading} disabled={disabled} onClick={onClick}>{label}</Button>;
}
