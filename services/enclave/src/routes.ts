import { randomBytes } from 'node:crypto';
import {
  ERROR_CODES,
  NATIVE,
  SignedDepositRequestSchema,
  SignedSessionGrantSchema,
  SignedSessionQuerySchema,
  wireToDepositRequestMsg,
  wireToSessionGrantMsg,
  wireToSessionQueryMsg,
} from '@cloakroom/shared';
import type { Envelope, ErrorCode, SessionQueryMsg } from '@cloakroom/shared';
import type { FastifyInstance } from 'fastify';
import type { Address, Hex } from 'viem';
import type { ZodError, ZodType } from 'zod';
import { AuthError } from './auth.js';
import type { AuthService } from './auth.js';
import type { EnclaveConfig } from './config.js';
import type { Inventory } from './inventory.js';
import type { KeyManager } from './keys.js';
import type { InMemoryLedger } from './ledger.js';
import type { DepositWatcher } from './watcher.js';

/** The encrypted body on the wire. The plaintext limit is enforced when it is decrypted. */
const WIRE_BODY_LIMIT_BYTES = 24 * 1024;
const MS_PER_SECOND = 1000;
const SESSION_ID_BYTES = 32;

const ERROR_STATUS: Partial<Record<ErrorCode, number>> = {
  BAD_SIGNATURE: 401,
  UNKNOWN_SESSION: 401,
  UNAUTHORIZED: 403,
  NONCE_USED: 409,
  EXPIRED: 400,
  UNSUPPORTED_ASSET: 400,
  INVALID_PAYLOAD: 400,
};

export interface ApiDeps {
  auth: AuthService;
  config: EnclaveConfig;
  inventory: Pick<Inventory, 'linkOwner'>;
  keys: KeyManager;
  ledger: Pick<InMemoryLedger, 'getBalance'>;
  watcher: Pick<DepositWatcher, 'openSession'>;
}

function nowSec(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

/**
 * Registers a route whose request and successful response are both encrypted. Errors stay in
 * plaintext and carry only a code. Decrypting never proves who sent a request, so handlers must
 * still authorize it.
 */
function privateRoute<T>(
  app: FastifyInstance,
  keys: KeyManager,
  path: string,
  schema: ZodType<T>,
  handler: (request: T) => Promise<unknown>,
  invalidCode: (error: ZodError) => ErrorCode = () => ERROR_CODES.INVALID_PAYLOAD,
): void {
  app.post<{ Body: Envelope }>(path, { bodyLimit: WIRE_BODY_LIMIT_BYTES }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const refuse = (code: ErrorCode) => reply.code(ERROR_STATUS[code] ?? 500).send({ error: code });

    let channel;
    try {
      channel = await keys.decryptWithResponse(request.body, path);
    } catch {
      return refuse(ERROR_CODES.INVALID_PAYLOAD);
    }
    const parsed = schema.safeParse(channel.payload);
    if (!parsed.success) return refuse(invalidCode(parsed.error));

    try {
      return await channel.sealResponse(await handler(parsed.data));
    } catch (error) {
      return refuse(error instanceof AuthError ? error.code : ERROR_CODES.INTERNAL_ERROR);
    }
  });
}

/**
 * Authorizes a read. Past the expiry check every failure gives the same answer, because anyone can
 * send a query naming any owner: different errors would reveal who has an active session.
 */
export async function authorizeRead(
  auth: AuthService,
  message: SessionQueryMsg,
  signature: Hex,
): Promise<Address> {
  auth.validateExpiry(message.expiry);
  try {
    return (await auth.verifySessionQuery(message, signature)).owner;
  } catch {
    throw new AuthError(ERROR_CODES.UNKNOWN_SESSION, 'No valid session');
  }
}

function depositInvalidCode(error: ZodError): ErrorCode {
  const unsupported = error.issues.some(
    (issue) => issue.path.join('.') === 'message.asset' && issue.message.startsWith('Only native'),
  );
  return unsupported ? ERROR_CODES.UNSUPPORTED_ASSET : ERROR_CODES.INVALID_PAYLOAD;
}

export function apiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { auth, config, inventory, keys, ledger, watcher } = deps;

  privateRoute(app, keys, '/session', SignedSessionGrantSchema, async ({ message, signature }) => {
    const grant = await auth.createSessionGrant(wireToSessionGrantMsg(message), signature as Hex);
    return { ok: true, expiresAt: Number(grant.expiry) };
  });

  privateRoute(
    app,
    keys,
    '/deposit-session',
    SignedDepositRequestSchema,
    async ({ message, signature }) => {
      const { owner } = await auth.verifyAndAuthorizeMutation(
        'DepositRequest',
        wireToDepositRequestMsg(message),
        signature as Hex,
      );
      const { address } = await keys.allocate('deposit');
      const session = await watcher.openSession({
        id: `0x${randomBytes(SESSION_ID_BYTES).toString('hex')}`,
        owner,
        eoa: address,
        expiry: nowSec() + config.DEPOSIT_SESSION_TTL_SEC,
      });
      // The same link replay rebuilds: an owner's payout must never come from their deposit address.
      inventory.linkOwner(owner, address);
      return { sessionId: session.id, depositAddress: address, expiresAt: session.expiry };
    },
    depositInvalidCode,
  );

  privateRoute(app, keys, '/balance', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    const balances = [NATIVE, config.TOKEN_OUT_ADDRESS].map((token) => {
      const balance = ledger.getBalance(owner, token);
      return {
        token: balance.token,
        available: balance.available.toString(),
        reserved: balance.reserved.toString(),
        pending: balance.pending.toString(),
      };
    });
    return { balances };
  });
}
