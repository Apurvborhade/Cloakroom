import { z } from 'zod';
import type { Address, Hex } from 'viem';

export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address')
  .transform((val) => val.toLowerCase() as Address);

export const hexSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]*$/, 'Invalid hex string')
  .transform((val) => val as Hex);

export const hex32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid 32-byte hex string')
  .transform((val) => val as Hex);

export const signatureSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid 65-byte hex signature')
  .transform((val) => val as Hex);

export const decimalStringSchema = z
  .string()
  .regex(/^\d+$/, 'Must be a non-negative decimal string');

export const uint64StringSchema = decimalStringSchema.refine(
  (val) => {
    try {
      const n = BigInt(val);
      return n >= 0n && n <= 18446744073709551615n;
    } catch {
      return false;
    }
  },
  { message: 'uint64 out of range (0 to 2^64 - 1)' }
);

export const uint256StringSchema = decimalStringSchema.refine(
  (val) => {
    try {
      const n = BigInt(val);
      return n >= 0n && n <= 2n ** 256n - 1n;
    } catch {
      return false;
    }
  },
  { message: 'uint256 out of range (0 to 2^256 - 1)' }
);

export const uint16NumberSchema = z.number().int().min(0).max(65535);
export const uint8NumberSchema = z.number().int().min(0).max(255);
