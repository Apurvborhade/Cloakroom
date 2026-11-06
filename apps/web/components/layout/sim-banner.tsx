'use client';

import { useEnclave } from '@/hooks/use-enclave';

/** Persistent and not dismissible: a simulated key has no TEE behind it. */
export function SimBanner() {
  const { identity } = useEnclave();
  if (identity?.mode !== 'simulated') return null;
  return (
    <div role="alert" className="border-b border-warn/40 bg-warn/[0.12]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-xs sm:px-6">
        <span className="rounded border border-warn/60 px-1.5 py-0.5 font-mono font-semibold tracking-wider text-warn">TEE-SIMULATED</span>
        <span className="text-fg">
          This enclave runs outside a TEE. Its key is not attested, the operator can read every request, and there is no Nitro confidentiality.
          Use test funds only.
        </span>
      </div>
    </div>
  );
}
