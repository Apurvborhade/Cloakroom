import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  parseAbiParameters,
  parseEther,
  publicActions,
  walletActions,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  claimInventoryAddresses,
  fundInventory,
  planSeeding,
  readSavedAddresses,
  type SeedChain,
  type SeedFundingOptions,
} from '../scripts/seeding.js';
import { custodyRoutes } from '../src/custody-routes.js';
import { KeyManager } from '../src/keys.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import type { Quote, QuoteRequest } from '../src/uniswap.js';
import { memoryJournal } from './helpers/memory-journal.js';
import {
  TEST_SWAP_ROUTER_ABI,
  TEST_SWAP_ROUTER_BYTECODE,
  TEST_SWAP_TOKEN_ABI,
} from './fixtures/test-swap-router.js';

const CHAIN = 11155111;
const ADMIN = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const OTHER = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const GAS_RESERVE = parseEther('0.005');
const TARGETS = { nativeWei: parseEther('0.02'), tokenUnits: 100_000_000n };
const THIS: Address = '0x0000000000000000000000000000000000000002';
const ROUTER_EXECUTE = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
/** 1 ETH buys this many token units in these tests. */
const RATE = 2_000_000_000n;

const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 20 }) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions)
  .extend(walletActions);

let anvilProcess: ChildProcess;
let directory: string;
let router: Address;
let token: Address;
let deployer: Address;

const freshAddress = () => privateKeyToAddress(generatePrivateKey());
const tempFile = () => join(directory, `${Math.random()}.json`);

const tokenBalance = (address: Address) =>
  chain.readContract({ address: token, abi: TEST_SWAP_TOKEN_ABI, functionName: 'balanceOf', args: [address] });

async function newFunder(eth = parseEther('5')) {
  const key = generatePrivateKey();
  const account = privateKeyToAccount(key);
  await anvil.setBalance({ address: account.address, value: eth });
  const client = createWalletClient({ account, chain: foundry, transport });
  const sent: Array<{ to: Address; value?: bigint; data?: Hex }> = [];
  return {
    address: account.address,
    sent,
    send: async (tx: { to: Address; value?: bigint; data?: Hex }) => {
      sent.push(tx);
      return client.sendTransaction(tx);
    },
  };
}

function swapCalldata(eoa: Address, input: bigint, minOut: bigint, sweepTo: Address = eoa): Hex {
  return encodeFunctionData({
    abi: ROUTER_EXECUTE,
    functionName: 'execute',
    args: [
      '0x0b0004',
      [
        encodeAbiParameters(parseAbiParameters('address, uint256'), [THIS, input]),
        encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [THIS, input, 0n, '0x00', false]),
        encodeAbiParameters(parseAbiParameters('address, address, uint256'), [token, sweepTo, minOut]),
      ],
      99_999_999_999n,
    ],
  });
}

function quoterWith(hook?: (request: QuoteRequest, quote: Quote) => Quote) {
  const requests: QuoteRequest[] = [];
  return {
    requests,
    quote: async (request: QuoteRequest): Promise<Quote> => {
      requests.push(request);
      const amountOut = (request.amountIn * RATE) / parseEther('1');
      const minAmountOut = (amountOut * 99n) / 100n;
      const quote: Quote = {
        amountIn: request.amountIn,
        amountOut,
        minAmountOut,
        transaction: {
          to: router,
          from: request.swapper,
          value: request.amountIn,
          data: swapCalldata(request.swapper, request.amountIn, minAmountOut),
        },
      };
      return hook ? hook(request, quote) : quote;
    },
  };
}

/** The mock router mints whatever it was last told to, so set it to what the swap would give. */
async function configureRouter(amountOut: bigint, shouldRevert = false): Promise<void> {
  const hash = await anvil.writeContract({
    account: deployer,
    chain: foundry,
    address: router,
    abi: TEST_SWAP_ROUTER_ABI,
    functionName: 'configure',
    args: [amountOut, shouldRevert],
  });
  await anvil.waitForTransactionReceipt({ hash });
}

