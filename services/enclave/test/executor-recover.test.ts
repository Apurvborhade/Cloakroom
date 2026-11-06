import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NATIVE,
  type CustodyEOA,
  type IntentStatus,
  type JournalEvent,
  type LockedWithdrawal,
  type StoredIntent,
} from '@cloakroom/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createTestClient,
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
  Executor,
  type ExecutorChain,
  type ExpectedTransaction,
  type RecoveredOperation,
  type TransactionSigner,
} from '../src/executor.js';
import { Inventory } from '../src/inventory.js';
import { EncryptedJournal } from '../src/journal.js';
import { InMemoryLedger, replayLedger } from '../src/ledger.js';
import { FifoSerialQueue } from '../src/queue.js';
import type { Quote, QuoteRequest } from '../src/uniswap.js';
import {
  TEST_SWAP_ROUTER_ABI,
  TEST_SWAP_ROUTER_BYTECODE,
  TEST_SWAP_TOKEN_ABI,
} from './fixtures/test-swap-router.js';

const GAS_RESERVE = parseEther('0.01');
const PAYOUT = parseEther('0.1');
const SWAP_IN = parseEther('0.1');
const AMOUNT_OUT = 2_630_992_794n;
const FEE_BPS = 10;
const THIS: Address = '0x0000000000000000000000000000000000000002';
const ROUTER_EXECUTE = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);

const PORT = 20000 + Math.floor(Math.random() * 20000);
const transport = http(`http://127.0.0.1:${PORT}`);
const chain = createPublicClient({ chain: foundry, transport, cacheTime: 0, pollingInterval: 20 }) as PublicClient;
const anvil = createTestClient({ chain: foundry, mode: 'anvil', transport })
  .extend(publicActions)
  .extend(walletActions);

let anvilProcess: ChildProcess;
let directory: string;
let sender: Address;
let router: Address;
let token: Address;
const openJournals: EncryptedJournal[] = [];

const freshAddress = () => privateKeyToAddress(generatePrivateKey());
const dropSend = (async () => {
  throw new Error('dropped');
}) as ExecutorChain['sendRawTransaction'];
const crashBeforeReceipt = (async () => {
  throw new Error('crashed');
}) as ExecutorChain['waitForTransactionReceipt'];

class Signer implements TransactionSigner {
  readonly keys = new Map<Address, Hex>();
  readonly signed: string[] = [];
  readonly expected = new Map<string, ExpectedTransaction>();

  newEoa(): Address {
    const key = generatePrivateKey();
    const address = privateKeyToAddress(key);
    this.keys.set(address, key);
    return address;
  }

  registerOp(opId: string, expected: ExpectedTransaction): void {
    this.expected.set(opId, expected);
  }

  async sign(eoa: Address, tx: Parameters<TransactionSigner['sign']>[1], opId: string): Promise<Hex> {
    if (!this.expected.has(opId) || this.signed.includes(opId)) throw new Error('SIGNING_REFUSED');
    this.signed.push(opId);
    return privateKeyToAccount(this.keys.get(eoa)!).signTransaction(tx);
  }
}

async function configureRouter(amountOut: bigint, shouldRevert: boolean): Promise<void> {
  const hash = await anvil.writeContract({
    account: sender,
    chain: foundry,
    address: router,
    abi: TEST_SWAP_ROUTER_ABI,
    functionName: 'configure',
    args: [amountOut, shouldRevert],
  });
  await anvil.waitForTransactionReceipt({ hash });
}

/** Everything that lives on disk or on-chain, and so survives a restart. */
interface World {
  signer: Signer;
  eoas: CustodyEOA[];
  filePath: string;
  key: Buffer;
}

async function newWorld(eoaCount = 1): Promise<World> {
  const signer = new Signer();
  const eoas: CustodyEOA[] = Array.from({ length: eoaCount }, (_, index) => ({
    index,
    address: signer.newEoa(),
    role: 'inventory',
    lastUsedAt: 0,
  }));
  for (const eoa of eoas) await anvil.setBalance({ address: eoa.address, value: parseEther('1') });
  return { signer, eoas, filePath: join(directory, `${Math.random()}.journal`), key: randomBytes(32) };
}

