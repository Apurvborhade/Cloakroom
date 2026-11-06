import { NATIVE } from '@cloakroom/shared';
import { defineChain, getAddress, isAddress } from 'viem';
import type { Address, Chain } from 'viem';
import { foundry, sepolia } from 'viem/chains';

/**
 * Public, non-secret configuration. Every value here ships to the browser, so nothing secret may
 * ever be added. Next.js only inlines NEXT_PUBLIC_* variables that are referenced literally, which
 * is why each one is read by name below.
 */
export type ChainReadMode = 'anon-rpc' | 'direct-dev';
export type MarginUiMode = 'auto' | 'off';

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
}

export interface AppConfig {
  apiUrl: string | null;
  chainId: number;
  chain: Chain;
  explorerUrl: string | null;
  native: TokenConfig;
  tokenOut: TokenConfig | null;
  maxAmountNativeWei: bigint;
  /** The expected gas reserve, shown before signing. The server's own value decides. */
  depositGasReserveWei: bigint;
  feeBps: number;
  maxSlippageBpsCap: number;
  walletConnectProjectId: string | null;
  allowSimulatedEnclave: boolean;
  marginUi: MarginUiMode;
  marginMaxLeverageBps: number;
  /** Shorts are refused by the live enclave until they are merged and tested. */
  marginShortsEnabled: boolean;
  uniswapPool: Address | null;
  chainRead: {
    mode: ChainReadMode;
    anonSpecifier: Address | null;
    anonTargetUrl: string | null;
    anonBootstrapRpcUrl: string | null;
    anonWorkerConfig: string | null;
    devDirectRpcUrl: string | null;
  };
  /** Human-readable problems, shown on the diagnostics page. Never contains values. */
  issues: string[];
}

export interface RawEnv {
  NEXT_PUBLIC_CLOAKROOM_API_URL?: string;
  NEXT_PUBLIC_CHAIN_ID?: string;
  NEXT_PUBLIC_EXPLORER_URL?: string;
  NEXT_PUBLIC_TOKEN_OUT_ADDRESS?: string;
  NEXT_PUBLIC_TOKEN_OUT_SYMBOL?: string;
  NEXT_PUBLIC_TOKEN_OUT_DECIMALS?: string;
  NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI?: string;
  NEXT_PUBLIC_DEPOSIT_GAS_RESERVE_WEI?: string;
  NEXT_PUBLIC_FEE_BPS?: string;
  NEXT_PUBLIC_MAX_SLIPPAGE_BPS_CAP?: string;
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?: string;
  NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE?: string;
  NEXT_PUBLIC_MARGIN_UI?: string;
  NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS?: string;
  NEXT_PUBLIC_MARGIN_SHORTS?: string;
  NEXT_PUBLIC_UNISWAP_POOL_ADDRESS?: string;
  NEXT_PUBLIC_CHAIN_READ_MODE?: string;
  NEXT_PUBLIC_ANON_RPC_SPECIFIER_ADDRESS?: string;
  NEXT_PUBLIC_ANON_RPC_TARGET_URL?: string;
  NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL?: string;
  NEXT_PUBLIC_ANON_RPC_WORKER_CONFIG?: string;
  NEXT_PUBLIC_DEV_DIRECT_RPC_URL?: string;
}

/**
 * Sepolia's 0.01% USDC/WETH pool, the closest of its four pools to the Trading API's quote. The
 * swap screen reads it for a live price and to set the order's limit.
 */
const SEPOLIA_REFERENCE_POOL = getAddress('0xfeed501c2b21d315f04946f85fc6416b640240b5');
const SEPOLIA_USDC = getAddress('0x1c7d4b196cb0c7b01d743fbc6116a902379c7238');

/** The MVP margin scope documented in docs/margin-interface.md: up to 4x. */
export const MARGIN_MVP_MAX_LEVERAGE_BPS = 40_000;

