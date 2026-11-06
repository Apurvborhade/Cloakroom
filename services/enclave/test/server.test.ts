import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NATIVE } from '@cloakroom/shared';
import type { StoredIntent } from '@cloakroom/shared';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { Executor } from '../src/executor.js';
import { EncryptedJournal } from '../src/journal.js';
import { KeyManager } from '../src/keys.js';
import { AesGcmStateVault, FileCipherBlobStore, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import type { CustodyRuntime } from '../src/custody-runtime.js';
import { bootEnclave } from '../src/server.js';
import type { BootOptions, RunningEnclave } from '../src/server.js';
import type { Quote, QuoteRequest } from '../src/uniswap.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from './fixtures/test-token.js';
import { apiClient } from './helpers/enclave.js';

const ANVIL_PORT = 18_793;
const API_PORT = 18_794;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
// Anvil's first default account: a public, test-only key.
const FUNDER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const OWNER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const ROUTER: Address = '0x7E4f6c5e954Da5c61B3423D81E2277431Ac043f3';
const BUILD_HASH = 'ab'.repeat(32);

const transport = http(RPC_URL);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 100 }) as PublicClient;
const wallet = createWalletClient({ account: FUNDER, chain: foundry, transport });

let anvilProcess: ChildProcess;
let TOKEN: Address;
let directory: string;
let store: MemoryCipherBlobStore;
let quotes: QuoteRequest[];
let running: RunningEnclave[];

function env(overrides: Record<string, string> = {}) {
  const example = Object.fromEntries(
    readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
  return loadConfig({
    ...example,
    CHAIN_ID: String(foundry.id),
    RPC_URL,
    CONFIRMATIONS: '0',
    UNISWAP_API_KEY: 'test-api-key',
    ADMIN_ADDRESS: OWNER,
    ALLOWED_ORIGIN: 'https://app.example',
    UNIVERSAL_ROUTER_ADDRESS: ROUTER,
    TOKEN_OUT_ADDRESS: TOKEN,
    PRICE_POLL_INTERVAL_SEC: '3600',
    SIM_MODE: 'true',
    HOST: '127.0.0.1',
    PORT: String(API_PORT),
    JOURNAL_PATH: join(directory, 'enclave.journal'),
    INVENTORY_EOA_COUNT: '2',
    CUSTODY_ALLOW_CREATE: 'true',
    ...overrides,
  });
}

const quoter: BootOptions['quoter'] = {
  quote: async (request: QuoteRequest): Promise<Quote> => {
    quotes.push(request);
    return { amountIn: request.amountIn, amountOut: 300_000_000n, minAmountOut: 0n };
  },
};

function options(overrides: Partial<BootOptions> = {}): BootOptions {
  return {
    config: env(),
    chain,
    quoter,
    openKeys: async (journal, policy) => {
      const vault = new AesGcmStateVault(store, simulationSealingKey('aa'.repeat(32), true), true);
      const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate: true });
      await keys.init();
      return keys;
    },
    ...overrides,
  };
}

async function boot(overrides: Partial<BootOptions> = {}): Promise<RunningEnclave> {
  const enclave = await bootEnclave(options(overrides));
  running.push(enclave);
  return enclave;
}

const isListening = () =>
  fetch(`http://127.0.0.1:${API_PORT}/attestation`).then(
    () => true,
    () => false,
  );

async function send(to: Address, value: bigint): Promise<void> {
  const hash = await wallet.sendTransaction({ to, value });
  await chain.waitForTransactionReceipt({ hash });
}

function intent(overrides: Partial<StoredIntent['intent']> = {}): StoredIntent['intent'] {
  return {
    owner: OWNER,
    tokenIn: NATIVE,
    tokenOut: TOKEN,
    amountIn: parseEther('0.1'),
    comparator: 0,
    triggerPrice: 1n,
    maxSlippageBps: 50,
    nonce: 1n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 3600),
    ...overrides,
  };
}

