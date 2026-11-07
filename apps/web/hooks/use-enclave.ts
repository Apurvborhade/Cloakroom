'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api';
import { appConfig } from '@/lib/config';
import { loadEnclaveIdentity } from '@/lib/attestation/enclave-identity';
import type { EnclaveIdentity } from '@/lib/attestation/enclave-identity';
import type { EnclaveBinding } from '@/lib/wallet/typed-data';

export const ENCLAVE_QUERY_KEY = ['enclave', appConfig.apiUrl] as const;

/** The enclave key and attestation data. Fetched once on load (no wallet popup), refreshable. */
export function useEnclave() {
  const query = useQuery<EnclaveIdentity>({
    queryKey: ENCLAVE_QUERY_KEY,
    queryFn: () => loadEnclaveIdentity(api, { expectedChainId: appConfig.chainId, allowSimulated: appConfig.allowSimulatedEnclave, trustedRelease: appConfig.attestationRelease }),
    enabled: Boolean(appConfig.apiUrl),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  const identity = query.data ?? null;
  const binding = useMemo<EnclaveBinding | null>(
    () => (identity ? { chainId: identity.chainId, enclavePubKey: identity.enclavePubKey } : null),
    [identity],
  );
  return { ...query, identity, binding };
}
