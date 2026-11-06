import { ERROR_CODES, NATIVE, PERMIT2_ADDRESS } from '@cloakroom/shared';
import type {
  IntentStore,
  Journal,
  JournalEvent,
  Ledger,
  LockedWithdrawal,
  MarginAccounting,
  MarginOperation,
  SerialQueue,
  StoredIntent,
} from '@cloakroom/shared';
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseEventLogs } from 'viem';
import type { Address, Hex, PublicClient, TransactionSerializableEIP1559 } from 'viem';
import type { Inventory } from './inventory.js';
import type { InMemoryLedger } from './ledger.js';
import { assertSafeSwapCalldata, assertSafeTokenToNativeCalldata, limitFloor } from './swap-calldata.js';
import type { Quote, QuoteRequest } from './uniswap.js';

const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const TRANSFER_EVENT = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const WETH_WITHDRAWAL_EVENT = parseAbi(['event Withdrawal(address indexed src, uint256 wad)']);
const ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function allowance(address owner, address token, address spender) view returns (uint160, uint48, uint48)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_UINT160 = 2n ** 160n - 1n;
const MAX_UINT48 = 2 ** 48 - 1;
const BPS_SCALE = 10_000n;
const BPS_PER_PERCENT = 100;
const MS_PER_SECOND = 1000;
/** Only these routes produce router commands that assertSafeSwapCalldata can check. */
const SWAP_PROTOCOLS = ['V2', 'V3'] as const;
/** A sell limit. "At or below" has no floor to protect the seller, so it is refused. */
const COMPARATOR_AT_OR_ABOVE = 0;

/** What the signing guard must see before it will sign an operation. */
export interface ExpectedTransaction {
  eoa: Address;
  to: Address;
  value: bigint;
  dataHash: Hex;
  /** Required for swaps; the signer checks the router commands itself. */
  data?: Hex;
}

/** The custody signing interface used by the executor. */
export interface TransactionSigner {
  registerOp(opId: string, expected: ExpectedTransaction): void | Promise<void>;
  /** Returns the serialized signed transaction. Refuses anything not registered. */
  sign(eoa: Address, tx: TransactionSerializableEIP1559, opId: string): Promise<Hex>;
}

export type ExecutorChain = Pick<
  PublicClient,
  | 'estimateFeesPerGas'
  | 'call'
  | 'estimateGas'
  | 'getTransactionCount'
  | 'getTransactionReceipt'
  | 'sendRawTransaction'
  | 'waitForTransactionReceipt'
>;

export interface ExecutorDeps {
  chain: ExecutorChain;
  chainId: number;
  signer: TransactionSigner;
  inventory: Pick<
    Inventory,
    'eoasLinkedTo' | 'free' | 'hold' | 'linkOwner' | 'pick' | 'refresh' | 'restoreHold'
  >;
  journal: Pick<Journal, 'append'>;
  /** The withdrawal ID must be the ref the funds were reserved under. */
  ledger: Pick<Ledger, 'consume' | 'release'> & Partial<Pick<InMemoryLedger, 'bookOperationalGas'>>;
  queue: SerialQueue;
  confirmations: bigint;
  receiptTimeoutMs: number;
  /** Gas limit as a percentage of the estimate. */
  gasMarginPercent: bigint;
  /** How many times to try refreshing balances before freeing an EOA. */
  inventorySettleAttempts: number;
  /** Required for runIntent. */
  swaps?: SwapDeps;
  /** Required for runMarginOperation. */
  margin?: MarginExecutionDeps;
}

export interface MarginExecutionDeps {
  accounting: Pick<MarginAccounting, 'settle' | 'fail'>;
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
  inventory: Pick<Inventory, 'depositEoasOf'>;
  /** Books the gas of the one-time approvals. */
  ledger: Pick<InMemoryLedger, 'apply'>;
  reader: Pick<PublicClient, 'readContract'>;
  routerAddress: Address;
  wethAddress: Address;
  maxSlippageBpsCap: number;
  nowMs?: () => number;
}

export type MarginOutcome =
  | { status: 'settled'; txHash: Hex; amountIn: bigint; amountOut: bigint }
  | { status: 'failed'; reason: string; txHash?: Hex }
  /** Broadcast with an unknown result. Funds stay reserved until recovery settles it. */
  | { status: 'unresolved'; txHash: Hex };

export interface SwapDeps {
  quoter: { quote(request: QuoteRequest): Promise<Quote> };
  intents: Pick<IntentStore, 'mark'>;
  /** Settles through the same code replay uses, so live and rebuilt balances cannot differ. */
  ledger: Pick<InMemoryLedger, 'apply'>;
  routerAddress: Address;
  tokenOut: Address;
  tokenOutDecimals: number;
  feeBps: number;
  maxSlippageBpsCap: number;
  nowMs?: () => number;
}

export type SwapOutcome =
  | { status: 'settled'; txHash: Hex; amountOut: bigint; fee: bigint }
  /** Nothing was sent and no funds moved. The intent stays pending for the next price check. */
  | { status: 'pending'; reason: string }
  | { status: 'failed'; reason: string; txHash?: Hex }
  /** Broadcast with an unknown result. Funds stay reserved until recovery settles it. */
  | { status: 'unresolved'; txHash: Hex };

