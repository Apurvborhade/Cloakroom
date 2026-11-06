import type { Address, Hex } from 'viem';
import { apiPostEnvelope } from './client';
import {
  WithdrawalResponseSchema,
  WithdrawalStatusResponseSchema,
  type WithdrawalResponse,
  type WithdrawalStatusItem,
} from './schemas';
import { fetchAttestation } from './attestation';
import { getStoredSessionKey, signSessionQuery } from '../crypto/sessionKey';
import { buildTypedDataPayload, NATIVE } from '../crypto/typedData';

export interface SubmitWithdrawalParams {
  owner: Address;
  token?: Address;
  amountRaw: bigint;
  to: Address;
  nonce: bigint;
  signTypedDataFn: (params: any) => Promise<Hex>;
}

export async function submitWithdrawal(params: SubmitWithdrawalParams): Promise<WithdrawalResponse> {
  const attestation = await fetchAttestation();
  const token = params.token || NATIVE;
  const now = Math.floor(Date.now() / 1000);
  const expiry = BigInt(now + 240); // 4 minutes ahead

  const withdrawalMessage = {
    owner: params.owner,
    token,
    amount: params.amountRaw,
    to: params.to,
    nonce: params.nonce,
    expiry,
  };

  const typedData = buildTypedDataPayload(
    attestation.chainId,
    attestation.enclavePubKey,
    'Withdrawal',
    withdrawalMessage
  );

  const signature = await params.signTypedDataFn(typedData);

  const requestPayload = {
    message: {
      owner: params.owner,
      token,
      amount: params.amountRaw.toString(),
      to: params.to,
      nonce: params.nonce.toString(),
      expiry: expiry.toString(),
    },
    signature,
  };

  const response = await apiPostEnvelope(
    '/withdrawals',
    requestPayload,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    WithdrawalResponseSchema
  );

  return response;
}

export async function fetchWithdrawalStatus(
  owner: Address,
  signTypedDataFallback?: (params: any) => Promise<any>
): Promise<WithdrawalStatusItem[]> {
  const attestation = await fetchAttestation();
  const session = getStoredSessionKey(owner);

  let signedQuery: { message: { owner: Address; expiry: string }; signature: string };

  if (session) {
    signedQuery = await signSessionQuery(session, attestation.chainId, attestation.enclavePubKey);
  } else if (signTypedDataFallback) {
    const now = Math.floor(Date.now() / 1000);
    const expiry = BigInt(now + 120);
    const payload = buildTypedDataPayload(
      attestation.chainId,
      attestation.enclavePubKey,
      'SessionQuery',
      { owner, expiry }
    );
    const signature = await signTypedDataFallback(payload);
    signedQuery = {
      message: { owner, expiry: expiry.toString() },
      signature,
    };
  } else {
    return [];
  }

  try {
    const response = await apiPostEnvelope(
      '/withdrawals/status',
      signedQuery,
      {
        chainId: attestation.chainId,
        enclavePubKey: attestation.enclavePubKey,
      },
      WithdrawalStatusResponseSchema
    );
    return response.withdrawals;
  } catch {
    // If /withdrawals/status is not yet mounted on backend, return empty list gracefully
    return [];
  }
}
