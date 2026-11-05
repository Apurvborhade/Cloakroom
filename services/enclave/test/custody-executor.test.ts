import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NATIVE } from '@cloakroom/shared';
import { createPublicClient, createTestClient, http, parseEther, publicActions, walletActions } from 'viem';
import type { Address } from 'viem';
import { privateKeyToAddress, generatePrivateKey } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Executor } from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { KeyManager } from '../src/keys.js';
import { FifoSerialQueue } from '../src/queue.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';
import { memoryJournal } from './helpers/memory-journal.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from './fixtures/test-token.js';

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
        eoa: linked.address, expiry: 4_000_000_000 });
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
