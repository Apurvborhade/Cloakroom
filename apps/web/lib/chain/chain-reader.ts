import type { AppConfig } from '../config';
import { jsonRpcCall } from './json-rpc';

/**
 * Every browser-side chain read goes through one ChainReader. In the default `anon-rpc` mode it is
 * the Anon-RPC browser harness's anonymized fetch. There is no silent fallback: if Anon-RPC is
 * misconfigured or fails, reads fail and the status says so. A direct RPC is used only when
 * NEXT_PUBLIC_CHAIN_READ_MODE=direct-dev is set explicitly, and the UI labels it as not anonymized.
 */
export type ChainReadState = 'disabled' | 'idle' | 'starting' | 'ready' | 'failed';
export type ChainReadRoute = 'anon-rpc' | 'direct-dev' | 'none';

export interface ChainReadStatus {
  route: ChainReadRoute;
  state: ChainReadState;
  /** Fixed, value-free explanation. */
  detail: string;
  totalReads: number;
  failedReads: number;
  byMethod: Record<string, number>;
  lastReadAt: number | null;
  /** Where Cloakroom API requests go. Direct only if Anon-RPC is off or the user chose it. */
  apiRoute: 'anon-rpc' | 'direct';
  apiRequests: number;
  apiFailures: number;
}

export class ChainReadUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = 'ChainReadUnavailableError';
  }
}

interface HarnessWorker {
  ready: Promise<void>;
  fetch: (input: string, init?: RequestInit & { anonOptions?: { isolationKey?: string } }) => Promise<Response>;
  close(): void;
}

export interface HarnessModule {
  AnonRpcWorker: new (init: {
    address: string;
    config?: unknown;
    preExisting?: { rpcProvider?: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } };
  }) => HarnessWorker;
}

export interface ChainReaderDeps {
  loadHarness?: () => Promise<HarnessModule>;
  fetchFn?: typeof fetch;
  readyTimeoutMs?: number;
  now?: () => number;
}

type Listener = () => void;

const DEFAULT_READY_TIMEOUT_MS = 45_000;
/** Keeps API requests, which name the owner to the enclave, unlinkable from wallet chain reads. */
const API_ISOLATION_KEY = 'cloakroom-api';

export class ChainReader {
  readonly route: ChainReadRoute;
  #status: ChainReadStatus;
  #listeners = new Set<Listener>();
  #worker: HarnessWorker | null = null;
  #starting: Promise<HarnessWorker> | null = null;
  readonly #config: AppConfig['chainRead'];
  readonly #deps: Required<Pick<ChainReaderDeps, 'readyTimeoutMs' | 'now'>> & ChainReaderDeps;