async function record(enclave: RunningEnclave, event: Parameters<EncryptedJournal['append']>[0]): Promise<void> {
  await enclave.parts.journal.append(event);
  enclave.parts.ledger.apply(event);
}

/** A deposit as the watcher journals it: replay needs the session behind every credit. */
async function credit(enclave: RunningEnclave, id: string, amount: bigint): Promise<void> {
  await record(enclave, {
    t: 'DEPOSIT_SESSION_OPENED',
    id,
    owner: OWNER,
    eoa: '0x00000000000000000000000000000000000dEaD1',
    expiry: 1,
    baseline: 0n,
    baselineBlock: 0n,
  });
  await record(enclave, { t: 'DEPOSIT_CREDITED', id, owner: OWNER, amount, block: 1n });
}

beforeAll(async () => {
  anvilProcess = spawn('anvil', ['--port', String(ANVIL_PORT), '--silent'], { stdio: 'ignore' });
  await vi.waitFor(() => chain.getBlockNumber(), { timeout: 10_000, interval: 100 });
  const hash = await wallet.deployContract({ abi: TEST_TOKEN_ABI, bytecode: TEST_TOKEN_BYTECODE });
  TOKEN = (await chain.waitForTransactionReceipt({ hash })).contractAddress as Address;
});

afterAll(() => {
  anvilProcess.kill();
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cloakroom-server-'));
  store = new MemoryCipherBlobStore();
  quotes = [];
  running = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(running.map((enclave) => enclave.stop()));
  rmSync(directory, { recursive: true, force: true });
});

describe('starting', () => {
  it('finishes recovery before it accepts requests', async () => {
    const codes: string[] = [];
    await boot({ log: (code) => codes.push(code) });

    expect(codes.indexOf('RECOVERY_DONE')).toBeGreaterThanOrEqual(0);
    expect(codes.indexOf('RECOVERY_DONE')).toBeLessThan(codes.indexOf('LISTENING'));
    expect(await isListening()).toBe(true);
  });

  it('allocates the inventory addresses once', async () => {
    const first = await boot();
    const addresses = first.parts.keys.list().map((eoa) => eoa.address);
    expect(addresses).toHaveLength(2);
    await first.stop();

    const second = await boot();

    expect(second.parts.keys.list().map((eoa) => eoa.address)).toEqual(addresses);
  });

  it('starts the price poller, with an address that is not a custody address', async () => {
    const enclave = await boot();

    await vi.waitFor(() => expect(quotes.length).toBeGreaterThan(0));

    const custody = enclave.parts.keys.list().map((eoa) => eoa.address);
    expect(custody).not.toContain(quotes[0]!.swapper);
  });

  it('encrypts the journal with the key manager, and reopens it', async () => {
    const first = await boot();
    await credit(first, 'secret-marker', 5n);
    await first.stop();

    expect(readFileSync(join(directory, 'enclave.journal')).toString('latin1')).not.toContain('secret-marker');
    const second = await boot();
    expect(second.parts.ledger.getBalance(OWNER, NATIVE).available).toBe(5n);
  });
});

