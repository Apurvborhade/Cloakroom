import { spawn, type ChildProcess } from 'node:child_process';
import { NATIVE, type CustodyEOA, type JournalEvent, type LockedWithdrawal } from '@cloakroom/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
  http,
  keccak256,
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
  Executor,
  type ExecutorChain,
  type ExpectedTransaction,
  type TransactionSigner,
  type WithdrawalOutcome,
} from '../src/executor.js';
import { Inventory, type InventoryChain } from '../src/inventory.js';
import { TEST_TOKEN_ABI, TEST_TOKEN_BYTECODE } from './fixtures/test-token.js';

const GAS_RESERVE = parseEther('0.01');
const CONFIRMATIONS = 2n;
const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const chain = createPublicClient({
  chain: foundry,
  transport,
  cacheTime: 0,
  pollingInterval: 20,
}) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions)
  .extend(walletActions);

let anvilProcess: ChildProcess;
let token: Address;
let funder: Address;

const freshAddress = () => privateKeyToAddress(generatePrivateKey());

/** Stands in for Felix's KeyManager, with real keys and the signing guard rules from the spec. */
class GuardedSigner implements TransactionSigner {
  readonly keys = new Map<Address, Hex>();
  readonly expected = new Map<string, ExpectedTransaction>();
  readonly signed = new Set<string>();
  refuse = false;

  newEoa(): Address {
    const key = generatePrivateKey();
    const address = privateKeyToAddress(key);
    this.keys.set(address, key);
    return address;
  }

  registerOp(opId: string, expected: ExpectedTransaction): void {
    this.expected.set(opId, expected);
  }

  async sign(
    eoa: Address,
    tx: Parameters<TransactionSigner['sign']>[1],
    opId: string,
  ): Promise<Hex> {
    const expected = this.expected.get(opId);
    if (this.refuse || !expected) throw new Error('SIGNING_REFUSED');
    if (this.signed.has(opId)) throw new Error('ALREADY_SIGNED');
    if (expected.eoa !== eoa || expected.to !== tx.to || expected.value !== tx.value) {
      throw new Error('SIGNING_REFUSED');
    }
    if (expected.dataHash !== keccak256(tx.data ?? '0x')) throw new Error('SIGNING_REFUSED');
    this.signed.add(opId);
    return privateKeyToAccount(this.keys.get(eoa)!).signTransaction(tx);
  }
}

async function fund(eoa: Address, native: bigint, tokenAmount = 0n): Promise<void> {
  await anvil.setBalance({ address: eoa, value: native });
  if (tokenAmount > 0n) {
    const hash = await anvil.writeContract({
      account: funder,
      chain: foundry,
      address: token,
      abi: TEST_TOKEN_ABI,
      functionName: 'mint',
      args: [eoa, tokenAmount],
    });
    await anvil.waitForTransactionReceipt({ hash });
  }
}

const tokenBalance = (address: Address) =>
  chain.readContract({
    address: token,
    abi: TEST_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [address],
  });

interface SetupOptions {
  chainPort?: Partial<ExecutorChain>;
  inventoryChain?: InventoryChain;
  journalFailsOn?: (event: JournalEvent) => boolean;
  receiptTimeoutMs?: number;
}

function setup(eoaCount: number, options: SetupOptions = {}) {
  const signer = new GuardedSigner();
  const eoas: CustodyEOA[] = Array.from({ length: eoaCount }, (_, index) => ({
    index,
    address: signer.newEoa(),
    role: 'inventory',
    lastUsedAt: 0,
  }));
  const inventory = new Inventory({
    chain: options.inventoryChain ?? chain,
    keys: { list: () => eoas },
    tokens: [token],
    gasReserveWei: GAS_RESERVE,
  });
  const journal: JournalEvent[] = [];
  const consumed: string[] = [];
  const released: string[] = [];
  const executor = new Executor({
    chain: { ...chain, ...options.chainPort } as ExecutorChain,
    chainId: foundry.id,
    signer,
    inventory,
    journal: {
      append: async (event) => {
        if (options.journalFailsOn?.(event)) throw new Error('disk full');
        journal.push(event);
        return {} as never;
      },
    },
    ledger: {
      consume: (ref) => void consumed.push(ref),
      release: (ref) => void released.push(ref),
    },
    queue: { run: (op) => op() },
    confirmations: CONFIRMATIONS,
    receiptTimeoutMs: options.receiptTimeoutMs ?? 30_000,
    gasMarginPercent: 120n,
    inventorySettleAttempts: 3,
  });
  return {
    executor,
    inventory,
    signer,
    journal,
    consumed,
    released,
    addresses: eoas.map((eoa) => eoa.address),
  };
}

