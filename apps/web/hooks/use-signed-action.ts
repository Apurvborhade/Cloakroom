'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import type { Address } from 'viem';
import { api } from '@/lib/api';
import type { CloakroomApi } from '@/lib/api/client';
import { ApiError, CLIENT_ERROR_CODES } from '@/lib/api/errors';
import { signRequest } from '@/lib/wallet/typed-data';
import type { EnclaveBinding, SignedWire, TypedRequest } from '@/lib/wallet/typed-data';
import { ENCLAVE_QUERY_KEY, useEnclave } from './use-enclave';
import { useOwner } from './use-owner';
import { useOwnerSigner } from './use-owner-signer';
import { PRIVATE_QUERY_ROOT } from './use-private-read';

export interface ActionContext {
  owner: Address;
  binding: EnclaveBinding;
}

/**
 * One owner-signed, HPKE-sealed mutation: build the exact typed message, ask the primary wallet to
 * sign it (a fresh signature every time), seal and POST it, then refresh the affected reads.
 * A second call while one is in flight is refused, so a double click cannot submit twice.
 */
export function useSignedAction<Input, M, W, Result>(options: {
  build: (input: Input, context: ActionContext) => TypedRequest<M, W>;
  send: (client: CloakroomApi, binding: EnclaveBinding, signed: SignedWire<W>) => Promise<Result>;
  /** Private read names to refresh afterwards, e.g. ['balance', 'intents']. */
  refresh?: string[];
  onSuccess?: (result: Result, input: Input, request: TypedRequest<M, W>, context: ActionContext) => void;
}) {
  const { owner, ready, wrongChain } = useOwner();
  const { binding } = useEnclave();
  const signer = useOwnerSigner();
  const queryClient = useQueryClient();
  const inFlight = useRef(false);

  return useMutation<Result, Error, Input>({
    mutationFn: async (input) => {
      if (inFlight.current) throw new Error('DUPLICATE_SUBMISSION');
      if (wrongChain) throw new ApiError(CLIENT_ERROR_CODES.WRONG_WALLET_CHAIN);
      if (!owner || !ready) throw new ApiError(CLIENT_ERROR_CODES.NO_SESSION);
      if (!binding) throw new ApiError(CLIENT_ERROR_CODES.ENCLAVE_UNAVAILABLE);
      inFlight.current = true;
      try {
        const context = { owner, binding };
        const request = options.build(input, context);
        const signed = await signRequest(signer, request);
        const result = await options.send(api, binding, signed);
        options.onSuccess?.(result, input, request, context);
        return result;
      } catch (error) {
        // A changed enclave key (restart with a new vault) makes every signature fail: reload it.
        if (error instanceof ApiError && error.code === 'BAD_SIGNATURE') {
          void queryClient.invalidateQueries({ queryKey: ENCLAVE_QUERY_KEY });
        }
        throw error;
      } finally {
        inFlight.current = false;
        for (const name of options.refresh ?? []) {
          void queryClient.invalidateQueries({ queryKey: [PRIVATE_QUERY_ROOT, owner?.toLowerCase(), binding?.enclavePubKey, name] });
        }
      }
    },
  });
}
