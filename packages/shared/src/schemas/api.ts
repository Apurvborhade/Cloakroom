import { z } from 'zod';
import type { Hex } from 'viem';
import { NATIVE } from '../constants.js';
import {
  addressSchema,
  hex32Schema,
  hexSchema,
  signatureSchema,
  decimalStringSchema,
  uint64StringSchema,
  uint256StringSchema,
} from './common.js';
import type {
  SessionGrantMsg,
  SessionQueryMsg,
  DepositRequestMsg,
  IntentMsg,
  CancelIntentMsg,
  WithdrawalMsg,
} from '../eip712.js';
import type { PriceReport } from '../types/oracle.js';

export function createSignedRequestSchema<T extends z.ZodTypeAny>(messageSchema: T) {
  return z.object({
    message: messageSchema,
    signature: signatureSchema,
  });
}

export type SignedRequest<T> = {
  message: T;
  signature: Hex;
};

// --- Request Wire Schemas ---

export const SessionGrantWireSchema = z.object({
  owner: addressSchema,
  sessionKey: addressSchema,
  expiry: uint64StringSchema,
});
export type SessionGrantWire = z.infer<typeof SessionGrantWireSchema>;

export const SessionQueryWireSchema = z.object({
  owner: addressSchema,
  expiry: uint64StringSchema,
});
export type SessionQueryWire = z.infer<typeof SessionQueryWireSchema>;

export const DepositRequestWireSchema = z.object({
  owner: addressSchema,
  asset: addressSchema.refine(
    (val) => val.toLowerCase() === NATIVE.toLowerCase(),
    { message: 'Only native ETH deposits (0x0000000000000000000000000000000000000000) are supported in v1' }
  ),
  nonce: uint64StringSchema,
  expiry: uint64StringSchema,
});
export type DepositRequestWire = z.infer<typeof DepositRequestWireSchema>;

export const IntentWireSchema = z.object({
  owner: addressSchema,
  tokenIn: addressSchema,
  tokenOut: addressSchema,
  amountIn: uint256StringSchema,
  comparator: z.union([z.literal(0), z.literal(1)]),
  triggerPrice: uint256StringSchema,
  maxSlippageBps: z.number().int().min(0).max(10_000),
  nonce: uint64StringSchema,
  expiry: uint64StringSchema,
});
export type IntentWire = z.infer<typeof IntentWireSchema>;

export const CancelIntentWireSchema = z.object({
  owner: addressSchema,
  intentId: hex32Schema,
  nonce: uint64StringSchema,
  expiry: uint64StringSchema,
});
export type CancelIntentWire = z.infer<typeof CancelIntentWireSchema>;

export const WithdrawalWireSchema = z.object({
  owner: addressSchema,
  token: addressSchema,
  amount: uint256StringSchema,
  to: addressSchema,
  nonce: uint64StringSchema,
  expiry: uint64StringSchema,
});
export type WithdrawalWire = z.infer<typeof WithdrawalWireSchema>;

export const PriceReportWireSchema = z.object({
  pair: z.string().min(1, 'pair is required'),
  price: uint256StringSchema,
  ts: z.number().int().positive('timestamp must be positive'),
  source: z.string().min(1, 'source is required'),
});
export type PriceReportWire = z.infer<typeof PriceReportWireSchema>;

// Signed wrapper schemas
export const SignedSessionGrantSchema = createSignedRequestSchema(SessionGrantWireSchema);
export const SignedSessionQuerySchema = createSignedRequestSchema(SessionQueryWireSchema);
export const SignedDepositRequestSchema = createSignedRequestSchema(DepositRequestWireSchema);
export const SignedIntentSchema = createSignedRequestSchema(IntentWireSchema);
export const SignedCancelIntentSchema = createSignedRequestSchema(CancelIntentWireSchema);
export const SignedWithdrawalSchema = createSignedRequestSchema(WithdrawalWireSchema);
export const AdminEoasWireSchema = z.object({
  admin: addressSchema, nonce: uint64StringSchema, expiry: uint64StringSchema,
}).strict();
export const SignedAdminEoasSchema = z.object({
  message: AdminEoasWireSchema, signature: signatureSchema,
}).strict();

