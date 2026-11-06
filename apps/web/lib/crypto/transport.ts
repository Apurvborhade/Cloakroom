import { sealEnvelopeWithResponse } from '@cloakroom/shared';
import type { EncryptedResponse, Envelope } from '@cloakroom/shared';
import type { Hex } from 'viem';
import { ApiError, CLIENT_ERROR_CODES } from '../api/errors';

export interface SealContext {
  chainId: number;
  enclavePubKey: Hex;
}

export interface SealedRequest {
  envelope: Envelope;
  /** Single use: authenticates and decrypts the reply to exactly this request. */
  openResponse(response: EncryptedResponse): Promise<unknown>;
}

/**
 * Seals a private request with the shared HPKE transport (DHKEM-X25519, HKDF-SHA256, AES-256-GCM,
 * info "cloakroom/hpke/v1"), bound to the chain, the route path and the enclave key through the
 * associated data. No cryptography is implemented here.
 */
export async function sealRequest(payload: unknown, path: string, context: SealContext): Promise<SealedRequest> {
  try {
    return await sealEnvelopeWithResponse(payload, { chainId: context.chainId, path, enclavePubKey: context.enclavePubKey });
  } catch {
    throw new ApiError(CLIENT_ERROR_CODES.SEAL_FAILED, { path });
  }
}

export function isEncryptedResponse(value: unknown): value is EncryptedResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  const record = value as Record<string, unknown>;
  return keys === 'ct,nonce' && typeof record.nonce === 'string' && typeof record.ct === 'string';
}
