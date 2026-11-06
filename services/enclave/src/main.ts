// The enclave service's entrypoint. Prints fixed status codes only, because errors can contain
// the RPC URL and the service handles private data.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createPublicClient, http } from 'viem';
import { loadConfig } from './config.js';
import type { EnclaveConfig } from './config.js';
import { KeyManager } from './keys.js';
import { openNitroRuntime } from './nitro-custody.js';
import { readNitroConfig } from './nitro-config.js';
import { AesGcmStateVault, FileCipherBlobStore, simulationSealingKey } from './sealed-state.js';
import { bootEnclave } from './server.js';
import type { BootOptions } from './server.js';
import { UniswapClient } from './uniswap.js';
import { createNitroUniswapClient } from './nitro-uniswap.js';
import { createNitroRpcTransport } from './nitro-rpc.js';
import { LongMarginAccounting } from './margin-accounting.js';

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (!value) throw new Error('BOOT_FAILED:config');
  return value;
}

function custody(config: EnclaveConfig, env: Readonly<Record<string, string | undefined>>,
  buildHash?: string): Pick<BootOptions, 'openKeys' | 'openRuntime'> {
  const allowCreate = config.CUSTODY_ALLOW_CREATE;
  if (config.SIM_MODE) {
    const vaultPath = required(env, 'SIM_VAULT_PATH');
    const sealingKey = required(env, 'SIM_SEALING_KEY');
    return { openKeys: async (journal, policy) => {
      await mkdir(dirname(vaultPath), { recursive: true });
      const vault = new AesGcmStateVault(new FileCipherBlobStore(vaultPath), simulationSealingKey(sealingKey, true), true);
      const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate });
      try { await keys.init(); } catch (error) { keys.close(); throw error; }
      return keys;
    } };
  }
  const keyArn = required(env, 'KMS_KEY_ARN');
  const region = required(env, 'KMS_REGION');
  const vaultId = required(env, 'VAULT_ID');
  if (!buildHash) throw new Error('BOOT_FAILED:config');
  return { openRuntime: (policy) => openNitroRuntime({ keyArn, region, vaultId, buildHash, policy, allowCreate }) };
}

async function main(): Promise<void> {
  const nitro = process.argv.includes('--nitro');
  const env = nitro
    ? await readNitroConfig((await readFile(new URL('./config.sha256', import.meta.url), 'utf8')).trim())
    : process.env;
  const config = loadConfig(env);
  if (config.SIM_MODE === nitro) throw new Error('BOOT_FAILED:config');
  if (config.SIM_MODE) console.log('SIM_MODE: not running in a TEE, so this makes no confidentiality claim.');
  if (config.SIM_MODE) await mkdir(dirname(config.JOURNAL_PATH), { recursive: true });
  const buildHash = nitro ? (await readFile(new URL('./build-hash', import.meta.url), 'utf8')).trim() : undefined;

  const running = await bootEnclave({
    config,
    chain: createPublicClient({ transport: config.SIM_MODE ? http(config.RPC_URL) : createNitroRpcTransport(config.RPC_URL) }),
    quoter: config.SIM_MODE ? new UniswapClient({
      apiUrl: config.UNISWAP_API_URL,
      apiKey: config.UNISWAP_API_KEY,
      chainId: config.CHAIN_ID,
      timeoutMs: config.PRICE_QUOTE_TIMEOUT_MS,
    }) : createNitroUniswapClient(config),
    ...custody(config, env, buildHash),
    ...(config.MARGIN_ENABLED ? { marginAccounting: (parts: Parameters<NonNullable<BootOptions['marginAccounting']>>[0]) =>
      new LongMarginAccounting({ ...parts, usdc: config.TOKEN_OUT_ADDRESS, usdcDecimals: config.TOKEN_OUT_DECIMALS,
        maxPriceAgeSec: config.PRICE_POLL_INTERVAL_SEC * 2 }) } : {}),
    socketPath: nitro ? '\0cloakroom-attestation' : undefined,
    log: (code) => console.log(code),
  });

  const shutdown = () => {
    running.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error: unknown) => {
  // loadConfig's message names variables and never their values. Boot errors name only the step.
  const message = error instanceof Error ? error.message : '';
  console.error(/^(BOOT_FAILED:|Missing or invalid environment|Environment variables exceed)/.test(message) ? message : 'BOOT_FAILED');
  process.exit(1);
});
