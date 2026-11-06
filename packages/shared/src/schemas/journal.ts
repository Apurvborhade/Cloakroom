import { z } from 'zod';
import { addressSchema, hexSchema } from './common.js';

export const DepositSessionOpenedEventSchema = z.object({
  t: z.literal('DEPOSIT_SESSION_OPENED'),
  id: z.string().min(1, 'id is required'),
  owner: addressSchema,
  eoa: addressSchema,
  expiry: z.number().int().positive('expiry must be positive'),
  baseline: z.bigint().min(0n, 'baseline must be non-negative'),
  baselineBlock: z.bigint().min(0n, 'baselineBlock must be non-negative'),
});
export type DepositSessionOpenedEvent = z.infer<typeof DepositSessionOpenedEventSchema>;

export const DepositCreditedEventSchema = z.object({
  t: z.literal('DEPOSIT_CREDITED'),
  id: z.string().min(1, 'id is required'),
  amount: z.bigint().positive('amount must be positive'),
  block: z.bigint().min(0n, 'block must be non-negative'),
  owner: addressSchema,
  txHash: hexSchema.optional(),
});
export type DepositCreditedEvent = z.infer<typeof DepositCreditedEventSchema>;

export const DepositSessionClosedEventSchema = z.object({
  t: z.literal('DEPOSIT_SESSION_CLOSED'),
  id: z.string().min(1, 'id is required'),
  eoa: addressSchema,
});
export type DepositSessionClosedEvent = z.infer<typeof DepositSessionClosedEventSchema>;
