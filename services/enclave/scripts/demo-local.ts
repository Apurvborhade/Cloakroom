import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, parseAbiParameters, parseEther } from 'viem';
import type { Address } from 'viem';
import type { Quote, QuoteRequest } from '../src/uniswap.js';
import {
  TEST_SWAP_ROUTER_ABI,
  TEST_SWAP_ROUTER_BYTECODE,
} from '../test/fixtures/test-swap-router.js';

const ROUTER_EXECUTE = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
const ROUTER_ITSELF: Address = '0x0000000000000000000000000000000000000002';
const FAR_DEADLINE = 99_999_999_999n;
/** The local price: 1 ETH buys 2,000 tokens with 6 decimals. */
const TOKEN_UNITS_PER_ETH = 2_000_000_000n;

export interface LocalUniswap {
  router: Address;
  token: Address;
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
}

/**
 * A stand-in for Uniswap on a local chain: a mock router and a quote in the real calldata shape,
 * so the real calldata checks run. Each quote sets what the router will pay, matching that quote.
 */
export async function deployLocalUniswap(wallet: {
  deploy: (abi: typeof TEST_SWAP_ROUTER_ABI, bytecode: typeof TEST_SWAP_ROUTER_BYTECODE) => Promise<Address>;
  readToken: (router: Address) => Promise<Address>;
  configure: (router: Address, amountOut: bigint) => Promise<void>;
}): Promise<LocalUniswap> {
  const router = getAddress(await wallet.deploy(TEST_SWAP_ROUTER_ABI, TEST_SWAP_ROUTER_BYTECODE));
  const token = await wallet.readToken(router);

  return {
    router,
    token,
    quoter: {
      quote: async (request) => {
        const amountOut = (request.amountIn * TOKEN_UNITS_PER_ETH) / parseEther('1');
        const percent = BigInt(Math.round((request.slippagePercent ?? 1) * 100));
        const minAmountOut = (amountOut * (10_000n - percent)) / 10_000n;
        await wallet.configure(router, amountOut);
        return {
          amountIn: request.amountIn,
          amountOut,
          minAmountOut,
          transaction: {
            to: router,
            from: request.swapper,
            value: request.amountIn,
            data: encodeFunctionData({
              abi: ROUTER_EXECUTE,
              functionName: 'execute',
              args: [
                '0x0b0004',
                [
                  encodeAbiParameters(parseAbiParameters('address, uint256'), [ROUTER_ITSELF, request.amountIn]),
                  encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
                    ROUTER_ITSELF,
                    request.amountIn,
                    0n,
                    '0x00',
                    false,
                  ]),
                  encodeAbiParameters(parseAbiParameters('address, address, uint256'), [
                    token,
                    request.swapper,
                    minAmountOut,
                  ]),
                ],
                FAR_DEADLINE,
              ],
            }),
          },
        };
      },
    },
  };
}
