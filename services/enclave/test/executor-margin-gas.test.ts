import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { NATIVE, type JournalEvent } from '@cloakroom/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createPublicClient, createTestClient, encodeAbiParameters, encodeFunctionData, getAddress,
  http, keccak256, parseAbiParameters, parseEther, publicActions, toBytes, walletActions,
  type Address,
} from 'viem';
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Executor, type ExecutorChain } from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { KeyManager } from '../src/keys.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { LongMarginAccounting } from '../src/margin-accounting.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { TEST_SWAP_ROUTER_ABI, TEST_SWAP_ROUTER_BYTECODE } from './fixtures/test-swap-router.js';
import { memoryJournal } from './helpers/memory-journal.js';

const port = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${port}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 20 });
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport }).extend(publicActions).extend(walletActions);
const RESERVE = parseEther('0.01');
const ASSET = parseEther('0.001');
const USD = 1_000_000n;
const freshAddress = () => privateKeyToAddress(generatePrivateKey());
let process: ChildProcess;
let router: Address, token: Address;
const weth = freshAddress();

beforeAll(async () => {
  process = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await chain.getBlockNumber(); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
  const [funder] = await anvil.getAddresses();
  const deployment = await anvil.deployContract({ account: funder!, chain: foundry,
    abi: TEST_SWAP_ROUTER_ABI, bytecode: TEST_SWAP_ROUTER_BYTECODE });
  router = getAddress((await anvil.waitForTransactionReceipt({ hash: deployment })).contractAddress!);
  token = await chain.readContract({ address: router, abi: TEST_SWAP_ROUTER_ABI, functionName: 'token' });
  const hash = await anvil.writeContract({ account: funder!, chain: foundry, address: router,
    abi: TEST_SWAP_ROUTER_ABI, functionName: 'configure', args: [2n * USD, false] });
  await anvil.waitForTransactionReceipt({ hash });
}, 15_000);
afterAll(() => { process?.kill(); });

