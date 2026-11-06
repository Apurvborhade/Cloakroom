import { FifoSerialQueue } from './queue.js';
import { AttestationService } from './attestation.js';
import type { QuoteProvider } from './attestation.js';
import { AuthService } from './auth.js';
import { toSigningPolicy } from './config.js';
import type { EnclaveConfig } from './config.js';
import { custodyRoutes } from './custody-routes.js';
import { apiRoutes } from './routes.js';
import type { ApiDeps } from './routes.js';
import { Executor } from './executor.js';
import type { RecoveredOperation, SwapDeps } from './executor.js';
import { IntentOrders } from './intent-orders.js';
import { InMemoryIntentStore } from './intents.js';
import { Inventory } from './inventory.js';
import { EncryptedJournal } from './journal.js';
import type { KeyManager, SigningPolicy } from './keys.js';
import { InMemoryLedger } from './ledger.js';
import { IntentExecutionPipeline } from './pipeline.js';
import { PricePoller } from './price-poller.js';
import { DepositWatcher } from './watcher.js';
import { trackWithdrawals, WithdrawalOrders, WithdrawalStatuses } from './withdrawal-orders.js';
import type { Journal } from '@cloakroom/shared';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
const DRAIN_CHECK_MS = 50;
const ATTESTATION_NONCE = /^(?:[a-f0-9]{2}){32,64}$/;
const MAX_ATTESTATIONS_IN_FLIGHT = 8;
const MS_PER_SECOND = 1000;

export type KeyJournal = Pick<Journal, 'append' | 'replay'>;

export interface BootOptions {
  config: EnclaveConfig;
  chain: PublicClient;
  quoter: SwapDeps['quoter'];
  /** Opens and initializes custody. Key initialization must not read the journal. */
  openKeys: (journal: KeyJournal, policy: SigningPolicy) => Promise<KeyManager>;
  /** Without a build hash, GET /attestation answers 503: there is no simulated quote. */
  attestation?: { buildHash: string; provider?: QuoteProvider };
  /** Receives fixed status codes only, never request data or error text. */
  log?: (code: string) => void;
  drainTimeoutMs?: number;
}

export interface EnclaveParts {
  auth: AuthService;
  executor: Executor;
  intentOrders: IntentOrders;
  intents: InMemoryIntentStore;
  inventory: Inventory;
  journal: EncryptedJournal;
  keys: KeyManager;
  ledger: InMemoryLedger;
  pipeline: IntentExecutionPipeline;
  poller: PricePoller;
  queue: FifoSerialQueue;
  watcher: DepositWatcher;
  withdrawalOrders: WithdrawalOrders;
  withdrawalStatuses: WithdrawalStatuses;
}

export interface RunningEnclave {
  app: FastifyInstance;
  parts: EnclaveParts;
  recovery: RecoveredOperation[];
  /** Safe to call more than once. */
  stop(): Promise<void>;
}

/** Logging stays off, because request bodies and addresses are private. */
export async function buildApp(options: {
  api: ApiDeps;
  attestation?: AttestationService;
}): Promise<FastifyInstance> {
  const { api, attestation } = options;
  const { config, keys } = api;
  const app = Fastify({ logger: false });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'INVALID_PAYLOAD' }));
  app.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    const status = error.statusCode ?? 500;
    return status < 500
      ? reply.code(status).send({ error: 'INVALID_PAYLOAD' })
      : reply.code(500).send({ error: 'INTERNAL_ERROR' });
  });

  let attestationsInFlight = 0;
  app.get<{ Querystring: Record<string, string | string[]> }>('/attestation', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { nonce, ...others } = request.query;
    const valid = Object.keys(others).length === 0
      && (nonce === undefined || (typeof nonce === 'string' && ATTESTATION_NONCE.test(nonce)));
    if (!valid) return reply.code(400).send({ error: 'INVALID_PAYLOAD' });
    if (!attestation || attestationsInFlight >= MAX_ATTESTATIONS_IN_FLIGHT) {
      return reply.code(503).send({ error: 'INTERNAL_ERROR' });
    }
    attestationsInFlight += 1;
    try {
      return await attestation.response(typeof nonce === 'string' ? Buffer.from(nonce, 'hex') : undefined);
    } catch {
      return reply.code(503).send({ error: 'INTERNAL_ERROR' });
    } finally {
      attestationsInFlight -= 1;
    }
  });

  // Simulation has no quote to prove this key, so clients must not treat it as attested.
  if (config.SIM_MODE) {
    app.get('/sim/enclave-key', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return { enclavePubKey: keys.transportPublicKey(), chainId: config.CHAIN_ID, simulated: true };
    });
  }

  await app.register(custodyRoutes, {
    keys,
    adminAddress: config.ADMIN_ADDRESS,
    seedingEnabled: config.SEEDING_ENABLED,
    chainId: config.CHAIN_ID,
  });
  apiRoutes(app, api);
  return app;
}