export type WithdrawalOutcome =
  | { status: 'confirmed'; txHash: Hex }
  | { status: 'failed'; reason: string; txHash?: Hex }
  /**
   * The transaction was broadcast but its result is unknown, and it may still land.
   * The funds stay reserved and the EOA stays busy until recovery settles it.
   */
  | { status: 'unresolved'; txHash: Hex };

export type RecoveryStatus =
  /** Reached a final state during recovery. */
  | 'settled'
  | 'failed'
  /** Locked but never broadcast, so nothing was sent and the funds went back. */
  | 'released'
  /** The result is still unknown. Funds stay reserved, and the next recovery tries again. */
  | 'unresolved'
  /**
   * The EOA's nonce moved but the transaction has no receipt, so a person must check it. Funds
   * stay reserved, because releasing them would pay twice if the transaction did land.
   */
  | 'review';

export interface RecoveredOperation {
  opId: string;
  status: RecoveryStatus;
}

type Receipt = Awaited<ReturnType<ExecutorChain['waitForTransactionReceipt']>>;

interface OpenBroadcast {
  eoa: Address;
  nonce: number;
  txHash: Hex;
  raw: Hex;
}

export interface StartedWithdrawal {
  finished: Promise<WithdrawalOutcome>;
}

interface PreparedTransaction {
  eoa: Address;
  nonce: number;
  raw: Hex;
  txHash: Hex;
}

/** Runs on-chain operations in one order: journal, sign, broadcast, confirm, settle. */
export class Executor {
  private readonly nextNonces = new Map<Address, number>();
  private readonly runningIntents = new Set<string>();

  constructor(private readonly deps: ExecutorDeps) {}

  /**
   * Finishes what a restart interrupted. Call it once on boot, after the ledger, intent store and
   * inventory have replayed the journal, and before the server, watcher or price poller start.
   *
   * Every broadcast is journaled before it is sent, so an operation with no broadcast event sent
   * nothing. An identical signed transaction has the same hash, so sending it again cannot pay
   * twice. Operations that stay open keep their funds reserved and their EOA busy.
   */
  async recover(history: AsyncIterable<{ event: JournalEvent }>): Promise<RecoveredOperation[]> {
    const { inventory } = this.deps;
    const locked = new Map<string, LockedWithdrawal>();
    const withdrawalBroadcasts = new Map<string, OpenBroadcast>();
    const intents = new Map<string, StoredIntent>();
    const swapBroadcasts = new Map<string, OpenBroadcast & { intentId: string }>();
    const marginApproved = new Map<string, MarginOperation>();
    const marginBroadcasts = new Map<string, OpenBroadcast>();

    const trackNonce = (eoa: Address, nonce: number) => {
      this.nextNonces.set(eoa, Math.max(this.nextNonces.get(eoa) ?? 0, nonce + 1));
    };

    for await (const { event } of history) {
      switch (event.t) {
        case 'WITHDRAWAL_LOCKED':
          locked.set(event.id, {
            id: event.id,
            owner: event.owner,
            token: event.token,
            amount: event.amount,
            to: event.to,
            status: 'locked',
          });
          break;
        case 'WITHDRAWAL_BROADCAST':
          withdrawalBroadcasts.set(event.id, event);
          trackNonce(event.eoa, event.nonce);
          break;
        case 'WITHDRAWAL_CONFIRMED':
        case 'WITHDRAWAL_FAILED':
          locked.delete(event.id);
          withdrawalBroadcasts.delete(event.id);
          break;
        case 'INTENT_CREATED':
          intents.set(event.id, {
            id: event.id,
            owner: event.owner,
            intent: event.intent,
            status: 'executing',
            createdAt: 0,
          });
          break;
        case 'EXEC_BROADCAST':
          swapBroadcasts.set(event.opId, {
            ...event,
            intentId: event.intentId ?? event.opId.replace(/^exec:/, ''),
          });
          trackNonce(event.eoa, event.nonce);
          break;
        case 'EXEC_SETTLED':
        case 'EXEC_FAILED':
          swapBroadcasts.delete(event.opId);
          break;
        case 'MARGIN_OP_APPROVED':
          marginApproved.set(event.opId, { ...event, positionId: event.positionId as Hex });
          break;
        case 'MARGIN_OP_BROADCAST':
          marginBroadcasts.set(event.opId, event);
          trackNonce(event.eoa, event.nonce);
          break;
        case 'MARGIN_OP_SETTLED':
        case 'MARGIN_OP_FAILED':
          marginApproved.delete(event.opId);
          marginBroadcasts.delete(event.opId);
          break;
        default:
          break;
      }
    }

    if (swapBroadcasts.size > 0 && !this.deps.swaps) throw new Error('SWAPS_NOT_CONFIGURED');
    if (marginApproved.size > 0 && !this.deps.margin) throw new Error('MARGIN_NOT_CONFIGURED');

    // Hold everything before any network call, so nothing can spend these funds meanwhile.
    for (const [id, broadcast] of withdrawalBroadcasts) {
      const withdrawal = locked.get(id);
      if (withdrawal) inventory.restoreHold(broadcast.eoa, withdrawal.token, withdrawal.amount, id);
    }
    for (const [opId, broadcast] of swapBroadcasts) {
      const stored = intents.get(broadcast.intentId);
      if (!stored) continue;
      inventory.restoreHold(broadcast.eoa, NATIVE, stored.intent.amountIn, opId);
      inventory.linkOwner(stored.owner, broadcast.eoa);
      // The poller must not run this intent again while its transaction may still land.
      this.runningIntents.add(stored.id);
      this.deps.swaps?.intents.mark(stored.id, 'executing');
    }
    for (const [opId, broadcast] of marginBroadcasts) {
      const operation = marginApproved.get(opId);
      if (operation) inventory.restoreHold(broadcast.eoa, operation.tokenIn, operation.amountIn, opId);
    }

    const report: RecoveredOperation[] = [];
    for (const [id, withdrawal] of locked) {
      if (withdrawalBroadcasts.has(id)) continue;
      await this.failWithdrawal(withdrawal, 'INTERRUPTED');
      report.push({ opId: id, status: 'released' });
    }

    const recoveries: Array<Promise<RecoveredOperation>> = [];
    for (const [id, broadcast] of withdrawalBroadcasts) {
      const withdrawal = locked.get(id);
      if (!withdrawal) {
        report.push({ opId: id, status: 'review' });
        continue;
      }
      recoveries.push(
        this.recoverBroadcast(id, broadcast, async (receipt) => {
          const outcome = await this.settleWithdrawal(withdrawal, receipt, broadcast.txHash);
          return outcome.status === 'confirmed' ? 'settled' : 'failed';
        }),
      );
    }
    for (const [opId, broadcast] of swapBroadcasts) {
      const stored = intents.get(broadcast.intentId);
      const swaps = this.deps.swaps;
      if (!stored || !swaps) {
        report.push({ opId, status: 'review' });
        continue;
      }
      recoveries.push(
        this.recoverBroadcast(opId, broadcast, async (receipt) => {
          const outcome = await this.settleIntent(
            stored,
            opId,
            broadcast.eoa,
            swaps,
            receipt,
            broadcast.txHash,
          );
          this.runningIntents.delete(stored.id);
          return outcome.status === 'settled' ? 'settled' : 'failed';
        }),
      );
    }
    for (const [opId, operation] of marginApproved) {
      const broadcast = marginBroadcasts.get(opId);
      if (!broadcast) {
        // Nothing was sent, so accounting can release what it reserved.
        await this.deps.margin?.accounting.fail(opId, { reason: 'INTERRUPTED' });
        report.push({ opId, status: 'released' });
        continue;
      }
      recoveries.push(
        this.recoverBroadcast(opId, broadcast, async (receipt) => {
          const outcome = await this.settleMargin(operation, broadcast.eoa, receipt, broadcast.txHash);
          return outcome.status === 'settled' ? 'settled' : 'failed';
        }),
      );
    }
    report.push(...(await Promise.all(recoveries)));
    return report;
  }

