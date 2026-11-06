import { spawn, type ChildProcess } from 'node:child_process';
import { NATIVE } from '@cloakroom/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex, type PublicClient } from 'viem';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { runDemo, type DemoOptions } from '../scripts/demo.js';
import { deployLocalUniswap, type LocalUniswap } from '../scripts/demo-local.js';
import { TEST_SWAP_ROUTER_ABI, TEST_SWAP_TOKEN_ABI } from './fixtures/test-swap-router.js';

/** Anvil's public, test-only default accounts. */
const FUNDER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const client = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 100 }) as PublicClient;

let anvil: ChildProcess;
let uniswap: LocalUniswap;

function options(overrides: Partial<DemoOptions> = {}): DemoOptions {
  return {
    client,
    chain: foundry,
    transport,
    funderKey: FUNDER_KEY,
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
    pollIntervalSec: 1,
    receiptTimeoutMs: 60_000,
    confirmations: 2n,
    log: () => {},
    ...overrides,
  };
}

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--block-time', '1', '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await client.getBlockNumber();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const deployer = createWalletClient({ account: privateKeyToAccount(DEPLOYER_KEY), chain: foundry, transport });
  uniswap = await deployLocalUniswap({
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
}, 20_000);

afterAll(() => {
  anvil?.kill();
});

describe('the two-user demo', () => {
  it('passes every check, from different addresses, with real payouts', async () => {
    const lines: string[] = [];

    const result = await runDemo(options({ log: (line) => lines.push(line) }));

    expect(result.checks.filter((check) => !check.passed)).toEqual([]);
    expect(result.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['replay rejected', 'wrong destination rejected', 'double spend rejected']),
    );

    const swap = await client.getTransactionReceipt({ hash: result.swapTxHash! });
    const payout = await client.getTransactionReceipt({ hash: result.payoutTxHash! });
    expect(swap.status).toBe('success');
    expect(payout.status).toBe('success');
    expect(swap.to?.toLowerCase()).toBe(uniswap.router.toLowerCase());
    expect(payout.from).not.toBe(swap.from);

    const logged = lines.join('\n');
    expect(logged).toContain('TEE-simulated');
    expect(logged).toContain('Known leaks');
    expect(logged).not.toContain(FUNDER_KEY);
  }, 120_000);

  it('returns unspent ETH to the funder afterwards', async () => {
    const funder = privateKeyToAccount(FUNDER_KEY).address;
    const before = await client.getBalance({ address: funder });

    await runDemo(options());

    const spent = before - (await client.getBalance({ address: funder }));
    // The swap's 0.1 ETH and Bob's locked withdrawal stay reflected on-chain as spent or returned.
    expect(spent).toBeLessThan(parseEther('0.2'));
  }, 120_000);

  it('fails rather than sending a swap whose calldata pays someone else', async () => {
    const attacker = privateKeyToAddress(generatePrivateKey());
    const tokenBefore = await client.readContract({
      address: uniswap.token,
      abi: TEST_SWAP_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [attacker],
    });
    let quotes = 0;
    const unsafe: DemoOptions['quoter'] = {
      quote: async (request) => {
        quotes += 1;
        const quote = await uniswap.quoter.quote(request);
        if (request.tokenIn !== NATIVE || !request.protocols || request.swapper === attacker) return quote;
        // Seeding asks with the funder. Only the swap's own request is tampered with.
        const funder = privateKeyToAccount(FUNDER_KEY).address;
        if (request.swapper === funder) return quote;
        const replaced = quote.transaction!.data.replace(
          request.swapper.slice(2).toLowerCase(),
          attacker.slice(2).toLowerCase(),
        ) as Hex;
        return { ...quote, transaction: { ...quote.transaction!, data: replaced } };
      },
    };

    await expect(runDemo(options({ quoter: unsafe, receiptTimeoutMs: 8_000 }))).rejects.toThrow('Timed out');

    expect(quotes).toBeGreaterThan(0);
    expect(
      await client.readContract({
        address: uniswap.token,
        abi: TEST_SWAP_TOKEN_ABI,
        functionName: 'balanceOf',
        args: [attacker],
      }),
    ).toBe(tokenBefore);
  }, 120_000);
});
