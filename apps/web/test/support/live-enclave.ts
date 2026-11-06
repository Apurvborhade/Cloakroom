/**
 * TEST FIXTURE. Boots the real enclave service (routes, auth, HPKE transport, ledger, journal,
 * deposit watcher, intent and withdrawal orders, mock margin accounting) on a fake in-memory chain.
 *
 * It exists because CI here has no Anvil. What it proves: the frontend's typed data, signing,
 * sealing, response opening and schemas agree with the real backend routes. What it does not
 * prove: anything about a real chain, Uniswap, or a TEE. Execution calls (estimateGas, sends)
 * throw, the way an unreachable RPC would, so withdrawals and margin swaps end in `failed`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Address, PublicClient } from 'viem';
import { getAddress } from 'viem';
import { loadConfig } from '../../../../services/enclave/src/config';
import { KeyManager } from '../../../../services/enclave/src/keys';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../../../../services/enclave/src/sealed-state';
import { bootEnclave } from '../../../../services/enclave/src/server';
import type { BootOptions, RunningEnclave } from '../../../../services/enclave/src/server';

export const FIXTURE_CHAIN_ID = 31337;
export const FIXTURE_TOKEN: Address = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
export const FIXTURE_ORIGIN = 'http://localhost:3000';

/** A chain that only answers reads. Balances are settable so a deposit can be simulated. */
export function fakeChain(chainId = FIXTURE_CHAIN_ID) {
  const balances = new Map<string, bigint>();
  let block = 100n;
  const unreachable = async () => {
    throw new Error('FIXTURE_CHAIN_HAS_NO_EXECUTION');
  };
  const client = {
    getChainId: async () => chainId,
    getBlockNumber: async () => block,
    getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => ({
      number: blockNumber ?? block,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    }),
    getBalance: async ({ address }: { address: Address }) => balances.get(getAddress(address)) ?? 0n,
    readContract: async () => 0n,
    watchBlockNumber: ({ onBlockNumber }: { onBlockNumber: (n: bigint) => void }) => {
      const timer = setInterval(() => {
        block += 1n;
        onBlockNumber(block);
      }, 200);
      return () => clearInterval(timer);
    },
    getTransactionCount: async () => 0,
    getTransactionReceipt: unreachable,
    waitForTransactionReceipt: unreachable,
    sendRawTransaction: unreachable,
    estimateGas: unreachable,
    estimateFeesPerGas: unreachable,
    call: unreachable,
  };
  return {
    client: client as unknown as PublicClient,
    setBalance: (address: Address, value: bigint) => balances.set(getAddress(address), value),
    mine: () => {
      block += 1n;
    },
  };
}

function exampleEnv(): Record<string, string> {
  return Object.fromEntries(
    readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  );
}

export interface LiveEnclave {
  enclave: RunningEnclave;
  chain: ReturnType<typeof fakeChain>;
  stop(): Promise<void>;
}

export async function startLiveEnclave(options: { port?: number; margin?: boolean; riskPrice?: bigint | null } = {}): Promise<LiveEnclave> {
  const directory = mkdtempSync(join(tmpdir(), 'cloakroom-web-fixture-'));
  const chain = fakeChain();
  const config = loadConfig({
    ...exampleEnv(),
    CHAIN_ID: String(FIXTURE_CHAIN_ID),
    RPC_URL: 'http://127.0.0.1:1',
    CONFIRMATIONS: '0',
    UNISWAP_API_KEY: 'fixture-not-a-key',
    ADMIN_ADDRESS: '0x000000000000000000000000000000000000dEaD',
    SEEDING_ENABLED: 'false',
    ALLOWED_ORIGIN: FIXTURE_ORIGIN,
    TOKEN_OUT_ADDRESS: FIXTURE_TOKEN,
    PRICE_POLL_INTERVAL_SEC: '3600',
    SIM_MODE: 'true',
    HOST: '127.0.0.1',
    PORT: String(options.port ?? 0),
    JOURNAL_PATH: join(directory, 'enclave.journal'),
    INVENTORY_EOA_COUNT: '2',
    CUSTODY_ALLOW_CREATE: 'true',
    MARGIN_ENABLED: options.margin ? 'true' : 'false',
  });
  const store = new MemoryCipherBlobStore();
  const riskPrice = options.riskPrice === undefined ? 2_000n * 10n ** 18n : options.riskPrice;
  const boot: BootOptions = {
    config,
    chain: chain.client,
    quoter: { quote: async () => { throw new Error('FIXTURE_HAS_NO_QUOTES'); } },
    openKeys: async (journal, policy) => {
      const vault = new AesGcmStateVault(store, simulationSealingKey('ab'.repeat(32), true), true);
      const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate: true });
      await keys.init();
      return keys;
    },
    ...(options.margin
      ? { riskPrices: { latest: () => (riskPrice === null ? null : { pair: 'fixture', price: riskPrice, ts: Math.floor(Date.now() / 1000), source: 'fixture' }) } }
      : {}),
    log: () => undefined,
  };
  const enclave = await bootEnclave(boot);
  return {
    enclave,
    chain,
    stop: async () => {
      await enclave.stop();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