describe('restarting', () => {
  it('restores balances, orders and open deposit sessions from the journal', async () => {
    const first = await boot();
    const order = intent({ triggerPrice: 10n ** 30n });
    await credit(first, 'deposit-1', parseEther('1'));
    const event = { t: 'INTENT_CREATED', id: 'intent-1', owner: OWNER, intent: order } as const;
    await record(first, event);
    first.parts.intents.apply(event);
    const depositEoa = (await first.parts.keys.allocate('deposit')).address;
    await first.parts.watcher.openSession({
      id: 'session-1',
      owner: OWNER,
      eoa: depositEoa,
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    const publicKey = first.parts.keys.transportPublicKey();
    await first.stop();

    const second = await boot();

    expect(second.parts.keys.transportPublicKey()).toBe(publicKey);
    expect(second.parts.ledger.getBalance(OWNER, NATIVE)).toMatchObject({
      available: parseEther('0.9'),
      reserved: parseEther('0.1'),
    });
    expect(second.parts.intents.get('intent-1')?.status).toBe('pending');

    await send(depositEoa, 7n);
    await second.parts.watcher.tick();
    expect(second.parts.ledger.getBalance(OWNER, NATIVE).available).toBe(parseEther('0.9') + 7n);
  });

  it('releases a withdrawal that was locked but never sent', async () => {
    const first = await boot();
    await credit(first, 'deposit-1', 10n);
    await record(first, { t: 'WITHDRAWAL_LOCKED', id: 'withdrawal-1', owner: OWNER, token: NATIVE, amount: 4n, to: FUNDER.address });
    expect(first.parts.ledger.getBalance(OWNER, NATIVE).reserved).toBe(4n);
    await first.stop();

    const second = await boot();

    expect(second.recovery).toEqual([{ opId: 'withdrawal-1', status: 'released' }]);
    expect(second.parts.ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 10n, reserved: 0n });
  });
});

describe('persistent runtime boot', () => {
  function persistent(allowCreate: boolean): BootOptions['openRuntime'] {
    return (policy) => openCustodyRuntime({
      vault: new AesGcmStateVault(store, simulationSealingKey('aa'.repeat(32), true), true),
      journalStore: new FileCipherBlobStore(join(directory, 'snapshot.blob')),
      policy, buildHash: BUILD_HASH, simMode: true, allowCreate,
      quote: async () => Buffer.from('runtime-quote'),
    });
  }

  it('restores ledger, intents and watcher from the snapshot without opening a local journal', async () => {
    const first = await boot({ openKeys: undefined, openRuntime: persistent(true) });
    const sessionKey = privateKeyToAccount(generatePrivateKey());
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 120);
    const api = apiClient(first);
    const signature = await api.sign(FUNDER, 'SessionGrant', {
      owner: FUNDER.address, sessionKey: sessionKey.address, expiry,
    } as never);
    expect((await api.post('/session', { message: {
      owner: FUNDER.address, sessionKey: sessionKey.address, expiry: expiry.toString(),
    }, signature })).status).toBe(200);
    await credit(first, 'persistent-credit', parseEther('1'));
    const order = { t: 'INTENT_CREATED', id: 'persistent-order', owner: OWNER,
      intent: intent({ triggerPrice: 10n ** 30n }) } as const;
    await record(first, order);
    const eoa = (await first.parts.keys.allocate('deposit')).address;
    await first.parts.watcher.openSession({ id: 'persistent-session', owner: OWNER, eoa,
      expiry: Math.floor(Date.now() / 1000) + 3600 });
    const identity = first.parts.keys.transportPublicKey();
    const addresses = first.parts.keys.list();
    await first.stop();
    expect(existsSync(join(directory, 'enclave.journal'))).toBe(false);
    expect(readFileSync(join(directory, 'snapshot.blob')).toString('latin1')).not.toContain('persistent-credit');

    let runtime: CustodyRuntime | undefined;
    const second = await boot({ openKeys: undefined, openRuntime: async (policy) => {
      runtime = await persistent(false)!(policy); return runtime;
    } });
    expect(second.parts.ledger).toBe(runtime!.ledger);
    expect(second.parts.keys.transportPublicKey()).toBe(identity);
    expect(second.parts.keys.list()).toEqual(addresses);
    expect(second.parts.ledger.getBalance(OWNER, NATIVE)).toMatchObject({
      available: parseEther('0.9'), reserved: parseEther('0.1'),
    });
    expect(second.parts.intents.get('persistent-order')?.status).toBe('pending');
    const restoredApi = apiClient(second);
    const readSignature = await restoredApi.sign(sessionKey, 'SessionQuery', { owner: FUNDER.address, expiry } as never);
    const readBalance = () => restoredApi.post('/balance', {
      message: { owner: FUNDER.address, expiry: expiry.toString() }, signature: readSignature,
    });
    expect((await readBalance()).status).toBe(401);
    expect((await restoredApi.post('/session', { message: {
      owner: FUNDER.address, sessionKey: sessionKey.address, expiry: expiry.toString(),
    }, signature })).status).toBe(200);
    expect((await readBalance()).status).toBe(200);
    expect((await second.app.inject({ url: '/attestation' })).json()).toMatchObject({
      enclavePubKey: identity, quote: Buffer.from('runtime-quote').toString('base64'),
    });
    await send(eoa, 7n);
    await second.parts.watcher.tick();
    expect(second.parts.ledger.getBalance(OWNER, NATIVE).available).toBe(parseEther('0.9') + 7n);
  });

  it.each(['missing', 'tampered'])('refuses a %s snapshot without replacing state', async (damage) => {
    const first = await boot({ openKeys: undefined, openRuntime: persistent(true) });
    await credit(first, 'credit', 5n);
    await first.stop();
    const path = join(directory, 'snapshot.blob');
    if (damage === 'missing') rmSync(path);
    else {
      const bytes = readFileSync(path); bytes[bytes.length - 1] = bytes.at(-1)! ^ 0xff; writeFileSync(path, bytes);
    }
    const saved = await store.read();
    await expect(bootEnclave(options({ openKeys: undefined, openRuntime: persistent(true) })))
      .rejects.toThrow('BOOT_FAILED:custody');
    expect(await store.read()).toEqual(saved);
    expect(await isListening()).toBe(false);
    expect(existsSync(join(directory, 'enclave.journal'))).toBe(false);
  });

  it('closes keys and snapshots after recovery fails', async () => {
    let runtime: CustodyRuntime | undefined;
    vi.spyOn(Executor.prototype, 'recover').mockRejectedValueOnce(new Error('secret RPC failure'));
    await expect(bootEnclave(options({ openKeys: undefined, openRuntime: async (policy) => {
      runtime = await persistent(true)!(policy); return runtime;
    } }))).rejects.toThrow('BOOT_FAILED:recovery');
    expect(await isListening()).toBe(false);
    await expect(runtime!.keys.allocate('inventory')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    await expect(runtime!.journal.append({ t: 'DEPOSIT_CREDITED', id: 'late', owner: OWNER, amount: 1n, block: 1n }))
      .rejects.toThrow('JOURNAL_UNAVAILABLE');
    expect(await boot({ openKeys: undefined, openRuntime: persistent(false) })).toBeDefined();
  });

  it('requires the persistent runtime outside simulation', async () => {
    const openKeys = vi.fn(options().openKeys!);
    await expect(bootEnclave(options({ config: env({ SIM_MODE: 'false' }), openKeys })))
      .rejects.toThrow('BOOT_FAILED:storage');
    expect(openKeys).not.toHaveBeenCalled();
  });

  it('listens on the enclave socket and closes the runtime on shutdown', async () => {
    let runtime: CustodyRuntime | undefined;
    const enclave = await boot({ socketPath: join(directory, 'enclave.sock'), openKeys: undefined,
      openRuntime: async (policy) => { runtime = await persistent(true)!(policy); return runtime; } });
    expect(existsSync(join(directory, 'enclave.sock'))).toBe(true);
    expect(await isListening()).toBe(false);
    expect((await enclave.app.inject({ url: '/attestation' })).statusCode).toBe(200);
    const close = vi.spyOn(runtime!, 'close');
    await enclave.stop(); await enclave.stop();
    expect(close).toHaveBeenCalledTimes(1);
    await expect(runtime!.keys.allocate('inventory')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
  });
});

describe('routes', () => {
  it('permits browser requests from the configured origin only', async () => {
    const enclave = await boot();
    for (const origin of ['https://app.example', 'https://another.example']) {
      const response = await enclave.app.inject({ method: 'OPTIONS', url: '/session', headers: {
        origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type',
      } });
      expect(response.headers['access-control-allow-origin']).toBe(origin === 'https://app.example' ? origin : undefined);
      if (origin === 'https://app.example') expect(response.statusCode).toBe(204);
    }
  });

  it('serves a quote for the key manager, and only with a valid nonce', async () => {
    const provider = vi.fn(async () => Buffer.from('quote'));
    const enclave = await boot({ attestation: { buildHash: BUILD_HASH, provider } });

    const good = await enclave.app.inject({ url: '/attestation' });
    const nonce = await enclave.app.inject({ url: `/attestation?nonce=${'01'.repeat(32)}` });
    const badNonce = await enclave.app.inject({ url: '/attestation?nonce=zz' });
    const extra = await enclave.app.inject({ url: '/attestation?other=1' });

    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({
      quote: Buffer.from('quote').toString('base64'),
      enclavePubKey: enclave.parts.keys.transportPublicKey(),
      buildHash: `0x${BUILD_HASH}`,
      chainId: foundry.id,
    });
    expect(nonce.statusCode).toBe(200);
    expect(badNonce.statusCode).toBe(400);
    expect(extra.statusCode).toBe(400);
  });

  it('refuses attestation when there is no quote to give, rather than faking one', async () => {
    const enclave = await boot();

    const response = await enclave.app.inject({ url: '/attestation' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: 'INTERNAL_ERROR' });
  });

  it('registers the custody route only while seeding is on', async () => {
    const seeding = await boot();
    expect((await seeding.app.inject({ method: 'POST', url: '/admin/eoas', payload: {} })).statusCode).toBe(400);
    await seeding.stop();

    const closed = await boot({ config: env({ SEEDING_ENABLED: 'false' }) });
    expect((await closed.app.inject({ method: 'POST', url: '/admin/eoas', payload: {} })).statusCode).toBe(404);
  });

  it('answers unknown routes with a documented error code', async () => {
    const enclave = await boot();

    const response = await enclave.app.inject({ url: '/nope' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'INVALID_PAYLOAD' });
  });
});

describe('a failed boot', () => {
  async function expectFailure(step: string, overrides: Partial<BootOptions> = {}) {
    const failure = await bootEnclave(options(overrides)).then(
      () => new Error('booted'),
      (error: Error) => error,
    );
    expect(failure.message).toBe(`BOOT_FAILED:${step}`);
    expect(failure.message).not.toContain(RPC_URL);
    expect(await isListening()).toBe(false);
  }

  it('refuses an RPC on the wrong chain', async () => {
    await expectFailure('chain', { config: env({ CHAIN_ID: '11155111' }) });
  });

  it('refuses when custody will not open', async () => {
    await expectFailure('keys', {
      openKeys: async () => {
        throw new Error('KEY_MANAGER_UNAVAILABLE');
      },
    });
  });

  it('refuses a tampered journal', async () => {
    const first = await boot();
    await credit(first, 'deposit-1', 5n);
    await first.stop();
    const path = join(directory, 'enclave.journal');
    const bytes = readFileSync(path);
    bytes[20] = bytes[20]! ^ 0xff;
    writeFileSync(path, bytes);

    await expectFailure('journal');
  });

  it('refuses when inventory cannot be read', async () => {
    const broken = new Proxy(chain, {
      get: (target, property, receiver) =>
        property === 'getBalance' || property === 'multicall' || property === 'readContract'
          ? () => Promise.reject(new Error(`RPC failed at ${RPC_URL}`))
          : Reflect.get(target, property, receiver),
    });

    await expectFailure('inventory', { chain: broken });
  });

  it('never accepts requests when recovery fails, and leaves the journal usable', async () => {
    vi.spyOn(Executor.prototype, 'recover').mockRejectedValueOnce(new Error('recovery broke'));

    await expectFailure('recovery');

    expect(await boot()).toBeDefined();
  });

  it('stops the watcher and poller when the port is taken', async () => {
    await boot();
    const before = quotes.length;

    await expectFailure2();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(quotes.length).toBeLessThanOrEqual(before + 1);

    async function expectFailure2() {
      const separate = mkdtempSync(join(tmpdir(), 'cloakroom-server-'));
      const otherStore = new MemoryCipherBlobStore();
      const failure = await bootEnclave(
        options({
          config: env({ JOURNAL_PATH: join(separate, 'enclave.journal') }),
          openKeys: async (journal, policy) => {
            const vault = new AesGcmStateVault(otherStore, simulationSealingKey('aa'.repeat(32), true), true);
            const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate: true });
            await keys.init();
            return keys;
          },
        }),
      ).then(
        () => new Error('booted'),
        (error: Error) => error,
      );
      rmSync(separate, { recursive: true, force: true });
      expect(failure.message).toBe('BOOT_FAILED:listen');
    }
  });
});

