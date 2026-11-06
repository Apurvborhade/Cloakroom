import { getAddress, isAddress } from 'viem';
import type { Address } from 'viem';
import { z } from 'zod';

const baseUnits = z.string().regex(/^\d+$/).transform(BigInt);
const addressField = z
  .string()
  .refine((value) => isAddress(value, { strict: false }))
  .transform((value): Address => getAddress(value));

const QUOTE_RESPONSE = z.object({
  routing: z.string(),
  quote: z.object({
    chainId: z.number(),
    input: z.object({ amount: baseUnits, token: addressField }),
    output: z.object({ amount: baseUnits, token: addressField, minimumAmount: baseUnits }),
  }),
});

export interface UniswapClientOptions {
  apiUrl: string;
  apiKey: string;
  chainId: number;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

export interface QuoteRequest {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  swapper: Address;
  /** Percent, so 0.5 means 0.5%. */
  slippagePercent?: number;
}

export interface Quote {
  amountIn: bigint;
  amountOut: bigint;
  minAmountOut: bigint;
}

/**
 * Calls the Uniswap Trading API and treats its answer as untrusted. Errors carry a code and an
 * HTTP status only, so the API key, addresses and amounts never reach a log.
 */
export class UniswapClient {
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: UniswapClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    const { apiKey, apiUrl, chainId, timeoutMs } = this.options;
    let response: Response;
    try {
      response = await this.fetch(`${apiUrl}/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          type: 'EXACT_INPUT',
          amount: request.amountIn.toString(),
          tokenInChainId: chainId,
          tokenOutChainId: chainId,
          tokenIn: request.tokenIn,
          tokenOut: request.tokenOut,
          swapper: request.swapper,
          ...(request.slippagePercent === undefined
            ? {}
            : { slippageTolerance: request.slippagePercent }),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('UNISWAP_UNAVAILABLE');
    }
    if (!response.ok) throw new Error(`UNISWAP_QUOTE_FAILED:${response.status}`);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error('UNISWAP_BAD_RESPONSE');
    }
    const parsed = QUOTE_RESPONSE.safeParse(body);
    if (!parsed.success) throw new Error('UNISWAP_BAD_RESPONSE');
    const { quote, routing } = parsed.data;

    // Custody EOAs sign ordinary transactions, so only a classic on-chain route can run.
    if (routing !== 'CLASSIC') throw new Error('UNISWAP_UNSUPPORTED_ROUTE');
    if (
      quote.chainId !== chainId ||
      quote.input.amount !== request.amountIn ||
      quote.input.token !== getAddress(request.tokenIn) ||
      quote.output.token !== getAddress(request.tokenOut) ||
      quote.output.amount === 0n ||
      quote.output.minimumAmount > quote.output.amount
    ) {
      throw new Error('UNISWAP_QUOTE_MISMATCH');
    }

    return {
      amountIn: quote.input.amount,
      amountOut: quote.output.amount,
      minAmountOut: quote.output.minimumAmount,
    };
  }
}