  constructor(config: AppConfig['chainRead'], deps: ChainReaderDeps = {}) {
    this.#config = config;
    this.#deps = { readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS, now: Date.now, ...deps };
    const usesAnon = config.mode === 'anon-rpc' && Boolean(config.anonSpecifier && config.anonTargetUrl && config.anonBootstrapRpcUrl);
    const base = {
      totalReads: 0,
      failedReads: 0,
      byMethod: {},
      lastReadAt: null,
      apiRoute: usesAnon ? ('anon-rpc' as const) : ('direct' as const),
      apiRequests: 0,
      apiFailures: 0,
    };
    if (config.mode === 'direct-dev' && config.devDirectRpcUrl) {
      this.route = 'direct-dev';
      this.#status = { ...base, route: 'direct-dev', state: 'ready', detail: 'Development fallback: reads go directly to the configured RPC and are NOT anonymized.' };
    } else if (config.mode === 'anon-rpc' && config.anonSpecifier && config.anonTargetUrl && config.anonBootstrapRpcUrl) {
      this.route = 'anon-rpc';
      this.#status = { ...base, route: 'anon-rpc', state: 'idle', detail: 'Anon-RPC configured; the harness starts on the first chain read.' };
    } else {
      this.route = 'none';
      this.#status = {
        ...base,
        route: 'none',
        state: 'disabled',
        detail: config.mode === 'direct-dev'
          ? 'direct-dev mode needs NEXT_PUBLIC_DEV_DIRECT_RPC_URL. Browser chain reads are disabled.'
          : 'Anon-RPC is not fully configured (specifier, target and bootstrap URL are required). Browser chain reads are disabled; nothing falls back to a plain RPC.',
      };
    }
  }

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getStatus = (): ChainReadStatus => this.#status;

  get available(): boolean {
    return this.route !== 'none' && this.#status.state !== 'failed';
  }

  /** Starts the Anon-RPC harness ahead of the first read. Safe to call repeatedly. */
  async start(): Promise<void> {
    if (this.route === 'anon-rpc') await this.#ensureWorker();
  }

  /** EIP-1193 style request, suitable for viem's `custom` transport. */
  request = async ({ method, params }: { method: string; params?: unknown }, isolationKey?: string): Promise<unknown> => {
    const list = Array.isArray(params) ? params : params === undefined ? [] : [params];
    try {
      const result = await this.#dispatch(method, list, isolationKey);
      this.#record(method, true);
      return result;
    } catch (error) {
      this.#record(method, false);
      throw error;
    }
  };

  /**
   * A fetch for the Cloakroom API. With Anon-RPC on, it hides the user's IP from the operator, and
   * it fails rather than falling back: only setApiDirect, which the user chooses, goes direct.
   */
  apiFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const direct = this.#deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    if (this.#status.apiRoute === 'direct') return direct(input, init);
    try {
      const worker = await this.#ensureWorker();
      const response = await worker.fetch(String(input), { ...init, anonOptions: { isolationKey: API_ISOLATION_KEY } });
      this.#status = { ...this.#status, apiRequests: this.#status.apiRequests + 1 };
      this.#emit();
      return response;
    } catch (error) {
      this.#status = { ...this.#status, apiRequests: this.#status.apiRequests + 1, apiFailures: this.#status.apiFailures + 1 };
      this.#emit();
      throw error;
    }
  };

  /** The user's explicit choice to reach the API directly, which shows the operator their IP. */
  setApiDirect(direct: boolean): void {
    if (this.route !== 'anon-rpc') return;
    this.#status = { ...this.#status, apiRoute: direct ? 'direct' : 'anon-rpc' };
    this.#emit();
  }

  close(): void {
    this.#worker?.close();
    this.#worker = null;
    this.#starting = null;
  }

  async #dispatch(method: string, params: unknown[], isolationKey?: string): Promise<unknown> {
    if (this.route === 'none') throw new ChainReadUnavailableError(this.#status.detail);
    const fetchFn = this.#deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    if (this.route === 'direct-dev') {
      return jsonRpcCall((url, init) => fetchFn(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }), this.#config.devDirectRpcUrl!, method, params);
    }
    const worker = await this.#ensureWorker();
    const anonOptions = isolationKey ? { anonOptions: { isolationKey } } : {};
    return jsonRpcCall((url, init) => worker.fetch(url, { ...init, ...anonOptions }), this.#config.anonTargetUrl!, method, params);
  }

  #ensureWorker(): Promise<HarnessWorker> {
    if (this.#worker) return Promise.resolve(this.#worker);
    if (this.#status.state === 'failed') return Promise.reject(new ChainReadUnavailableError(this.#status.detail));
    this.#starting ??= this.#boot();
    return this.#starting;
  }

  async #boot(): Promise<HarnessWorker> {
    this.#set({ state: 'starting', detail: 'Starting the Anon-RPC harness: reading the specifier and verifying the worker bundle hash.' });
    try {
      const harness = await (this.#deps.loadHarness ?? (() => import('@anon-rpc/browser-harness') as unknown as Promise<HarnessModule>))();
      const fetchFn = this.#deps.fetchFn ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
      const bootstrapUrl = this.#config.anonBootstrapRpcUrl!;
      let config: unknown;
      if (this.#config.anonWorkerConfig) {
        try {
          config = JSON.parse(this.#config.anonWorkerConfig);
        } catch {
          throw new Error('NEXT_PUBLIC_ANON_RPC_WORKER_CONFIG is not valid JSON');
        }
      }
      const worker = new harness.AnonRpcWorker({
        address: this.#config.anonSpecifier!,
        ...(config === undefined ? {} : { config }),
        preExisting: {
          // Used only to read the on-chain specifier (workerHash and resolvers).
          rpcProvider: {
            request: ({ method, params }) =>
              jsonRpcCall((url, init) => fetchFn(url, { ...init, credentials: 'omit', referrerPolicy: 'no-referrer' }), bootstrapUrl, method, params ?? []),
          },
        },
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          worker.ready,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Anon-RPC harness did not become ready in time')), this.#deps.readyTimeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      this.#worker = worker;
      this.#set({ state: 'ready', detail: 'Anon-RPC active: browser chain reads go through the sandboxed anon-client.' });
      return worker;
    } catch (error) {
      this.#starting = null;
      const reason = error instanceof Error && /NEXT_PUBLIC_|did not become ready/.test(error.message) ? error.message : 'the harness failed to start';
      this.#set({ state: 'failed', detail: `Anon-RPC unavailable: ${reason}. Browser chain reads are disabled; nothing falls back to a plain RPC.` });
      throw new ChainReadUnavailableError(this.#status.detail);
    }
  }

  /** Lets the user retry after a failure (diagnostics page). */
  reset(): void {
    if (this.route !== 'anon-rpc') return;
    this.close();
    this.#set({ state: 'idle', detail: 'Anon-RPC configured; the harness starts on the next chain read.' });
  }

  #record(method: string, ok: boolean): void {
    const byMethod = { ...this.#status.byMethod, [method]: (this.#status.byMethod[method] ?? 0) + 1 };
    this.#status = {
      ...this.#status,
      totalReads: this.#status.totalReads + 1,
      failedReads: this.#status.failedReads + (ok ? 0 : 1),
      byMethod,
      lastReadAt: this.#deps.now(),
    };
    this.#emit();
  }

  #set(patch: Pick<ChainReadStatus, 'state' | 'detail'>): void {
    this.#status = { ...this.#status, ...patch };
    this.#emit();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