  private async recoverBroadcast(
    opId: string,
    broadcast: OpenBroadcast,
    settle: (receipt: Receipt) => Promise<'settled' | 'failed'>,
  ): Promise<RecoveredOperation> {
    const { chain, confirmations } = this.deps;
    const { eoa, nonce, raw, txHash } = broadcast;

    let landed = false;
    let nonceMoved = false;
    try {
      // Read the nonce first. A transaction mined between the two reads then shows its receipt.
      const chainNonce = await chain.getTransactionCount({ address: eoa, blockTag: 'latest' });
      nonceMoved = chainNonce > nonce;
      landed = await this.hasReceipt(txHash);
    } catch {
      return { opId, status: 'unresolved' };
    }

    if (!landed) {
      if (nonceMoved) return { opId, status: 'review' };
      try {
        await chain.sendRawTransaction({ serializedTransaction: raw });
      } catch {
        // It may already be known to the node, so only the receipt decides the outcome.
      }
    }

    let receipt: Receipt;
    try {
      receipt = await chain.waitForTransactionReceipt({
        hash: txHash,
        confirmations: Number(confirmations) + 1,
        timeout: this.deps.receiptTimeoutMs,
      });
    } catch {
      return { opId, status: 'unresolved' };
    }
    return { opId, status: await settle(receipt) };
  }

  private async hasReceipt(hash: Hex): Promise<boolean> {
    try {
      await this.deps.chain.getTransactionReceipt({ hash });
      return true;
    } catch (error) {
      if ((error as Error).name === 'TransactionReceiptNotFoundError') return false;
      throw error;
    }
  }

  /**
   * Pays out a withdrawal whose funds are already reserved and journaled as locked.
   *
   * Resolves once an EOA is assigned, so the API can answer without waiting for confirmations.
   * Rejects with NO_INVENTORY after releasing the lock if no EOA can pay it. Follow `finished`
   * for the result: it rejects only if the journal cannot be written, and then the funds stay
   * reserved.
   */
  async runWithdrawal(withdrawal: LockedWithdrawal): Promise<StartedWithdrawal> {
    const { inventory } = this.deps;

    try {
      await inventory.refresh();
    } catch {
      await this.failWithdrawal(withdrawal, ERROR_CODES.NO_INVENTORY);
      throw new Error(ERROR_CODES.NO_INVENTORY);
    }

    const excluded = inventory.eoasLinkedTo(withdrawal.owner);
    const chosen = inventory.pick(withdrawal.token, withdrawal.amount, excluded);
    if (!chosen) {
      await this.failWithdrawal(withdrawal, ERROR_CODES.NO_INVENTORY);
      throw new Error(ERROR_CODES.NO_INVENTORY);
    }

    inventory.hold(chosen.address, withdrawal.token, withdrawal.amount, withdrawal.id);
    return { finished: this.executeWithdrawal(withdrawal, chosen.address) };
  }