async function setup(gasBalances: bigint[], kind: 'close' | 'liquidate' = 'close', overrides: Partial<ExecutorChain> = {}) {
  const log = memoryJournal(), ledger = new InMemoryLedger(), queue = new FifoSerialQueue();
  const keys = new KeyManager({ simMode: true, allowCreate: true, journal: log.journal,
    vault: new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey(randomBytes(32).toString('hex'), true), true),
    policy: { chainId: foundry.id, maxGas: 1_200_000n, maxFeePerGas: 100_000_000_000n,
      maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: parseEther('1'),
      swaps: { routerAddress: router, tokenOut: token, tokenOutDecimals: 6, feeBps: 10 },
      margin: { wethAddress: weth } } });
  await keys.init();
  const ownDeposit = await keys.allocate('inventory');
  const candidates = await Promise.all(gasBalances.map(() => keys.allocate('inventory')));
  const owner = freshAddress(), lender = freshAddress();
  const inventory = new Inventory({ chain, keys, tokens: [token], gasReserveWei: RESERVE });
  const append = async (event: JournalEvent) => {
    await log.journal.append(event); ledger.apply(event); inventory.replay(event);
  };
  for (const [id, depositor] of [['trader', owner], ['lender', lender]] as const) {
    await append({ t: 'DEPOSIT_SESSION_OPENED', id, owner: depositor, eoa: ownDeposit.address,
      expiry: 4_000_000_000, baseline: 0n, baselineBlock: 0n,
      funding: { asset: token, tokenBaseline: 0n, gasReserveWei: RESERVE } });
    await append({ t: 'DEPOSIT_COMPLETED', id, owner: depositor, eoa: ownDeposit.address,
      asset: token, nativeAmount: 0n, tokenAmount: USD, gasReserveWei: RESERVE, block: 1n });
  }
  const accounting = new LongMarginAccounting({ ledger, journal: log.journal, queue, usdc: token, usdcDecimals: 6 });
  const now = Math.floor(Date.now() / 1000), expiry = BigInt(now + 120);
  const price = { pair: `${NATIVE}/${token}`, price: 2_000n * 10n ** 18n, ts: now, source: 'test' };
  await accounting.supply(lender, { owner: lender, nonce: 1n, expiry, token, amount: USD });
  const opened = await accounting.prepareOpen(owner, { owner, nonce: 1n, expiry, side: 0,
    collateral: USD, leverageBps: 20_000, limitPrice: price.price, maxSlippageBps: 100 }, price);
  // Seed the opened position; the exit below uses Anvil, the real executor and custody signer.
  const openHash = keccak256(toBytes(opened.opId));
  await append({ t: 'MARGIN_OP_BROADCAST', opId: opened.opId, eoa: candidates[0]!.address, nonce: 0, txHash: openHash, raw: '0x01' });
  await accounting.settle(opened.opId, { amountIn: 2n * USD, amountOut: ASSET, gasCost: 1n, txHash: openHash });
  await anvil.setBalance({ address: ownDeposit.address, value: parseEther('1') });
  for (const [index, eoa] of candidates.entries()) {
    await anvil.setBalance({ address: eoa.address, value: ASSET + gasBalances[index]! });
  }
  const operation = kind === 'close'
    ? await accounting.prepareClose(owner, { owner, nonce: 2n, expiry, positionId: opened.positionId,
      limitPrice: 1_900n * 10n ** 18n, maxSlippageBps: 100 }, price)
    : (await accounting.prepareLiquidation(opened.positionId, { ...price, price: 1_000n * 10n ** 18n }))!;
  const quote = vi.fn(async (request: { amountIn: bigint; swapper: Address; slippagePercent?: number }) => {
    const minOut = 2n * USD * (10_000n - BigInt(Math.round(request.slippagePercent! * 100))) / 10_000n;
    const data = encodeFunctionData({ abi: TEST_SWAP_ROUTER_ABI, functionName: 'execute', args: [
      '0x0b08', [
        encodeAbiParameters(parseAbiParameters('address, uint256'),
          ['0x0000000000000000000000000000000000000002', request.amountIn]),
        encodeAbiParameters(parseAbiParameters('address, uint256, uint256, address[], bool'),
          [request.swapper, request.amountIn, minOut, [weth, token], false]),
      ], BigInt(operation.expiry),
    ] });
    return { amountIn: request.amountIn, amountOut: 2n * USD, minAmountOut: minOut,
      transaction: { to: router, from: request.swapper, value: request.amountIn, data } };
  });
  const register = vi.spyOn(keys, 'registerOp');
  const executor = new Executor({ chain: { ...chain, ...overrides }, chainId: foundry.id,
    signer: keys, inventory, ledger, journal: log.journal, queue, confirmations: 0n,
    receiptTimeoutMs: 5000, gasMarginPercent: 120n, inventorySettleAttempts: 2,
    margin: { accounting, inventory, ledger, reader: chain, routerAddress: router,
      wethAddress: weth, maxSlippageBpsCap: 300, quoter: { quote } } });
  return { executor, operation, owner, lender, candidates, ownDeposit, inventory, accounting, ledger, log, register, quote };
}

