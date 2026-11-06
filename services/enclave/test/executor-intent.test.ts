import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NATIVE,
  PRICE_PRECISION,
  type CustodyEOA,
  type IntentStatus,
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
  keccak256,
  pad,
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
  type SwapOutcome,
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
const AMOUNT_IN = parseEther('0.1');
const AMOUNT_OUT = 2_630_992_794n;
const FEE_BPS = 10;
const THIS: Address = '0x0000000000000000000000000000000000000002';
const ATTACKER = privateKeyToAddress(generatePrivateKey());
const ROUTER_EXECUTE = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable']);
/** The price of the quote above, in tokenOut per ETH scaled by 1e18. */
const PRICE = 26_309_927_940_000_000_000_000n;

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
const journals: EncryptedJournal[] = [];

const freshAddress = () => privateKeyToAddress(generatePrivateKey());

class GuardedSigner implements TransactionSigner {
  readonly keys = new Map<Address, Hex>();
  readonly expected = new Map<string, ExpectedTransaction>();
  readonly signed: string[] = [];
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

  async sign(eoa: Address, tx: Parameters<TransactionSigner['sign']>[1], opId: string): Promise<Hex> {
    const expected = this.expected.get(opId);
    if (this.refuse || !expected || this.signed.includes(opId)) throw new Error('SIGNING_REFUSED');
    if (
      expected.eoa !== eoa ||
      expected.to !== tx.to ||
      expected.value !== tx.value ||
      expected.dataHash !== keccak256(tx.data ?? '0x')
    ) {
      throw new Error('SIGNING_REFUSED');
    }
    this.signed.push(opId);
    return privateKeyToAccount(this.keys.get(eoa)!).signTransaction(tx);
  }
}

function swapCalldata(options: { eoa: Address; minOut: bigint; sweepTo?: Address; deadline?: bigint }): Hex {
  return encodeFunctionData({
    abi: ROUTER_EXECUTE,
    functionName: 'execute',
    args: [
      '0x0b0004',
      [
        encodeAbiParameters(parseAbiParameters('address, uint256'), [THIS, AMOUNT_IN]),
        encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
          THIS,
          AMOUNT_IN,
          0n,
          '0x00',
          false,
        ]),
        encodeAbiParameters(parseAbiParameters('address, address, uint256'), [
          token,
          options.sweepTo ?? options.eoa,
          options.minOut,
        ]),
      ],
      options.deadline ?? 99_999_999_999n,
    ],
  });
}

type QuoteHook = (request: QuoteRequest, quote: Quote) => Quote | Promise<Quote>;