function readEnv(): RawEnv {
  return {
    NEXT_PUBLIC_CLOAKROOM_API_URL: process.env.NEXT_PUBLIC_CLOAKROOM_API_URL,
    NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID,
    NEXT_PUBLIC_EXPLORER_URL: process.env.NEXT_PUBLIC_EXPLORER_URL,
    NEXT_PUBLIC_TOKEN_OUT_ADDRESS: process.env.NEXT_PUBLIC_TOKEN_OUT_ADDRESS,
    NEXT_PUBLIC_TOKEN_OUT_SYMBOL: process.env.NEXT_PUBLIC_TOKEN_OUT_SYMBOL,
    NEXT_PUBLIC_TOKEN_OUT_DECIMALS: process.env.NEXT_PUBLIC_TOKEN_OUT_DECIMALS,
    NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI: process.env.NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI,
    NEXT_PUBLIC_DEPOSIT_GAS_RESERVE_WEI: process.env.NEXT_PUBLIC_DEPOSIT_GAS_RESERVE_WEI,
    NEXT_PUBLIC_FEE_BPS: process.env.NEXT_PUBLIC_FEE_BPS,
    NEXT_PUBLIC_MAX_SLIPPAGE_BPS_CAP: process.env.NEXT_PUBLIC_MAX_SLIPPAGE_BPS_CAP,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE: process.env.NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE,
    NEXT_PUBLIC_MARGIN_UI: process.env.NEXT_PUBLIC_MARGIN_UI,
    NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS: process.env.NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS,
    NEXT_PUBLIC_MARGIN_SHORTS: process.env.NEXT_PUBLIC_MARGIN_SHORTS,
    NEXT_PUBLIC_UNISWAP_POOL_ADDRESS: process.env.NEXT_PUBLIC_UNISWAP_POOL_ADDRESS,
    NEXT_PUBLIC_CHAIN_READ_MODE: process.env.NEXT_PUBLIC_CHAIN_READ_MODE,
    NEXT_PUBLIC_ANON_RPC_SPECIFIER_ADDRESS: process.env.NEXT_PUBLIC_ANON_RPC_SPECIFIER_ADDRESS,
    NEXT_PUBLIC_ANON_RPC_TARGET_URL: process.env.NEXT_PUBLIC_ANON_RPC_TARGET_URL,
    NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL: process.env.NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL,
    NEXT_PUBLIC_ANON_RPC_WORKER_CONFIG: process.env.NEXT_PUBLIC_ANON_RPC_WORKER_CONFIG,
    NEXT_PUBLIC_DEV_DIRECT_RPC_URL: process.env.NEXT_PUBLIC_DEV_DIRECT_RPC_URL,
  };
}

const trimmed = (value: string | undefined) => {
  const text = value?.trim();
  return text ? text : null;
};

function url(value: string | undefined, name: string, issues: string[]): string | null {
  const text = trimmed(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error();
    return text.replace(/\/+$/, '');
  } catch {
    issues.push(`${name} is not a valid http(s) URL`);
    return null;
  }
}

function address(value: string | undefined, name: string, issues: string[]): Address | null {
  const text = trimmed(value);
  if (!text) return null;
  if (!isAddress(text, { strict: false })) {
    issues.push(`${name} is not a valid address`);
    return null;
  }
  return getAddress(text);
}

function int(value: string | undefined, fallback: number, name: string, issues: string[], max = Number.MAX_SAFE_INTEGER): number {
  const text = trimmed(value);
  if (!text) return fallback;
  if (!/^\d+$/.test(text) || Number(text) > max) {
    issues.push(`${name} must be a whole number${max < Number.MAX_SAFE_INTEGER ? ` up to ${max}` : ''}`);
    return fallback;
  }
  return Number(text);
}

function chainFor(chainId: number, rpcUrl: string | null): Chain {
  if (chainId === sepolia.id) return sepolia;
  if (chainId === foundry.id) return foundry;
  return defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
  });
}