describe('margin exit gas budget', () => {
  it.each(['close', 'liquidate'] as const)('%s spends a partially used reserve and settles once', async (kind) => {
    const s = await setup([RESERVE - parseEther('0.000001')], kind);
    const before = await chain.getBalance({ address: s.candidates[0]!.address });
    const outcome = await s.executor.runMarginOperation(s.operation);
    expect(outcome.status).toBe('settled');
    if (outcome.status !== 'settled') throw new Error(outcome.status);
    const tx = await chain.getTransaction({ hash: outcome.txHash });
    expect(tx.from).toBe(s.candidates[0]!.address.toLowerCase());
    expect(tx.value).toBe(ASSET);
    expect(before).toBeGreaterThanOrEqual(tx.value + tx.gas * tx.maxFeePerGas!);
    expect(await chain.getBalance({ address: s.ownDeposit.address })).toBe(parseEther('1'));
    expect(s.accounting.positions(s.owner, null)[0]).toMatchObject({
      status: kind === 'close' ? 'closed' : 'liquidated', debt: 0n, asset: 0n, payout: USD, shortfall: 0n,
    });
    expect(s.ledger.getBalance(s.owner, token).available).toBe(USD);
    expect(s.accounting.lending(s.lender)[0]?.available).toBe(USD);
    const replayed = await replayLedger(s.log.journal);
    expect(replayed.totals()).toEqual(s.ledger.totals());
    expect(replayed.marginPositions.positions()).toEqual(s.ledger.marginPositions.positions());
    s.ledger.assertInvariants();
  });

  it('tries another eligible address before signing when the first cannot afford gas', async () => {
    const s = await setup([1n, RESERVE / 2n]);
    const outcome = await s.executor.runMarginOperation(s.operation);
    expect(outcome.status).toBe('settled');
    expect(s.register).toHaveBeenCalledTimes(1);
    expect(s.register.mock.calls[0]![1].eoa).toBe(s.candidates[1]!.address);
    expect(await chain.getBalance({ address: s.candidates[0]!.address })).toBe(ASSET + 1n);
    expect(s.log.events.filter((e) => e.t === 'MARGIN_OP_FAILED')).toHaveLength(0);
  });

  it('requires the maximum signed fee budget, keeps the position open and releases the address on failure', async () => {
    const s = await setup([parseEther('0.0001')], 'close', {
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
    });
    expect(await s.executor.runMarginOperation(s.operation)).toEqual({ status: 'failed', reason: 'INSUFFICIENT_GAS' });
    expect(s.register).not.toHaveBeenCalled();
    expect(s.accounting.positions(s.owner, null)[0]).toMatchObject({ status: 'open', asset: ASSET, debt: USD });
    expect(s.log.events.filter((e) => e.t === 'MARGIN_OP_BROADCAST' && e.opId === s.operation.opId)).toHaveLength(0);
    await anvil.setBalance({ address: s.candidates[0]!.address, value: ASSET + RESERVE });
    await s.inventory.refresh();
    expect(s.inventory.pick(NATIVE, ASSET, s.inventory.depositEoasOf(s.owner))?.address).toBe(s.candidates[0]!.address);
    s.ledger.assertInvariants();
  });

  it('keeps in-flight addresses locked while checking the quote', async () => {
    const s = await setup([RESERVE]);
    const original = s.quote.getMockImplementation()!;
    s.quote.mockImplementation(async (request) => {
      expect(() => s.inventory.hold(request.swapper, NATIVE, 1n, 'competing')).toThrow('EOA_IN_FLIGHT');
      return original(request);
    });
    expect((await s.executor.runMarginOperation(s.operation)).status).toBe('settled');
    expect(s.quote).toHaveBeenCalledTimes(1);
  });

  it.each([-1n, 0n])('checks the gas margin and maximum fee at the funding boundary (%s wei)', async (difference) => {
    const budget = 120_000n * 1_000_000_000n;
    const s = await setup([budget + difference], 'close', {
      estimateGas: vi.fn().mockResolvedValue(100_000n),
      estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }),
    });
    const outcome = await s.executor.runMarginOperation(s.operation);
    expect(outcome.status).toBe(difference < 0n ? 'failed' : 'settled');
    expect(s.register).toHaveBeenCalledTimes(difference < 0n ? 0 : 1);
  });

  it('rechecks the pending balance before signing instead of trusting the inventory snapshot', async () => {
    const getBalance = vi.fn().mockResolvedValue(ASSET);
    const s = await setup([RESERVE], 'close', { getBalance });
    expect(await s.executor.runMarginOperation(s.operation)).toEqual({ status: 'failed', reason: 'INSUFFICIENT_GAS' });
    expect(getBalance).toHaveBeenCalledWith({ address: s.candidates[0]!.address, blockTag: 'pending' });
    expect(s.register).not.toHaveBeenCalled();
  });
});