  /**
   * Swaps an intent's reserved ETH from an EOA not linked to its owner. Call it when a price
   * report says the condition is met, without waiting for it to finish.
   *
   * Everything before signing is safe to retry, so a problem there leaves the intent pending. The
   * Trading API is untrusted: its transaction is decoded and simulated before anything is signed.
   */
  async runIntent(stored: StoredIntent): Promise<SwapOutcome> {
    if (!this.deps.swaps) throw new Error('SWAPS_NOT_CONFIGURED');
    if (stored.status !== 'pending') return { status: 'pending', reason: 'NOT_PENDING' };
    if (this.runningIntents.has(stored.id)) return { status: 'pending', reason: 'ALREADY_RUNNING' };

    this.runningIntents.add(stored.id);
    try {
      return await this.executeIntent(stored, this.deps.swaps);
    } finally {
      this.runningIntents.delete(stored.id);
    }
  }

  private async executeIntent(stored: StoredIntent, swaps: SwapDeps): Promise<SwapOutcome> {
    const { chain, chainId, confirmations, inventory, journal, queue, signer } = this.deps;
    const { intent, owner } = stored;
    const opId = `exec:${stored.id}`;

    if (
      getAddress(intent.tokenIn) !== getAddress(NATIVE) ||
      getAddress(intent.tokenOut) !== getAddress(swaps.tokenOut)
    ) {
      const reason = 'UNSUPPORTED_PAIR';
      await this.failIntent(stored, opId, swaps, reason);
      return { status: 'failed', reason };
    }
    if (intent.comparator !== COMPARATOR_AT_OR_ABOVE) {
      const reason = 'UNSUPPORTED_COMPARATOR';
      await this.failIntent(stored, opId, swaps, reason);
      return { status: 'failed', reason };
    }

    const nowMs = (swaps.nowMs ?? Date.now)();
    const nowSec = BigInt(Math.floor(nowMs / MS_PER_SECOND));
    if (intent.expiry <= nowSec) return { status: 'pending', reason: 'EXPIRED' };

    swaps.intents.mark(stored.id, 'executing');
    const stayPending = (reason: string): SwapOutcome => {
      inventory.free(opId);
      swaps.intents.mark(stored.id, 'pending');
      return { status: 'pending', reason };
    };

    try {
      await inventory.refresh();
    } catch {
      return stayPending('INVENTORY_UNAVAILABLE');
    }
    const chosen = inventory.pick(NATIVE, intent.amountIn, inventory.eoasLinkedTo(owner));
    if (!chosen) return stayPending(ERROR_CODES.NO_INVENTORY);
    const eoa = chosen.address;
    inventory.hold(eoa, NATIVE, intent.amountIn, opId);

    const floor = limitFloor(intent.amountIn, intent.triggerPrice, swaps.tokenOutDecimals, swaps.feeBps);
    const requestQuote = (slippageBps: number) =>
      swaps.quoter.quote({
        tokenIn: NATIVE,
        tokenOut: swaps.tokenOut,
        amountIn: intent.amountIn,
        swapper: eoa,
        slippagePercent: slippageBps / BPS_PER_PERCENT,
        protocols: SWAP_PROTOCOLS,
      });
    const minimumAfter = (amountOut: bigint, slippageBps: number) =>
      (amountOut * (BPS_SCALE - BigInt(slippageBps))) / BPS_SCALE;

    let slippageBps = Math.min(intent.maxSlippageBps, swaps.maxSlippageBpsCap);
    let quote: Quote;
    try {
      quote = await requestQuote(slippageBps);
      // A larger amount can get a worse price than the poll did, so check this swap's own quote.
      if (quote.amountOut < floor) return stayPending('CONDITION_NOT_MET');

      // Slippage may only use the room above the limit, and the API builds the calldata from it.
      if (minimumAfter(quote.amountOut, slippageBps) < floor) {
        slippageBps = Number(((quote.amountOut - floor) * BPS_SCALE) / quote.amountOut);
        if (slippageBps === 0) return stayPending('NO_ROOM_ABOVE_LIMIT');
        quote = await requestQuote(slippageBps);
      }
    } catch {
      return stayPending('QUOTE_UNAVAILABLE');
    }

    const minOut = minimumAfter(quote.amountOut, slippageBps);
    if (minOut < floor) return stayPending('NO_ROOM_ABOVE_LIMIT');
    const transaction = quote.transaction;
    if (!transaction) return stayPending('NO_TRANSACTION');
    if (
      transaction.to !== getAddress(swaps.routerAddress) ||
      transaction.from !== getAddress(eoa) ||
      transaction.value !== intent.amountIn
    ) {
      return stayPending('UNEXPECTED_TRANSACTION');
    }
    try {
      assertSafeSwapCalldata({
        data: transaction.data,
        eoa,
        tokenOut: swaps.tokenOut,
        minOut,
        floor,
        nowSec,
      });
    } catch {
      return stayPending('UNSAFE_CALLDATA');
    }

    const call = { account: eoa, to: transaction.to, data: transaction.data, value: transaction.value };
    let gasLimit: bigint;
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint;
    let nonce: number;
    try {
      await chain.call(call);
      const [estimatedGas, fees, chainNonce] = await Promise.all([
        chain.estimateGas(call),
        chain.estimateFeesPerGas(),
        chain.getTransactionCount({ address: eoa, blockTag: 'pending' }),
      ]);
      gasLimit = (estimatedGas * this.deps.gasMarginPercent) / 100n;
      maxFeePerGas = fees.maxFeePerGas;
      maxPriorityFeePerGas = fees.maxPriorityFeePerGas;
      nonce = Math.max(chainNonce, this.nextNonces.get(eoa) ?? 0);
    } catch {
      return stayPending('SIMULATION_FAILED');
    }

    let raw: Hex;
    let txHash: Hex;
    try {
      await signer.registerOp(opId, {
        eoa,
        to: transaction.to,
        value: transaction.value,
        dataHash: keccak256(transaction.data),
        data: transaction.data,
      });
      raw = await signer.sign(
        eoa,
        {
          type: 'eip1559',
          chainId,
          nonce,
          gas: gasLimit,
          maxFeePerGas,
          maxPriorityFeePerGas,
          to: transaction.to,
          value: transaction.value,
          data: transaction.data,
        },
        opId,
      );
      txHash = keccak256(raw);
      await queue.run(() =>
        journal.append({
          t: 'EXEC_BROADCAST',
          opId,
          eoa,
          nonce,
          txHash,
          raw,
          intentId: stored.id,
        }),
      );
    } catch {
      // Nothing was broadcast, so the funds can safely go back.
      const reason = 'PREPARE_FAILED';
      await this.failIntent(stored, opId, swaps, reason);
      inventory.free(opId);
      return { status: 'failed', reason };
    }

    this.nextNonces.set(eoa, nonce + 1);
    inventory.linkOwner(owner, eoa);

    try {
      await chain.sendRawTransaction({ serializedTransaction: raw });
    } catch {
      // A send can fail after the node accepted it, so only the receipt decides the outcome.
    }

    let receipt;
    try {
      receipt = await chain.waitForTransactionReceipt({
        hash: txHash,
        confirmations: Number(confirmations) + 1,
        timeout: this.deps.receiptTimeoutMs,
      });
    } catch {
      return { status: 'unresolved', txHash };
    }

    return this.settleIntent(stored, opId, eoa, swaps, receipt, txHash);
  }

