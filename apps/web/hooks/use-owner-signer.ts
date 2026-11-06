'use client';

import { useCallback } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { ApiError, CLIENT_ERROR_CODES, isUserRejection } from '@/lib/api/errors';
import { appConfig } from '@/lib/config';
import type { TypedDataSigner } from '@/lib/wallet/typed-data';

/**
 * The primary wallet's EIP-712 signer. It refuses to ask for a signature when the wallet is on
 * the wrong chain, and turns a wallet rejection into USER_REJECTED. It is only ever called from an
 * explicit user action, never on mount.
 */
export function useOwnerSigner(): TypedDataSigner {
  const { signTypedDataAsync } = useSignTypedData();
  const { chainId, isConnected } = useAccount();
  return useCallback<TypedDataSigner>(
    async (args) => {
      if (!isConnected) throw new ApiError(CLIENT_ERROR_CODES.NO_SESSION);
      if (chainId !== appConfig.chainId) throw new ApiError(CLIENT_ERROR_CODES.WRONG_WALLET_CHAIN);
      try {
        return await signTypedDataAsync(args as Parameters<typeof signTypedDataAsync>[0]);
      } catch (error) {
        if (isUserRejection(error)) throw new ApiError(CLIENT_ERROR_CODES.USER_REJECTED);
        throw error;
      }
    },
    [chainId, isConnected, signTypedDataAsync],
  );
}
