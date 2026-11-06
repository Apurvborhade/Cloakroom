import { appConfig } from '../config';
import { ChainReader } from './chain-reader';

/** The app-wide chain reader. Created once; it starts the Anon-RPC harness lazily in the browser. */
export const chainReader = new ChainReader(appConfig.chainRead);

/** Which browser reads exist and where they go, for the diagnostics panel and README. */
export const BROWSER_READS = [
  { name: 'Deposit transaction receipt', methods: ['eth_getTransactionReceipt', 'eth_blockNumber'] },
  { name: 'Wallet ETH balance', methods: ['eth_getBalance'] },
  { name: 'Wallet output-token balance', methods: ['eth_call (balanceOf)'] },
  { name: 'Withdrawal payout receipt', methods: ['eth_getTransactionReceipt'] },
  { name: 'Uniswap pool spot price (optional)', methods: ['eth_call (slot0, token0, token1, decimals)'] },
] as const;

/** Traffic that never uses Anon-RPC, and why. */
export const BYPASSING_TRAFFIC = [
  { name: 'Wallet signing and the deposit transfer', reason: "Handled by the user's own wallet and its RPC; the app cannot route the wallet's traffic." },
  { name: 'Anon-RPC bootstrap read', reason: 'The harness reads its on-chain specifier through NEXT_PUBLIC_ANON_RPC_BOOTSTRAP_RPC_URL before it can anonymize anything. It carries no user data.' },
  { name: 'Cloakroom API', reason: 'HPKE-encrypted requests to the enclave service. The operator sees your IP and request timing.' },
  { name: "The enclave's own chain reads", reason: 'Deposit watching, inventory and execution run inside the enclave service with its own RPC.' },
] as const;
