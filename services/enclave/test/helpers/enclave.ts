import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDomain, deriveEnclaveSalt, EIP712_TYPES, sealEnvelopeWithResponse } from '@cloakroom/shared';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { Address, PublicClient } from 'viem';
import type { PrivateKeyAccount } from 'viem/accounts';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { vi } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { KeyManager } from '../../src/keys.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../../src/sealed-state.js';
import { bootEnclave } from '../../src/server.js';
import type { BootOptions, RunningEnclave } from '../../src/server.js';
import type { Quote, QuoteRequest } from '../../src/uniswap.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from '../fixtures/test-token.js';

// Anvil's first default account: a public, test-only key.
const FUNDER = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

/** A real server on a real local chain, with stand-ins only for custody storage and Uniswap. */
export function enclaveHarness(anvilPort: number, apiPort: number) {
  const rpcUrl = `http://127.0.0.1:${anvilPort}`;
  const transport = http(rpcUrl);
  const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 100 }) as PublicClient;
  const wallet = createWalletClient({ account: FUNDER, chain: foundry, transport });

  let anvil: ChildProcess;
  let directory: string;
  let store: MemoryCipherBlobStore;
  let token: Address;
  let running: RunningEnclave[] = [];

  const config = (overrides: Record<string, string> = {}) => {
    const example = Object.fromEntries(
      readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => line.includes('=') && !line.startsWith('#'))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    return loadConfig({
      ...example,
      CHAIN_ID: String(foundry.id),
      RPC_URL: rpcUrl,
      CONFIRMATIONS: '0',
      UNISWAP_API_KEY: 'test-api-key',
      ADMIN_ADDRESS: FUNDER.address,
      ALLOWED_ORIGIN: 'https://app.example',
      TOKEN_OUT_ADDRESS: token,
      PRICE_POLL_INTERVAL_SEC: '3600',
      SIM_MODE: 'true',
      HOST: '127.0.0.1',
      PORT: String(apiPort),
      JOURNAL_PATH: join(directory, 'enclave.journal'),
      INVENTORY_EOA_COUNT: '2',
      CUSTODY_ALLOW_CREATE: 'true',
      ...overrides,
    });
  };

  const quoter: BootOptions['quoter'] = {
    quote: async (request: QuoteRequest): Promise<Quote> => ({
      amountIn: request.amountIn,
      amountOut: 300_000_000n,
      minAmountOut: 0n,
    }),
  };

  const boot = async (overrides: Partial<BootOptions> = {}) => {
    const enclave = await bootEnclave({
      config: config(),
      chain,
      quoter,
      openKeys: async (journal, policy) => {
        const vault = new AesGcmStateVault(store, simulationSealingKey('aa'.repeat(32), true), true);
        const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate: true });
        await keys.init();
        return keys;
      },
      ...overrides,
    });
    running.push(enclave);
    return enclave;
  };

  return {
    boot,
    chain,
    config,
    start: async () => {
      anvil = spawn('anvil', ['--port', String(anvilPort), '--silent'], { stdio: 'ignore' });
      await vi.waitFor(() => chain.getBlockNumber(), { timeout: 10_000, interval: 100 });
      const hash = await wallet.deployContract({ abi: TEST_TOKEN_ABI, bytecode: TEST_TOKEN_BYTECODE });
      token = (await chain.waitForTransactionReceipt({ hash })).contractAddress as Address;
    },
    finish: () => anvil.kill(),
    reset: () => {
      directory = mkdtempSync(join(tmpdir(), 'cloakroom-api-'));
      store = new MemoryCipherBlobStore();
      running = [];
    },
    cleanup: async () => {
      await Promise.all(running.map((enclave) => enclave.stop()));
      rmSync(directory, { recursive: true, force: true });
    },
    send: async (to: Address, value: bigint) => {
      const hash = await wallet.sendTransaction({ to, value });
      await chain.waitForTransactionReceipt({ hash });
    },
    token: () => token,
  };
}

/** What a browser does: signs with the enclave's domain, and seals the request to its key. */
export function apiClient(enclave: RunningEnclave) {
  const enclavePubKey = enclave.parts.keys.transportPublicKey();
  const domain = createDomain(foundry.id, deriveEnclaveSalt(enclavePubKey));
  return {
    sign: (account: PrivateKeyAccount, primaryType: 'SessionGrant' | 'SessionQuery' | 'DepositRequest', message: never) =>
      account.signTypedData({ domain, types: EIP712_TYPES, primaryType, message }),
    post: async (path: string, payload: unknown, sealedFor = path) => {
      const { envelope, openResponse } = await sealEnvelopeWithResponse(payload, {
        path: sealedFor,
        chainId: foundry.id,
        enclavePubKey,
      });
      const response = await enclave.app.inject({ method: 'POST', url: path, payload: envelope });
      const body = response.json();
      return {
        status: response.statusCode,
        raw: body,
        body: response.statusCode === 200 ? ((await openResponse(body)) as Record<string, unknown>) : body,
      };
    },
  };
}
