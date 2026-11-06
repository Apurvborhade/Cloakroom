import { AttestationResponseSchema } from '@cloakroom/shared';
import type { AttestationResponse } from '@cloakroom/shared';
import type { ZodType } from 'zod';
import { isEncryptedResponse, sealRequest } from '../crypto/transport';
import type { SealContext } from '../crypto/transport';
import { ApiError, CLIENT_ERROR_CODES } from './errors';
import { ErrorBodySchema, SimEnclaveKeyResponseSchema } from './schemas';
import type { SimEnclaveKeyResponse } from './schemas';

/** Receives route paths and error codes only, never request or response contents. */
export interface ApiTelemetry {
  onSuccess?(path: string): void;
  onError?(path: string, code: string): void;
}

export interface CloakroomApiOptions {
  baseUrl: string | null;
  fetchFn?: typeof fetch;
  telemetry?: ApiTelemetry;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The single typed client for the enclave API. Private routes are always sealed with HPKE and
 * their replies opened with the request's single-use response channel; there is no plaintext path.
 */
export class CloakroomApi {
  readonly baseUrl: string | null;
  private readonly fetchFn: typeof fetch;
  private readonly telemetry: ApiTelemetry;
  private readonly timeoutMs: number;

  constructor(options: CloakroomApiOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchFn = options.fetchFn ?? ((...args) => globalThis.fetch(...args));
    this.telemetry = options.telemetry ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async getAttestation(nonceHex?: string): Promise<AttestationResponse> {
    const query = nonceHex ? `?nonce=${encodeURIComponent(nonceHex)}` : '';
    return this.getPublic('/attestation', query, AttestationResponseSchema);
  }

  async getSimEnclaveKey(): Promise<SimEnclaveKeyResponse> {
    return this.getPublic('/sim/enclave-key', '', SimEnclaveKeyResponseSchema);
  }

  /**
   * Seals `payload` for `path`, POSTs `{ enc, ct }`, opens the encrypted reply and validates it.
   * Errors stay plaintext on the wire and carry only a code.
   */
  async postPrivate<T>(path: string, payload: unknown, context: SealContext, schema: ZodType<T>): Promise<T> {
    const base = this.requireBase(path);
    const sealed = await sealRequest(payload, path, context);
    const response = await this.send(path, `${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sealed.envelope),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw await this.failure(path, response);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw this.fail(path, CLIENT_ERROR_CODES.BAD_RESPONSE, response.status);
    }
    if (!isEncryptedResponse(body)) throw this.fail(path, CLIENT_ERROR_CODES.BAD_RESPONSE, response.status);

    let opened: unknown;
    try {
      opened = await sealed.openResponse(body);
    } catch {
      throw this.fail(path, CLIENT_ERROR_CODES.BAD_RESPONSE, response.status);
    }
    const parsed = schema.safeParse(opened);
    if (!parsed.success) throw this.fail(path, CLIENT_ERROR_CODES.BAD_RESPONSE, response.status);
    this.telemetry.onSuccess?.(path);
    return parsed.data;
  }

  private async getPublic<T>(path: string, query: string, schema: ZodType<T>): Promise<T> {
    const base = this.requireBase(path);
    const response = await this.send(path, `${base}${path}${query}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw await this.failure(path, response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw this.fail(path, CLIENT_ERROR_CODES.BAD_RESPONSE, response.status);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw this.fail(path, CLIENT_ERROR_CODES.BAD_RESPONSE, response.status);
    this.telemetry.onSuccess?.(path);
    return parsed.data;
  }

  private requireBase(path: string): string {
    if (!this.baseUrl) throw this.fail(path, CLIENT_ERROR_CODES.NOT_CONFIGURED, null);
    return this.baseUrl;
  }

  private async send(path: string, url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch {
      throw this.fail(path, CLIENT_ERROR_CODES.NETWORK_ERROR, null);
    } finally {
      clearTimeout(timer);
    }
  }

  private async failure(path: string, response: Response): Promise<ApiError> {
    if (response.status === 429) return this.fail(path, CLIENT_ERROR_CODES.RATE_LIMITED, 429);
    let code: string = CLIENT_ERROR_CODES.BAD_RESPONSE;
    try {
      const parsed = ErrorBodySchema.safeParse(await response.json());
      if (parsed.success) code = parsed.data.error;
    } catch {
      // Not JSON: keep BAD_RESPONSE.
    }
    // The server's not-found handler answers 404 INVALID_PAYLOAD for routes it does not register,
    // which is how a disabled feature (margin) or an undeployed endpoint looks from outside.
    if (response.status === 404 && code === 'INVALID_PAYLOAD') code = CLIENT_ERROR_CODES.ROUTE_NOT_FOUND;
    return this.fail(path, code, response.status);
  }

  private fail(path: string, code: string, status: number | null): ApiError {
    const error = new ApiError(code, { status, path });
    this.telemetry.onError?.(path, error.code);
    return error;
  }
}
