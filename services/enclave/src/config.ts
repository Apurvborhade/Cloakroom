import { BPS_DENOMINATOR } from '@cloakroom/shared';
import { getAddress, isAddress } from 'viem';
import type { Address } from 'viem';
import { z } from 'zod';

const wholeNumber = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine(Number.isSafeInteger);
const positiveNumber = wholeNumber.refine((value) => value > 0);
const bps = wholeNumber.refine((value) => value <= BPS_DENOMINATOR);
const wei = z.string().regex(/^\d+$/).transform(BigInt);
const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));
const flag = z.enum(['true', 'false']).transform((value) => value === 'true');
const secret = z.string().min(1);

/** Every environment variable the enclave reads. All are required: see .env.example. */
const ENV_SCHEMA = z.object({
  CHAIN_ID: positiveNumber,
  RPC_URL: z.string().url(),
  CONFIRMATIONS: wholeNumber,
  GAS_RESERVE_WEI: wei,
  GAS_MARGIN_PERCENT: wholeNumber.refine((value) => value >= 100),
  RECEIPT_TIMEOUT_MS: positiveNumber,
  INVENTORY_SETTLE_ATTEMPTS: positiveNumber,

  UNIVERSAL_ROUTER_ADDRESS: address,
  WETH_ADDRESS: address,
  TOKEN_OUT_ADDRESS: address,
  UNISWAP_API_KEY: secret,

  MAX_SLIPPAGE_BPS_CAP: bps,
  FEE_BPS: bps,
  DEPOSIT_SESSION_TTL_SEC: positiveNumber,
  SESSION_GRANT_TTL_SEC: positiveNumber,
  MAX_EXPIRY_FUTURE_SEC: positiveNumber,
  MAX_CLOCK_SKEW_SEC: wholeNumber,
  MAX_BODY_SIZE_BYTES: positiveNumber,
  MAX_AMOUNT_NATIVE_WEI: wei,

  PRICE_POLL_INTERVAL_SEC: positiveNumber,
  PRICE_REFERENCE_AMOUNT_WEI: wei.refine((value) => value > 0n),

  ADMIN_ADDRESS: address,
  SEEDING_ENABLED: flag,

  SIM_MODE: flag,
  ALLOWED_ORIGIN: z.string().url(),
});

export type EnclaveConfig = z.infer<typeof ENV_SCHEMA>;

/** The variable names the enclave reads. */
export const ENV_VARIABLES = Object.keys(ENV_SCHEMA.shape) as Array<keyof EnclaveConfig>;

/**
 * Reads and validates the environment, and is meant to run once at boot. The error names the
 * variables at fault and never their values, because some of them are secrets.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): EnclaveConfig {
  const result = ENV_SCHEMA.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
  }
  return result.data;
}
