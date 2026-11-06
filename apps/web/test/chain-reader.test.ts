// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { ChainReader, ChainReadUnavailableError } from '@/lib/chain/chain-reader';
import type { HarnessModule } from '@/lib/chain/chain-reader';
import { createReadClient, spotPriceFromSqrt } from '@/lib/chain/reads';
import { foundry } from 'viem/chains';

const anonConfig = {
  mode: 'anon-rpc' as const,
  anonSpecifier: '0x000000000000000000000000000000000000a11c' as const,
  anonTargetUrl: 'https://target.example/rpc',
  anonBootstrapRpcUrl: 'https://bootstrap.example/rpc',
  anonWorkerConfig: '{"network":"sepolia"}',
  devDirectRpcUrl: 'https://direct.example/rpc',
};

const rpc = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });

function fakeHarness(options: { fail?: boolean } = {}) {
  const calls: Array<{ url: string; body: string; anonOptions?: unknown }> = [];
  let init: unknown;
  const module: HarnessModule = {
    AnonRpcWorker: class {
      ready: Promise<void>;
      constructor(value: unknown) {
        init = value;
        this.ready = options.fail ? Promise.reject(new Error('specifier hash mismatch')) : Promise.resolve();
        this.ready.catch(() => undefined);
      }
      fetch = async (url: string, requestInit?: RequestInit & { anonOptions?: unknown }) => {
        calls.push({ url, body: String(requestInit?.body), anonOptions: requestInit?.anonOptions });
        return rpc('0x2a');
      };
      close() {}
    } as unknown as HarnessModule['AnonRpcWorker'],
  };
  return { module, calls, init: () => init };
}

describe('ChainReader', () => {
  it('routes reads through the Anon-RPC harness with the target URL and isolation key', async () => {
    const harness = fakeHarness();
    const directFetch = vi.fn(async () => rpc('0x0'));
    const reader = new ChainReader(anonConfig, { loadHarness: async () => harness.module, fetchFn: directFetch as never });
    expect(reader.getStatus()).toMatchObject({ route: 'anon-rpc', state: 'idle' });
    const result = await reader.request({ method: 'eth_blockNumber' }, 'iso-1');
    expect(result).toBe('0x2a');
    expect(harness.calls[0]).toMatchObject({ url: 'https://target.example/rpc', anonOptions: { isolationKey: 'iso-1' } });
    expect(harness.init()).toMatchObject({ address: anonConfig.anonSpecifier, config: { network: 'sepolia' } });
    expect(directFetch).not.toHaveBeenCalled();
    expect(reader.getStatus()).toMatchObject({ state: 'ready', totalReads: 1, byMethod: { eth_blockNumber: 1 } });
  });

  it('uses the bootstrap RPC only for the harness specifier read', async () => {
    const harness = fakeHarness();
    const directFetch = vi.fn(async () => rpc('0xabc'));
    const reader = new ChainReader(anonConfig, { loadHarness: async () => harness.module, fetchFn: directFetch as never });
    await reader.start();
    const provider = (harness.init() as { preExisting: { rpcProvider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } } }).preExisting.rpcProvider;
    expect(await provider.request({ method: 'eth_call', params: [] })).toBe('0xabc');
    expect(directFetch).toHaveBeenCalledWith('https://bootstrap.example/rpc', expect.anything());
  });

  it('fails closed when the harness fails: no fallback to any plain RPC', async () => {
    const harness = fakeHarness({ fail: true });
    const directFetch = vi.fn(async () => rpc('0x0'));
    const reader = new ChainReader(anonConfig, { loadHarness: async () => harness.module, fetchFn: directFetch as never });
    await expect(reader.request({ method: 'eth_getBalance', params: [] })).rejects.toBeInstanceOf(ChainReadUnavailableError);
    expect(reader.getStatus()).toMatchObject({ route: 'anon-rpc', state: 'failed', failedReads: 1 });
    expect(reader.available).toBe(false);
    expect(directFetch).not.toHaveBeenCalled();
    expect(harness.calls).toHaveLength(0);
  });

  it('is disabled, not silently direct, when Anon-RPC is incomplete', async () => {
    const directFetch = vi.fn();
    const reader = new ChainReader({ ...anonConfig, anonSpecifier: null }, { fetchFn: directFetch as never });
    expect(reader.getStatus()).toMatchObject({ route: 'none', state: 'disabled' });
    await expect(reader.request({ method: 'eth_chainId' })).rejects.toBeInstanceOf(ChainReadUnavailableError);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it('uses the direct dev RPC only in direct-dev mode, and labels it', async () => {
    const directFetch = vi.fn(async () => rpc('0x7a69'));
    const reader = new ChainReader({ ...anonConfig, mode: 'direct-dev' }, { fetchFn: directFetch as never });
    expect(reader.getStatus().detail).toMatch(/NOT anonymized/);
    const client = createReadClient(reader, foundry);
    expect(await client.getChainId()).toBe(31337);
    expect(directFetch).toHaveBeenCalledWith('https://direct.example/rpc', expect.objectContaining({ method: 'POST' }));
  });

  it('times out a harness that never becomes ready', async () => {
    const module: HarnessModule = {
      AnonRpcWorker: class {
        ready = new Promise<void>(() => undefined);
        fetch = async () => rpc('0x');
        close() {}
      } as unknown as HarnessModule['AnonRpcWorker'],
    };
    const reader = new ChainReader(anonConfig, { loadHarness: async () => module, readyTimeoutMs: 20 });
    await expect(reader.start()).rejects.toBeInstanceOf(ChainReadUnavailableError);
    expect(reader.getStatus().detail).toMatch(/did not become ready/);
  });
});

function isqrt(value: bigint): bigint {
  if (value < 2n) return value;
  let x = value;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + value / x) / 2n;
  }
  return x;
}

describe('pool spot price', () => {
  const Q192 = 2n ** 192n;
  const target = 2_000n * 10n ** 18n;
  const close = (price: bigint) => (price > target ? price - target : target - price) * 10n ** 9n <= target;

  it('reads tokenOut as token0 (USDC 6 dec / WETH 18 dec)', () => {
    // raw token1/token0 = 1e18 wei per 2000e6 USDC units
    const sqrt = isqrt((10n ** 18n * Q192) / (2_000n * 10n ** 6n));
    expect(close(spotPriceFromSqrt(sqrt, false, 6, 18))).toBe(true);
  });

  it('reads tokenOut as token1 (WETH 18 dec / USDC 6 dec)', () => {
    const sqrt = isqrt((2_000n * 10n ** 6n * Q192) / 10n ** 18n);
    expect(close(spotPriceFromSqrt(sqrt, true, 18, 6))).toBe(true);
  });

  it('returns zero for an uninitialised pool', () => {
    expect(spotPriceFromSqrt(0n, true, 18, 6)).toBe(0n);
  });
});