describe('stopping', () => {
  it('stops polling and listening, closes the journal, and can be called twice', async () => {
    const enclave = await boot({ config: env({ PRICE_POLL_INTERVAL_SEC: '1' }) });
    await vi.waitFor(() => expect(quotes.length).toBeGreaterThan(0));

    await enclave.stop();
    await enclave.stop();
    const after = quotes.length;
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect(quotes.length).toBe(after);
    expect(await isListening()).toBe(false);
    await expect(
      enclave.parts.journal.append({ t: 'DEPOSIT_CREDITED', id: 'late', owner: OWNER, amount: 1n, block: 1n }),
    ).rejects.toThrow('JOURNAL_CLOSED');
  });

  it('does not wait forever for a running swap, and says so', async () => {
    const first = await boot();
    const event = { t: 'INTENT_CREATED', id: 'intent-1', owner: OWNER, intent: intent() } as const;
    await credit(first, 'deposit-1', parseEther('1'));
    await record(first, event);
    await send(first.parts.keys.list()[0]!.address, parseEther('1'));
    await first.stop();

    let release = () => undefined as void;
    let swapQuoteStarted = false;
    const hanging: BootOptions['quoter'] = {
      quote: async (request) => {
        if (request.slippagePercent === undefined) return quoter.quote(request);
        swapQuoteStarted = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        throw new Error('stopped');
      },
    };
    const codes: string[] = [];
    const second = await boot({ quoter: hanging, drainTimeoutMs: 50, log: (code) => codes.push(code) });
    await vi.waitFor(() => expect(swapQuoteStarted).toBe(true));

    await second.stop();

    expect(codes).toContain('SHUTDOWN_WITH_SWAPS_RUNNING');
    expect(codes.at(-1)).toBe('STOPPED');
    release();
  });
});

