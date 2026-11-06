import { readFile, writeFile } from 'node:fs/promises';
import {
  createDomain,
  deriveEnclaveSalt,
  EIP712_TYPES,
  NATIVE,
  sealEnvelopeWithResponse,
} from '@cloakroom/shared';
import { encodeFunctionData, getAddress, parseAbi } from 'viem';
import type { Account, Address, Hex, PublicClient } from 'viem';
import { assertSafeSwapCalldata } from '../src/swap-calldata.js';
import type { Quote, QuoteRequest } from '../src/uniswap.js';

const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);
const SWAP_PROTOCOLS = ['V2', 'V3'] as const;
const BPS_SCALE = 10_000n;
/** Extra ETH to swap, because a larger amount gets a slightly worse price than the first quote. */
const SWAP_INPUT_MARGIN_BPS = 300n;
const SWAP_SLIPPAGE_PERCENT = 1;
const CLAIM_EXPIRY_SEC = 120n;

export interface ClaimOptions {
  enclaveUrl: string;
  /** Take this from a verified attestation, so the claim is sealed to the real enclave. */
  enclavePubKey: Hex;
  chainId: number;
  admin: Pick<Account, 'address'> & { signTypedData: NonNullable<Account['signTypedData']> };
  /** Where the addresses are saved. The claim is refused if this file already exists. */
  filePath: string;
  nowSec?: () => bigint;
  fetch?: typeof globalThis.fetch;
}

/**
 * Claims the inventory addresses from the enclave, and saves them at once.
 *
 * The enclave discloses them only once, and a lost response does not reopen the disclosure. So
 * an existing file stops the claim before any request, and the response is written straight away.
 */
