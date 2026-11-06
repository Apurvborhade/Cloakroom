import type { Hex } from 'viem';
import { z } from 'zod';
import { sealEnvelopeWithResponse, type EncryptedResponse } from '../crypto/encryption';
import { StandardErrorSchema } from './schemas';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_NONY_API_URL?.replace(/\/$/, '') || 'https://api.nony.money';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message?: string) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 12000;

/**
 * Executes a GET request with timeout and schema validation.
 */
export async function apiGet<T>(path: string, schema: z.ZodSchema<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      const errorParsed = StandardErrorSchema.safeParse(data);
      const code = errorParsed.success ? errorParsed.data.error : `HTTP_${res.status}`;
      const msg = errorParsed.success ? errorParsed.data.message : res.statusText;
      throw new ApiError(code, res.status, msg);
    }

    const validated = schema.safeParse(data);
    if (!validated.success) {
      throw new ApiError('INVALID_RESPONSE_SCHEMA', res.status, validated.error.message);
    }

    return validated.data;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('NETWORK_TIMEOUT', 408, 'The request to NONY backend timed out.');
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK_ERROR', 0, err?.message || 'Failed to connect to NONY backend.');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Seals payload in an HPKE envelope bound to enclavePubKey and path,
 * sends POST to the enclave, and unseals the encrypted response.
 */
export async function apiPostEnvelope<TReq, TRes>(
  path: string,
  payload: TReq,
  context: { chainId: number; enclavePubKey: Hex },
  responseSchema: z.ZodSchema<TRes>
): Promise<TRes> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    // 1. Seal payload into HPKE Envelope
    const { envelope, openResponse } = await sealEnvelopeWithResponse(payload, {
      chainId: context.chainId,
      path,
      enclavePubKey: context.enclavePubKey,
    });

    // 2. Transmit wire envelope
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
      cache: 'no-store',
    });

    const wireData = await res.json().catch(() => null);

    // 3. Handle HTTP errors
    if (!res.ok) {
      const errorParsed = StandardErrorSchema.safeParse(wireData);
      const code = errorParsed.success ? errorParsed.data.error : `HTTP_${res.status}`;
      const msg = errorParsed.success ? errorParsed.data.message : res.statusText;
      throw new ApiError(code, res.status, msg);
    }

    // 4. Decrypt response if sealed, or parse directly if plain
    let decryptedPayload: unknown = wireData;
    if (wireData && typeof wireData === 'object' && 'nonce' in wireData && 'ct' in wireData) {
      decryptedPayload = await openResponse(wireData as EncryptedResponse);
    }

    // 5. Validate decrypted response with schema
    const validated = responseSchema.safeParse(decryptedPayload);
    if (!validated.success) {
      throw new ApiError('INVALID_RESPONSE_SCHEMA', res.status, validated.error.message);
    }

    return validated.data;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError('NETWORK_TIMEOUT', 408, 'The request to NONY backend timed out.');
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK_ERROR', 0, err?.message || 'Failed to communicate with NONY backend.');
  } finally {
    clearTimeout(timer);
  }
}
