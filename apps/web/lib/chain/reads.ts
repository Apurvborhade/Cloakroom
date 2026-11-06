import { createPublicClient, custom, erc20Abi, getAddress } from 'viem';
import type { Address, Chain, Hash, PublicClient, TransactionReceipt } from 'viem';
import { PRICE_PRECISION } from '@cloakroom/shared';
import type { ChainReader } from './chain-reader';

/** A viem client whose every request goes through the ChainReader (Anon-RPC by default). */
export function createReadClient(reader: ChainReader, chain: Chain, isolationKey?: string): PublicClient {
  return createPublicClient({
    chain,
    pollingInterval: 4_000,
    cacheTime: 0,
    transport: custom({ request: (args) => reader.request(args, isolationKey) }, { retryCount: 1 }),
  }) as PublicClient;
}

export function readNativeBalance(client: PublicClient, owner: Address): Promise<bigint> {
  return client.getBalance({ address: owner });
}

export function readTokenBalance(client: PublicClient, token: Address, owner: Address): Promise<bigint> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
}

/** Null while the transaction is not yet mined (or not yet seen by the node). */
export async function readReceipt(client: PublicClient, hash: Hash): Promise<TransactionReceipt | null> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error && typeof error === 'object' && (error as { name?: string }).name === 'TransactionReceiptNotFoundError') return null;
    throw error;
  }
}

export function readBlockNumber(client: PublicClient): Promise<bigint> {
  return client.getBlockNumber({ cacheTime: 0 });
}

const UNISWAP_V3_POOL_ABI = [
  {
    type: 'function', name: 'slot0', stateMutability: 'view', inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' }, { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' }, { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' }, { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  { type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
] as const;

const Q192 = 2n ** 192n;

/**
 * The pool's current spot price as tokenOut per 1 unit of the other token (WETH), in the protocol's
 * 1e18 fixed point. Pure arithmetic on slot0; no floating point.
 */
export function spotPriceFromSqrt(sqrtPriceX96: bigint, outIsToken1: boolean, decimals0: number, decimals1: number): bigint {
  const squared = sqrtPriceX96 * sqrtPriceX96;
  if (squared === 0n) return 0n;
  return outIsToken1
    ? (squared * 10n ** BigInt(decimals0) * PRICE_PRECISION) / (Q192 * 10n ** BigInt(decimals1))
    : (Q192 * 10n ** BigInt(decimals1) * PRICE_PRECISION) / (squared * 10n ** BigInt(decimals0));
}

/**
 * Reads a Uniswap v3 pool's spot price. This is a public reference only: the enclave triggers on its
 * own Trading API quote, which can differ.
 */
export async function readPoolSpotPrice(client: PublicClient, pool: Address, tokenOut: Address): Promise<bigint> {
  const [slot0, token0, token1] = await Promise.all([
    client.readContract({ address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'slot0' }),
    client.readContract({ address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'token0' }),
    client.readContract({ address: pool, abi: UNISWAP_V3_POOL_ABI, functionName: 'token1' }),
  ]);
  const outIsToken1 = getAddress(token1) === getAddress(tokenOut);
  if (!outIsToken1 && getAddress(token0) !== getAddress(tokenOut)) throw new Error('POOL_TOKEN_MISMATCH');
  const [decimals0, decimals1] = await Promise.all([
    client.readContract({ address: token0, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: token1, abi: erc20Abi, functionName: 'decimals' }),
  ]);
  return spotPriceFromSqrt(slot0[0], outIsToken1, decimals0, decimals1);
}