  /**
   * Runs one swap accounting has approved, and reports the result back to it.
   *
   * It stays away from the spot order rules on purpose: it never links the EOA to the owner, so
   * margin can't use up the addresses their withdrawals need, and it only avoids their deposit
   * addresses, so a liquidation can always find one. Everything before the broadcast event is a
   * definite failure, because nothing was sent.
   */
  async runMarginOperation(operation: MarginOperation): Promise<MarginOutcome> {
    const margin = this.deps.margin;
    if (!margin) throw new Error('MARGIN_NOT_CONFIGURED');
    const { chain, chainId, confirmations, inventory, journal, queue, signer } = this.deps;
    const { amountIn, minAmountOut, opId, owner, tokenIn, tokenOut } = operation;
    const nativeIn = getAddress(tokenIn) === getAddress(NATIVE);

    const fail = async (reason: string): Promise<MarginOutcome> => {
      await margin.accounting.fail(opId, { reason });
      inventory.free(opId);
      return { status: 'failed', reason };
    };

    try {
      await inventory.refresh();
    } catch {
      return fail('INVENTORY_UNAVAILABLE');
    }
    const chosen = inventory.pick(tokenIn, amountIn, margin.inventory.depositEoasOf(owner));
    if (!chosen) return fail(ERROR_CODES.NO_INVENTORY);
    const eoa = chosen.address;
    inventory.hold(eoa, tokenIn, amountIn, opId);

    if (!nativeIn) {
      try {
        await this.ensureApprovals(eoa, tokenIn, amountIn, margin);
      } catch {
        return fail('APPROVAL_FAILED');
      }
    }

    const nowSec = BigInt(Math.floor((margin.nowMs ?? Date.now)() / MS_PER_SECOND));
    if (BigInt(operation.expiry) <= nowSec) return fail(ERROR_CODES.EXPIRED);

    const requestQuote = (slippageBps: number) =>
      margin.quoter.quote({
        tokenIn,
        tokenOut,
        amountIn,
        swapper: eoa,
        slippagePercent: slippageBps / BPS_PER_PERCENT,
        protocols: SWAP_PROTOCOLS,
      });
    const minimumAfter = (amountOut: bigint, slippageBps: number) =>
      (amountOut * (BPS_SCALE - BigInt(slippageBps))) / BPS_SCALE;

    let slippageBps = Math.min(operation.maxSlippageBps, margin.maxSlippageBpsCap);
    let quote: Quote;
    try {
      quote = await requestQuote(slippageBps);
      if (quote.amountOut < minAmountOut) return fail('LIMIT_NOT_MET');
      // Slippage may only use the room above the approved minimum.
      if (minimumAfter(quote.amountOut, slippageBps) < minAmountOut) {
        slippageBps = Number(((quote.amountOut - minAmountOut) * BPS_SCALE) / quote.amountOut);
        if (slippageBps === 0) return fail('LIMIT_NOT_MET');
        quote = await requestQuote(slippageBps);
      }
    } catch {
      return fail('QUOTE_UNAVAILABLE');
    }
    const minOut = minimumAfter(quote.amountOut, slippageBps);
    const transaction = quote.transaction;
    if (minOut < minAmountOut) return fail('LIMIT_NOT_MET');
    if (!transaction) return fail('NO_TRANSACTION');
    if (
      transaction.to !== getAddress(margin.routerAddress) ||
      transaction.from !== getAddress(eoa) ||
      transaction.value !== (nativeIn ? amountIn : 0n)
    ) {
      return fail('UNEXPECTED_TRANSACTION');
    }
    try {
      if (nativeIn) {
        assertSafeSwapCalldata({ data: transaction.data, eoa, tokenOut, minOut, floor: minAmountOut, nowSec });
      } else {
        assertSafeTokenToNativeCalldata({
          data: transaction.data,
          eoa,
          tokenIn,
          wethAddress: margin.wethAddress,
          amountIn,
          minOut,
          nowSec,
        });
      }
    } catch {
      return fail('UNSAFE_CALLDATA');
    }

    let raw: Hex;
    let txHash: Hex;
    let nonce: number;
    try {
      const prepared = await this.prepareCall(eoa, transaction);
      nonce = prepared.nonce;
      await signer.registerOp(opId, {
        eoa,
        to: transaction.to,
        value: transaction.value,
        dataHash: keccak256(transaction.data),
        data: transaction.data,
      });
      raw = await signer.sign(eoa, { ...prepared, chainId }, opId);
      txHash = keccak256(raw);
      await queue.run(async () => {
        const event = { t: 'MARGIN_OP_BROADCAST', opId, eoa, nonce, txHash, raw } as const;
        await journal.append(event);
        margin.ledger.apply(event);
      });
    } catch {
      return fail('PREPARE_FAILED');
    }

    this.nextNonces.set(eoa, nonce + 1);
    try {
      await chain.sendRawTransaction({ serializedTransaction: raw });
    } catch {
      // A send can fail after the node accepted it, so only the receipt decides the outcome.
    }

    let receipt;
    try {
      receipt = await chain.waitForTransactionReceipt({
        hash: txHash,
        confirmations: Number(confirmations) + 1,
        timeout: this.deps.receiptTimeoutMs,
      });
    } catch {
      return { status: 'unresolved', txHash };
    }
    return this.settleMargin(operation, eoa, receipt, txHash);
  }

