import type { Address, Hex } from 'viem';
import { apiPostEnvelope } from './client';
import { SessionResponseSchema, type SessionResponse } from './schemas';
import { fetchAttestation } from './attestation';
import { createNewSessionKey, getStoredSessionKey, type SessionKeyState } from '../crypto/sessionKey';
import { buildTypedDataPayload } from '../crypto/typedData';

export async function ensureActiveSession(
  owner: Address,
  signTypedDataFn: (params: any) => Promise<Hex>
): Promise<SessionKeyState> {
  const existing = getStoredSessionKey(owner);
  if (existing) {
    return existing;
  }

  // Generate ephemeral session key
  const newSession = createNewSessionKey(owner, 1800);
  const attestation = await fetchAttestation();
  const now = Math.floor(Date.now() / 1000);
  const expiry = BigInt(now + 1800);

  const grantMessage = {
    owner,
    sessionKey: newSession.address,
    expiry,
  };

  const typedData = buildTypedDataPayload(
    attestation.chainId,
    attestation.enclavePubKey,
    'SessionGrant',
    grantMessage
  );

  const signature = await signTypedDataFn(typedData);

  const requestPayload = {
    message: {
      owner,
      sessionKey: newSession.address,
      expiry: expiry.toString(),
    },
    signature,
  };

  const response = await apiPostEnvelope(
    '/session',
    requestPayload,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    SessionResponseSchema
  );

  if (!response.ok) {
    throw new Error('Failed to authorize session grant with NONY enclave.');
  }

  return newSession;
}
