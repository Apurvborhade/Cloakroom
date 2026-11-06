// The enclave service's entrypoint. Prints fixed status codes only, because errors can contain
// the RPC URL and the service handles private data.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createPublicClient, http } from 'viem';
import { loadConfig } from './config.js';
import type { EnclaveConfig } from './config.js';
import { KeyManager } from './keys.js';
import { openNitroCustody } from './nitro-custody.js';
import { AesGcmStateVault, FileCipherBlobStore, simulationSealingKey } from './sealed-state.js';
import { bootEnclave } from './server.js';
import type { BootOptions } from './server.js';
import { UniswapClient } from './uniswap.js';
import { createNitroUniswapClient } from './nitro-uniswap.js';
import { createNitroRpcTransport } from './nitro-rpc.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function custody(config: EnclaveConfig): BootOptions['openKeys'] {
  const allowCreate = config.CUSTODY_ALLOW_CREATE;
  if (config.SIM_MODE) {
    const vaultPath = required('SIM_VAULT_PATH');
    const sealingKey = required('SIM_SEALING_KEY');
    return async (journal, policy) => {
      await mkdir(dirname(vaultPath), { recursive: true });
      const vault = new AesGcmStateVault(new FileCipherBlobStore(vaultPath), simulationSealingKey(sealingKey, true), true);
      const keys = new KeyManager({ vault, journal, policy, simMode: true, allowCreate });
      await keys.init();
      return keys;
    };
  }
  const keyArn = required('KMS_KEY_ARN');
  const region = required('KMS_REGION');
  const vaultId = required('VAULT_ID');
  return (journal, policy) => openNitroCustody({ keyArn, region, vaultId, journal, policy, allowCreate });
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.SIM_MODE) console.log('SIM_MODE: not running in a TEE, so this makes no confidentiality claim.');
  await mkdir(dirname(config.JOURNAL_PATH), { recursive: true });

  const running = await bootEnclave({
    config,
    chain: createPublicClient({ transport: config.SIM_MODE ? http(config.RPC_URL) : createNitroRpcTransport(config.RPC_URL) }),
    quoter: config.SIM_MODE ? new UniswapClient({
      apiUrl: config.UNISWAP_API_URL,
      apiKey: config.UNISWAP_API_KEY,
      chainId: config.CHAIN_ID,
      timeoutMs: config.PRICE_QUOTE_TIMEOUT_MS,
    }) : createNitroUniswapClient(config),
    openKeys: custody(config),
    attestation: config.SIM_MODE
      ? undefined
      : { buildHash: (await readFile(new URL('./build-hash', import.meta.url), 'utf8')).trim() },
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
