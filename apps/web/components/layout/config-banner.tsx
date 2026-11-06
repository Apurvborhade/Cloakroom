'use client';

import Link from 'next/link';
import { appConfig } from '@/lib/config';

export function ConfigBanner() {
  if (appConfig.apiUrl) return null;
  return (
    <div role="alert" className="border-b border-bad/30 bg-bad/10">
      <div className="mx-auto max-w-7xl px-4 py-2 text-xs text-fg sm:px-6">
        NEXT_PUBLIC_CLOAKROOM_API_URL is not set, so the app cannot reach the enclave. See{' '}
        <Link className="text-accent underline" href="/diagnostics">diagnostics</Link> and apps/web/.env.example.
      </div>
    </div>
  );
}
