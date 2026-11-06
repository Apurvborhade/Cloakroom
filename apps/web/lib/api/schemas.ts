import { hex32Schema, hexSchema } from '@cloakroom/shared';
import { z } from 'zod';

/**
 * Response bodies the routes return that have no exported schema in @cloakroom/shared yet. They
 * mirror services/enclave/src/routes.ts and margin-routes.ts exactly; moving them into the shared
 * package is listed as a follow-up in apps/web/README.md.
 */
export const SessionResponseSchema = z.object({ ok: z.literal(true), expiresAt: z.number().int() });
export const IntentCreatedResponseSchema = z.object({ intentId: hex32Schema, status: z.literal('pending') });
export const IntentCancelledResponseSchema = z.object({ status: z.literal('cancelled') });
export const OkResponseSchema = z.object({ ok: z.literal(true) });
export const SimEnclaveKeyResponseSchema = z.object({
  enclavePubKey: hexSchema,
  chainId: z.number().int(),
  simulated: z.literal(true),
});
export const ErrorBodySchema = z.object({ error: z.string() });

export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type IntentCreatedResponse = z.infer<typeof IntentCreatedResponseSchema>;
export type SimEnclaveKeyResponse = z.infer<typeof SimEnclaveKeyResponseSchema>;
