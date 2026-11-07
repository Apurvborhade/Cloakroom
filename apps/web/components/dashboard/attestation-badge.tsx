'use client';

import Link from 'next/link';
import { useEnclave } from '@/hooks/use-enclave';
import { Badge } from '../ui/badge';

/**
 * Green only when this browser checked the Nitro quote against a pinned release. Otherwise the best
 * honest state is "attestation received, unverified".
 */
export function AttestationBadge() {
  const { identity, isLoading, error } = useEnclave();
  let content;
  if (isLoading) content = <Badge tone="neutral">Enclave: loading…</Badge>;
  else if (error || !identity) content = <Badge tone="bad" dot>Enclave unavailable</Badge>;
  else if (identity.mode === 'simulated') content = <Badge tone="warn" dot>TEE-simulated</Badge>;
  else if (identity.mode === 'attested-verified') content = <Badge tone="ok" dot>Attestation verified</Badge>;
  else content = <Badge tone="accent" dot>Attestation received · unverified in browser</Badge>;
  return (
    <Link href="/attestation" className="rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" aria-label="Attestation details">
      {content}
    </Link>
  );
}