async function configureRouter(amountOut: bigint, shouldRevert = false): Promise<void> {
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

async function setup(options: {
  eoaCount?: number;
  hook?: QuoteHook;
  chainPort?: Partial<ExecutorChain>;
  receiptTimeoutMs?: number;
  maxSlippageBpsCap?: number;
  nowMs?: () => number;
  fund?: bigint;
} = {}) {
  const signer = new GuardedSigner();
  const eoas: CustodyEOA[] = Array.from({ length: options.eoaCount ?? 1 }, (_, index) => ({
    index,
    address: signer.newEoa(),
    role: 'inventory',
    lastUsedAt: 0,
  }));
  for (const eoa of eoas) {
    await anvil.setBalance({ address: eoa.address, value: options.fund ?? parseEther('1') });
  }

  const inventory = new Inventory({
    chain,
    keys: { list: () => eoas },
    tokens: [token],
    gasReserveWei: GAS_RESERVE,
  });
  const journal = new EncryptedJournal({
    filePath: join(directory, `${Math.random()}.journal`),
    key: randomBytes(32),
  });
  journals.push(journal);
  const ledger = new InMemoryLedger();
  const marks: Array<{ status: IntentStatus; amountOut?: bigint }> = [];
  const requests: QuoteRequest[] = [];

  const quoter = {
    quote: async (request: QuoteRequest): Promise<Quote> => {
      requests.push(request);
      const slippage = BigInt(Math.round((request.slippagePercent ?? 0) * 100));
      const minAmountOut = (AMOUNT_OUT * (10_000n - slippage)) / 10_000n;
      const quote: Quote = {
        amountIn: request.amountIn,
        amountOut: AMOUNT_OUT,
        minAmountOut,
        transaction: {
          to: router,
          from: request.swapper,
          value: request.amountIn,
          data: swapCalldata({ eoa: request.swapper, minOut: minAmountOut }),
        },
      };
      return options.hook ? options.hook(request, quote) : quote;
    },
  };

  const executor = new Executor({
    chain: { ...chain, ...options.chainPort } as ExecutorChain,
    chainId: foundry.id,
    signer,
    inventory,
    journal,
    ledger,
    queue: new FifoSerialQueue(),
    confirmations: 2n,
    receiptTimeoutMs: options.receiptTimeoutMs ?? 30_000,
    gasMarginPercent: 120n,
    inventorySettleAttempts: 3,
    swaps: {
      quoter,
      intents: {
        mark: (_id, status, amountOut) => void marks.push({ status, amountOut }),
      },
      ledger,
      routerAddress: router,
      tokenOut: token,
      tokenOutDecimals: 6,
      feeBps: FEE_BPS,
      maxSlippageBpsCap: options.maxSlippageBpsCap ?? 100,
      nowMs: options.nowMs,
    },
  });

  async function fundOwner(owner: Address, id: string, intent: StoredIntent['intent']): Promise<void> {
    const events = [
      { t: 'DEPOSIT_CREDITED', id: `deposit-${id}`, owner, amount: intent.amountIn, block: 1n },
      { t: 'INTENT_CREATED', id, owner, intent },
    ] as const;
    for (const event of events) {
      await journal.append(event);
      ledger.apply(event);
    }
  }

  return {
    executor,
    inventory,
    signer,
    journal,
    ledger,
    marks,
    requests,
    fundOwner,
    addresses: eoas.map((eoa) => eoa.address),
  };
}

let nextId = 0;
async function makeIntent(
  context: { fundOwner(owner: Address, id: string, intent: StoredIntent['intent']): Promise<void> },
  overrides: Partial<StoredIntent['intent']> = {},
): Promise<StoredIntent> {
  nextId += 1;
  const owner = freshAddress();
  const id = `intent-${nextId}`;
  const intent: StoredIntent['intent'] = {
    owner,
    tokenIn: NATIVE,
    tokenOut: token,
    amountIn: AMOUNT_IN,
    comparator: 0,
    triggerPrice: 1000n * PRICE_PRECISION,
    maxSlippageBps: 50,
    nonce: 1n,
    expiry: 99_999_999_999n,
    ...overrides,
  };
  await context.fundOwner(owner, id, intent);
  return { id, owner, intent, status: 'pending', createdAt: 0 };
}

const mineUntilDone = (outcome: Promise<SwapOutcome>) => mineUntilFinished(outcome);

async function mineUntilFinished<T>(finished: Promise<T>): Promise<T> {
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

const tokenBalance = (address: Address) =>
  chain.readContract({ address: token, abi: TEST_SWAP_TOKEN_ABI, functionName: 'balanceOf', args: [address] });

async function journalEvents(journal: EncryptedJournal): Promise<string[]> {
  const types: string[] = [];
  for await (const { event } of journal.replay()) types.push(event.t);
  return types;
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'cloakroom-swap-'));
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
  await configureRouter(AMOUNT_OUT);
}, 15_000);

afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
});

afterAll(() => {
  anvilProcess?.kill();
  rmSync(directory, { recursive: true, force: true });
});

