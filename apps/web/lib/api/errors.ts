import { ERROR_CODES } from '@cloakroom/shared';

/** Client-side codes for failures that never reached a backend handler. */
export const CLIENT_ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  BAD_RESPONSE: 'BAD_RESPONSE',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  SEAL_FAILED: 'SEAL_FAILED',
  USER_REJECTED: 'USER_REJECTED',
  WRONG_WALLET_CHAIN: 'WRONG_WALLET_CHAIN',
  NO_SESSION: 'NO_SESSION',
  ENCLAVE_UNAVAILABLE: 'ENCLAVE_UNAVAILABLE',
} as const;

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[keyof typeof CLIENT_ERROR_CODES];
export type ApiErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | ClientErrorCode;

const KNOWN = new Set<string>([...Object.values(ERROR_CODES), ...Object.values(CLIENT_ERROR_CODES)]);

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;
  readonly path: string | null;

  constructor(code: string, options: { status?: number | null; path?: string | null } = {}) {
    const known = KNOWN.has(code) ? (code as ApiErrorCode) : ERROR_CODES.INTERNAL_ERROR;
    super(known);
    this.name = 'ApiError';
    this.code = known;
    this.status = options.status ?? null;
    this.path = options.path ?? null;
  }
}

const MESSAGES: Record<ApiErrorCode, string> = {
  BAD_SIGNATURE:
    'The enclave could not verify the signature. If the enclave restarted, its key and signing domain changed: refresh the enclave key and sign again.',
  EXPIRED: 'The signed request expired before the enclave received it. Sign again.',
  NONCE_USED: 'This request was already used. Sign a new one.',
  WRONG_CHAIN: 'The request was signed for a different chain.',
  INSUFFICIENT_BALANCE: 'Not enough available private balance for this request.',
  NO_INVENTORY: 'No unlinked custody address can pay this amount right now. Your funds were released; try a smaller amount or later.',
  UNKNOWN_SESSION: 'The read session is not recognised (it expired, or the enclave restarted). Unlock private data again.',
  STALE_PRICE: 'The enclave has no fresh risk price right now, so it cannot open or change positions. Try again shortly.',
  PRICE_MISMATCH: 'The price check did not match.',
  UNSUPPORTED_ASSET: 'This asset is not supported by the enclave for this operation.',
  UNAUTHORIZED: 'Not authorised.',
  INTENT_NOT_FOUND: 'The intent was not found, or it is no longer pending and cannot be cancelled.',
  INVALID_PAYLOAD: 'The enclave rejected the request as invalid (for example an amount outside its limits or an unsupported option).',
  INTERNAL_ERROR: 'The enclave reported an internal error.',
  MARGIN_DISABLED: 'Margin trading is disabled on this enclave.',
  POSITION_NOT_FOUND: 'Position not found.',
  POSITION_BUSY: 'The position is not open (it is opening, closing or already settled), so this action is not possible now.',
  INSUFFICIENT_COLLATERAL: 'Not enough collateral for this leverage.',
  INSUFFICIENT_LIQUIDITY: 'Not enough lending liquidity for this request.',
  NETWORK_ERROR: 'Could not reach the nony.money API.',
  NOT_CONFIGURED: 'The app is missing configuration for this action. See the diagnostics page.',
  BAD_RESPONSE: 'The API answered with a response the app could not authenticate or validate.',
  ROUTE_NOT_FOUND: 'The API does not offer this endpoint.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  SEAL_FAILED: 'The request could not be encrypted to the enclave key.',
  USER_REJECTED: 'The signature request was rejected in the wallet.',
  WRONG_WALLET_CHAIN: 'Your wallet is connected to a different network.',
  NO_SESSION: 'Unlock private data first: sign a read-only session grant.',
  ENCLAVE_UNAVAILABLE: 'The enclave key is not available yet.',
};

export function describeError(error: unknown): string {
  const code = errorCode(error);
  return MESSAGES[code] ?? MESSAGES.INTERNAL_ERROR;
}

export function errorCode(error: unknown): ApiErrorCode {
  if (error instanceof ApiError) return error.code;
  if (isUserRejection(error)) return CLIENT_ERROR_CODES.USER_REJECTED;
  return ERROR_CODES.INTERNAL_ERROR;
}

/** Wallet rejections: EIP-1193 code 4001 or viem's UserRejectedRequestError. */
export function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const value = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (value.code === 4001 || value.name === 'UserRejectedRequestError') return true;
    current = value.cause;
  }
  return false;
}