export function parseConfig(env: RawEnv): AppConfig {
  const issues: string[] = [];
  const apiUrl = url(env.NEXT_PUBLIC_CLOAKROOM_API_URL, 'NEXT_PUBLIC_CLOAKROOM_API_URL', issues);
  if (!apiUrl) issues.push('NEXT_PUBLIC_CLOAKROOM_API_URL is not set: the app cannot reach the enclave API');

  const chainId = int(env.NEXT_PUBLIC_CHAIN_ID, sepolia.id, 'NEXT_PUBLIC_CHAIN_ID', issues);
  const devDirectRpcUrl = url(env.NEXT_PUBLIC_DEV_DIRECT_RPC_URL, 'NEXT_PUBLIC_DEV_DIRECT_RPC_URL', issues);
  const chain = chainFor(chainId, devDirectRpcUrl);

  const tokenOutAddress = address(env.NEXT_PUBLIC_TOKEN_OUT_ADDRESS, 'NEXT_PUBLIC_TOKEN_OUT_ADDRESS', issues);
  if (!tokenOutAddress) issues.push('NEXT_PUBLIC_TOKEN_OUT_ADDRESS is not set: swaps and output-token withdrawals are disabled');
  const tokenOut: TokenConfig | null = tokenOutAddress
    ? {
        address: tokenOutAddress,
        symbol: trimmed(env.NEXT_PUBLIC_TOKEN_OUT_SYMBOL) ?? 'USDC',
        decimals: int(env.NEXT_PUBLIC_TOKEN_OUT_DECIMALS, 6, 'NEXT_PUBLIC_TOKEN_OUT_DECIMALS', issues, 77),
      }
    : null;

  const maxWeiText = trimmed(env.NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI) ?? '1000000000000000000';
  let maxAmountNativeWei = 10n ** 18n;
  if (/^\d+$/.test(maxWeiText)) maxAmountNativeWei = BigInt(maxWeiText);
  else issues.push('NEXT_PUBLIC_MAX_AMOUNT_NATIVE_WEI must be a whole number of wei');

  const reserveText = trimmed(env.NEXT_PUBLIC_DEPOSIT_GAS_RESERVE_WEI) ?? '10000000000000000';
  let depositGasReserveWei = 10n ** 16n;
  if (/^\d+$/.test(reserveText)) depositGasReserveWei = BigInt(reserveText);
  else issues.push('NEXT_PUBLIC_DEPOSIT_GAS_RESERVE_WEI must be a whole number of wei');

  const explicitExplorer = url(env.NEXT_PUBLIC_EXPLORER_URL, 'NEXT_PUBLIC_EXPLORER_URL', issues);
  const explorerUrl = explicitExplorer ?? chain.blockExplorers?.default.url ?? null;

  const modeText = trimmed(env.NEXT_PUBLIC_CHAIN_READ_MODE) ?? 'anon-rpc';
  let mode: ChainReadMode = 'anon-rpc';
  if (modeText === 'direct-dev') mode = 'direct-dev';
  else if (modeText !== 'anon-rpc') issues.push('NEXT_PUBLIC_CHAIN_READ_MODE must be anon-rpc or direct-dev; using anon-rpc');

  const anonSpecifier = address(env.NEXT_PUBLIC_ANON_RPC_SPECIFIER_ADDRESS, 'NEXT_PUBLIC_ANON_RPC_SPECIFIER_ADDRESS', issues);
  const anonTargetUrl = url(env.NEXT_PUBLIC_ANON_RPC_TARGET_URL, 'NEXT_PUBLIC_ANON_RPC_TARGET_URL', issues);
  const anonBootstrapRpcUrl = url(env.NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL, 'NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL', issues);
  if (mode === 'anon-rpc' && (!anonSpecifier || !anonTargetUrl || !anonBootstrapRpcUrl)) {
    issues.push('Anon-RPC is the chain-read mode but its specifier, target or bootstrap URL is missing: browser chain reads are disabled');
  }
  if (mode === 'direct-dev' && !devDirectRpcUrl) {
    issues.push('direct-dev chain reads need NEXT_PUBLIC_DEV_DIRECT_RPC_URL');
  }

  const marginText = trimmed(env.NEXT_PUBLIC_MARGIN_UI) ?? 'auto';
  const marginUi: MarginUiMode = marginText === 'off' ? 'off' : 'auto';
  const marginMaxLeverageBps = Math.min(
    int(env.NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS, MARGIN_MVP_MAX_LEVERAGE_BPS, 'NEXT_PUBLIC_MARGIN_MAX_LEVERAGE_BPS', issues),
    MARGIN_MVP_MAX_LEVERAGE_BPS,
  );

  return {
    apiUrl,
    chainId,
    chain,
    explorerUrl,
    native: { address: NATIVE, symbol: 'ETH', decimals: 18 },
    tokenOut,
    maxAmountNativeWei,
    depositGasReserveWei,
    feeBps: int(env.NEXT_PUBLIC_FEE_BPS, 10, 'NEXT_PUBLIC_FEE_BPS', issues, 9_999),
    maxSlippageBpsCap: int(env.NEXT_PUBLIC_MAX_SLIPPAGE_BPS_CAP, 100, 'NEXT_PUBLIC_MAX_SLIPPAGE_BPS_CAP', issues, 10_000),
    walletConnectProjectId: trimmed(env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID),
    allowSimulatedEnclave: trimmed(env.NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE) === 'true',
    marginUi,
    marginMaxLeverageBps: Math.max(10_000, marginMaxLeverageBps),
    marginShortsEnabled: trimmed(env.NEXT_PUBLIC_MARGIN_SHORTS) === 'true',
    uniswapPool: address(env.NEXT_PUBLIC_UNISWAP_POOL_ADDRESS, 'NEXT_PUBLIC_UNISWAP_POOL_ADDRESS', issues)
      ?? (chainId === sepolia.id && tokenOutAddress === SEPOLIA_USDC ? SEPOLIA_REFERENCE_POOL : null),
    chainRead: {
      mode,
      anonSpecifier,
      anonTargetUrl,
      anonBootstrapRpcUrl,
      anonWorkerConfig: trimmed(env.NEXT_PUBLIC_ANON_RPC_WORKER_CONFIG),
      devDirectRpcUrl,
    },
    issues,
  };
}

export const appConfig: AppConfig = parseConfig(readEnv());

/** Tokens the enclave's private ledger reports: native ETH and the configured output token. */
export function knownTokens(config: AppConfig = appConfig): TokenConfig[] {
  return config.tokenOut ? [config.native, config.tokenOut] : [config.native];
}

export function tokenFor(token: string, config: AppConfig = appConfig): TokenConfig | null {
  const key = token.toLowerCase();
  return knownTokens(config).find((item) => item.address.toLowerCase() === key) ?? null;
}
