import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NATIVE, type StoredIntent } from '@cloakroom/shared';
import { createPublicClient, createTestClient, encodeAbiParameters, encodeFunctionData, getAddress, http,
  parseAbiParameters, parseEther, publicActions, walletActions } from 'viem';
import type { Address } from 'viem';
import { privateKeyToAddress, generatePrivateKey } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Executor } from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { KeyManager } from '../src/keys.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { memoryJournal } from './helpers/memory-journal.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from './fixtures/test-token.js';
import { TEST_SWAP_ROUTER_ABI, TEST_SWAP_ROUTER_BYTECODE } from './fixtures/test-swap-router.js';

const port = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${port}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 20 });
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport }).extend(publicActions).extend(walletActions);
let process: ChildProcess;
let token: Address;

beforeAll(async () => {
  process = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
  let failed = false;
  process.on('error', () => { failed = true; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (failed) throw new Error('Anvil is required for custody integration tests');
    try { await chain.getBlockNumber(); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
  const [funder] = await anvil.getAddresses();
  const hash = await anvil.deployContract({ account: funder!, abi: TEST_TOKEN_ABI,
    bytecode: TEST_TOKEN_BYTECODE, chain: foundry });
  token = (await anvil.waitForTransactionReceipt({ hash })).contractAddress!;
}, 15_000);

afterAll(() => { process?.kill(); });

describe('custody signer with the real executor', () => {
  it('settles a limit swap with the real KeyManager and preserves the limit after fees', async () => {
    const [funder] = await anvil.getAddresses();
    const deployment = await anvil.deployContract({ account: funder!, chain: foundry,
      abi: TEST_SWAP_ROUTER_ABI, bytecode: TEST_SWAP_ROUTER_BYTECODE });
    const router = getAddress((await anvil.waitForTransactionReceipt({ hash: deployment })).contractAddress!);
    const outputToken = await chain.readContract({ address: router, abi: TEST_SWAP_ROUTER_ABI, functionName: 'token' });
    const output = 301_000_000n;
    const configured = await anvil.writeContract({ account: funder!, chain: foundry, address: router,
      abi: TEST_SWAP_ROUTER_ABI, functionName: 'configure', args: [output, false] });
    await anvil.waitForTransactionReceipt({ hash: configured });
    const log = memoryJournal();
    const keys = new KeyManager({ simMode: true, allowCreate: true, journal: log.journal,
      vault: new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey(randomBytes(32).toString('hex'), true), true),
      policy: { chainId: foundry.id, maxGas: 1_200_000n, maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: parseEther('1'),
        swaps: { routerAddress: router, tokenOut: outputToken, tokenOutDecimals: 6, feeBps: 10 } } });
    await keys.init();
    const linked = await keys.allocate('inventory');
    const custody = await keys.allocate('inventory');
    const owner = privateKeyToAddress(generatePrivateKey());
    const ledger = new InMemoryLedger();
    const inventory = new Inventory({ chain, keys, tokens: [outputToken], gasReserveWei: parseEther('0.01') });
    for (const eoa of [linked, custody]) await anvil.setBalance({ address: eoa.address, value: parseEther('1') });
    const stored: StoredIntent = { id: 'swap', owner, status: 'pending', createdAt: Date.now(), intent: {
      owner, tokenIn: NATIVE, tokenOut: outputToken, amountIn: parseEther('0.1'), comparator: 0,
      triggerPrice: 3_000n * 10n ** 18n, maxSlippageBps: 50, nonce: 1n,
      expiry: BigInt(Math.floor(Date.now() / 1000)) + 300n,
    } };
    await log.journal.append({ t: 'DEPOSIT_SESSION_OPENED', id: 'deposit', owner, eoa: linked.address,
      expiry: 4_000_000_000, baseline: 0n, baselineBlock: 0n });
    inventory.linkOwner(owner, linked.address);
    await log.journal.append({ t: 'DEPOSIT_CREDITED', id: 'deposit', owner, amount: stored.intent.amountIn, block: 1n });
    await log.journal.append({ t: 'INTENT_CREATED', id: stored.id, owner, intent: stored.intent });
    for (const event of log.events) ledger.apply(event);
    let quotes = 0;
    const executor = new Executor({ chain, chainId: foundry.id, signer: keys, inventory, ledger,
      journal: log.journal, queue: new FifoSerialQueue(), confirmations: 0n, receiptTimeoutMs: 5000,
      gasMarginPercent: 120n, inventorySettleAttempts: 2, swaps: {
        routerAddress: router, tokenOut: outputToken, tokenOutDecimals: 6, feeBps: 10,
        maxSlippageBpsCap: 100, ledger, intents: { mark() {} }, quoter: {
          async quote(request) {
            quotes++;
            const minOut = output * (10_000n - BigInt(Math.round(request.slippagePercent! * 100))) / 10_000n;
            const data = encodeFunctionData({ abi: TEST_SWAP_ROUTER_ABI, functionName: 'execute', args: [
              '0x0b08', [
                encodeAbiParameters(parseAbiParameters('address, uint256'),
                  ['0x0000000000000000000000000000000000000002', request.amountIn]),
                encodeAbiParameters(parseAbiParameters('address, uint256, uint256, address[], bool'),
                  [request.swapper, request.amountIn, minOut, [token, outputToken], false]),
              ], stored.intent.expiry,
            ] });
            return { amountIn: request.amountIn, amountOut: output, minAmountOut: minOut,
              transaction: { to: router, from: request.swapper, value: request.amountIn, data } };
          },
        },
      } });
    const outcome = await executor.runIntent(stored);
    if (outcome.status !== 'settled') throw new Error(`Swap did not settle: ${JSON.stringify(outcome)}`);
    expect(quotes).toBe(2);
    expect(getAddress((await chain.getTransaction({ hash: outcome.txHash })).from)).toBe(custody.address);
    expect(outcome.amountOut - outcome.fee).toBeGreaterThanOrEqual(300_000_000n);
    expect(ledger.getBalance(owner, outputToken).available).toBe(300_699_000n);
    expect((await replayLedger(log.journal)).getBalance(owner, outputToken)).toEqual(ledger.getBalance(owner, outputToken));
    expect(log.events.map((event) => event.t)).toContain('SIGNING_COMPLETED');
    await expect(keys.recoverSigned('exec:swap')).rejects.toThrow('SIGNING_DENIED');
  });

  for (const native of [true, false]) {
    it(`settles a ${native ? 'native' : 'ERC-20'} payout from an unlinked HD account`, async () => {
      const log = memoryJournal();
      const vault = new AesGcmStateVault(new MemoryCipherBlobStore(),
        simulationSealingKey(randomBytes(32).toString('hex'), true), true);
      const options = { vault, journal: log.journal, simMode: true, allowCreate: true,
        policy: { chainId: foundry.id, maxGas: 500_000n, maxFeePerGas: 100_000_000_000n,
          maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: parseEther('1') } };
      const keys = new KeyManager(options);
      await keys.init();
      const linked = await keys.allocate('inventory');
      const payout = await keys.allocate('inventory');
      const owner = privateKeyToAddress(generatePrivateKey());
      const destination = privateKeyToAddress(generatePrivateKey());
      const inventory = new Inventory({ chain, keys, tokens: [token], gasReserveWei: parseEther('0.01') });
      inventory.linkOwner(owner, linked.address);
      await log.journal.append({ t: 'DEPOSIT_SESSION_OPENED', id: 'deposit', owner,
        eoa: linked.address, expiry: 4_000_000_000, baseline: 0n, baselineBlock: 0n });
      const [funder] = await anvil.getAddresses();
      for (const account of [linked, payout]) {
        await anvil.setBalance({ address: account.address, value: parseEther('2') });
        if (!native) {
          const hash = await anvil.writeContract({ account: funder!, chain: foundry, address: token,
            abi: TEST_TOKEN_ABI, functionName: 'mint', args: [account.address, 1000n] });
          await anvil.waitForTransactionReceipt({ hash });
        }
      }
      const amount = native ? 100_000_000_000_000n : 100n;
      await log.journal.append({ t: 'WITHDRAWAL_LOCKED', id: 'payout', owner,
        token: native ? NATIVE : token, amount, to: destination });
      const consumed: string[] = [];
      const released: string[] = [];
      const executor = new Executor({ chain, chainId: foundry.id, signer: keys, inventory,
        journal: log.journal, queue: new FifoSerialQueue(), confirmations: 0n,
        receiptTimeoutMs: 5000, gasMarginPercent: 120n, inventorySettleAttempts: 2,
        ledger: { consume(id) { consumed.push(id); }, release(id) { released.push(id); } } });
      const outcome = await (await executor.runWithdrawal({ id: 'payout', owner,
        token: native ? NATIVE : token, amount, to: destination, status: 'locked' })).finished;
      expect(outcome.status).toBe('confirmed');
      expect(consumed).toEqual(['payout']);
      expect(released).toEqual([]);
      if (outcome.status !== 'confirmed') throw new Error('Payout failed');
      const landed = await chain.getTransaction({ hash: outcome.txHash });
      expect(landed.from.toLowerCase()).toBe(payout.address.toLowerCase());
      expect(await chain.getBalance({ address: linked.address })).toBe(parseEther('2'));
      const received = native ? await chain.getBalance({ address: destination })
        : await chain.readContract({ address: token, abi: TEST_TOKEN_ABI,
          functionName: 'balanceOf', args: [destination] });
      expect(received).toBe(amount);
      const events = log.events.map((event) => event.t);
      expect(events.indexOf('SIGNING_REGISTERED')).toBeLessThan(events.indexOf('SIGNING_COMPLETED'));
      expect(events.indexOf('SIGNING_COMPLETED')).toBeLessThan(events.indexOf('WITHDRAWAL_BROADCAST'));
      const restarted = new KeyManager({ ...options, allowCreate: false });
      await restarted.init();
      await restarted.restoreSigningState();
      expect(restarted.list()).toEqual(keys.list());
      await expect(restarted.registerOp('payout', { eoa: payout.address, to: destination,
        value: amount, dataHash: `0x${'00'.repeat(32)}` })).rejects.toThrow('SIGNING_DENIED');
    });
  }
});
