import { SignedEscapeActivateSchema, SignedSessionQuerySchema, wireToEscapeActivateMsg, wireToSessionQueryMsg } from '@cloakroom/shared';
import type { FastifyInstance } from 'fastify';
import type { Hex } from 'viem';
import type { AuthService } from './auth.js';
import type { EscapeHatchService } from './escape.js';
import type { EscapeRecord } from './escape-state.js';
import type { KeyManager } from './keys.js';
import { authorizeRead, privateRoute } from './routes.js';

function claimWire(record: EscapeRecord | null) {
  if (!record) return null;
  return { id: record.id, claimId: record.claimId, hatch: record.hatch, amount: record.amount.toString(),
    status: record.status, ...(record.txHash ? { txHash: record.txHash } : {}), ...(record.reason ? { reason: record.reason } : {}) };
}

export function escapeRoutes(app: FastifyInstance, deps: { keys: KeyManager; auth: AuthService; escape: EscapeHatchService }) {
  const { keys, auth, escape } = deps;
  privateRoute(app, keys, '/escape/activate', SignedEscapeActivateSchema, async ({ message, signature, code }) => {
    const activate = wireToEscapeActivateMsg(message);
    escape.validateActivation(activate, code);
    await auth.verifyAndAuthorizeMutation('EscapeActivate', activate, signature as Hex);
    return { claim: claimWire(await escape.activate(activate, code)) };
  });
  privateRoute(app, keys, '/escape/status', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    const state = escape.status(owner);
    return { ...state, claim: claimWire(state.claim) };
  });
}