describe('Executor.runIntent', () => {
  describe('a successful swap', () => {
    it('swaps from an unlinked EOA and settles the real output net of the fee', async () => {
      const context = await setup();
      const stored = await makeIntent(context);
      const fee = (AMOUNT_OUT * BigInt(FEE_BPS)) / 10_000n;

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      expect(outcome).toMatchObject({ status: 'settled', amountOut: AMOUNT_OUT, fee });
      const balance = context.ledger.getBalance(stored.owner, token);
      expect(balance.available).toBe(AMOUNT_OUT - fee);
      expect(context.ledger.getBalance(stored.owner, NATIVE).reserved).toBe(0n);
      expect(context.ledger.getProtocolRevenue(token)).toBe(fee);
      expect(context.marks).toEqual([{ status: 'executing' }, { status: 'done', amountOut: AMOUNT_OUT - fee }]);
      expect(await tokenBalance(context.addresses[0]!)).toBeGreaterThanOrEqual(AMOUNT_OUT);
    });

    it('journals in order, and a rebuilt ledger matches the live one exactly', async () => {
      const context = await setup();
      const stored = await makeIntent(context);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      if (outcome.status !== 'settled') throw new Error('expected settled');
      expect(await journalEvents(context.journal)).toEqual([
        'DEPOSIT_CREDITED',
        'INTENT_CREATED',
        'EXEC_BROADCAST',
        'EXEC_SETTLED',
        'FEE_BOOKED',
      ]);
      const receipt = await chain.getTransactionReceipt({ hash: outcome.txHash });
      const gas = receipt.gasUsed * receipt.effectiveGasPrice;
      const rebuilt = await replayLedger(context.journal);
      for (const ledger of [context.ledger, rebuilt]) {
        expect(ledger.getOperationalGasSpent(NATIVE)).toBe(gas);
        expect(ledger.getProtocolRevenue(token)).toBe(outcome.fee);
      }
      expect(rebuilt.getBalance(stored.owner, token)).toEqual(context.ledger.getBalance(stored.owner, token));
      expect(rebuilt.getBalance(stored.owner, NATIVE)).toEqual(context.ledger.getBalance(stored.owner, NATIVE));
    });

    it('settles a single route, where the swap pays the EOA directly', async () => {
      const context = await setup({
        hook: (request, quote) => ({
          ...quote,
          transaction: {
            ...quote.transaction!,
            data: encodeFunctionData({
              abi: ROUTER_EXECUTE,
              functionName: 'execute',
              args: [
                '0x0b00',
                [
                  encodeAbiParameters(parseAbiParameters('address, uint256'), [THIS, AMOUNT_IN]),
                  encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [
                    request.swapper,
                    AMOUNT_IN,
                    quote.minAmountOut,
                    `0xfff9976782d46cc05630d1f6ebab18b2324d6b14000bb8${token.slice(2)}`,
                    false,
                  ]),
                ],
                99_999_999_999n,
              ],
            }),
          },
        }),
      });
      const stored = await makeIntent(context);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      expect(outcome).toMatchObject({ status: 'settled', amountOut: AMOUNT_OUT });
    });

    it('counts only Transfer logs from the output token to the EOA', async () => {
      const context = await setup();
      await configureRouter(1234n);
      const stored = await makeIntent(context);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));
      await configureRouter(AMOUNT_OUT);

      expect(outcome).toMatchObject({ status: 'settled', amountOut: 1234n, fee: 1n });
    });

    it('ignores transfers of other tokens, and transfers to other addresses', async () => {
      const otherToken = freshAddress();
      const context = await setup({
        chainPort: {
          waitForTransactionReceipt: (async (
            args: Parameters<PublicClient['waitForTransactionReceipt']>[0],
          ) => {
            const receipt = await chain.waitForTransactionReceipt(args);
            const transfer = receipt.logs[0]!;
            const toAttacker = pad(ATTACKER);
            return {
              ...receipt,
              logs: [
                ...receipt.logs,
                { ...transfer, logIndex: 100, address: otherToken },
                {
                  ...transfer,
                  logIndex: 101,
                  topics: [transfer.topics[0], transfer.topics[1], toAttacker],
                },
              ],
            };
          }) as ExecutorChain['waitForTransactionReceipt'],
        },
      });
      const stored = await makeIntent(context);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      expect(outcome).toMatchObject({ status: 'settled', amountOut: AMOUNT_OUT });
    });

    it('asks for checkable routes, the owner slippage, and the chosen EOA', async () => {
      const context = await setup();
      const stored = await makeIntent(context);

      await mineUntilDone(context.executor.runIntent(stored));

      expect(context.requests).toEqual([
        {
          tokenIn: NATIVE,
          tokenOut: token,
          amountIn: AMOUNT_IN,
          swapper: context.addresses[0],
          slippagePercent: 0.5,
          protocols: ['V2', 'V3'],
        },
      ]);
    });

    it('limits slippage to the configured cap', async () => {
      const context = await setup({ maxSlippageBpsCap: 100 });
      const stored = await makeIntent(context, { maxSlippageBps: 5000 });

      await mineUntilDone(context.executor.runIntent(stored));

      expect(context.requests[0]?.slippagePercent).toBe(1);
    });

    it('frees the EOA with spent funds gone, and links it to the owner', async () => {
      const context = await setup({ fund: AMOUNT_IN + GAS_RESERVE + parseEther('0.01') });
      const stored = await makeIntent(context);

      await mineUntilDone(context.executor.runIntent(stored));

      expect([...context.inventory.eoasLinkedTo(stored.owner)]).toEqual([context.addresses[0]]);
      expect(context.inventory.pick(NATIVE, AMOUNT_IN, new Set())).toBeNull();
      expect(context.inventory.pick(NATIVE, 1n, new Set())).not.toBeNull();
    });

    it('never swaps from an EOA linked to the owner', async () => {
      const context = await setup({ eoaCount: 2 });
      const stored = await makeIntent(context);
      context.inventory.linkOwner(stored.owner, context.addresses[0]!);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      if (outcome.status !== 'settled') throw new Error('expected settled');
      const receipt = await chain.getTransactionReceipt({ hash: outcome.txHash });
      expect(receipt.from.toLowerCase()).toBe(context.addresses[1]!.toLowerCase());
    });

    it('shares nonces with withdrawals on the same EOA', async () => {
      const context = await setup({
        chainPort: { getTransactionCount: (async () => 0) as ExecutorChain['getTransactionCount'] },
      });
      const stored = await makeIntent(context);
      expect((await mineUntilDone(context.executor.runIntent(stored))).status).toBe('settled');

      const owner = freshAddress();
      const to = freshAddress();
      const events = [
        { t: 'DEPOSIT_CREDITED', id: 'nonce-deposit', owner, amount: 5n, block: 1n },
        { t: 'WITHDRAWAL_LOCKED', id: 'nonce-withdrawal', owner, token: NATIVE, amount: 5n, to },
      ] as const;
      for (const event of events) {
        await context.journal.append(event);
        context.ledger.apply(event);
      }
      const { finished } = await context.executor.runWithdrawal({
        id: 'nonce-withdrawal',
        owner,
        token: NATIVE,
        amount: 5n,
        to,
        status: 'locked',
      });
      const outcome = await mineUntilFinished(finished);

      expect(outcome.status).toBe('confirmed');
      expect(await chain.getTransactionCount({ address: context.addresses[0]! })).toBe(2);
    });
  });

  describe('the price condition', () => {
    it.each([
      ['at or above, met', 0, PRICE, 'settled'],
      ['at or above, not met', 0, PRICE + 1n, 'pending'],
      ['at or below, met', 1, PRICE, 'settled'],
      ['at or below, not met', 1, PRICE - 1n, 'pending'],
      ['an unknown comparator', 2, PRICE, 'pending'],
    ])('%s', async (_name, comparator, triggerPrice, expected) => {
      const context = await setup();
      const stored = await makeIntent(context, { comparator, triggerPrice });

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      expect(outcome.status).toBe(expected);
    });

    it('rechecks against the swap amount, because a large swap gets a worse price', async () => {
      const context = await setup({
        hook: (_request, quote) => ({ ...quote, amountOut: quote.amountOut / 2n }),
      });
      const stored = await makeIntent(context, { triggerPrice: PRICE });

      const outcome = await context.executor.runIntent(stored);

      expect(outcome).toEqual({ status: 'pending', reason: 'CONDITION_NOT_MET' });
      expect(context.signer.signed).toEqual([]);
    });
  });

  describe('leaving an intent pending, with nothing sent', () => {
    async function expectUntouched(
      context: Awaited<ReturnType<typeof setup>>,
      stored: StoredIntent,
      outcome: SwapOutcome,
      reason: string,
    ) {
      expect(outcome).toEqual({ status: 'pending', reason });
      expect(context.signer.signed).toEqual([]);
      expect(context.marks.at(-1)).toEqual({ status: 'pending', amountOut: undefined });
      expect(context.ledger.getBalance(stored.owner, NATIVE).reserved).toBe(AMOUNT_IN);
      expect(context.inventory.pick(NATIVE, 1n, new Set())).not.toBeNull();
    }

    it('when the quote fails', async () => {
      const context = await setup({
        hook: () => {
          throw new Error('UNISWAP_UNAVAILABLE');
        },
      });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), 'QUOTE_UNAVAILABLE');
    });

    it('when no transaction comes back', async () => {
      const context = await setup({ hook: (_request, { transaction: _unused, ...quote }) => quote });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), 'NO_TRANSACTION');
    });

    it.each<[string, (quote: Quote) => Partial<NonNullable<Quote['transaction']>>, string]>([
      ['goes to another contract', () => ({ to: ATTACKER }), 'UNEXPECTED_TRANSACTION'],
      ['comes from another address', () => ({ from: ATTACKER }), 'UNEXPECTED_TRANSACTION'],
      ['spends more ETH than was reserved', () => ({ value: AMOUNT_IN + 1n }), 'UNEXPECTED_TRANSACTION'],
      ['spends less ETH than was reserved', () => ({ value: AMOUNT_IN - 1n }), 'UNEXPECTED_TRANSACTION'],
    ])('when the API transaction %s', async (_name, change, reason) => {
      const context = await setup({
        hook: (_request, quote) => ({ ...quote, transaction: { ...quote.transaction!, ...change(quote) } }),
      });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), reason);
    });

    it('when the calldata pays someone else', async () => {
      const context = await setup({
        hook: (request, quote) => ({
          ...quote,
          transaction: {
            ...quote.transaction!,
            data: swapCalldata({ eoa: request.swapper, minOut: quote.minAmountOut, sweepTo: ATTACKER }),
          },
        }),
      });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), 'UNSAFE_CALLDATA');
    });

    it('when the calldata minimum is below the owner slippage limit', async () => {
      const context = await setup({
        hook: (request, quote) => ({
          ...quote,
          transaction: { ...quote.transaction!, data: swapCalldata({ eoa: request.swapper, minOut: 1n }) },
        }),
      });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), 'UNSAFE_CALLDATA');
    });

    it('when the calldata deadline has passed', async () => {
      const context = await setup({
        hook: (request, quote) => ({
          ...quote,
          transaction: {
            ...quote.transaction!,
            data: swapCalldata({ eoa: request.swapper, minOut: quote.minAmountOut, deadline: 1n }),
          },
        }),
      });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), 'UNSAFE_CALLDATA');
    });

    it('when the simulation reverts', async () => {
      const context = await setup();
      await configureRouter(AMOUNT_OUT, true);
      const stored = await makeIntent(context);

      const outcome = await context.executor.runIntent(stored);
      await configureRouter(AMOUNT_OUT);

      await expectUntouched(context, stored, outcome, 'SIMULATION_FAILED');
    });

    it('when only the simulation reverts, even though gas estimation succeeds', async () => {
      const context = await setup({
        chainPort: {
          call: (async () => {
            throw new Error('execution reverted');
          }) as ExecutorChain['call'],
          estimateGas: (async () => 200_000n) as ExecutorChain['estimateGas'],
        },
      });
      const stored = await makeIntent(context);

      await expectUntouched(context, stored, await context.executor.runIntent(stored), 'SIMULATION_FAILED');
    });

    it('when no EOA can cover the amount', async () => {
      const context = await setup({ fund: AMOUNT_IN });
      const stored = await makeIntent(context);

      const outcome = await context.executor.runIntent(stored);

      expect(outcome).toEqual({ status: 'pending', reason: 'NO_INVENTORY' });
      expect(context.requests).toEqual([]);
      expect(context.ledger.getBalance(stored.owner, NATIVE).reserved).toBe(AMOUNT_IN);
    });

    it('when the only funded EOA is linked to the owner', async () => {
      const context = await setup();
      const stored = await makeIntent(context);
      context.inventory.linkOwner(stored.owner, context.addresses[0]!);

      const outcome = await context.executor.runIntent(stored);

      expect(outcome).toEqual({ status: 'pending', reason: 'NO_INVENTORY' });
    });

    it('when the intent has expired, without touching its status', async () => {
      const context = await setup({ nowMs: () => 2_000_000 });
      const stored = await makeIntent(context, { expiry: 2_000n });

      const outcome = await context.executor.runIntent(stored);

      expect(outcome).toEqual({ status: 'pending', reason: 'EXPIRED' });
      expect(context.marks).toEqual([]);
      expect(context.requests).toEqual([]);
    });

    it('retries successfully on the next price check', async () => {
      let calls = 0;
      const context = await setup({
        hook: (_request, quote) => {
          calls += 1;
          if (calls === 1) throw new Error('UNISWAP_UNAVAILABLE');
          return quote;
        },
      });
      const stored = await makeIntent(context);

      expect((await context.executor.runIntent(stored)).status).toBe('pending');
      expect((await mineUntilDone(context.executor.runIntent(stored))).status).toBe('settled');
    });
  });

  describe('running only once', () => {
    it('refuses to run an intent that is already running', async () => {
      const context = await setup();
      const stored = await makeIntent(context);

      const [first, second] = await Promise.all([
        mineUntilDone(context.executor.runIntent(stored)),
        context.executor.runIntent(stored),
      ]);

      expect(first.status).toBe('settled');
      expect(second).toEqual({ status: 'pending', reason: 'ALREADY_RUNNING' });
      expect(context.signer.signed).toHaveLength(1);
    });

    it('refuses an intent that is no longer pending', async () => {
      const context = await setup();
      const stored = await makeIntent(context);

      const outcome = await context.executor.runIntent({ ...stored, status: 'done' });

      expect(outcome).toEqual({ status: 'pending', reason: 'NOT_PENDING' });
      expect(context.marks).toEqual([]);
    });

    it('runs concurrent intents from different EOAs', async () => {
      const context = await setup({ eoaCount: 2 });
      const first = await makeIntent(context);
      const second = await makeIntent(context);

      const outcomes = await Promise.all([
        mineUntilDone(context.executor.runIntent(first)),
        mineUntilDone(context.executor.runIntent(second)),
      ]);

      const senders = await Promise.all(
        outcomes.map(async (outcome) => {
          if (outcome.status !== 'settled') throw new Error('expected settled');
          return (await chain.getTransactionReceipt({ hash: outcome.txHash })).from;
        }),
      );
      expect(new Set(senders).size).toBe(2);
    });
  });

  describe('when it fails', () => {
    it('releases the funds when signing is refused, and sends nothing', async () => {
      const context = await setup();
      context.signer.refuse = true;
      const stored = await makeIntent(context);

      const outcome = await context.executor.runIntent(stored);

      expect(outcome).toEqual({ status: 'failed', reason: 'PREPARE_FAILED' });
      expect(context.ledger.getBalance(stored.owner, NATIVE)).toMatchObject({
        available: AMOUNT_IN,
        reserved: 0n,
      });
      expect(context.marks.at(-1)?.status).toBe('failed');
      expect(await journalEvents(context.journal)).toContain('EXEC_FAILED');
      expect(context.inventory.pick(NATIVE, 1n, new Set())).not.toBeNull();
    });

    it('refuses other pairs, and releases the funds', async () => {
      const context = await setup();
      const stored = await makeIntent(context, { tokenOut: freshAddress() });

      const outcome = await context.executor.runIntent(stored);

      expect(outcome).toEqual({ status: 'failed', reason: 'UNSUPPORTED_PAIR' });
      expect(context.ledger.getBalance(stored.owner, NATIVE).available).toBe(AMOUNT_IN);
    });

    it('releases the funds and books gas when the swap reverts on-chain', async () => {
      const context = await setup({
        chainPort: {
          call: (async () => ({ data: '0x' })) as ExecutorChain['call'],
          estimateGas: (async () => 200_000n) as ExecutorChain['estimateGas'],
        },
      });
      await configureRouter(AMOUNT_OUT, true);
      const stored = await makeIntent(context);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));
      await configureRouter(AMOUNT_OUT);

      expect(outcome).toMatchObject({ status: 'failed', reason: 'REVERTED' });
      expect(context.ledger.getBalance(stored.owner, NATIVE)).toMatchObject({
        available: AMOUNT_IN,
        reserved: 0n,
      });
      expect(context.ledger.getBalance(stored.owner, token).available).toBe(0n);
      expect(context.ledger.getOperationalGasSpent(NATIVE)).toBeGreaterThan(0n);
      expect(context.marks.at(-1)?.status).toBe('failed');
      const rebuilt = await replayLedger(context.journal);
      expect(rebuilt.getBalance(stored.owner, NATIVE)).toEqual(context.ledger.getBalance(stored.owner, NATIVE));
    });

    it('still settles when a send reports an error but the transaction landed', async () => {
      const context = await setup({
        chainPort: {
          sendRawTransaction: (async (args: { serializedTransaction: Hex }) => {
            await chain.sendRawTransaction(args);
            throw new Error('connection reset');
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      const stored = await makeIntent(context);

      const outcome = await mineUntilDone(context.executor.runIntent(stored));

      expect(outcome.status).toBe('settled');
    });

    it('keeps funds reserved and the EOA busy when the result is unknown', async () => {
      const context = await setup({
        receiptTimeoutMs: 200,
        chainPort: {
          sendRawTransaction: (async () => {
            throw new Error('dropped');
          }) as ExecutorChain['sendRawTransaction'],
        },
      });
      const stored = await makeIntent(context);

      const outcome = await context.executor.runIntent(stored);

      expect(outcome.status).toBe('unresolved');
      expect(context.ledger.getBalance(stored.owner, NATIVE).reserved).toBe(AMOUNT_IN);
      expect(context.marks.at(-1)?.status).toBe('executing');
      expect(context.inventory.pick(NATIVE, 1n, new Set())).toBeNull();
    });

    it('does not settle until confirmations have passed', async () => {
      const context = await setup();
      const stored = await makeIntent(context);

      const running = context.executor.runIntent(stored);
      await expect.poll(() => context.signer.signed.length, { timeout: 5_000 }).toBe(1);
      await expect.poll(() => tokenBalance(context.addresses[0]!), { timeout: 5_000 }).toBeGreaterThan(0n);

      await anvil.mine({ blocks: 1 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(context.ledger.getBalance(stored.owner, token).available).toBe(0n);

      await anvil.mine({ blocks: 1 });
      await running;
      expect(context.ledger.getBalance(stored.owner, token).available).toBeGreaterThan(0n);
    });

    it('throws clearly if swaps are not configured', async () => {
      const inventory = new Inventory({
        chain,
        keys: { list: () => [] },
        tokens: [],
        gasReserveWei: 0n,
      });
      const executor = new Executor({
        chain: chain as ExecutorChain,
        chainId: foundry.id,
        signer: new GuardedSigner(),
        inventory,
        journal: { append: async () => ({}) as never },
        ledger: { consume: () => {}, release: () => {} },
        queue: new FifoSerialQueue(),
        confirmations: 0n,
        receiptTimeoutMs: 1,
        gasMarginPercent: 100n,
        inventorySettleAttempts: 1,
      });

      await expect(
        executor.runIntent({ id: 'x', owner: ATTACKER, status: 'pending', createdAt: 0 } as StoredIntent),
      ).rejects.toThrow('SWAPS_NOT_CONFIGURED');
    });
  });
});

describe('Executor.runWithdrawal gas accounting', () => {
  it('books gas live the same way replay does', async () => {
    const context = await setup();
    const owner = freshAddress();
    const events = [
      { t: 'DEPOSIT_CREDITED', id: 'd', owner, amount: parseEther('0.1'), block: 1n },
      {
        t: 'WITHDRAWAL_LOCKED',
        id: 'w1',
        owner,
        token: NATIVE,
        amount: parseEther('0.05'),
        to: freshAddress(),
      },
    ] as const;
    for (const event of events) {
      await context.journal.append(event);
      context.ledger.apply(event);
    }

    const { finished } = await context.executor.runWithdrawal({
      id: 'w1',
      owner,
      token: NATIVE,
      amount: parseEther('0.05'),
      to: events[1].to,
      status: 'locked',
    });
    await mineUntilFinished(finished);

    expect(context.ledger.getOperationalGasSpent(NATIVE)).toBeGreaterThan(0n);
    const rebuilt = await replayLedger(context.journal);
    expect(rebuilt.getOperationalGasSpent(NATIVE)).toBe(context.ledger.getOperationalGasSpent(NATIVE));
  });
});