function fundingOptions(
  wallet: SeedFundingOptions['wallet'],
  addresses: Address[],
  overrides: Partial<SeedFundingOptions> = {},
): SeedFundingOptions {
  return {
    chain: chain as unknown as SeedChain,
    wallet,
    addresses,
    tokenOut: token,
    targets: TARGETS,
    gasReserveWei: GAS_RESERVE,
    gasBufferWei: parseEther('0.01'),
    swap: { quoter: quoterWith(), routerAddress: router, priceCheckWei: parseEther('0.001') },
    execute: true,
    ...overrides,
  };
}

async function realEnclave() {
  const { journal } = memoryJournal();
  const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey('aa'.repeat(32), true), true);
  const keys = new KeyManager({
    journal,
    vault,
    simMode: true,
    allowCreate: true,
    policy: { chainId: CHAIN, maxGas: 100_000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 5n, maxNativeValue: 10n },
  });
  await keys.init();
  const inventory = await keys.allocate('inventory');
  const deposit = await keys.allocate('deposit');
  const app = Fastify({ logger: false });
  await custodyRoutes(app, { keys, adminAddress: ADMIN.address, seedingEnabled: true, chainId: CHAIN });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { app, keys, inventory, deposit, url };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cloakroom-seed-'));
  anvilProcess = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chain.getBlockNumber();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  [deployer] = (await anvil.getAddresses()) as [Address];
  const hash = await anvil.deployContract({
    account: deployer,
    chain: foundry,
    abi: TEST_SWAP_ROUTER_ABI,
    bytecode: TEST_SWAP_ROUTER_BYTECODE,
  });
  router = getAddress((await anvil.waitForTransactionReceipt({ hash })).contractAddress!);
  token = await chain.readContract({ address: router, abi: TEST_SWAP_ROUTER_ABI, functionName: 'token' });
}, 15_000);

afterAll(() => {
  anvilProcess?.kill();
  rmSync(directory, { recursive: true, force: true });
});