/**
 * Starts the enclave service in the documented boot order, and accepts requests only once recovery
 * has finished. A failed step stops whatever already started. The thrown message names the step
 * and nothing else, because the cause can contain the RPC URL.
 */
export async function bootEnclave(options: BootOptions): Promise<RunningEnclave> {
  const { chain, config, quoter } = options;
  const log = options.log ?? (() => undefined);
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;

  const cleanups: Array<() => void | Promise<void>> = [];
  const runCleanups = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        await cleanup();
      } catch {
        log('CLEANUP_FAILED');
      }
    }
  };
  const step = async <T>(name: string, run: () => T | Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (cause) {
      await runCleanups();
      throw new Error(`BOOT_FAILED:${name}`, { cause });
    }
  };

  await step('chain', async () => {
    if ((await chain.getChainId()) !== config.CHAIN_ID) throw new Error('CHAIN_MISMATCH');
  });

  // KeyManager needs the journal to sign, and the journal needs KeyManager's cipher to open. Keys
  // don't read the journal during init, so they get a pass-through until the journal is open.
  let journal: EncryptedJournal | undefined;
  const openJournal = () => {
    if (!journal) throw new Error('JOURNAL_NOT_OPEN');
    return journal;
  };
  const keyJournal: KeyJournal = {
    append: (event) => openJournal().append(event),
    replay: () => openJournal().replay(),
  };

  const keys = await step('keys', async () => {
    const manager = await options.openKeys(keyJournal, toSigningPolicy(config));
    const existing = manager.list().filter((eoa) => eoa.role === 'inventory').length;
    for (let count = existing; count < config.INVENTORY_EOA_COUNT; count += 1) {
      await manager.allocate('inventory');
    }
    return manager;
  });

  journal = await step('journal', () =>
    EncryptedJournal.open({ filePath: config.JOURNAL_PATH, cipher: keys.journalCipher() }),
  );
  const openedJournal = journal;
  cleanups.push(() => openedJournal.close());

  const queue = new FifoSerialQueue();
  const ledger = new InMemoryLedger();
  const intents = new InMemoryIntentStore();
  const inventory = new Inventory({
    chain,
    keys,
    tokens: [config.TOKEN_OUT_ADDRESS],
    gasReserveWei: config.GAS_RESERVE_WEI,
  });
  const confirmations = BigInt(config.CONFIRMATIONS);
  const watcher = new DepositWatcher({
    chain,
    journal: openedJournal,
    ledger,
    queue,
    confirmations,
    onSessionClosed: (eoa) => inventory.markInventory(eoa),
  });

  const withdrawalStatuses = new WithdrawalStatuses();
  const trackedJournal = trackWithdrawals(openedJournal, withdrawalStatuses);

  await step('replay', async () => {
    for await (const { event, timestamp } of openedJournal.replay()) {
      ledger.apply(event);
      intents.apply(event, timestamp);
      inventory.replay(event);
      watcher.replay(event);
      withdrawalStatuses.apply(event);
    }
  });
  await step('signing-state', () => keys.restoreSigningState());

  const auth = new AuthService({
    chainId: config.CHAIN_ID,
    enclavePubKey: keys.transportPublicKey(),
    config: {
      sessionGrantTtlSec: config.SESSION_GRANT_TTL_SEC,
      maxExpiryFutureSec: config.MAX_EXPIRY_FUTURE_SEC,
      maxClockSkewSec: config.MAX_CLOCK_SKEW_SEC,
    },
    queue,
    journal: openedJournal,
    ledger,
  });
  const executor = new Executor({
    chain,
    chainId: config.CHAIN_ID,
    signer: keys,
    inventory,
    journal: trackedJournal,
    ledger,
    queue,
    confirmations,
    receiptTimeoutMs: config.RECEIPT_TIMEOUT_MS,
    gasMarginPercent: BigInt(config.GAS_MARGIN_PERCENT),
    inventorySettleAttempts: config.INVENTORY_SETTLE_ATTEMPTS,
    swaps: {
      quoter,
      intents,
      ledger,
      routerAddress: config.UNIVERSAL_ROUTER_ADDRESS,
      tokenOut: config.TOKEN_OUT_ADDRESS,
      tokenOutDecimals: config.TOKEN_OUT_DECIMALS,
      feeBps: config.FEE_BPS,
      maxSlippageBpsCap: config.MAX_SLIPPAGE_BPS_CAP,
    },
  });
  const intentOrders = new IntentOrders({ intents, journal: openedJournal, ledger, queue });
  const withdrawalOrders = new WithdrawalOrders({
    executor,
    journal: trackedJournal,
    ledger,
    queue,
    onError: () => log('WITHDRAWAL_JOURNAL_ERROR'),
  });
  const pipeline = new IntentExecutionPipeline({
    intents,
    executor,
    onIntentError: () => log('INTENT_EXECUTION_ERROR'),
  });
  const poller = new PricePoller({
    quoter,
    tokenOut: config.TOKEN_OUT_ADDRESS,
    tokenOutDecimals: config.TOKEN_OUT_DECIMALS,
    referenceAmountWei: config.PRICE_REFERENCE_AMOUNT_WEI,
    intervalSec: config.PRICE_POLL_INTERVAL_SEC,
    swapper: privateKeyToAccount(generatePrivateKey()).address,
    onReport: pipeline.onReport,
    onError: () => log('PRICE_POLL_FAILED'),
  });

  await step('inventory', () => inventory.refresh());
  const recovery = await step('recovery', () => executor.recover(openedJournal.replay()));
  const stuck = recovery.filter(({ status }) => status === 'review' || status === 'unresolved').length;
  log(stuck === 0 ? 'RECOVERY_DONE' : 'RECOVERY_DONE_WITH_LOCKED_FUNDS');
  await step('expiry', () => intentOrders.expireDue());

  const app = await step('routes', () =>
    buildApp({
      api: { auth, config, intentOrders, intents, inventory, keys, ledger, watcher, withdrawalOrders, withdrawalStatuses },
      attestation: options.attestation
        ? new AttestationService(options.attestation.buildHash, {
            identity: keys,
            chainId: config.CHAIN_ID,
            provider: options.attestation.provider,
          })
        : undefined,
    }),
  );
  cleanups.push(() => app.close());

  await step('start', () => {
    cleanups.push(watcher.start(chain, () => log('WATCHER_ERROR')));
    cleanups.push(poller.start());
    // On its own timer, so orders still expire and release funds when price checks are failing.
    const expiryTimer = setInterval(() => {
      intentOrders.expireDue().catch(() => log('INTENT_EXPIRY_ERROR'));
    }, config.PRICE_POLL_INTERVAL_SEC * MS_PER_SECOND);
    cleanups.push(() => clearInterval(expiryTimer));
  });
  await step('listen', () => app.listen({ host: config.HOST, port: config.PORT }));
  log('LISTENING');

  const drainSwaps = async () => {
    const deadline = Date.now() + drainTimeoutMs;
    const running = () => pipeline.inFlightCount + withdrawalOrders.inFlightCount;
    while (running() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_CHECK_MS));
    }
    if (running() > 0) log('SHUTDOWN_WITH_SWAPS_RUNNING');
  };

  let stopping: Promise<void> | undefined;
  const stop = () => {
    // Cleanups run newest first: poller, watcher, server, then this, then the journal.
    stopping ??= (async () => {
      const closeJournal = cleanups.shift();
      await runCleanups();
      await drainSwaps();
      await closeJournal?.();
      log('STOPPED');
    })();
    return stopping;
  };

  return {
    app,
    parts: { auth, executor, intentOrders, intents, inventory, journal: openedJournal, keys, ledger, pipeline, poller, queue, watcher, withdrawalOrders, withdrawalStatuses },
    recovery,
    stop,
  };
}