  private async settleMargin(
    operation: MarginOperation,
    eoa: Address,
    receipt: Receipt,
    txHash: Hex,
  ): Promise<MarginOutcome> {
    const margin = this.deps.margin;
    if (!margin) throw new Error('MARGIN_NOT_CONFIGURED');
    const { opId, tokenIn, tokenOut } = operation;
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;

    if (receipt.status !== 'success') {
      await margin.accounting.fail(opId, { reason: 'REVERTED', gasCost, txHash });
      await this.releaseEoa(opId);
      return { status: 'failed', reason: 'REVERTED', txHash };
    }

    const transfers = parseEventLogs({ abi: TRANSFER_EVENT, logs: receipt.logs, eventName: 'Transfer' });
    const nativeIn = getAddress(tokenIn) === getAddress(NATIVE);
    const amountIn = nativeIn
      ? operation.amountIn
      : transfers
          .filter((log) => getAddress(log.address) === getAddress(tokenIn) && getAddress(log.args.from) === getAddress(eoa))
          .reduce((sum, log) => sum + log.args.value, 0n);
    // ETH paid out leaves no Transfer event, but the router's unwrap shows on WETH.
    const amountOut = getAddress(tokenOut) === getAddress(NATIVE)
      ? parseEventLogs({ abi: WETH_WITHDRAWAL_EVENT, logs: receipt.logs, eventName: 'Withdrawal' })
          .filter(
            (log) =>
              getAddress(log.address) === getAddress(margin.wethAddress) &&
              getAddress(log.args.src) === getAddress(margin.routerAddress),
          )
          .reduce((sum, log) => sum + log.args.wad, 0n)
      : transfers
          .filter((log) => getAddress(log.address) === getAddress(tokenOut) && getAddress(log.args.to) === getAddress(eoa))
          .reduce((sum, log) => sum + log.args.value, 0n);

    await margin.accounting.settle(opId, { amountIn, amountOut, gasCost, txHash });
    await this.releaseEoa(opId);
    return { status: 'settled', txHash, amountIn, amountOut };
  }

  /**
   * An EOA spending a token needs two approvals, once: the token to Permit2, then Permit2 to the
   * router. With both in place the Trading API returns an ordinary swap with no permit to sign.
   * Only the router gets the allowance, and it can only pull funds when this EOA calls it.
   */
  private async ensureApprovals(
    eoa: Address,
    token: Address,
    amount: bigint,
    margin: MarginExecutionDeps,
  ): Promise<void> {
    const { reader, routerAddress } = margin;
    const toPermit2 = (await reader.readContract({
      address: token,
      abi: ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [eoa, PERMIT2_ADDRESS],
    })) as bigint;
    if (toPermit2 < amount) {
      await this.sendApproval(eoa, token, encodeFunctionData({
        abi: ALLOWANCE_ABI,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS, MAX_UINT256],
      }), margin);
    }