describe('claimInventoryAddresses', () => {
  it('claims from the real enclave route, and saves only inventory addresses', async () => {
    const { app, keys, inventory, deposit, url } = await realEnclave();
    const filePath = tempFile();

    const addresses = await claimInventoryAddresses({
      enclaveUrl: url,
      enclavePubKey: keys.transportPublicKey(),
      chainId: CHAIN,
      admin: ADMIN,
      filePath,
    });
    await app.close();

    expect(addresses).toEqual([inventory.address]);
    expect(await readSavedAddresses(filePath)).toEqual([inventory.address]);
    expect(readFileSync(filePath, 'utf8')).not.toContain(deposit.address);
  });

  it('saves the file so only its owner can read it', async () => {
    const { app, keys, url } = await realEnclave();
    const filePath = tempFile();

    await claimInventoryAddresses({
      enclaveUrl: url,
      enclavePubKey: keys.transportPublicKey(),
      chainId: CHAIN,
      admin: ADMIN,
      filePath,
    });
    await app.close();

    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('makes no request if addresses were already saved, so the one claim is not wasted', async () => {
    const { app, keys, url } = await realEnclave();
    const filePath = tempFile();
    writeFileSync(filePath, '["0x0000000000000000000000000000000000000001"]');
    let requests = 0;

    await expect(
      claimInventoryAddresses({
        enclaveUrl: url,
        enclavePubKey: keys.transportPublicKey(),
        chainId: CHAIN,
        admin: ADMIN,
        filePath,
        fetch: (async () => {
          requests += 1;
          return new Response('{}');
        }) as typeof globalThis.fetch,
      }),
    ).rejects.toThrow('SEED_ADDRESSES_ALREADY_SAVED');
    await app.close();

    expect(requests).toBe(0);
    expect(readFileSync(filePath, 'utf8')).toContain('0x0000000000000000000000000000000000000001');
  });

  it('fails cleanly for the wrong admin, saving nothing', async () => {
    const { app, keys, url } = await realEnclave();
    const filePath = tempFile();

    await expect(
      claimInventoryAddresses({
        enclaveUrl: url,
        enclavePubKey: keys.transportPublicKey(),
        chainId: CHAIN,
        admin: OTHER,
        filePath,
      }),
    ).rejects.toThrow('SEED_CLAIM_FAILED:403');
    await app.close();

    await expect(readSavedAddresses(filePath)).rejects.toThrow();
  });

  it('fails cleanly when the claim was already used elsewhere', async () => {
    const { app, keys, url } = await realEnclave();
    const options = { enclaveUrl: url, enclavePubKey: keys.transportPublicKey(), chainId: CHAIN, admin: ADMIN };
    await claimInventoryAddresses({ ...options, filePath: tempFile() });

    await expect(claimInventoryAddresses({ ...options, filePath: tempFile() })).rejects.toThrow('SEED_CLAIM_FAILED:403');
    await app.close();
  });
});

describe('readSavedAddresses', () => {
  it.each([
    ['an empty list', '[]'],
    ['something that is not a list', '{"addresses":[]}'],
    ['duplicates', '["0x0000000000000000000000000000000000000001","0x0000000000000000000000000000000000000001"]'],
  ])('rejects %s', async (_name, content) => {
    const filePath = tempFile();
    writeFileSync(filePath, content);

    await expect(readSavedAddresses(filePath)).rejects.toThrow('SEED_ADDRESSES_INVALID');
  });

  it('rejects an invalid address', async () => {
    const filePath = tempFile();
    writeFileSync(filePath, '["not-an-address"]');

    await expect(readSavedAddresses(filePath)).rejects.toThrow();
  });
});

describe('planSeeding', () => {
  const address = '0x0000000000000000000000000000000000000001' as Address;

  it('asks only for what is missing', () => {
    const plan = planSeeding([{ address, native: parseEther('0.015'), token: 40_000_000n }], TARGETS);

    expect(plan.topUps).toEqual([{ address, native: parseEther('0.005'), token: 60_000_000n }]);
    expect(plan.totalNative).toBe(parseEther('0.005'));
    expect(plan.totalToken).toBe(60_000_000n);
  });

  it('skips addresses already at or above their targets', () => {
    expect(planSeeding([{ address, native: TARGETS.nativeWei, token: TARGETS.tokenUnits }], TARGETS).topUps).toEqual([]);
    expect(planSeeding([{ address, native: parseEther('9'), token: 999_000_000n }], TARGETS).topUps).toEqual([]);
  });

  it('never asks for a negative amount when only one side is short', () => {
    const plan = planSeeding([{ address, native: parseEther('9'), token: 1n }], TARGETS);

    expect(plan.topUps).toEqual([{ address, native: 0n, token: TARGETS.tokenUnits - 1n }]);
    expect(plan.totalNative).toBe(0n);
  });
});

describe('fundInventory', () => {
  it('swaps for the missing tokens, then funds each address to its target', async () => {
    const wallet = await newFunder();
    const addresses = [freshAddress(), freshAddress()];
    await configureRouter(TARGETS.tokenUnits * 2n);

    const result = await fundInventory(fundingOptions(wallet, addresses));

    expect(result.executed).toBe(true);
    for (const address of addresses) {
      expect(await chain.getBalance({ address })).toBe(TARGETS.nativeWei);
      expect(await tokenBalance(address)).toBe(TARGETS.tokenUnits);
    }
    expect(wallet.sent.at(0)?.to).toBe(router);
    expect(result.swapInputWei).toBeGreaterThan(0n);
  });

  it('asks Uniswap for checkable routes only', async () => {
    const wallet = await newFunder();
    const quoter = quoterWith();
    await configureRouter(TARGETS.tokenUnits);

    await fundInventory(
      fundingOptions(wallet, [freshAddress()], {
        swap: { quoter, routerAddress: router, priceCheckWei: parseEther('0.001') },
      }),
    );

    for (const request of quoter.requests) expect(request.protocols).toEqual(['V2', 'V3']);
  });

  it('sends nothing the second time, because every target is already met', async () => {
    const wallet = await newFunder();
    const addresses = [freshAddress()];
    await configureRouter(TARGETS.tokenUnits);
    await fundInventory(fundingOptions(wallet, addresses));
    const sentBefore = wallet.sent.length;

    const second = await fundInventory(fundingOptions(wallet, addresses));

    expect(second.plan.topUps).toEqual([]);
    expect(wallet.sent.length).toBe(sentBefore);
    expect(await chain.getBalance({ address: addresses[0]! })).toBe(TARGETS.nativeWei);
  });

  it('only tops up the difference for an address that already has some funds', async () => {
    const wallet = await newFunder();
    const address = freshAddress();
    await anvil.setBalance({ address, value: parseEther('0.015') });
    await configureRouter(TARGETS.tokenUnits);

    const result = await fundInventory(fundingOptions(wallet, [address]));

    expect(result.plan.totalNative).toBe(parseEther('0.005'));
    expect(await chain.getBalance({ address })).toBe(TARGETS.nativeWei);
  });

  it('skips the swap when the wallet already holds enough tokens', async () => {
    const wallet = await newFunder();
    // The router pays more than the first run needs, so the wallet keeps a surplus.
    await configureRouter(TARGETS.tokenUnits * 10n);
    await fundInventory(fundingOptions(wallet, [freshAddress()]));
    const quoter = quoterWith();

    const first = await fundInventory(
      fundingOptions(wallet, [freshAddress()], {
        swap: { quoter, routerAddress: router, priceCheckWei: parseEther('0.001') },
      }),
    );

    expect(first.swapInputWei).toBe(0n);
    expect(quoter.requests).toEqual([]);
  });

  describe('previewing', () => {
    it('sends nothing without execute, but still reports the plan', async () => {
      const wallet = await newFunder();
      const address = freshAddress();

      const result = await fundInventory(fundingOptions(wallet, [address], { execute: false }));

      expect(result.executed).toBe(false);
      expect(result.plan.totalNative).toBe(TARGETS.nativeWei);
      expect(result.swapInputWei).toBeGreaterThan(0n);
      expect(wallet.sent).toEqual([]);
      expect(await chain.getBalance({ address })).toBe(0n);
    });
  });

  describe('refusing before any funds move', () => {
    it('when the wallet cannot cover the plan', async () => {
      const wallet = await newFunder(parseEther('0.001'));

      await expect(fundInventory(fundingOptions(wallet, [freshAddress()]))).rejects.toThrow('SEED_FUNDER_INSUFFICIENT_ETH');
      expect(wallet.sent).toEqual([]);
    });

    it('when the wallet could not cover the plan plus its gas buffer', async () => {
      const wallet = await newFunder(TARGETS.nativeWei);
      const targets = { nativeWei: TARGETS.nativeWei, tokenUnits: 0n };

      await expect(fundInventory(fundingOptions(wallet, [freshAddress()], { targets }))).rejects.toThrow(
        'SEED_FUNDER_INSUFFICIENT_ETH',
      );
      expect(wallet.sent).toEqual([]);
    });

    it('when the wallet could cover the transfers but not the swap as well', async () => {
      const wallet = await newFunder(parseEther('0.04'));

      await expect(fundInventory(fundingOptions(wallet, [freshAddress()]))).rejects.toThrow('SEED_FUNDER_INSUFFICIENT_ETH');
      expect(wallet.sent).toEqual([]);
    });

    it('when the swap would revert', async () => {
      const wallet = await newFunder();
      await configureRouter(TARGETS.tokenUnits, true);

      await expect(fundInventory(fundingOptions(wallet, [freshAddress()]))).rejects.toThrow();
      await configureRouter(TARGETS.tokenUnits);
      expect(wallet.sent).toEqual([]);
    });

    it('when the target would leave nothing above the gas reserve', async () => {
      const wallet = await newFunder();
      const targets = { nativeWei: GAS_RESERVE, tokenUnits: TARGETS.tokenUnits };

      await expect(fundInventory(fundingOptions(wallet, [freshAddress()], { targets }))).rejects.toThrow(
        'SEED_TARGET_BELOW_GAS_RESERVE',
      );
    });

    it('when the funding wallet is in the inventory list', async () => {
      const wallet = await newFunder();

      await expect(fundInventory(fundingOptions(wallet, [wallet.address]))).rejects.toThrow('SEED_FUNDER_IN_INVENTORY');
    });

    it.each<[string, (quote: Quote, request: QuoteRequest) => Quote, string]>([
      ['goes to another contract', (quote) => ({ ...quote, transaction: { ...quote.transaction!, to: freshAddress() } }), 'SEED_SWAP_UNEXPECTED_TRANSACTION'],
      ['comes from another address', (quote) => ({ ...quote, transaction: { ...quote.transaction!, from: freshAddress() } }), 'SEED_SWAP_UNEXPECTED_TRANSACTION'],
      ['spends more ETH than planned', (quote) => ({ ...quote, transaction: { ...quote.transaction!, value: quote.amountIn + 1n } }), 'SEED_SWAP_UNEXPECTED_TRANSACTION'],
      ['has no transaction', ({ transaction: _unused, ...quote }) => quote, 'SEED_SWAP_UNEXPECTED_TRANSACTION'],
      ['pays someone else', (quote, request) => ({ ...quote, transaction: { ...quote.transaction!, data: swapCalldata(request.swapper, request.amountIn, quote.minAmountOut, freshAddress()) } }), 'SWEEP_RECIPIENT'],
      ['sets too low a minimum on-chain', (quote, request) => ({ ...quote, transaction: { ...quote.transaction!, data: swapCalldata(request.swapper, request.amountIn, 1n) } }), 'SWEEP_MINIMUM'],
    ])('when the swap %s', async (_name, change, reason) => {
      const wallet = await newFunder();

      await expect(
        fundInventory(
          fundingOptions(wallet, [freshAddress()], {
            swap: {
              quoter: quoterWith((request, quote) => change(quote, request)),
              routerAddress: router,
              priceCheckWei: parseEther('0.001'),
            },
          }),
        ),
      ).rejects.toThrow(reason);
      expect(wallet.sent).toEqual([]);
    });

    it('when the real quote would not cover the tokens needed', async () => {
      const wallet = await newFunder();
      let calls = 0;
      const quoter = quoterWith((_request, quote) => {
        calls += 1;
        return calls === 1 ? quote : { ...quote, minAmountOut: 1n };
      });

      await expect(
        fundInventory(
          fundingOptions(wallet, [freshAddress()], {
            swap: { quoter, routerAddress: router, priceCheckWei: parseEther('0.001') },
          }),
        ),
      ).rejects.toThrow('SEED_SWAP_TOO_SMALL');
      expect(wallet.sent).toEqual([]);
    });
  });

  it('stops if the swap delivers fewer tokens than the transfers need', async () => {
    const wallet = await newFunder();
    await configureRouter(1n);

    await expect(fundInventory(fundingOptions(wallet, [freshAddress()]))).rejects.toThrow();
    await configureRouter(TARGETS.tokenUnits);
  });

  it('reports it if an address still misses its target afterwards', async () => {
    const wallet = await newFunder();
    const address = freshAddress();
    await configureRouter(TARGETS.tokenUnits);
    let sends = 0;
    const dropping = {
      address: wallet.address,
      send: async (tx: { to: Address; value?: bigint; data?: Hex }) => {
        sends += 1;
        // The ETH top-up "succeeds" but goes elsewhere, as a wrong send would.
        return wallet.send(tx.value && !tx.data ? { ...tx, to: freshAddress() } : tx);
      },
    };

    await expect(fundInventory(fundingOptions(dropping, [address]))).rejects.toThrow('SEED_INCOMPLETE');
    expect(sends).toBeGreaterThan(0);
  });

  it('stops on a reverted transaction', async () => {
    const reverting = freshAddress();
    await anvil.setCode({ address: reverting, bytecode: '0x60006000fd' });
    const targets = { nativeWei: TARGETS.nativeWei, tokenUnits: 0n };
    const raw = createWalletClient({ account: privateKeyToAccount(generatePrivateKey()), chain: foundry, transport });
    await anvil.setBalance({ address: raw.account.address, value: parseEther('5') });
    const forced = {
      address: raw.account.address,
      send: (tx: { to: Address; value?: bigint; data?: Hex }) => raw.sendTransaction({ ...tx, gas: 100_000n }),
    };

    await expect(fundInventory(fundingOptions(forced, [reverting], { targets }))).rejects.toThrow('SEED_TRANSACTION_REVERTED');
  });
});
