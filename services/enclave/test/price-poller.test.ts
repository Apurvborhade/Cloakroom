import { NATIVE, PRICE_PRECISION, type PriceReport } from '@cloakroom/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import type { Address } from 'viem';
import { PricePoller, priceFromQuote, type PricePollerDeps } from '../src/price-poller.js';
import { UniswapClient, type Quote, type QuoteRequest } from '../src/uniswap.js';

const USDC: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const SWAPPER = privateKeyToAddress(generatePrivateKey());
const REFERENCE = 100_000_000_000_000_000n;
const CHAIN_ID = 11155111;
const API_KEY = 'secret-api-key';

/** The values from a real Sepolia quote for 0.1 ETH. */
const REAL_QUOTE: Quote = {
  amountIn: REFERENCE,
  amountOut: 2_630_992_794n,
  minAmountOut: 2_617_837_830n,
};

function quoteBody(overrides: Record<string, unknown> = {}, quote: Record<string, unknown> = {}) {
  return {
    routing: 'CLASSIC',
    quote: {
      chainId: CHAIN_ID,
      input: { amount: REFERENCE.toString(), token: NATIVE },
      output: { amount: '2630992794', token: USDC, minimumAmount: '2617837830' },
      ...quote,
    },
    ...overrides,
  };
}

function client(response: () => Promise<Response>) {
  const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => response());
  const uniswap = new UniswapClient({
    apiUrl: 'https://api.example/v1',
    apiKey: API_KEY,
    chainId: CHAIN_ID,
    timeoutMs: 1000,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { uniswap, fetch };
}

const json = (body: unknown, status = 200) => async () =>
  new Response(JSON.stringify(body), { status });

const REQUEST: QuoteRequest = { tokenIn: NATIVE, tokenOut: USDC, amountIn: REFERENCE, swapper: SWAPPER };

describe('UniswapClient.quote', () => {
  it('returns the amounts from a valid response', async () => {
    const { uniswap } = client(json(quoteBody()));

    await expect(uniswap.quote(REQUEST)).resolves.toEqual(REAL_QUOTE);
  });

  it('sends the request the Trading API expects, with the key only in the header', async () => {
    const { uniswap, fetch } = client(json(quoteBody()));

    await uniswap.quote({ ...REQUEST, slippagePercent: 0.5 });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.example/v1/quote');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('x-api-key')).toBe(API_KEY);
    expect(String(init?.body)).not.toContain(API_KEY);
    expect(JSON.parse(String(init?.body))).toEqual({
      type: 'EXACT_INPUT',
      amount: REFERENCE.toString(),
      tokenInChainId: CHAIN_ID,
      tokenOutChainId: CHAIN_ID,
      tokenIn: NATIVE,
      tokenOut: USDC,
      swapper: SWAPPER,
      slippageTolerance: 0.5,
    });
  });

  it('leaves slippage out when none is given', async () => {
    const { uniswap, fetch } = client(json(quoteBody()));

    await uniswap.quote(REQUEST);

    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).not.toHaveProperty('slippageTolerance');
  });

  it('accepts the same addresses in a different case', async () => {
    const { uniswap } = client(
      json(quoteBody({}, { output: { amount: '1', token: USDC.toLowerCase(), minimumAmount: '1' } })),
    );

    await expect(uniswap.quote(REQUEST)).resolves.toMatchObject({ amountOut: 1n });
  });

  it.each([
    ['a rate limit', json({ errorCode: 'x' }, 429), 'UNISWAP_QUOTE_FAILED:429'],
    ['a server error', json({}, 500), 'UNISWAP_QUOTE_FAILED:500'],
    ['a body that is not JSON', async () => new Response('oops'), 'UNISWAP_BAD_RESPONSE'],
    ['a missing quote', json({ routing: 'CLASSIC' }), 'UNISWAP_BAD_RESPONSE'],
    ['a non-numeric amount', json(quoteBody({}, { output: { amount: '1.5', token: USDC, minimumAmount: '1' } })), 'UNISWAP_BAD_RESPONSE'],
    ['a UniswapX route', json(quoteBody({ routing: 'DUTCH_V2' })), 'UNISWAP_UNSUPPORTED_ROUTE'],
    ['the wrong chain', json(quoteBody({}, { chainId: 1 })), 'UNISWAP_QUOTE_MISMATCH'],
    ['a different input amount', json(quoteBody({}, { input: { amount: '1', token: NATIVE } })), 'UNISWAP_QUOTE_MISMATCH'],
    ['a different input token', json(quoteBody({}, { input: { amount: REFERENCE.toString(), token: USDC } })), 'UNISWAP_QUOTE_MISMATCH'],
    ['a different output token', json(quoteBody({}, { output: { amount: '1', token: NATIVE, minimumAmount: '1' } })), 'UNISWAP_QUOTE_MISMATCH'],
    ['a zero output', json(quoteBody({}, { output: { amount: '0', token: USDC, minimumAmount: '0' } })), 'UNISWAP_QUOTE_MISMATCH'],
    ['a minimum above the output', json(quoteBody({}, { output: { amount: '1', token: USDC, minimumAmount: '2' } })), 'UNISWAP_QUOTE_MISMATCH'],
  ])('rejects %s', async (_name, response, code) => {
    const { uniswap } = client(response);

    await expect(uniswap.quote(REQUEST)).rejects.toThrow(code);
  });

  it('reports a network failure without details', async () => {
    const { uniswap } = client(async () => {
      throw new Error(`connection failed for ${API_KEY}`);
    });

    await expect(uniswap.quote(REQUEST)).rejects.toThrow(/^UNISWAP_UNAVAILABLE$/);
  });

  it('gives up when the API does not answer in time', async () => {
    const uniswap = new UniswapClient({
      apiUrl: 'https://api.example/v1',
      apiKey: API_KEY,
      chainId: CHAIN_ID,
      timeoutMs: 20,
      fetch: ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as typeof globalThis.fetch,
    });

    await expect(uniswap.quote(REQUEST)).rejects.toThrow('UNISWAP_UNAVAILABLE');
  });
});

