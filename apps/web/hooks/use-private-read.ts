'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionQueryWire } from '@cloakroom/shared';
import { api } from '@/lib/api';
import type { CloakroomApi } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { sessionStore } from '@/lib/session/session-store';
import type { EnclaveBinding, SignedWire } from '@/lib/wallet/typed-data';
import { useEnclave } from './use-enclave';
import { useOwner } from './use-owner';
import { useSession } from './use-session';

export const PRIVATE_QUERY_ROOT = 'private';

type Fetcher<T> = (client: CloakroomApi, binding: EnclaveBinding, query: SignedWire<SessionQueryWire>) => Promise<T>;

/**
 * A session-signed private read. The query key includes the owner and enclave key, so data from
 * one account can never be served to another, and the guard removes all of it on account change.
 * An UNKNOWN_SESSION or EXPIRED answer ends the local session so the UI asks for a new grant.
 */
export function usePrivateRead<T>(
  name: string,
  fetcher: Fetcher<T>,
  options: { refetchInterval?: number | false | ((data: T | undefined) => number | false); enabled?: boolean } = {},
) {
  const { owner } = useOwner();
  const { binding } = useEnclave();
  const { active } = useSession();
  return useQuery<T, ApiError>({
    queryKey: [PRIVATE_QUERY_ROOT, owner?.toLowerCase(), binding?.enclavePubKey, name],
    enabled: active && Boolean(owner && binding) && (options.enabled ?? true),
    queryFn: async () => {
      const query = await sessionStore.signQuery(owner, binding);
      try {
        return await fetcher(api, binding!, query);
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'UNKNOWN_SESSION' || error.code === 'EXPIRED')) {
          sessionStore.end('rejected-by-enclave');
        }
        throw error;
      }
    },
    retry: (count, error) => !(error instanceof ApiError && ['UNKNOWN_SESSION', 'EXPIRED', 'NO_SESSION', 'ROUTE_NOT_FOUND'].includes(error.code)) && count < 1,
    refetchInterval: typeof options.refetchInterval === 'function'
      ? (query) => (options.refetchInterval as (data: T | undefined) => number | false)(query.state.data)
      : options.refetchInterval ?? false,
    refetchOnWindowFocus: false,
  });
}
