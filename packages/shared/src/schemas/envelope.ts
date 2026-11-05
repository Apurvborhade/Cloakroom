import { z } from 'zod';

export const EnvelopeSchema = z.object({
  enc: z.string().min(1, 'enc is required (base64)'),
  ct: z.string().min(1, 'ct is required (base64)'),
});

export type Envelope = z.infer<typeof EnvelopeSchema>;