describe('priceFromQuote', () => {
  it('matches the real Sepolia quote', () => {
    expect(priceFromQuote(REAL_QUOTE.amountIn, REAL_QUOTE.amountOut, 6)).toBe(
      26_309_927_940_000_000_000_000n,
    );
  });

  it('handles an output token with 18 decimals', () => {
    expect(priceFromQuote(10n ** 18n, 3000n * 10n ** 18n, 18)).toBe(3000n * PRICE_PRECISION);
  });

  it('does not change with the size of the quote at the same rate', () => {
    expect(priceFromQuote(10n ** 17n, 300_000_000n, 6)).toBe(priceFromQuote(10n ** 18n, 3_000_000_000n, 6));
  });

  it('rounds down', () => {
    expect(priceFromQuote(3n * 10n ** 18n, 10n ** 18n, 18)).toBe(333_333_333_333_333_333n);
  });
});

describe('PricePoller', () => {
  let quotes: Array<() => Promise<Quote>>;
  let reports: PriceReport[];
  let errors: unknown[];
  let quoter: { quote: ReturnType<typeof vi.fn> };

  function poller(overrides: Partial<PricePollerDeps> = {}) {
    return new PricePoller({
      quoter: quoter as unknown as PricePollerDeps['quoter'],
      tokenOut: USDC,
      tokenOutDecimals: 6,
      referenceAmountWei: REFERENCE,
      intervalSec: 60,
      swapper: SWAPPER,
      onReport: (report) => void reports.push(report),
      onError: (error) => void errors.push(error),
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    quotes = [];
    reports = [];
    errors = [];
    quoter = {
      quote: vi.fn(async () => {
        const next = quotes.shift();
        return next ? next() : REAL_QUOTE;
      }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls at once, reports the price, and uses the throwaway swapper', async () => {
    const stop = poller().start();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(quoter.quote).toHaveBeenCalledWith({
      tokenIn: NATIVE,
      tokenOut: USDC,
      amountIn: REFERENCE,
      swapper: SWAPPER,
    });
    expect(reports).toEqual([
      {
        pair: `${NATIVE}/${USDC}`,
        price: 26_309_927_940_000_000_000_000n,
        ts: 1_000_000,
        source: 'uniswap',
      },
    ]);
  });

  it('polls again on every interval', async () => {
    const stop = poller().start();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(quoter.quote).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(quoter.quote).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(120_000);
    stop();
    expect(quoter.quote).toHaveBeenCalledTimes(4);
  });

  it('reports nothing when a poll fails, and tries again next interval', async () => {
    quotes.push(async () => {
      throw new Error('UNISWAP_QUOTE_FAILED:429');
    });
    const stop = poller().start();
    await vi.advanceTimersByTimeAsync(0);

    expect(reports).toEqual([]);
    expect(errors).toEqual([new Error('UNISWAP_QUOTE_FAILED:429')]);

    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    expect(reports).toHaveLength(1);
  });

  it('does not overlap polls when a quote is slow', async () => {
    let finish!: (quote: Quote) => void;
    quotes.push(() => new Promise((resolve) => (finish = resolve)));
    const stop = poller().start();

    await vi.advanceTimersByTimeAsync(300_000);
    expect(quoter.quote).toHaveBeenCalledTimes(1);

    finish(REAL_QUOTE);
    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    expect(quoter.quote).toHaveBeenCalledTimes(2);
  });

  it('stops polling when stopped', async () => {
    const stop = poller().start();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    await vi.advanceTimersByTimeAsync(600_000);
    expect(quoter.quote).toHaveBeenCalledTimes(1);
  });

  it('drops a quote that arrives after stopping', async () => {
    let finish!: (quote: Quote) => void;
    quotes.push(() => new Promise((resolve) => (finish = resolve)));
    const instance = poller();
    const stop = instance.start();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    finish(REAL_QUOTE);
    await vi.advanceTimersByTimeAsync(0);

    expect(reports).toEqual([]);
    expect(instance.latest()).toBeNull();
  });

  it('stays quiet about a failure that arrives after stopping', async () => {
    let fail!: (error: Error) => void;
    quotes.push(() => new Promise((_resolve, reject) => (fail = reject)));
    const stop = poller().start();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    fail(new Error('late'));
    await vi.advanceTimersByTimeAsync(0);

    expect(errors).toEqual([]);
  });

  it('refuses to start twice', async () => {
    const instance = poller();
    const stop = instance.start();

    expect(() => instance.start()).toThrow('PRICE_POLLER_RUNNING');

    stop();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('can start again after stopping', async () => {
    const instance = poller();
    instance.start()();
    await vi.advanceTimersByTimeAsync(0);
    const calls = quoter.quote.mock.calls.length;

    const stop = instance.start();
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(quoter.quote.mock.calls.length).toBe(calls + 1);
  });

  it('does not wait for a slow handler before polling again', async () => {
    const stop = poller({ onReport: () => new Promise(() => {}) }).start();
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(quoter.quote).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['throws', () => { throw new Error('handler'); }],
    ['rejects', async () => { throw new Error('handler'); }],
  ])('keeps polling when the handler %s', async (_name, onReport) => {
    const stop = poller({ onReport }).start();
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(quoter.quote).toHaveBeenCalledTimes(2);
    expect(errors).toEqual([new Error('handler'), new Error('handler')]);
  });

  describe('latest', () => {
    it('is null before the first report', () => {
      expect(poller().latest()).toBeNull();
    });

    it('returns the newest report', async () => {
      quotes.push(async () => ({ ...REAL_QUOTE, amountOut: 1_000_000n }));
      const instance = poller();
      const stop = instance.start();
      await vi.advanceTimersByTimeAsync(60_000);
      stop();

      expect(instance.latest()?.price).toBe(priceFromQuote(REFERENCE, REAL_QUOTE.amountOut, 6));
    });

    it('goes null once the price is too old, so a dead API cannot trigger swaps', async () => {
      const instance = poller();
      quoter.quote.mockImplementationOnce(async () => REAL_QUOTE);
      quoter.quote.mockImplementation(async () => {
        throw new Error('UNISWAP_UNAVAILABLE');
      });
      const stop = instance.start();

      await vi.advanceTimersByTimeAsync(119_000);
      expect(instance.latest()).not.toBeNull();

      await vi.advanceTimersByTimeAsync(2_000);
      stop();
      expect(instance.latest()).toBeNull();
    });
  });
});
