import type { Address, Hex } from 'viem';
import { apiPostEnvelope } from './client';
import { DepositSessionResponseSchema, type DepositSessionResponse } from './schemas';
import { fetchAttestation } from './attestation';
import { NATIVE, buildTypedDataPayload } from '../crypto/typedData';

export interface DepositSession {
  sessionId: string;
  depositAddress: Address;
  expiresAt: number; // Unix timestamp in seconds
  owner: Address;
  asset: Address;
  nonce: string;
  createdAt: number;
}

export async function requestDepositSession(
  owner: Address,
  nonce: bigint,
  signTypedDataFn: (params: any) => Promise<Hex>,
  ttlSeconds: number = 900
): Promise<DepositSession> {
  const attestation = await fetchAttestation();
  const now = Math.floor(Date.now() / 1000);
  // Expiry for the DepositRequest signature must be within 300 seconds (MAX_EXPIRY_FUTURE_SEC)
  const signatureExpiry = BigInt(now + 240);

  const depositMessage = {
    owner,
    asset: NATIVE,
    nonce,
    expiry: signatureExpiry,
  };

  const typedData = buildTypedDataPayload(
    attestation.chainId,
    attestation.enclavePubKey,
    'DepositRequest',
    depositMessage
  );

  const signature = await signTypedDataFn(typedData);

  const requestPayload = {
    message: {
      owner,
      asset: NATIVE,
      nonce: nonce.toString(),
      expiry: signatureExpiry.toString(),
    },
    signature,
  };

  const response: DepositSessionResponse = await apiPostEnvelope(
    '/deposit-session',
    requestPayload,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    DepositSessionResponseSchema
  );

  return {
    sessionId: response.sessionId,
    depositAddress: response.depositAddress,
    expiresAt: response.expiresAt,
    owner,
    asset: NATIVE,
    nonce: nonce.toString(),
    createdAt: now,
  };
}
