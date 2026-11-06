import type { Address, Hex } from 'viem';
import { apiPostEnvelope } from './client';
import {
  IntentCreateResponseSchema,
  IntentStatusResponseSchema,
  CancelIntentResponseSchema,
  type IntentCreateResponse,
  type IntentStatusItem,
} from './schemas';
import { fetchAttestation } from './attestation';
import { getStoredSessionKey, signSessionQuery } from '../crypto/sessionKey';
import { buildTypedDataPayload, NATIVE } from '../crypto/typedData';

export interface CreateIntentParams {
  owner: Address;
  tokenIn?: Address;
  tokenOut?: Address;
  amountInWei: bigint;
  comparator: 0 | 1; // 0: price >= trigger, 1: price <= trigger
  triggerPrice1e18: bigint;
  maxSlippageBps: number;
  nonce: bigint;
  signTypedDataFn: (params: any) => Promise<Hex>;
}

export interface IntentRecord {
  id: string;
  owner: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  triggerPrice: string;
  comparator: 0 | 1;
  maxSlippageBps: number;
  status: 'pending' | 'executing' | 'done' | 'failed' | 'cancelled' | 'expired';
  amountOut?: string;
  createdAt: number;
}

export const SEPOLIA_USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

export async function submitIntent(params: CreateIntentParams): Promise<IntentCreateResponse> {
  const attestation = await fetchAttestation();
  const tokenIn = params.tokenIn || NATIVE;
  const tokenOut = params.tokenOut || SEPOLIA_USDC;
  const now = Math.floor(Date.now() / 1000);
  const expiry = BigInt(now + 240); // 4 minutes ahead

  const intentMessage = {
    owner: params.owner,
    tokenIn,
    tokenOut,
    amountIn: params.amountInWei,
    comparator: params.comparator,
    triggerPrice: params.triggerPrice1e18,
    maxSlippageBps: params.maxSlippageBps,
    nonce: params.nonce,
    expiry,
  };

  const typedData = buildTypedDataPayload(
    attestation.chainId,
    attestation.enclavePubKey,
    'Intent',
    intentMessage
  );

  const signature = await params.signTypedDataFn(typedData);

  const requestPayload = {
    message: {
      owner: params.owner,
      tokenIn,
      tokenOut,
      amountIn: params.amountInWei.toString(),
      comparator: params.comparator,
      triggerPrice: params.triggerPrice1e18.toString(),
      maxSlippageBps: params.maxSlippageBps,
      nonce: params.nonce.toString(),
      expiry: expiry.toString(),
    },
    signature,
  };

  const response = await apiPostEnvelope(
    '/intents',
    requestPayload,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    IntentCreateResponseSchema
  );

  return response;
}

export async function fetchIntentsStatus(
  owner: Address,
  signTypedDataFallback?: (params: any) => Promise<any>
): Promise<IntentStatusItem[]> {
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

  const response = await apiPostEnvelope(
    '/intents/status',
    signedQuery,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    IntentStatusResponseSchema
  );

  return response.intents;
}

export async function cancelIntent(
  owner: Address,
  intentId: Hex,
  nonce: bigint,
  signTypedDataFn: (params: any) => Promise<Hex>
): Promise<void> {
  const attestation = await fetchAttestation();
  const now = Math.floor(Date.now() / 1000);
  const expiry = BigInt(now + 240);

  const cancelMessage = {
    owner,
    intentId,
    nonce,
    expiry,
  };

  const typedData = buildTypedDataPayload(
    attestation.chainId,
    attestation.enclavePubKey,
    'CancelIntent',
    cancelMessage
  );

  const signature = await signTypedDataFn(typedData);

  const requestPayload = {
    message: {
      owner,
      intentId,
      nonce: nonce.toString(),
      expiry: expiry.toString(),
    },
    signature,
  };

  await apiPostEnvelope(
    '/intents/cancel',
    requestPayload,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    CancelIntentResponseSchema
  );
}