describe('the journal cipher option', () => {
  const cipher = {
    encrypt: (plaintext: Uint8Array) => Buffer.concat([Buffer.alloc(12, 1), Buffer.alloc(16, 2), Buffer.from(plaintext)]),
    decrypt: (sealed: Uint8Array) => Buffer.from(sealed).subarray(28),
  };

  it.each([
    ['neither', {}],
    ['both', { key: Buffer.alloc(32), cipher }],
  ])('refuses %s of key and cipher', (_name, secret) => {
    // @ts-expect-error Exercise runtime validation of deliberately invalid options.
    expect(() => new EncryptedJournal({ filePath: join(directory, 'x.journal'), ...secret })).toThrow('JOURNAL_KEY_INVALID');
  });

  it('reports a failed decrypt as corruption', async () => {
    const path = join(directory, 'x.journal');
    const journal = await EncryptedJournal.open({ filePath: path, cipher });
    await journal.append({ t: 'DEPOSIT_CREDITED', id: 'a', owner: OWNER, amount: 1n, block: 1n });
    await journal.close();
    const failing = {
      ...cipher,
      decrypt: (): Hex => {
        throw new Error('JOURNAL_DECRYPT_FAILED');
      },
    };

    await expect(EncryptedJournal.open({ filePath: path, cipher: failing as never })).rejects.toThrow('JOURNAL_CORRUPT');
  });
});
