/**
 * The two-user demo as one command, with real components and clearly labelled stand-ins.
 *
 *   demo-fixture.ts local     starts its own Anvil chain, with a mock router
 *   demo-fixture.ts sepolia   real Sepolia, Trading API and Universal Router, spending test ETH
 *
 * See scripts/README.md.
 */
import { spawn } from 'node:child_process';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import type { Address, Hex, PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import { UniswapClient } from '../src/uniswap.js';
import { TEST_SWAP_ROUTER_ABI } from '../test/fixtures/test-swap-router.js';
import { runDemo } from './demo.js';
import type { DemoOptions, DemoResult } from './demo.js';
import { deployLocalUniswap } from './demo-local.js';

/** Anvil's first default account: a public, test-only key. */
const ANVIL_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
/** Anvil's second default account, so deploying does not disturb the funder's nonces. */
const ANVIL_DEPLOYER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const LOCAL_PORT = 18_545;
const SECRET_NAMES = ['RPC_URL', 'UNISWAP_API_KEY', 'TEST_PRIVATE_KEY'];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in .env`);
  return value;
}

function describeError(error: unknown): string {
  let text = error instanceof Error ? error.message : String(error);
  for (const name of SECRET_NAMES) {
    const secret = process.env[name];
    if (secret) text = text.replaceAll(secret, `[${name}]`);
  }
  return text;
}

function report(result: DemoResult): void {
  const failed = result.checks.filter((check) => !check.passed);
  console.log(`\n${result.checks.length - failed.length} of ${result.checks.length} checks passed.`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

const STAND_INS =
  'Real: auth, journal, ledger, queue, watcher, inventory, price poller, executor.\nStand-ins: the signer, the intent store, no API or UI, and nothing runs in a TEE.';

async function runLocal(): Promise<void> {
  const url = `http://127.0.0.1:${LOCAL_PORT}`;
  const anvil = spawn('anvil', ['--port', String(LOCAL_PORT), '--block-time', '1', '--silent'], { stdio: 'ignore' });
  try {
    const transport = http(url);
    const client = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 200 });
    for (let attempt = 0; attempt < 50; attempt++) {
      const ready = await client.getBlockNumber().then(
        () => true,
        () => false,
      );
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const deployer = createWalletClient({ account: privateKeyToAccount(ANVIL_DEPLOYER_KEY), chain: foundry, transport });
    const uniswap = await deployLocalUniswap({
      deploy: async (abi, bytecode) => {
        const hash = await deployer.deployContract({ abi, bytecode });
        return (await client.waitForTransactionReceipt({ hash })).contractAddress as Address;
      },
      readToken: (router) => client.readContract({ address: router, abi: TEST_SWAP_ROUTER_ABI, functionName: 'token' }),
      configure: async (router, amountOut) => {
        const hash = await deployer.writeContract({
          address: router,
          abi: TEST_SWAP_ROUTER_ABI,
          functionName: 'configure',
          args: [amountOut, false],
        });
        await client.waitForTransactionReceipt({ hash });
      },
    });
    console.log('Local demo: Anvil chain, with a mock Uniswap router.');
    console.log(STAND_INS);
    const options: DemoOptions = {
      client: client as PublicClient,
      chain: foundry,
      transport,
      funderKey: ANVIL_KEY,
      quoter: uniswap.quoter,
      routerAddress: uniswap.router,
      tokenOut: uniswap.token,
      tokenOutDecimals: 6,
      feeBps: 10,
      gasReserveWei: parseEther('0.01'),
      inventoryEthWei: parseEther('1'),
      inventoryTokenUnits: 100_000_000n,
      depositWei: parseEther('0.5'),
      swapWei: parseEther('0.1'),
      sessionTtlSec: 12,
      pollIntervalSec: 2,
      receiptTimeoutMs: 60_000,
      confirmations: 2n,
      log: console.log,
    };
    report(await runDemo(options));
  } finally {
    anvil.kill();
  }
}

async function runSepolia(): Promise<void> {
  const transport = http(required('RPC_URL'));
  const chainId = await createPublicClient({ transport }).getChainId();
  if (chainId !== sepolia.id) throw new Error(`Refusing to run on chain ${chainId}. Only Sepolia is allowed.`);
  const client = createPublicClient({ chain: sepolia, transport, cacheTime: 0, pollingInterval: 4_000 });
  console.log('Sepolia demo: real chain, Trading API and Universal Router. This spends test ETH.');
  console.log(STAND_INS);
  report(
    await runDemo({
      client: client as PublicClient,
      chain: sepolia,
      transport,
      funderKey: required('TEST_PRIVATE_KEY') as Hex,
      quoter: new UniswapClient({
        apiUrl: required('UNISWAP_API_URL'),
        apiKey: required('UNISWAP_API_KEY'),
        chainId: sepolia.id,
        timeoutMs: Number(required('PRICE_QUOTE_TIMEOUT_MS')),
      }),
      routerAddress: required('UNIVERSAL_ROUTER_ADDRESS') as Address,
      tokenOut: required('TOKEN_OUT_ADDRESS') as Address,
      tokenOutDecimals: Number(required('TOKEN_OUT_DECIMALS')),
      feeBps: Number(required('FEE_BPS')),
      gasReserveWei: parseEther('0.005'),
      inventoryEthWei: parseEther('0.008'),
      inventoryTokenUnits: 5_000_000n,
      depositWei: parseEther('0.002'),
      swapWei: parseEther('0.001'),
      sessionTtlSec: 150,
      pollIntervalSec: 15,
      receiptTimeoutMs: 300_000,
      confirmations: 2n,
      explorerTxUrl: 'https://sepolia.etherscan.io/tx/',
      log: console.log,
    }),
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === 'local') return runLocal();
  if (mode === 'sepolia') return runSepolia();
  throw new Error('Use: local, or sepolia');
}

main().catch((error: unknown) => {
  console.error(`\nStopped: ${describeError(error)}`);
  process.exitCode = 1;
});
