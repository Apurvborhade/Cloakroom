import type { FastifyInstance } from 'fastify';
import { createDomain, deriveEnclaveSalt, EIP712_TYPES, MAX_EXPIRY_FUTURE_SEC,
  SignedAdminEoasSchema } from '@cloakroom/shared';
import type { Envelope } from '@cloakroom/shared';
import { getAddress, verifyTypedData } from 'viem';
import type { Address } from 'viem';
import type { KeyManager } from './keys.js';

/** Mount on a server with logging disabled or redacted: bodies contain private data. */
export async function custodyRoutes(app: FastifyInstance, options: {
  keys: KeyManager; adminAddress: Address; seedingEnabled: boolean; chainId: number;
  now?: () => bigint;
}): Promise<void> {
  const admin = getAddress(options.adminAddress);
  const domain = createDomain(options.chainId, deriveEnclaveSalt(options.keys.transportPublicKey()));
  const now = options.now ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  // Do not register an address-disclosure route when the deployment disables seeding.
  if (!options.seedingEnabled) return;
  app.post<{ Body: Envelope }>('/admin/eoas', { bodyLimit: 24 * 1024,
    errorHandler(error, _request, reply) {
      return reply.code(error.statusCode === 413 ? 413 : 400).send({ error: 'INVALID_PAYLOAD' });
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    let channel;
    let parsed;
    try {
      channel = await options.keys.decryptWithResponse(request.body, '/admin/eoas');
      parsed = SignedAdminEoasSchema.parse(channel.payload);
    } catch { return reply.code(400).send({ error: 'INVALID_PAYLOAD' }); }
    const message = { admin: getAddress(parsed.message.admin),
      nonce: BigInt(parsed.message.nonce), expiry: BigInt(parsed.message.expiry) };
    const timestamp = now();
    if (message.expiry < timestamp || message.expiry > timestamp + BigInt(MAX_EXPIRY_FUTURE_SEC)) {
      return reply.code(400).send({ error: 'EXPIRED' });
    }
    let authorized = false;
    try {
      authorized = message.admin === admin && await verifyTypedData({
        address: admin, domain, types: EIP712_TYPES, primaryType: 'AdminEoas', message, signature: parsed.signature,
      });
    } catch { /* Invalid curve points and malformed signatures are unauthorized. */ }
    if (!authorized) return reply.code(403).send({ error: 'UNAUTHORIZED' });
    try {
      const addresses = await options.keys.claimSeedingAddresses();
      return await channel.sealResponse({ addresses });
    } catch (error) {
      if (error instanceof Error && error.message === 'SEEDING_DISABLED') {
        return reply.code(403).send({ error: 'UNAUTHORIZED' });
      }
      return reply.code(503).send({ error: 'INTERNAL_ERROR' });
    }
  });
}
