import { randomBytes } from 'node:crypto';
import {
  ERROR_CODES,
  NATIVE,
  SignedCancelIntentSchema,
  SignedDepositRequestSchema,
  SignedIntentSchema,
  SignedSessionGrantSchema,
  SignedSessionQuerySchema,
  SignedWithdrawalSchema,
  wireToCancelIntentMsg,
  wireToDepositRequestMsg,
  wireToIntentMsg,
  wireToSessionGrantMsg,
  wireToSessionQueryMsg,
  wireToWithdrawalMsg,
} from '@cloakroom/shared';
import type { Envelope, ErrorCode, IntentMsg, SessionQueryMsg, WithdrawalMsg } from '@cloakroom/shared';
import type { FastifyInstance } from 'fastify';
import { getAddress } from 'viem';
import type { Address, Hex } from 'viem';
import type { ZodError, ZodType } from 'zod';
import { AuthError } from './auth.js';
import type { AuthService } from './auth.js';
import type { EnclaveConfig } from './config.js';
import type { IntentOrders } from './intent-orders.js';
import type { InMemoryIntentStore } from './intents.js';
import type { Inventory } from './inventory.js';
import type { KeyManager } from './keys.js';
import type { InMemoryLedger } from './ledger.js';
import { marginRoutes } from './margin-routes.js';
import type { MarginRouteDeps } from './margin-routes.js';
import type { DepositWatcher } from './watcher.js';
import type { WithdrawalOrders, WithdrawalStatuses } from './withdrawal-orders.js';

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
  INSUFFICIENT_BALANCE: 400,
  INTENT_NOT_FOUND: 404,
  NO_INVENTORY: 409,
  STALE_PRICE: 503,
  MARGIN_DISABLED: 404,
  POSITION_NOT_FOUND: 404,
  POSITION_BUSY: 409,
  INSUFFICIENT_COLLATERAL: 400,
  INSUFFICIENT_LIQUIDITY: 409,
};

export interface ApiDeps {
  auth: AuthService;
  config: EnclaveConfig;
  intentOrders: IntentOrders;
  intents: Pick<InMemoryIntentStore, 'listByOwner'>;
  inventory: Pick<Inventory, 'linkDeposit'>;
  keys: KeyManager;
  ledger: Pick<InMemoryLedger, 'getBalance'>;
  watcher: Pick<DepositWatcher, 'openSession' | 'listByOwner'>;
  withdrawalOrders: Pick<WithdrawalOrders, 'create'>;
  withdrawalStatuses: Pick<WithdrawalStatuses, 'listByOwner'>;
  /** Present only when MARGIN_ENABLED is set. Without it the margin routes do not exist. */
  margin?: MarginRouteDeps;
}

function nowSec(): number {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

/**
 * Registers a route whose request and successful response are both encrypted. Errors stay in
 * plaintext and carry only a code. Decrypting never proves who sent a request, so handlers must
 * still authorize it.
 */
export function privateRoute<T>(
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

/** Refuses an order the executor could never run, before it spends the owner's nonce. */
function assertRunnableIntent(intent: IntentMsg, config: EnclaveConfig): void {
  if (getAddress(intent.tokenIn) !== NATIVE || getAddress(intent.tokenOut) !== config.TOKEN_OUT_ADDRESS) {
    throw new AuthError(ERROR_CODES.UNSUPPORTED_ASSET);
  }
  // Only "at or above" has a limit to protect the seller: see the binding limit floor decision.
  const valid =
    intent.comparator === 0 &&
    intent.triggerPrice > 0n &&
    intent.amountIn > 0n &&
    intent.amountIn <= config.MAX_AMOUNT_NATIVE_WEI;
  if (!valid) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
}

/** Refuses a withdrawal that could never be paid, before it spends the owner's nonce. */
function assertPayableWithdrawal(withdrawal: WithdrawalMsg, config: EnclaveConfig): void {
  const token = getAddress(withdrawal.token);
  if (token !== NATIVE && token !== config.TOKEN_OUT_ADDRESS) {
    throw new AuthError(ERROR_CODES.UNSUPPORTED_ASSET);
  }
  const valid =
    withdrawal.amount > 0n &&
    getAddress(withdrawal.to) !== NATIVE &&
    (token !== NATIVE || withdrawal.amount <= config.MAX_AMOUNT_NATIVE_WEI);
  if (!valid) throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
}

export function apiRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const {
    auth,
    config,
    intentOrders,
    intents,
    inventory,
    keys,
    ledger,
    watcher,
    withdrawalOrders,
    withdrawalStatuses,
  } = deps;

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
      const asset = getAddress(message.asset);
      if (asset !== NATIVE && asset !== config.TOKEN_OUT_ADDRESS) {
        throw new AuthError(ERROR_CODES.UNSUPPORTED_ASSET);
      }
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
        funding: { asset, gasReserveWei: config.GAS_RESERVE_WEI },
      });
      // The same link replay rebuilds: an owner's payout must never come from their deposit address.
      inventory.linkDeposit(owner, address);
      return { sessionId: session.id, depositAddress: address, expiresAt: session.expiry,
        asset, gasReserveWei: config.GAS_RESERVE_WEI.toString(), singleUse: true };
    },
  );

  privateRoute(app, keys, '/deposits/status', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    return { deposits: watcher.listByOwner(owner) };
  });

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

  privateRoute(app, keys, '/intents', SignedIntentSchema, async ({ message, signature }) => {
    const intent = wireToIntentMsg(message);
    assertRunnableIntent(intent, config);
    const { owner } = await auth.verifyAndAuthorizeMutation('Intent', intent, signature as Hex);
    return { intentId: await intentOrders.create(owner, intent), status: 'pending' };
  });

  privateRoute(app, keys, '/intents/status', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    return {
      intents: intents.listByOwner(owner).map(({ id, status, settledAmountOut }) => ({
        id,
        status,
        ...(settledAmountOut === undefined ? {} : { amountOut: settledAmountOut.toString() }),
      })),
    };
  });

  privateRoute(app, keys, '/intents/cancel', SignedCancelIntentSchema, async ({ message, signature }) => {
    const cancel = wireToCancelIntentMsg(message);
    const { owner } = await auth.verifyAndAuthorizeMutation('CancelIntent', cancel, signature as Hex);
    await intentOrders.cancel(owner, cancel.intentId);
    return { status: 'cancelled' };
  });

  privateRoute(app, keys, '/withdrawals', SignedWithdrawalSchema, async ({ message, signature }) => {
    const withdrawal = wireToWithdrawalMsg(message);
    assertPayableWithdrawal(withdrawal, config);
    const { owner } = await auth.verifyAndAuthorizeMutation('Withdrawal', withdrawal, signature as Hex);
    return { withdrawalId: await withdrawalOrders.create(owner, withdrawal), status: 'locked' };
  });

  privateRoute(app, keys, '/withdrawals/status', SignedSessionQuerySchema, async ({ message, signature }) => {
    const owner = await authorizeRead(auth, wireToSessionQueryMsg(message), signature as Hex);
    return {
      withdrawals: withdrawalStatuses.listByOwner(owner).map(({ id, status, txHash, reason }) => ({
        id,
        status,
        ...(txHash === undefined ? {} : { txHash }),
        ...(reason === undefined ? {} : { reason }),
      })),
    };
  });

  if (deps.margin) marginRoutes(app, { auth, keys, ...deps.margin });
}
