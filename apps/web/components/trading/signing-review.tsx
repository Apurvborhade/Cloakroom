'use client';

import type { ReactNode } from 'react';
import { MUTATION_LIFETIME_SEC } from '@/lib/wallet/typed-data';
import { useEnclave } from '@/hooks/use-enclave';
import { Address } from '../ui/address';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { KeyValue, KeyValueList } from '../ui/key-value';
import { Notice } from '../ui/notice';

export interface ReviewRow {
  label: ReactNode;
  value: ReactNode;
  mono?: boolean;
}

/**
 * The readable review shown before any wallet popup. It names the EIP-712 type, the exact values,
 * and the domain the signature binds to. Signing starts only from the confirm button.
 */
export function SigningReview({
  open,
  onClose,
  onConfirm,
  title,
  primaryType,
  rows,
  authorises,
  warnings,
  pending,
  error,
  confirmLabel = 'Sign in wallet',
  canConfirm = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  primaryType: string;
  rows: ReviewRow[];
  authorises: ReactNode;
  warnings?: ReactNode;
  pending: boolean;
  error?: ReactNode;
  confirmLabel?: string;
  /** False keeps the sign button disabled, e.g. until inputs in `children` are valid. */
  canConfirm?: boolean;
  /** Inputs that belong to this action (amount, limit price), shown above the review. */
  children?: ReactNode;
}) {
  const { identity } = useEnclave();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      locked={pending}
      title={title}
      description={<>Your wallet will ask you to sign an EIP-712 <span className="font-mono">{primaryType}</span> message.</>}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={onConfirm} loading={pending} disabled={!canConfirm}>{pending ? 'Waiting for wallet…' : confirmLabel}</Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        <KeyValueList>
          {rows.map((row, index) => (
            <KeyValue key={index} label={row.label} mono={row.mono}>{row.value}</KeyValue>
          ))}
          <KeyValue label="Nonce and expiry">A fresh nonce; expires {Math.round(MUTATION_LIFETIME_SEC / 60)} minutes after signing</KeyValue>
        </KeyValueList>
        <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-xs">
          <p className="font-medium text-fg-muted">Signing domain</p>
          <p className="mt-1 text-fg-subtle">
            PrivateIntentNetwork v1 · chain {identity?.chainId ?? '—'} · salt = keccak256(enclave key)
          </p>
          {identity && <div className="mt-1"><Address value={identity.salt} head={10} tail={8} /></div>}
          {identity?.mode === 'simulated' && <p className="mt-2 text-warn">This enclave key is simulated and not attested.</p>}
        </div>
        <div className="text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-fg-subtle">What you are authorising</p>
          <div className="mt-1 text-fg-muted">{authorises}</div>
        </div>
        {warnings}
        {error && <Notice tone="error">{error}</Notice>}
        <p className="text-[11px] text-fg-faint">The signed request is encrypted to the enclave key with HPKE before it leaves your browser.</p>
      </div>
    </Dialog>
  );
}