export async function claimInventoryAddresses(options: ClaimOptions): Promise<Address[]> {
  const { admin, chainId, enclavePubKey, enclaveUrl, filePath } = options;
  const send = options.fetch ?? globalThis.fetch;
  const now = options.nowSec?.() ?? BigInt(Math.floor(Date.now() / 1000));

  if (await fileExists(filePath)) throw new Error('SEED_ADDRESSES_ALREADY_SAVED');

  const message = { admin: admin.address, nonce: now, expiry: now + CLAIM_EXPIRY_SEC };
  const signature = await admin.signTypedData({
    domain: createDomain(chainId, deriveEnclaveSalt(enclavePubKey)),
    types: EIP712_TYPES,
    primaryType: 'AdminEoas',
    message,
  });
  const client = await sealEnvelopeWithResponse(
    {
      message: { admin: admin.address, nonce: message.nonce.toString(), expiry: message.expiry.toString() },
      signature,
    },
    { chainId, path: '/admin/eoas', enclavePubKey },
  );

  const response = await send(`${enclaveUrl}/admin/eoas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(client.envelope),
  });
  if (!response.ok) throw new Error(`SEED_CLAIM_FAILED:${response.status}`);

  const opened = (await client.openResponse(await response.json())) as { addresses?: unknown };
  if (!Array.isArray(opened.addresses)) throw new Error('SEED_CLAIM_BAD_RESPONSE');
  const addresses = opened.addresses.map((address) => getAddress(String(address)));

  // Only the owner can read it, and "wx" refuses to overwrite an earlier claim.
  await writeFile(filePath, `${JSON.stringify(addresses, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return addresses;
}

export async function readSavedAddresses(filePath: string): Promise<Address[]> {
  const saved: unknown = JSON.parse(await readFile(filePath, 'utf8'));
  if (!Array.isArray(saved) || saved.length === 0) throw new Error('SEED_ADDRESSES_INVALID');
  const addresses = saved.map((address) => getAddress(String(address)));
  if (new Set(addresses).size !== addresses.length) throw new Error('SEED_ADDRESSES_INVALID');
  return addresses;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export interface SeedTargets {
  /** ETH each address should hold, including its gas reserve. */
  nativeWei: bigint;
  /** Output token each address should hold, in base units. */
  tokenUnits: bigint;
}

export interface SeedBalance {
  address: Address;
  native: bigint;
  token: bigint;
}

export interface SeedTopUp {
  address: Address;
  native: bigint;
  token: bigint;
}

export interface SeedPlan {
  topUps: SeedTopUp[];
  totalNative: bigint;
  totalToken: bigint;
}

/** Works out what each address is missing, so running again only tops up the difference. */
export function planSeeding(balances: readonly SeedBalance[], targets: SeedTargets): SeedPlan {
  const topUps = balances
    .map((balance) => ({
      address: balance.address,
      native: balance.native < targets.nativeWei ? targets.nativeWei - balance.native : 0n,
      token: balance.token < targets.tokenUnits ? targets.tokenUnits - balance.token : 0n,
    }))
    .filter((topUp) => topUp.native > 0n || topUp.token > 0n);
  return {
    topUps,
    totalNative: topUps.reduce((sum, topUp) => sum + topUp.native, 0n),
    totalToken: topUps.reduce((sum, topUp) => sum + topUp.token, 0n),
  };
}

export type SeedChain = Pick<
  PublicClient,
  'call' | 'estimateFeesPerGas' | 'getBalance' | 'readContract' | 'waitForTransactionReceipt'
>;

/** The funding wallet. It only needs to send transactions. */
export interface SeedWallet {
  address: Address;
  send(tx: { to: Address; value?: bigint; data?: Hex }): Promise<Hex>;
}

export interface SeedSwapSettings {
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
  routerAddress: Address;
  /** A small amount used to read the current price before the real quote. */
  priceCheckWei: bigint;
  nowSec?: () => bigint;
}

export interface SeedFundingOptions {
  chain: SeedChain;
  wallet: SeedWallet;
  addresses: readonly Address[];
  tokenOut: Address;
  targets: SeedTargets;
  gasReserveWei: bigint;
  swap: SeedSwapSettings;
  /** Keep this much ETH in the funding wallet to pay for gas. */
  gasBufferWei: bigint;
  /** Preview only: nothing is sent unless this is true. */
  execute: boolean;
  onProgress?: (line: string) => void;
}

export interface SeedResult {
  plan: SeedPlan;
  swapInputWei: bigint;
  executed: boolean;
  transactions: Hex[];
}

export async function readSeedBalances(
  chain: SeedChain,
  tokenOut: Address,
  addresses: readonly Address[],
): Promise<SeedBalance[]> {
  return Promise.all(
    addresses.map(async (address) => {
      const [native, token] = await Promise.all([
        chain.getBalance({ address }),
        chain.readContract({
          address: tokenOut,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }),
      ]);
      return { address, native, token };
    }),
  );
}

/**
 * Tops up each address, and checks everything before sending anything: a shortfall stops the run
 * with no funds moved. Swaps ETH for any output token the wallet is missing.
 */
export async function fundInventory(options: SeedFundingOptions): Promise<SeedResult> {
  const { addresses, chain, gasBufferWei, gasReserveWei, targets, tokenOut, wallet } = options;
  const progress = options.onProgress ?? (() => {});

  if (targets.nativeWei <= gasReserveWei) throw new Error('SEED_TARGET_BELOW_GAS_RESERVE');
  const normalized = addresses.map((address) => getAddress(address));
  if (normalized.includes(getAddress(wallet.address))) throw new Error('SEED_FUNDER_IN_INVENTORY');

  const plan = planSeeding(await readSeedBalances(chain, tokenOut, normalized), targets);
  const [walletNative, walletToken] = await Promise.all([
    chain.getBalance({ address: wallet.address }),
    chain.readContract({ address: tokenOut, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet.address] }),
  ]);

  const tokenShortfall = plan.totalToken > walletToken ? plan.totalToken - walletToken : 0n;
  const swap = tokenShortfall > 0n ? await prepareSwap(options, tokenShortfall) : null;
  const swapInputWei = swap?.amountIn ?? 0n;

  if (walletNative < plan.totalNative + swapInputWei + gasBufferWei) {
    throw new Error('SEED_FUNDER_INSUFFICIENT_ETH');
  }

  if (swap) {
    await chain.call({ account: wallet.address, to: swap.to, data: swap.data, value: swap.amountIn });
  }

  if (!options.execute) return { plan, swapInputWei, executed: false, transactions: [] };

  const transactions: Hex[] = [];
  const sendAndWait = async (tx: { to: Address; value?: bigint; data?: Hex }): Promise<void> => {
    const hash = await wallet.send(tx);
    const receipt = await chain.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') throw new Error('SEED_TRANSACTION_REVERTED');
    transactions.push(hash);
  };

  if (swap) {
    progress(`Swapping ETH for ${tokenShortfall} token units`);
    await sendAndWait({ to: swap.to, value: swap.amountIn, data: swap.data });
  }
  for (const topUp of plan.topUps) {
    if (topUp.native > 0n) {
      await sendAndWait({ to: topUp.address, value: topUp.native });
    }
    if (topUp.token > 0n) {
      await sendAndWait({
        to: tokenOut,
        data: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [topUp.address, topUp.token],
        }),
      });
    }
    progress(`Funded ${topUp.address}`);
  }

  const after = planSeeding(await readSeedBalances(chain, tokenOut, normalized), targets);
  if (after.topUps.length > 0) throw new Error('SEED_INCOMPLETE');
  return { plan, swapInputWei, executed: true, transactions };
}

/** Gets a checked swap for at least the missing tokens. The caller simulates and sends it. */
async function prepareSwap(
  options: SeedFundingOptions,
  tokensNeeded: bigint,
): Promise<{ to: Address; data: Hex; amountIn: bigint }> {
  const { chain, swap, tokenOut, wallet } = options;
  const request = {
    tokenIn: NATIVE,
    tokenOut,
    swapper: wallet.address,
    slippagePercent: SWAP_SLIPPAGE_PERCENT,
    protocols: SWAP_PROTOCOLS,
  };

  const priceCheck = await swap.quoter.quote({ ...request, amountIn: swap.priceCheckWei });
  const bare = (tokensNeeded * swap.priceCheckWei) / priceCheck.minAmountOut + 1n;
  const amountIn = (bare * (BPS_SCALE + SWAP_INPUT_MARGIN_BPS)) / BPS_SCALE;

  const quote = await swap.quoter.quote({ ...request, amountIn });
  if (quote.minAmountOut < tokensNeeded) throw new Error('SEED_SWAP_TOO_SMALL');

  const transaction = quote.transaction;
  if (
    !transaction ||
    getAddress(transaction.to) !== getAddress(swap.routerAddress) ||
    getAddress(transaction.from) !== getAddress(wallet.address) ||
    transaction.value !== amountIn
  ) {
    throw new Error('SEED_SWAP_UNEXPECTED_TRANSACTION');
  }
  assertSafeSwapCalldata({
    data: transaction.data,
    eoa: wallet.address,
    tokenOut,
    minOut: tokensNeeded,
    nowSec: swap.nowSec?.() ?? BigInt(Math.floor(Date.now() / 1000)),
  });
  return { to: transaction.to, data: transaction.data, amountIn };
}
