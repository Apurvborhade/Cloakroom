/**
 * Checks the live Uniswap Trading API with the client and price logic the poller uses.
 * It only asks for quotes, so it sends nothing on-chain. See scripts/README.md.
 */
import { NATIVE } from '@cloakroom/shared';
import { formatUnits } from 'viem';
import type { Address } from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { priceFromQuote } from '../src/price-poller.js';
import { UniswapClient } from '../src/uniswap.js';

const REQUESTS = 6;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

async function main(): Promise<void> {
  const tokenOut = required('TOKEN_OUT_ADDRESS') as Address;
  const tokenOutDecimals = Number(required('TOKEN_OUT_DECIMALS'));
  const amountIn = BigInt(required('PRICE_REFERENCE_AMOUNT_WEI'));
  const client = new UniswapClient({
    apiUrl: required('UNISWAP_API_URL'),
    apiKey: required('UNISWAP_API_KEY'),
    chainId: Number(required('CHAIN_ID')),
    timeoutMs: Number(required('PRICE_QUOTE_TIMEOUT_MS')),
  });

  console.log(`Sending ${REQUESTS} quotes, each from a new throwaway address.\n`);
  let failures = 0;
  for (let attempt = 1; attempt <= REQUESTS; attempt++) {
    const started = Date.now();
    try {
      const quote = await client.quote({
        tokenIn: NATIVE,
        tokenOut,
        amountIn,
        swapper: privateKeyToAddress(generatePrivateKey()),
      });
      const price = priceFromQuote(quote.amountIn, quote.amountOut, tokenOutDecimals);
      console.log(`  ${attempt}. PASS  ${formatUnits(price, 18)} per ETH, ${Date.now() - started} ms`);
    } catch (error) {
      failures += 1;
      console.log(`  ${attempt}. FAIL  ${(error as Error).message}, ${Date.now() - started} ms`);
    }
  }

  console.log(failures === 0 ? '\nAll quotes passed.' : `\n${failures} quote(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(`Stopped: ${(error as Error).message}`);
  process.exitCode = 1;
});
