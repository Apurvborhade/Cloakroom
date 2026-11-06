/**
 * Claims the inventory addresses from the enclave once, then funds them with ETH and the output
 * token. Funding previews unless given --execute. Only runs on Sepolia or a local Anvil chain.
 * See scripts/README.md.
 */
import { createPublicClient, createWalletClient, formatEther, formatUnits, http } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, sepolia } from 'viem/chains';
import { UniswapClient } from '../src/uniswap.js';
import { claimInventoryAddresses, fundInventory, readSavedAddresses } from './seeding.js';

const CHAINS = { [sepolia.id]: sepolia, [foundry.id]: foundry } as const;
const DEFAULT_ADDRESSES_FILE = '.seed-addresses.json';
const PRICE_CHECK_WEI = 1_000_000_000_000_000n;
const GAS_BUFFER_WEI = 10_000_000_000_000_000n;

const SECRET_NAMES = ['RPC_URL', 'UNISWAP_API_KEY', 'ADMIN_PRIVATE_KEY', 'SEED_FUNDER_PRIVATE_KEY'];

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

const addressesFile = () => process.env.SEED_ADDRESSES_FILE ?? DEFAULT_ADDRESSES_FILE;

async function claim(): Promise<void> {
  const chainId = Number(required('CHAIN_ID'));
  if (!(chainId in CHAINS)) throw new Error(`Refusing to run on chain ${chainId}.`);
  const addresses = await claimInventoryAddresses({
    enclaveUrl: required('ENCLAVE_URL'),
    enclavePubKey: required('ENCLAVE_PUB_KEY') as Hex,
    chainId,
    admin: privateKeyToAccount(required('ADMIN_PRIVATE_KEY') as Hex),
    filePath: addressesFile(),
  });
  console.log(`Saved ${addresses.length} addresses to ${addressesFile()}.`);
  console.log('This can only be done once, so keep that file until funding is finished.');
}

async function fund(execute: boolean): Promise<void> {
  const transport = http(required('RPC_URL'));
  const chainId = await createPublicClient({ transport }).getChainId();
  if (!(chainId in CHAINS)) throw new Error(`Refusing to run on chain ${chainId}.`);
  const chain = CHAINS[chainId as keyof typeof CHAINS];
  const client = createPublicClient({ chain, transport, cacheTime: 0 });
  const account = privateKeyToAccount(required('SEED_FUNDER_PRIVATE_KEY') as Hex);
  const walletClient = createWalletClient({ account, chain, transport });
  const decimals = Number(required('TOKEN_OUT_DECIMALS'));

  const result = await fundInventory({
    chain: client,
    wallet: { address: account.address, send: (tx) => walletClient.sendTransaction(tx) },
    addresses: await readSavedAddresses(addressesFile()),
    tokenOut: required('TOKEN_OUT_ADDRESS') as Address,
    targets: {
      nativeWei: BigInt(required('SEED_ETH_PER_EOA_WEI')),
      tokenUnits: BigInt(required('SEED_TOKEN_PER_EOA')),
    },
    gasReserveWei: BigInt(required('GAS_RESERVE_WEI')),
    gasBufferWei: GAS_BUFFER_WEI,
    swap: {
      quoter: new UniswapClient({
        apiUrl: required('UNISWAP_API_URL'),
        apiKey: required('UNISWAP_API_KEY'),
        chainId,
        timeoutMs: Number(required('PRICE_QUOTE_TIMEOUT_MS')),
      }),
      routerAddress: required('UNIVERSAL_ROUTER_ADDRESS') as Address,
      priceCheckWei: PRICE_CHECK_WEI,
    },
    execute,
    onProgress: (line) => console.log(`  ${line}`),
  });

  const { plan } = result;
  console.log(`\nChain: ${chain.name} (${chainId})`);
  console.log(`Addresses needing funds: ${plan.topUps.length}`);
  console.log(`ETH to send: ${formatEther(plan.totalNative)}`);
  console.log(`Tokens to send: ${formatUnits(plan.totalToken, decimals)}`);
  console.log(`ETH to swap for tokens: ${formatEther(result.swapInputWei)}`);
  if (result.executed) {
    console.log(`\nDone in ${result.transactions.length} transaction(s). Every address reached its target.`);
    console.log('Now set SEEDING_ENABLED=false. These addresses are public now that they are funded.');
  } else {
    console.log('\nPreview only: nothing was sent. Run again with --execute to fund.');
  }
}

async function main(): Promise<void> {
  const [command, flag] = process.argv.slice(2);
  if (command === 'claim') return claim();
  if (command === 'fund') return fund(flag === '--execute');
  throw new Error('Use: claim, or fund [--execute]');
}

main().catch((error: unknown) => {
  console.error(`Stopped: ${describeError(error)}`);
  process.exitCode = 1;
});