function quoter(hook?: (request: QuoteRequest, quote: Quote) => Quote) {
  return {
    quote: async (request: QuoteRequest): Promise<Quote> => {
      const minAmountOut = (AMOUNT_OUT * 9950n) / 10_000n;
      const quote: Quote = {
        amountIn: request.amountIn,
        amountOut: AMOUNT_OUT,
        minAmountOut,
        transaction: {
          to: router,
          from: request.swapper,
          value: request.amountIn,
          data: encodeFunctionData({
            abi: ROUTER_EXECUTE,
            functionName: 'execute',
            args: [
              '0x0b0004',
              [
                encodeAbiParameters(parseAbiParameters('address, uint256'), [THIS, request.amountIn]),
                encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
                  THIS,
                  request.amountIn,
                  0n,
                  '0x00',
                  false,
                ]),
                encodeAbiParameters(parseAbiParameters('address, address, uint256'), [
                  token,
                  request.swapper,
                  minAmountOut,
                ]),
              ],
              99_999_999_999n,
            ],
          }),
        },
      };
      return hook ? hook(request, quote) : quote;
    },
  };
}

/** Boots a process the way the enclave must: journal, then ledger, then inventory, then executor. */
async function boot(world: World, chainPort: Partial<ExecutorChain> = {}, withSwaps = true) {
  const journal = new EncryptedJournal({ filePath: world.filePath, key: world.key });
  openJournals.push(journal);
  const ledger = await replayLedger(journal);
  const inventory = new Inventory({
    chain,
    keys: { list: () => world.eoas },
    tokens: [token],
    gasReserveWei: GAS_RESERVE,
  });
  for await (const { event } of journal.replay()) inventory.replay(event);
  const marks: Array<{ id: string; status: IntentStatus }> = [];
  const executor = new Executor({
    chain: { ...chain, ...chainPort } as ExecutorChain,
    chainId: foundry.id,
    signer: world.signer,
    inventory,
    journal,
    ledger,
    queue: new FifoSerialQueue(),
    confirmations: 2n,
    receiptTimeoutMs: chainPort.waitForTransactionReceipt ? 1 : 5_000,
    gasMarginPercent: 120n,
    inventorySettleAttempts: 3,
    swaps: withSwaps
      ? {
          quoter: quoter(),
          intents: { mark: (id, status) => void marks.push({ id, status }) },
          ledger,
          routerAddress: router,
          tokenOut: token,
          tokenOutDecimals: 6,
          feeBps: FEE_BPS,
          maxSlippageBpsCap: 100,
        }
      : undefined,
  });
  return { executor, inventory, journal, ledger, marks };
}

type Booted = Awaited<ReturnType<typeof boot>>;

async function append(booted: Booted, events: readonly JournalEvent[]) {
  for (const event of events) {
    await booted.journal.append(event);
    booted.ledger.apply(event);
  }
}

function newWithdrawal(id = 'w1'): LockedWithdrawal {
  return { id, owner: freshAddress(), token: NATIVE, amount: PAYOUT, to: freshAddress(), status: 'locked' };
}

async function lockWithdrawal(booted: Booted, withdrawal: LockedWithdrawal) {
  await append(booted, [
    { t: 'DEPOSIT_CREDITED', id: `d-${withdrawal.id}`, owner: withdrawal.owner, amount: withdrawal.amount, block: 1n },
    {
      t: 'WITHDRAWAL_LOCKED',
      id: withdrawal.id,
      owner: withdrawal.owner,
      token: withdrawal.token,
      amount: withdrawal.amount,
      to: withdrawal.to,
    },
  ]);
}

async function createIntent(booted: Booted, id = 'i1'): Promise<StoredIntent> {
  const owner = freshAddress();
  const intent: StoredIntent['intent'] = {
    owner,
    tokenIn: NATIVE,
    tokenOut: token,
    amountIn: SWAP_IN,
    comparator: 0,
    triggerPrice: 1n,
    maxSlippageBps: 50,
    nonce: 1n,
    expiry: 99_999_999_999n,
  };
  await append(booted, [
    { t: 'DEPOSIT_CREDITED', id: `d-${id}`, owner, amount: SWAP_IN, block: 1n },
    { t: 'INTENT_CREATED', id, owner, intent },
  ]);
  return { id, owner, intent, status: 'pending', createdAt: 0 };
}