let nextId = 0;
function withdrawal(overrides: Partial<LockedWithdrawal> = {}): LockedWithdrawal {
  nextId += 1;
  return {
    id: `w${nextId}`,
    owner: freshAddress(),
    token: NATIVE,
    amount: parseEther('0.1'),
    to: freshAddress(),
    status: 'locked',
    ...overrides,
  };
}

/** Mines until the operation finishes. */
async function mineUntilDone(finished: Promise<WithdrawalOutcome>): Promise<WithdrawalOutcome> {
  let done = false;
  const tracked = finished.finally(() => {
    done = true;
  });
  while (!done) {
    await anvil.mine({ blocks: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return tracked;
}

const eventTypes = (journal: JournalEvent[]) => journal.map((event) => event.t);

beforeAll(async () => {
  anvilProcess = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chain.getBlockNumber();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  [funder] = (await anvil.getAddresses()) as [Address];
  const hash = await anvil.deployContract({
    account: funder,
    chain: foundry,
    abi: TEST_TOKEN_ABI,
    bytecode: TEST_TOKEN_BYTECODE,
  });
  token = (await anvil.waitForTransactionReceipt({ hash })).contractAddress!;
}, 15_000);

afterAll(() => {
  anvilProcess?.kill();
});

describe('Executor.runWithdrawal', () => {
  describe('paying out', () => {
    it('sends native ETH to the signed destination, then settles', async () => {
      const { executor, journal, consumed, released, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));
      const request = withdrawal();

      const { finished } = await executor.runWithdrawal(request);
      const outcome = await mineUntilDone(finished);

      expect(outcome.status).toBe('confirmed');
      expect(await chain.getBalance({ address: request.to })).toBe(request.amount);
      expect(consumed).toEqual([request.id]);
      expect(released).toEqual([]);
      expect(eventTypes(journal)).toEqual([
        'WITHDRAWAL_BROADCAST',
        'WITHDRAWAL_CONFIRMED',
        'FEE_BOOKED',
      ]);
    });

    it('sends an ERC-20 through the token contract to the signed destination', async () => {
      const { executor, consumed, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'), 5_000_000n);
      const request = withdrawal({ token, amount: 2_000_000n });

      const { finished } = await executor.runWithdrawal(request);
      const outcome = await mineUntilDone(finished);

      expect(outcome.status).toBe('confirmed');
      expect(await tokenBalance(request.to)).toBe(2_000_000n);
      expect(await tokenBalance(addresses[0]!)).toBe(3_000_000n);
      expect(await chain.getBalance({ address: request.to })).toBe(0n);
      expect(consumed).toEqual([request.id]);
    });

    it('journals the exact hash of the transaction that lands', async () => {
      const { executor, journal, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));

      const { finished } = await executor.runWithdrawal(withdrawal());
      const outcome = await mineUntilDone(finished);

      const broadcast = journal[0];
      if (broadcast?.t !== 'WITHDRAWAL_BROADCAST' || outcome.status !== 'confirmed') {
        throw new Error('expected a confirmed broadcast');
      }
      expect(broadcast.txHash).toBe(outcome.txHash);
      expect(broadcast.txHash).toBe(keccak256(broadcast.raw));
      const receipt = await chain.getTransactionReceipt({ hash: outcome.txHash });
      expect(receipt.from.toLowerCase()).toBe(addresses[0]!.toLowerCase());
    });

    it('journals the broadcast before sending', async () => {
      let journaledBeforeSend = false;
      const context = setup(1, {
        chainPort: {
          sendRawTransaction: (async (args: { serializedTransaction: Hex }) => {
            journaledBeforeSend = eventTypes(context.journal).includes('WITHDRAWAL_BROADCAST');
            return chain.sendRawTransaction(args);
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      await fund(context.addresses[0]!, parseEther('1'));

      const { finished } = await context.executor.runWithdrawal(withdrawal());
      await mineUntilDone(finished);

      expect(journaledBeforeSend).toBe(true);
    });

    it('books the gas actually spent', async () => {
      const { executor, journal, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));

      const { finished } = await executor.runWithdrawal(withdrawal());
      const outcome = await mineUntilDone(finished);

      if (outcome.status !== 'confirmed') throw new Error('expected confirmed');
      const receipt = await chain.getTransactionReceipt({ hash: outcome.txHash });
      expect(journal.at(-1)).toMatchObject({
        t: 'FEE_BOOKED',
        token: NATIVE,
        feeAmount: receipt.gasUsed * receipt.effectiveGasPrice,
      });
    });

    it('does not settle until CONFIRMATIONS blocks have passed', async () => {
      const { executor, journal, consumed, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));
      const request = withdrawal();

      const { finished } = await executor.runWithdrawal(request);
      await expect.poll(() => eventTypes(journal).includes('WITHDRAWAL_BROADCAST')).toBe(true);
      await expect
        .poll(() => chain.getBalance({ address: request.to }))
        .toBe(request.amount);

      await anvil.mine({ blocks: 1 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(consumed).toEqual([]);

      await anvil.mine({ blocks: 1 });
      await finished;
      expect(consumed).toEqual([request.id]);
    });

    it('uses consecutive nonces for later payouts from the same EOA', async () => {
      const { executor, journal, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));

      for (let round = 0; round < 3; round++) {
        const { finished } = await executor.runWithdrawal(withdrawal());
        expect((await mineUntilDone(finished)).status).toBe('confirmed');
      }

      const nonces = journal.flatMap((event) =>
        event.t === 'WITHDRAWAL_BROADCAST' ? [event.nonce] : [],
      );
      expect(nonces).toEqual([0, 1, 2]);
    });

    it('keeps its own nonce count when the node reports a stale one', async () => {
      const { executor, journal, addresses } = setup(1, {
        chainPort: {
          getTransactionCount: (async () => 0) as ExecutorChain['getTransactionCount'],
        },
      });
      await fund(addresses[0]!, parseEther('1'));

      for (let round = 0; round < 2; round++) {
        const { finished } = await executor.runWithdrawal(withdrawal());
        expect((await mineUntilDone(finished)).status).toBe('confirmed');
      }

      const nonces = journal.flatMap((event) =>
        event.t === 'WITHDRAWAL_BROADCAST' ? [event.nonce] : [],
      );
      expect(nonces).toEqual([0, 1]);
    });

    it('makes the EOA available again, with the spent funds gone', async () => {
      const { executor, inventory, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));

      const { finished } = await executor.runWithdrawal(
        withdrawal({ amount: parseEther('0.9') }),
      );
      await mineUntilDone(finished);

      expect(inventory.pick(NATIVE, parseEther('0.5'), new Set())).toBeNull();
      expect(inventory.pick(NATIVE, parseEther('0.05'), new Set())).not.toBeNull();
    });
  });

  describe('choosing the EOA', () => {
    it('prefers an EOA without the owner’s swap history', async () => {
      const { executor, inventory, addresses } = setup(2);
      await fund(addresses[0]!, parseEther('1'));
      await fund(addresses[1]!, parseEther('1'));
      const request = withdrawal();
      inventory.linkOwner(request.owner, addresses[0]!);

      const { finished } = await executor.runWithdrawal(request);
      const outcome = await mineUntilDone(finished);

      if (outcome.status !== 'confirmed') throw new Error('expected confirmed');
      const receipt = await chain.getTransactionReceipt({ hash: outcome.txHash });
      expect(receipt.from.toLowerCase()).toBe(addresses[1]!.toLowerCase());
    });

    it('rejects when the only funded EOA received the owner’s deposit', async () => {
      const { executor, inventory, released, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));
      const request = withdrawal();
      inventory.linkDeposit(request.owner, addresses[0]!);

      await expect(executor.runWithdrawal(request)).rejects.toThrow('NO_INVENTORY');
      expect(released).toEqual([request.id]);
    });

    it('pays USDC from unrelated deposits before falling back to the owner’s swap address', async () => {
      const { executor, inventory, addresses } = setup(3);
      const [own, swapped, unrelated] = addresses as [Address, Address, Address];
      await fund(own, parseEther('1'), 100_000_000n);
      await fund(swapped, parseEther('1'), 100_000_000n);
      await fund(unrelated, parseEther('1'), 10_000_000n);
      const first = withdrawal({ token, amount: 10_000_000n });
      inventory.linkDeposit(first.owner, own);
      inventory.linkOwner(first.owner, swapped);

      const paid = await mineUntilDone((await executor.runWithdrawal(first)).finished);
      if (paid.status !== 'confirmed') throw new Error('expected confirmed');
      expect((await chain.getTransactionReceipt({ hash: paid.txHash })).from.toLowerCase()).toBe(unrelated.toLowerCase());

      const second = withdrawal({ owner: first.owner, token, amount: 10_000_000n });
      const fallback = await mineUntilDone((await executor.runWithdrawal(second)).finished);
      if (fallback.status !== 'confirmed') throw new Error('expected confirmed');
      expect((await chain.getTransactionReceipt({ hash: fallback.txHash })).from.toLowerCase()).toBe(swapped.toLowerCase());
    });

    it('rejects cleanly and releases the lock when no single EOA holds enough', async () => {
      const { executor, journal, consumed, released, addresses } = setup(2);
      await fund(addresses[0]!, parseEther('0.6'));
      await fund(addresses[1]!, parseEther('0.6'));
      const request = withdrawal({ amount: parseEther('1') });

      await expect(executor.runWithdrawal(request)).rejects.toThrow('NO_INVENTORY');

      expect(released).toEqual([request.id]);
      expect(consumed).toEqual([]);
      expect(journal).toEqual([
        { t: 'WITHDRAWAL_FAILED', id: request.id, owner: request.owner, reason: 'NO_INVENTORY' },
      ]);
    });

    it('releases the lock when balances cannot be read', async () => {
      const failingChain = {
        ...chain,
        getBlockNumber: async () => {
          throw new Error('rpc down');
        },
      } as unknown as InventoryChain;
      const { executor, released } = setup(1, { inventoryChain: failingChain });
      const request = withdrawal();

      await expect(executor.runWithdrawal(request)).rejects.toThrow('NO_INVENTORY');
      expect(released).toEqual([request.id]);
    });

    it('gives concurrent payouts different EOAs', async () => {
      const { executor, addresses } = setup(2);
      await fund(addresses[0]!, parseEther('1'));
      await fund(addresses[1]!, parseEther('1'));

      const [first, second] = await Promise.all([
        executor.runWithdrawal(withdrawal()),
        executor.runWithdrawal(withdrawal()),
      ]);
      const outcomes = await Promise.all([
        mineUntilDone(first.finished),
        mineUntilDone(second.finished),
      ]);

      const senders = await Promise.all(
        outcomes.map(async (outcome) => {
          if (outcome.status !== 'confirmed') throw new Error('expected confirmed');
          return (await chain.getTransactionReceipt({ hash: outcome.txHash })).from;
        }),
      );
      expect(new Set(senders).size).toBe(2);
    });

    it('rejects a concurrent payout when the only EOA is busy', async () => {
      const { executor, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));

      const results = await Promise.allSettled([
        executor.runWithdrawal(withdrawal()),
        executor.runWithdrawal(withdrawal()),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
      const started = results.find((result) => result.status === 'fulfilled');
      if (started?.status !== 'fulfilled') throw new Error('expected one to start');
      await mineUntilDone(started.value.finished);
    });
  });

  describe('when something goes wrong', () => {
    it('releases the funds when the transaction reverts on-chain', async () => {
      const revertingContract = freshAddress();
      await anvil.setCode({ address: revertingContract, bytecode: '0x60006000fd' });
      const { executor, inventory, journal, consumed, released, addresses } = setup(1, {
        chainPort: {
          estimateGas: (async () => 100_000n) as ExecutorChain['estimateGas'],
        },
      });
      await fund(addresses[0]!, parseEther('1'));
      const request = withdrawal({ to: revertingContract });

      const { finished } = await executor.runWithdrawal(request);
      const outcome = await mineUntilDone(finished);

      expect(outcome).toMatchObject({ status: 'failed', reason: 'REVERTED' });
      expect(released).toEqual([request.id]);
      expect(consumed).toEqual([]);
      expect(eventTypes(journal)).toEqual([
        'WITHDRAWAL_BROADCAST',
        'WITHDRAWAL_FAILED',
        'FEE_BOOKED',
      ]);
      expect(inventory.pick(NATIVE, 1n, new Set())).not.toBeNull();
    });

    it('releases the funds and sends nothing when signing is refused', async () => {
      const { executor, inventory, signer, journal, released, addresses } = setup(1);
      await fund(addresses[0]!, parseEther('1'));
      const nonceBefore = await chain.getTransactionCount({ address: addresses[0]! });
      signer.refuse = true;
      const request = withdrawal();

      const { finished } = await executor.runWithdrawal(request);
      const outcome = await finished;

      expect(outcome).toEqual({ status: 'failed', reason: 'PREPARE_FAILED' });
      expect(released).toEqual([request.id]);
      expect(eventTypes(journal)).toEqual(['WITHDRAWAL_FAILED']);
      expect(await chain.getTransactionCount({ address: addresses[0]! })).toBe(nonceBefore);
      expect(inventory.pick(NATIVE, 1n, new Set())).not.toBeNull();
    });

    it('does not send when the broadcast cannot be journaled', async () => {
      let sent = false;
      const { executor, released, addresses } = setup(1, {
        journalFailsOn: (event) => event.t === 'WITHDRAWAL_BROADCAST',
        chainPort: {
          sendRawTransaction: (async () => {
            sent = true;
            return '0x' as Hex;
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      await fund(addresses[0]!, parseEther('1'));
      const request = withdrawal();

      const { finished } = await executor.runWithdrawal(request);

      await expect(finished).resolves.toMatchObject({ status: 'failed' });
      expect(sent).toBe(false);
      expect(released).toEqual([request.id]);
    });

    it('keeps the funds reserved if the journal is completely unavailable', async () => {
      let sent = false;
      const { executor, released, addresses } = setup(1, {
        journalFailsOn: () => true,
        chainPort: {
          sendRawTransaction: (async () => {
            sent = true;
            return '0x' as Hex;
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      await fund(addresses[0]!, parseEther('1'));

      const { finished } = await executor.runWithdrawal(withdrawal());

      await expect(finished).rejects.toThrow('disk full');
      expect(sent).toBe(false);
      expect(released).toEqual([]);
    });

    it('still settles when a send reports an error but the transaction landed', async () => {
      const { executor, consumed, released, addresses } = setup(1, {
        chainPort: {
          sendRawTransaction: (async (args: { serializedTransaction: Hex }) => {
            await chain.sendRawTransaction(args);
            throw new Error('connection reset');
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      await fund(addresses[0]!, parseEther('1'));
      const request = withdrawal();

      const { finished } = await executor.runWithdrawal(request);
      const outcome = await mineUntilDone(finished);

      expect(outcome.status).toBe('confirmed');
      expect(consumed).toEqual([request.id]);
      expect(released).toEqual([]);
    });

    it('keeps funds reserved and the EOA busy when the result is unknown', async () => {
      const { executor, inventory, consumed, released, addresses } = setup(1, {
        receiptTimeoutMs: 200,
        chainPort: {
          sendRawTransaction: (async () => {
            throw new Error('dropped');
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      await fund(addresses[0]!, parseEther('1'));

      const { finished } = await executor.runWithdrawal(withdrawal());
      const outcome = await finished;

      expect(outcome.status).toBe('unresolved');
      expect(consumed).toEqual([]);
      expect(released).toEqual([]);
      expect(inventory.pick(NATIVE, 1n, new Set())).toBeNull();
    });

    it('keeps the EOA busy after settling if balances cannot be refreshed', async () => {
      let failing = false;
      const inventoryChain = {
        ...chain,
        getBlockNumber: (async (args?: Parameters<PublicClient['getBlockNumber']>[0]) => {
          if (failing) throw new Error('rpc down');
          return chain.getBlockNumber(args);
        }) as PublicClient['getBlockNumber'],
      } as InventoryChain;
      const context = setup(1, {
        inventoryChain,
        chainPort: {
          waitForTransactionReceipt: (async (
            args: Parameters<PublicClient['waitForTransactionReceipt']>[0],
          ) => {
            const receipt = await chain.waitForTransactionReceipt(args);
            failing = true;
            return receipt;
          }) as ExecutorChain['waitForTransactionReceipt'],
        },
      });
      await fund(context.addresses[0]!, parseEther('1'));

      const { finished } = await context.executor.runWithdrawal(withdrawal());
      const outcome = await mineUntilDone(finished);

      expect(outcome.status).toBe('confirmed');
      expect(context.inventory.pick(NATIVE, 1n, new Set())).toBeNull();
    });
  });

  it('lowers on-chain totals by the payout and gas', async () => {
    const { executor, inventory, addresses } = setup(1);
    await fund(addresses[0]!, parseEther('1'));
    const before = (await inventory.getPhysicalBalances()).get(NATIVE)!;
    const request = withdrawal();

    const { finished } = await executor.runWithdrawal(request);
    const outcome = await mineUntilDone(finished);

    if (outcome.status !== 'confirmed') throw new Error('expected confirmed');
    const receipt = await chain.getTransactionReceipt({ hash: outcome.txHash });
    const gas = receipt.gasUsed * receipt.effectiveGasPrice;
    expect((await inventory.getPhysicalBalances()).get(NATIVE)).toBe(before - request.amount - gas);
  });
});
