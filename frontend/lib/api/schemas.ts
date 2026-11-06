import { z } from 'zod';
import type { Hex, Address } from 'viem';

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Expected 20-byte hex address')
  .transform((val) => val.toLowerCase() as Address);

export const hexSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]*$/, 'Expected 0x-prefixed hex string')
  .transform((val) => val as Hex);

export const hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected 32-byte hex string')
  .transform((val) => val as Hex);

export const decimalStringSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/, 'Expected non-negative integer string in base units');

export const uint64StringSchema = decimalStringSchema;
export const uint256StringSchema = decimalStringSchema;

// --- API Response Schemas ---

export const AttestationResponseSchema = z.object({
  quote: z.string().min(1, 'Quote is required'),
  enclavePubKey: hexSchema,
  buildHash: hex32Schema,
  chainId: z.number().int().positive(),
});
export type AttestationResponse = z.infer<typeof AttestationResponseSchema>;

export const SessionResponseSchema = z.object({
  ok: z.literal(true),
  expiresAt: z.number().int().positive(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const DepositSessionResponseSchema = z.object({
  sessionId: z.string().min(1),
  depositAddress: addressSchema,
  expiresAt: z.number().int().positive(),
});
export type DepositSessionResponse = z.infer<typeof DepositSessionResponseSchema>;

export const BalanceItemSchema = z.object({
  token: addressSchema,
  available: decimalStringSchema,
  reserved: decimalStringSchema,
  pending: decimalStringSchema,
});
export type BalanceItem = z.infer<typeof BalanceItemSchema>;

export const BalanceResponseSchema = z.object({
  balances: z.array(BalanceItemSchema),
});
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;

export const IntentCreateResponseSchema = z.object({
  intentId: z.string().min(1),
  status: z.enum(['pending', 'executing', 'done', 'failed', 'cancelled', 'expired']),
});
export type IntentCreateResponse = z.infer<typeof IntentCreateResponseSchema>;

export const IntentStatusItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['pending', 'executing', 'done', 'failed', 'cancelled', 'expired']),
  amountOut: decimalStringSchema.optional(),
});
export type IntentStatusItem = z.infer<typeof IntentStatusItemSchema>;

export const IntentStatusResponseSchema = z.object({
  intents: z.array(IntentStatusItemSchema),
});
export type IntentStatusResponse = z.infer<typeof IntentStatusResponseSchema>;

export const CancelIntentResponseSchema = z.object({
  status: z.literal('cancelled'),
});
export type CancelIntentResponse = z.infer<typeof CancelIntentResponseSchema>;

export const WithdrawalResponseSchema = z.object({
  withdrawalId: z.string().min(1),
  status: z.literal('locked'),
});
export type WithdrawalResponse = z.infer<typeof WithdrawalResponseSchema>;

export const WithdrawalStatusItemSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['locked', 'sent', 'confirmed', 'failed']),
  txHash: hexSchema.optional(),
  reason: z.string().optional(),
});
export type WithdrawalStatusItem = z.infer<typeof WithdrawalStatusItemSchema>;

export const WithdrawalStatusResponseSchema = z.object({
  withdrawals: z.array(WithdrawalStatusItemSchema),
});
export type WithdrawalStatusResponse = z.infer<typeof WithdrawalStatusResponseSchema>;

export const StandardErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type StandardError = z.infer<typeof StandardErrorSchema>;
