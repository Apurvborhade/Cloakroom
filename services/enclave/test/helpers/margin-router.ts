import { NATIVE, PERMIT2_ADDRESS } from '@cloakroom/shared';
import { createTestClient, createWalletClient, encodeAbiParameters, encodeFunctionData, encodePacked, getAddress, parseAbiParameters } from 'viem';
import type { Address, PublicClient, Transport } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { QuoteRequest } from '../../src/uniswap.js';
import { MARGIN_ROUTER_ABI, MARGIN_ROUTER_BYTECODE, MARGIN_TOKEN_ABI, MARGIN_PERMIT2_RUNTIME } from '../fixtures/test-margin-router.js';

// Anvil's public second account; only used on the local testchain.
const DEPLOYER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const THIS: Address = '0x0000000000000000000000000000000000000002';
const ETH = 10n ** 18n, USD = 10n ** 6n;

export async function marginRouter(chain: PublicClient, transport: Transport) {
  const wallet = createWalletClient({ account: DEPLOYER, chain: foundry, transport });
  const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport });
  await anvil.setCode({ address: PERMIT2_ADDRESS, bytecode: MARGIN_PERMIT2_RUNTIME });
  const deployed = await chain.waitForTransactionReceipt({ hash: await wallet.deployContract({
    abi: MARGIN_ROUTER_ABI, bytecode: MARGIN_ROUTER_BYTECODE,
  }) });
  const router = getAddress(deployed.contractAddress!);
  const token = await chain.readContract({ address: router, abi: MARGIN_ROUTER_ABI, functionName: 'token' });
  const weth = await chain.readContract({ address: router, abi: MARGIN_ROUTER_ABI, functionName: 'weth' });
  let priceUsd = 2_000n;

  return {
    router, token, weth,
    price: () => priceUsd * ETH,
    configure: async (price: bigint, shouldRevert = false) => {
      await chain.waitForTransactionReceipt({ hash: await wallet.writeContract({
        address: router, abi: MARGIN_ROUTER_ABI, functionName: 'configure', args: [price * USD, shouldRevert],
      }) });
      priceUsd = price;
    },
    seedTokens: async (to: Address, amount: bigint) => {
      await chain.waitForTransactionReceipt({ hash: await wallet.writeContract({
        address: token, abi: MARGIN_TOKEN_ABI, functionName: 'mint', args: [to, amount],
      }) });
    },
    tokenBalance: (address: Address) => chain.readContract({ address: token, abi: MARGIN_TOKEN_ABI,
      functionName: 'balanceOf', args: [address] }),
    quoter: { quote: async (request: QuoteRequest) => {
      const native = request.tokenIn === NATIVE;
      const amountOut = native ? request.amountIn * priceUsd * USD / ETH : request.amountIn * ETH / (priceUsd * USD);
      const slippage = BigInt(Math.round((request.slippagePercent ?? 1) * 100));
      const minAmountOut = amountOut * (10_000n - slippage) / 10_000n;
      const path = encodePacked(['address', 'uint24', 'address'], native ? [weth, 500, token] : [token, 500, weth]);
      const swap = encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'),
        [THIS, request.amountIn, 0n, path, !native]);
      const inputs = native ? [
        encodeAbiParameters(parseAbiParameters('address, uint256'), [THIS, request.amountIn]),
        swap,
        encodeAbiParameters(parseAbiParameters('address, address, uint256'), [token, request.swapper, minAmountOut]),
      ] : [
        swap,
        encodeAbiParameters(parseAbiParameters('address, uint256'), [request.swapper, minAmountOut]),
        encodeAbiParameters(parseAbiParameters('address, address, uint256'), [NATIVE, request.swapper, 0n]),
      ];
      return { amountIn: request.amountIn, amountOut, minAmountOut, transaction: {
        from: request.swapper, to: router, value: native ? request.amountIn : 0n,
        data: encodeFunctionData({ abi: MARGIN_ROUTER_ABI, functionName: 'execute',
          args: [native ? '0x0b0004' : '0x000c04', inputs, 99_999_999_999n] }),
      } };
    } },
  };
}