/** Runs a withdrawal up to the point where the process dies, then closes its journal. */
async function crashDuringWithdrawal(world: World, port: Partial<ExecutorChain>, withdrawal = newWithdrawal()) {
  const first = await boot(world, port);
  await lockWithdrawal(first, withdrawal);
  const { finished } = await first.executor.runWithdrawal(withdrawal);
  expect((await finished).status).toBe('unresolved');
  await first.journal.close();
  return withdrawal;
}

async function crashDuringSwap(world: World, port: Partial<ExecutorChain>) {
  const first = await boot(world, port);
  const stored = await createIntent(first);
  expect((await first.executor.runIntent(stored)).status).toBe('unresolved');
  await first.journal.close();
  return stored;
}

async function recoverFrom(booted: Booted): Promise<RecoveredOperation[]> {
  const running = booted.executor.recover(booted.journal.replay());
  let done = false;
  const tracked = running.finally(() => {
    done = true;
  });
  while (!done) {
    await anvil.mine({ blocks: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return tracked;
}

async function eventTypes(journal: EncryptedJournal): Promise<string[]> {
  const types: string[] = [];
  for await (const { event } of journal.replay()) types.push(event.t);
  return types;
}

const countOf = (types: string[], type: string) => types.filter((t) => t === type).length;
const nonceOf = (world: World, index = 0) =>
  chain.getTransactionCount({ address: world.eoas[index]!.address });

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cloakroom-recover-'));
  anvilProcess = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await chain.getBlockNumber();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  [sender] = (await anvil.getAddresses()) as [Address];
  const hash = await anvil.deployContract({
    account: sender,
    chain: foundry,
    abi: TEST_SWAP_ROUTER_ABI,
    bytecode: TEST_SWAP_ROUTER_BYTECODE,
  });
  router = getAddress((await anvil.waitForTransactionReceipt({ hash })).contractAddress!);
  token = await chain.readContract({ address: router, abi: TEST_SWAP_ROUTER_ABI, functionName: 'token' });
  await configureRouter(AMOUNT_OUT, false);
}, 15_000);

afterEach(async () => {
  for (const journal of openJournals.splice(0)) await journal.close().catch(() => {});
});

afterAll(() => {
  anvilProcess?.kill();
  rmSync(directory, { recursive: true, force: true });
});

describe('Executor.recover', () => {
  describe('killed after a withdrawal was sent', () => {
    it('settles it once, and pays the recipient only once', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });
      expect(await nonceOf(world)).toBe(1);

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([{ opId: withdrawal.id, status: 'settled' }]);
      expect(await chain.getBalance({ address: withdrawal.to })).toBe(PAYOUT);
      expect(await nonceOf(world)).toBe(1);
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE)).toMatchObject({ available: 0n, reserved: 0n });
      expect(world.signer.signed).toEqual([withdrawal.id]);
      const types = await eventTypes(second.journal);
      expect(countOf(types, 'WITHDRAWAL_BROADCAST')).toBe(1);
      expect(countOf(types, 'WITHDRAWAL_CONFIRMED')).toBe(1);
      expect(countOf(types, 'FEE_BOOKED')).toBe(1);
    });

    it('waits for confirmations before settling', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });
      const second = await boot(world);

      const running = second.executor.recover(second.journal.replay());
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE).reserved).toBe(PAYOUT);

      await anvil.mine({ blocks: 2 });
      await running;
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE).reserved).toBe(0n);
    });

    it('matches a ledger rebuilt from the journal', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world);
      await recoverFrom(second);

      const rebuilt = await replayLedger(second.journal);
      expect(rebuilt.getBalance(withdrawal.owner, NATIVE)).toEqual(second.ledger.getBalance(withdrawal.owner, NATIVE));
      expect(rebuilt.getOperationalGasSpent(NATIVE)).toBe(second.ledger.getOperationalGasSpent(NATIVE));
      expect(rebuilt.getOperationalGasSpent(NATIVE)).toBeGreaterThan(0n);
    });

    it('frees the EOA afterwards, with the spent funds gone', async () => {
      const world = await newWorld();
      await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world);
      await recoverFrom(second);

      expect(second.inventory.pick(NATIVE, parseEther('0.95'), new Set())).toBeNull();
      expect(second.inventory.pick(NATIVE, parseEther('0.5'), new Set())).not.toBeNull();
    });
  });

  describe('killed after journaling, before the transaction was sent', () => {
    it('sends the identical transaction, and settles once', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, {
        sendRawTransaction: dropSend,
        waitForTransactionReceipt: crashBeforeReceipt,
      });
      expect(await nonceOf(world)).toBe(0);

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([{ opId: withdrawal.id, status: 'settled' }]);
      expect(await chain.getBalance({ address: withdrawal.to })).toBe(PAYOUT);
      expect(await nonceOf(world)).toBe(1);
      expect(world.signer.signed).toEqual([withdrawal.id]);
    });
  });

  describe('a transaction that reverted while the enclave was down', () => {
    it('releases the funds and books the gas', async () => {
      const world = await newWorld();
      const reverting = freshAddress();
      await anvil.setCode({ address: reverting, bytecode: '0x60006000fd' });
      const withdrawal = { ...newWithdrawal(), to: reverting };
      await crashDuringWithdrawal(
        world,
        {
          estimateGas: (async () => 100_000n) as ExecutorChain['estimateGas'],
          waitForTransactionReceipt: crashBeforeReceipt,
        },
        withdrawal,
      );

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([{ opId: withdrawal.id, status: 'failed' }]);
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE)).toMatchObject({ available: PAYOUT, reserved: 0n });
      expect(second.ledger.getOperationalGasSpent(NATIVE)).toBeGreaterThan(0n);
    });
  });

  describe('a nonce that moved with no receipt', () => {
    async function crashThenReplaceNonce() {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, {
        sendRawTransaction: dropSend,
        waitForTransactionReceipt: crashBeforeReceipt,
      });
      const key = world.signer.keys.get(world.eoas[0]!.address)!;
      const raw = await privateKeyToAccount(key).signTransaction({
        chainId: foundry.id,
        type: 'eip1559',
        nonce: 0,
        to: freshAddress(),
        value: 1n,
        gas: 21_000n,
        maxFeePerGas: 100_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      });
      const hash = await chain.sendRawTransaction({ serializedTransaction: raw });
      await chain.waitForTransactionReceipt({ hash });
      return { world, withdrawal };
    }

    it('flags it for review, and keeps the funds reserved and the EOA busy', async () => {
      const { world, withdrawal } = await crashThenReplaceNonce();

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([{ opId: withdrawal.id, status: 'review' }]);
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE)).toMatchObject({ available: 0n, reserved: PAYOUT });
      expect(second.inventory.pick(NATIVE, 1n, new Set())).toBeNull();
      expect(await chain.getBalance({ address: withdrawal.to })).toBe(0n);
      expect(await eventTypes(second.journal)).not.toContain('WITHDRAWAL_FAILED');
    });

    it('never sends the old transaction again', async () => {
      const { world } = await crashThenReplaceNonce();
      let sends = 0;

      const second = await boot(world, {
        sendRawTransaction: (async () => {
          sends += 1;
          return '0x' as Hex;
        }) as ExecutorChain['sendRawTransaction'],
      });
      await recoverFrom(second);

      expect(sends).toBe(0);
    });
  });

  describe('a withdrawal locked but never broadcast', () => {
    it('releases the funds, because nothing can have been sent', async () => {
      const world = await newWorld();
      const first = await boot(world);
      const withdrawal = newWithdrawal();
      await lockWithdrawal(first, withdrawal);
      await first.journal.close();

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([{ opId: withdrawal.id, status: 'released' }]);
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE)).toMatchObject({ available: PAYOUT, reserved: 0n });
      expect(await eventTypes(second.journal)).toContain('WITHDRAWAL_FAILED');
      expect(await nonceOf(world)).toBe(0);
    });
  });

  describe('when the chain cannot be reached', () => {
    const rpcDown = {
      getTransactionCount: (async () => {
        throw new Error('rpc down');
      }) as ExecutorChain['getTransactionCount'],
    };

    it('still settles when resending reports an error but the node has it', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, {
        sendRawTransaction: dropSend,
        waitForTransactionReceipt: crashBeforeReceipt,
      });

      const second = await boot(world, {
        sendRawTransaction: (async (args: { serializedTransaction: Hex }) => {
          await chain.sendRawTransaction(args);
          throw new Error('already known');
        }) as ExecutorChain['sendRawTransaction'],
      });

      expect(await recoverFrom(second)).toEqual([{ opId: withdrawal.id, status: 'settled' }]);
    });

    it('stays unresolved with funds held, then settles on the next boot', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world, rpcDown);
      expect(await recoverFrom(second)).toEqual([{ opId: withdrawal.id, status: 'unresolved' }]);
      expect(second.ledger.getBalance(withdrawal.owner, NATIVE).reserved).toBe(PAYOUT);
      await second.inventory.refresh();
      expect(second.inventory.pick(NATIVE, 1n, new Set())).toBeNull();
      await second.journal.close();

      const third = await boot(world);
      expect(await recoverFrom(third)).toEqual([{ opId: withdrawal.id, status: 'settled' }]);
      expect(await chain.getBalance({ address: withdrawal.to })).toBe(PAYOUT);
    });

    it('stays unresolved when a receipt lookup fails for another reason', async () => {
      const world = await newWorld();
      const withdrawal = await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });
      let sends = 0;

      const second = await boot(world, {
        getTransactionReceipt: (async () => {
          throw new Error('rpc down');
        }) as ExecutorChain['getTransactionReceipt'],
        sendRawTransaction: (async () => {
          sends += 1;
          return '0x' as Hex;
        }) as ExecutorChain['sendRawTransaction'],
      });

      expect(await recoverFrom(second)).toEqual([{ opId: withdrawal.id, status: 'unresolved' }]);
      expect(sends).toBe(0);
    });

    it('holds funds before the first network call', async () => {
      const world = await newWorld();
      await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });
      const second = await boot(world);
      await second.inventory.refresh();
      let heldWhenFirstCalled: boolean | undefined;
      const third = new Executor({
        chain: {
          ...chain,
          getTransactionCount: (async () => {
            heldWhenFirstCalled ??= second.inventory.pick(NATIVE, 1n, new Set()) === null;
            throw new Error('stop');
          }) as ExecutorChain['getTransactionCount'],
        } as ExecutorChain,
        chainId: foundry.id,
        signer: world.signer,
        inventory: second.inventory,
        journal: second.journal,
        ledger: second.ledger,
        queue: new FifoSerialQueue(),
        confirmations: 2n,
        receiptTimeoutMs: 1,
        gasMarginPercent: 120n,
        inventorySettleAttempts: 1,
      });

      await third.recover(second.journal.replay());

      expect(heldWhenFirstCalled).toBe(true);
    });
  });

  describe('work that already finished', () => {
    it('leaves a settled withdrawal alone', async () => {
      const world = await newWorld();
      const first = await boot(world);
      const withdrawal = newWithdrawal();
      await lockWithdrawal(first, withdrawal);
      const { finished } = await first.executor.runWithdrawal(withdrawal);
      let done = false;
      void finished.finally(() => {
        done = true;
      });
      while (!done) {
        await anvil.mine({ blocks: 1 });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await first.journal.close();
      const before = await eventTypes((await boot(world)).journal);

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([]);
      expect(await eventTypes(second.journal)).toEqual(before);
      expect(await nonceOf(world)).toBe(1);
    });

    it('does nothing the second time', async () => {
      const world = await newWorld();
      await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world);
      await recoverFrom(second);
      const after = await eventTypes(second.journal);
      await second.journal.close();

      const third = await boot(world);
      expect(await recoverFrom(third)).toEqual([]);
      expect(await eventTypes(third.journal)).toEqual(after);
    });

    it('does nothing with an empty journal', async () => {
      const second = await boot(await newWorld());

      expect(await recoverFrom(second)).toEqual([]);
    });
  });

  describe('nonces after a restart', () => {
    it('continues from the journal when the node reports a stale count', async () => {
      const world = await newWorld();
      await crashDuringWithdrawal(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world, {
        getTransactionCount: (async (args: { blockTag?: string }) =>
          args.blockTag === 'pending' ? 0 : 1) as ExecutorChain['getTransactionCount'],
      });
      await recoverFrom(second);
      const next = newWithdrawal('w2');
      await lockWithdrawal(second, next);
      const { finished } = await second.executor.runWithdrawal(next);
      let done = false;
      void finished.finally(() => {
        done = true;
      });
      while (!done) {
        await anvil.mine({ blocks: 1 });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect((await finished).status).toBe('confirmed');
      expect(await nonceOf(world)).toBe(2);
    });
  });

  describe('killed during a swap', () => {
    it('settles once from the receipt, with the same result as a normal swap', async () => {
      const world = await newWorld();
      const stored = await crashDuringSwap(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world);
      const report = await recoverFrom(second);

      const fee = (AMOUNT_OUT * BigInt(FEE_BPS)) / 10_000n;
      expect(report).toEqual([{ opId: `exec:${stored.id}`, status: 'settled' }]);
      expect(second.ledger.getBalance(stored.owner, token).available).toBe(AMOUNT_OUT - fee);
      expect(second.ledger.getBalance(stored.owner, NATIVE).reserved).toBe(0n);
      expect(second.ledger.getProtocolRevenue(token)).toBe(fee);
      expect(await nonceOf(world)).toBe(1);
      expect(
        await chain.readContract({
          address: token,
          abi: TEST_SWAP_TOKEN_ABI,
          functionName: 'balanceOf',
          args: [world.eoas[0]!.address],
        }),
      ).toBe(AMOUNT_OUT);
      expect(second.marks.map((mark) => mark.status)).toEqual(['executing', 'done']);
      const rebuilt = await replayLedger(second.journal);
      expect(rebuilt.getBalance(stored.owner, token)).toEqual(second.ledger.getBalance(stored.owner, token));
    });

    it('sends the identical swap if it never went out, and settles once', async () => {
      const world = await newWorld();
      const stored = await crashDuringSwap(world, {
        sendRawTransaction: dropSend,
        waitForTransactionReceipt: crashBeforeReceipt,
      });
      expect(await nonceOf(world)).toBe(0);

      const second = await boot(world);
      expect(await recoverFrom(second)).toEqual([{ opId: `exec:${stored.id}`, status: 'settled' }]);
      expect(await nonceOf(world)).toBe(1);
      expect(world.signer.signed).toEqual([`exec:${stored.id}`]);
    });

    it('marks an unfinished swap executing, and refuses to run it again', async () => {
      const world = await newWorld();
      const stored = await crashDuringSwap(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world, {
        getTransactionCount: (async () => {
          throw new Error('rpc down');
        }) as ExecutorChain['getTransactionCount'],
      });
      expect(await recoverFrom(second)).toEqual([{ opId: `exec:${stored.id}`, status: 'unresolved' }]);

      expect(second.marks).toEqual([{ id: stored.id, status: 'executing' }]);
      expect(await second.executor.runIntent(stored)).toEqual({ status: 'pending', reason: 'ALREADY_RUNNING' });
    });

    it('links the EOA to the owner, so their later operations avoid it', async () => {
      const world = await newWorld();
      const stored = await crashDuringSwap(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world);
      await recoverFrom(second);

      expect([...second.inventory.eoasLinkedTo(stored.owner)]).toEqual([world.eoas[0]!.address]);
    });

    it('holds the EOA while the swap result is unknown', async () => {
      const world = await newWorld();
      await crashDuringSwap(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world, {
        getTransactionCount: (async () => {
          throw new Error('rpc down');
        }) as ExecutorChain['getTransactionCount'],
      });
      await recoverFrom(second);
      await second.inventory.refresh();

      expect(second.inventory.pick(NATIVE, 1n, new Set())).toBeNull();
    });

    it('does nothing the second time', async () => {
      const world = await newWorld();
      await crashDuringSwap(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world);
      await recoverFrom(second);
      const after = await eventTypes(second.journal);
      await second.journal.close();

      const third = await boot(world);
      expect(await recoverFrom(third)).toEqual([]);
      expect(await eventTypes(third.journal)).toEqual(after);
      expect(third.marks).toEqual([]);
      expect(await nonceOf(world)).toBe(1);
    });

    it('leaves a swap alone if it had already failed', async () => {
      const world = await newWorld();
      const first = await boot(world);
      const stored = await createIntent(first);
      await append(first, [
        { t: 'EXEC_BROADCAST', opId: `exec:${stored.id}`, eoa: world.eoas[0]!.address, nonce: 0, txHash: `0x${'1'.repeat(64)}`, raw: '0x', intentId: stored.id },
        { t: 'EXEC_FAILED', opId: `exec:${stored.id}`, intentId: stored.id, owner: stored.owner, reason: 'REVERTED' },
      ]);
      await first.journal.close();

      const second = await boot(world);

      expect(await recoverFrom(second)).toEqual([]);
      expect(second.ledger.getBalance(stored.owner, NATIVE).available).toBe(SWAP_IN);
    });

    it('releases the funds if the swap reverted while the enclave was down', async () => {
      const world = await newWorld();
      await configureRouter(AMOUNT_OUT, true);
      const stored = await crashDuringSwap(world, {
        call: (async () => ({ data: '0x' })) as ExecutorChain['call'],
        estimateGas: (async () => 200_000n) as ExecutorChain['estimateGas'],
        waitForTransactionReceipt: crashBeforeReceipt,
      });
      await configureRouter(AMOUNT_OUT, false);

      const second = await boot(world);
      const report = await recoverFrom(second);

      expect(report).toEqual([{ opId: `exec:${stored.id}`, status: 'failed' }]);
      expect(second.ledger.getBalance(stored.owner, NATIVE)).toMatchObject({ available: SWAP_IN, reserved: 0n });
      expect(second.ledger.getBalance(stored.owner, token).available).toBe(0n);
      expect(second.marks.map((mark) => mark.status)).toEqual(['executing', 'failed']);
      expect(second.ledger.getOperationalGasSpent(NATIVE)).toBeGreaterThan(0n);
    });

    it('refuses to boot past an open swap without swap settings', async () => {
      const world = await newWorld();
      await crashDuringSwap(world, { waitForTransactionReceipt: crashBeforeReceipt });

      const second = await boot(world, {}, false);

      await expect(second.executor.recover(second.journal.replay())).rejects.toThrow('SWAPS_NOT_CONFIGURED');
    });
  });

  it('recovers several interrupted operations together, each once', async () => {
    const world = await newWorld(3);
    const first = await boot(world, { waitForTransactionReceipt: crashBeforeReceipt });
    const stored = await createIntent(first);
    const one = newWithdrawal('w1');
    const two = newWithdrawal('w2');
    await lockWithdrawal(first, one);
    await lockWithdrawal(first, two);
    expect((await first.executor.runIntent(stored)).status).toBe('unresolved');
    await (await first.executor.runWithdrawal(one)).finished;
    await (await first.executor.runWithdrawal(two)).finished;
    await first.journal.close();

    const second = await boot(world);
    const report = await recoverFrom(second);

    expect(report.map((entry) => entry.status)).toEqual(['settled', 'settled', 'settled']);
    expect(await chain.getBalance({ address: one.to })).toBe(PAYOUT);
    expect(await chain.getBalance({ address: two.to })).toBe(PAYOUT);
    expect(world.signer.signed).toHaveLength(3);
  });
});

describe('Inventory.restoreHold', () => {
  it('holds even when the balance has already left', async () => {
    const world = await newWorld();
    await anvil.setBalance({ address: world.eoas[0]!.address, value: 0n });
    const { inventory } = await boot(world);

    inventory.restoreHold(world.eoas[0]!.address, NATIVE, PAYOUT, 'op');

    await anvil.setBalance({ address: world.eoas[0]!.address, value: parseEther('5') });
    await anvil.mine({ blocks: 1 });
    await inventory.refresh();
    expect(inventory.pick(NATIVE, 1n, new Set())).toBeNull();
    inventory.free('op');
    expect(inventory.pick(NATIVE, 1n, new Set())).not.toBeNull();
  });

  it('is safe to repeat, and refuses an unknown EOA', async () => {
    const world = await newWorld();
    const { inventory } = await boot(world);

    inventory.restoreHold(world.eoas[0]!.address, NATIVE, 1n, 'op');
    expect(() => inventory.restoreHold(world.eoas[0]!.address, NATIVE, 1n, 'op')).not.toThrow();
    expect(() => inventory.restoreHold(freshAddress(), NATIVE, 1n, 'other')).toThrow('UNKNOWN_EOA');
  });
});