// --- Response Schemas ---

export const BalanceItemWireSchema = z.object({
  token: addressSchema,
  available: decimalStringSchema,
  reserved: decimalStringSchema,
  pending: decimalStringSchema,
});
export type BalanceWire = z.infer<typeof BalanceItemWireSchema>;

export const BalanceResponseSchema = z.object({
  balances: z.array(BalanceItemWireSchema),
});
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;

export const IntentStatusItemSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'executing', 'done', 'failed', 'cancelled', 'expired']),
  amountOut: decimalStringSchema.optional(),
});

export const IntentStatusResponseSchema = z.object({
  intents: z.array(IntentStatusItemSchema),
});
export type IntentStatusResponse = z.infer<typeof IntentStatusResponseSchema>;

export const DepositSessionResponseSchema = z.object({
  sessionId: z.string(),
  depositAddress: addressSchema,
  expiresAt: z.number().int(),
});
export type DepositSessionResponse = z.infer<typeof DepositSessionResponseSchema>;

export const WithdrawalResponseSchema = z.object({
  withdrawalId: z.string(),
  status: z.literal('locked'),
});
export type WithdrawalResponse = z.infer<typeof WithdrawalResponseSchema>;

export const StandardErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type StandardErrorResponse = z.infer<typeof StandardErrorResponseSchema>;

export const AttestationResponseSchema = z.object({
  quote: z.string(),
  enclavePubKey: hexSchema,
  buildHash: hex32Schema,
  chainId: z.number().int(),
});
export type AttestationResponse = z.infer<typeof AttestationResponseSchema>;

// --- Conversion Helpers (Wire to Internal BigInt Types) ---

export function wireToSessionGrantMsg(wire: SessionGrantWire): SessionGrantMsg {
  return {
    owner: wire.owner,
    sessionKey: wire.sessionKey,
    expiry: BigInt(wire.expiry),
  };
}

export function wireToSessionQueryMsg(wire: SessionQueryWire): SessionQueryMsg {
  return {
    owner: wire.owner,
    expiry: BigInt(wire.expiry),
  };
}

export function wireToDepositRequestMsg(wire: DepositRequestWire): DepositRequestMsg {
  return {
    owner: wire.owner,
    asset: wire.asset,
    nonce: BigInt(wire.nonce),
    expiry: BigInt(wire.expiry),
  };
}

export function wireToIntentMsg(wire: IntentWire): IntentMsg {
  return {
    owner: wire.owner,
    tokenIn: wire.tokenIn,
    tokenOut: wire.tokenOut,
    amountIn: BigInt(wire.amountIn),
    comparator: wire.comparator,
    triggerPrice: BigInt(wire.triggerPrice),
    maxSlippageBps: wire.maxSlippageBps,
    nonce: BigInt(wire.nonce),
    expiry: BigInt(wire.expiry),
  };
}

export function wireToCancelIntentMsg(wire: CancelIntentWire): CancelIntentMsg {
  return {
    owner: wire.owner,
    intentId: wire.intentId,
    nonce: BigInt(wire.nonce),
    expiry: BigInt(wire.expiry),
  };
}

export function wireToWithdrawalMsg(wire: WithdrawalWire): WithdrawalMsg {
  return {
    owner: wire.owner,
    token: wire.token,
    amount: BigInt(wire.amount),
    to: wire.to,
    nonce: BigInt(wire.nonce),
    expiry: BigInt(wire.expiry),
  };
}

export function wireToPriceReport(wire: PriceReportWire): PriceReport {
  return {
    pair: wire.pair,
    price: BigInt(wire.price),
    ts: wire.ts,
    source: wire.source,
  };
}