    const [toRouter, expiration] = (await reader.readContract({
      address: PERMIT2_ADDRESS,
      abi: ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [eoa, token, routerAddress],
    })) as readonly [bigint, number, number];
    const nowSec = Math.floor((margin.nowMs ?? Date.now)() / MS_PER_SECOND);
    if (toRouter < amount || expiration <= nowSec) {
      await this.sendApproval(eoa, PERMIT2_ADDRESS, encodeFunctionData({
        abi: ALLOWANCE_ABI,
        functionName: 'approve',
        args: [token, routerAddress, MAX_UINT160, MAX_UINT48],
      }), margin);
    }
  }

  private async sendApproval(eoa: Address, to: Address, data: Hex, margin: MarginExecutionDeps): Promise<void> {
    const { chain, chainId, confirmations, journal, queue, signer } = this.deps;
    const prepared = await this.prepareCall(eoa, { to, data, value: 0n });
    // The signer never signs one opId twice, so a retry after a failure needs a new one.
    const opId = `approval:${eoa}:${prepared.nonce}:${to.slice(2, 10)}`;
    await signer.registerOp(opId, { eoa, to, value: 0n, dataHash: keccak256(data), data });
    const raw = await signer.sign(eoa, { ...prepared, chainId }, opId);
    this.nextNonces.set(eoa, prepared.nonce + 1);
    const hash = await chain.sendRawTransaction({ serializedTransaction: raw });
    const receipt = await chain.waitForTransactionReceipt({
      hash,
      confirmations: Number(confirmations) + 1,
      timeout: this.deps.receiptTimeoutMs,
    });
    await queue.run(async () => {
      const booked = {
        t: 'FEE_BOOKED',
        opId,
        token: NATIVE,
        feeAmount: receipt.gasUsed * receipt.effectiveGasPrice,
      } as const;
      await journal.append(booked);
      margin.ledger.apply(booked);
    });
    if (receipt.status !== 'success') throw new Error('APPROVAL_REVERTED');
  }

  /** Simulates a call, then fills in the gas and nonce needed to sign it. */
  private async prepareCall(eoa: Address, call: { to: Address; data: Hex; value: bigint }) {
    const { chain, gasMarginPercent } = this.deps;
    const request = { account: eoa, ...call };
    await chain.call(request);
    const [estimatedGas, fees, chainNonce] = await Promise.all([
      chain.estimateGas(request),
      chain.estimateFeesPerGas(),
      chain.getTransactionCount({ address: eoa, blockTag: 'pending' }),
    ]);
    return {
      type: 'eip1559' as const,
      nonce: Math.max(chainNonce, this.nextNonces.get(eoa) ?? 0),
      gas: (estimatedGas * gasMarginPercent) / 100n,
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      to: call.to,
      value: call.value,
      data: call.data,
    };
  }

  private async settleIntent(
    stored: StoredIntent,
    opId: string,
    eoa: Address,
    swaps: SwapDeps,
    receipt: Receipt,
    txHash: Hex,
  ): Promise<SwapOutcome> {
    const { journal, queue } = this.deps;
    const { owner } = stored;
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    if (receipt.status !== 'success') {
      const reason = 'REVERTED';
      await this.failIntent(stored, opId, swaps, reason, gasCost);
      await this.releaseEoa(opId);
      return { status: 'failed', reason, txHash };
    }

    const amountOut = parseEventLogs({ abi: TRANSFER_EVENT, logs: receipt.logs, eventName: 'Transfer' })
      .filter(
        (log) =>
          getAddress(log.address) === getAddress(swaps.tokenOut) &&
          getAddress(log.args.to) === getAddress(eoa),
      )
      .reduce((sum, log) => sum + log.args.value, 0n);
    const fee = (amountOut * BigInt(swaps.feeBps)) / BPS_SCALE;

    await queue.run(async () => {
      const settled = {
        t: 'EXEC_SETTLED',
        opId,
        intentId: stored.id,
        owner,
        tokenOut: swaps.tokenOut,
        amountOut,
        fee,
      } as const;
      await journal.append(settled);
      swaps.ledger.apply(settled);
      const booked = { t: 'FEE_BOOKED', opId, token: NATIVE, feeAmount: gasCost } as const;
      await journal.append(booked);
      swaps.ledger.apply(booked);
    });
    swaps.intents.mark(stored.id, 'done', amountOut - fee);
    await this.releaseEoa(opId);
    return { status: 'settled', txHash, amountOut, fee };
  }

  private async failIntent(
    stored: StoredIntent,
    opId: string,
    swaps: SwapDeps,
    reason: string,
    gasCost?: bigint,
  ): Promise<void> {
    const { journal, queue } = this.deps;
    await queue.run(async () => {
      const failed = {
        t: 'EXEC_FAILED',
        opId,
        intentId: stored.id,
        owner: stored.owner,
        reason,
      } as const;
      await journal.append(failed);
      swaps.ledger.apply(failed);
      if (gasCost !== undefined) {
        const booked = { t: 'FEE_BOOKED', opId, token: NATIVE, feeAmount: gasCost } as const;
        await journal.append(booked);
        swaps.ledger.apply(booked);
      }
    });
    swaps.intents.mark(stored.id, 'failed');
  }

  private async executeWithdrawal(
    withdrawal: LockedWithdrawal,
    eoa: Address,
  ): Promise<WithdrawalOutcome> {
    const { chain, confirmations, journal, queue, inventory } = this.deps;
    let prepared: PreparedTransaction;

    try {
      prepared = await this.prepareWithdrawal(withdrawal, eoa);
      await queue.run(() =>
        journal.append({
          t: 'WITHDRAWAL_BROADCAST',
          id: withdrawal.id,
          eoa,
          nonce: prepared.nonce,
          txHash: prepared.txHash,
          raw: prepared.raw,
        }),
      );
    } catch {
      // Nothing was broadcast, so the funds can safely go back.
      const reason = 'PREPARE_FAILED';
      await this.failWithdrawal(withdrawal, reason);
      inventory.free(withdrawal.id);
      return { status: 'failed', reason };
    }

    this.nextNonces.set(eoa, prepared.nonce + 1);
    const { txHash } = prepared;

    try {
      await chain.sendRawTransaction({ serializedTransaction: prepared.raw });
    } catch {
      // A send can fail after the node accepted it, so only the receipt decides the outcome.
    }

    let receipt;
    try {
      receipt = await chain.waitForTransactionReceipt({
        hash: txHash,
        // viem counts the block holding the transaction as the first confirmation.
        confirmations: Number(confirmations) + 1,
        timeout: this.deps.receiptTimeoutMs,
      });
    } catch {
      return { status: 'unresolved', txHash };
    }

    return this.settleWithdrawal(withdrawal, receipt, txHash);
  }

  private async settleWithdrawal(
    withdrawal: LockedWithdrawal,
    receipt: Receipt,
    txHash: Hex,
  ): Promise<WithdrawalOutcome> {
    const { journal, queue } = this.deps;
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;
    if (receipt.status === 'success') {
      await queue.run(async () => {
        await journal.append({
          t: 'WITHDRAWAL_CONFIRMED',
          id: withdrawal.id,
          owner: withdrawal.owner,
        });
        this.deps.ledger.consume(withdrawal.id);
        await journal.append({
          t: 'FEE_BOOKED',
          opId: withdrawal.id,
          token: NATIVE,
          feeAmount: gasCost,
        });
        this.deps.ledger.bookOperationalGas?.(withdrawal.id, NATIVE, gasCost);
      });
      await this.releaseEoa(withdrawal.id);
      return { status: 'confirmed', txHash };
    }

    const reason = 'REVERTED';
    await this.failWithdrawal(withdrawal, reason, gasCost);
    await this.releaseEoa(withdrawal.id);
    return { status: 'failed', reason, txHash };
  }

  private async prepareWithdrawal(
    withdrawal: LockedWithdrawal,
    eoa: Address,
  ): Promise<PreparedTransaction> {
    const { chain, chainId, signer } = this.deps;
    const payment = this.buildPayment(withdrawal);

    await signer.registerOp(withdrawal.id, {
      eoa,
      to: payment.to,
      value: payment.value,
      dataHash: keccak256(payment.data),
    });

    const [estimatedGas, fees, chainNonce] = await Promise.all([
      chain.estimateGas({ account: eoa, ...payment }),
      chain.estimateFeesPerGas(),
      chain.getTransactionCount({ address: eoa, blockTag: 'pending' }),
    ]);
    const nonce = Math.max(chainNonce, this.nextNonces.get(eoa) ?? 0);

    const raw = await signer.sign(
      eoa,
      {
        type: 'eip1559',
        chainId,
        nonce,
        gas: (estimatedGas * this.deps.gasMarginPercent) / 100n,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        ...payment,
      },
      withdrawal.id,
    );

    return { eoa, nonce, raw, txHash: keccak256(raw) };
  }

  /** The destination is always the `to` the owner signed. */
  private buildPayment(withdrawal: LockedWithdrawal): { to: Address; value: bigint; data: Hex } {
    if (withdrawal.token === NATIVE) {
      return { to: withdrawal.to, value: withdrawal.amount, data: '0x' };
    }
    return {
      to: withdrawal.token,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [withdrawal.to, withdrawal.amount],
      }),
    };
  }

  private async failWithdrawal(
    withdrawal: LockedWithdrawal,
    reason: string,
    gasCost?: bigint,
  ): Promise<void> {
    const { journal, ledger, queue } = this.deps;
    await queue.run(async () => {
      await journal.append({
        t: 'WITHDRAWAL_FAILED',
        id: withdrawal.id,
        owner: withdrawal.owner,
        reason,
      });
      ledger.release(withdrawal.id);
      if (gasCost !== undefined) {
        await journal.append({
          t: 'FEE_BOOKED',
          opId: withdrawal.id,
          token: NATIVE,
          feeAmount: gasCost,
        });
        ledger.bookOperationalGas?.(withdrawal.id, NATIVE, gasCost);
      }
    });
  }

  /**
   * Refreshes before freeing, so spent funds never look available. If every refresh fails the
   * EOA stays busy, which only makes it unavailable, and never risks overspending.
   */
  private async releaseEoa(opId: string): Promise<void> {
    for (let attempt = 0; attempt < this.deps.inventorySettleAttempts; attempt++) {
      try {
        await this.deps.inventory.refresh();
        this.deps.inventory.free(opId);
        return;
      } catch {
        // Try again.
      }
    }
  }
}
