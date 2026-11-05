import { ERROR_CODES, NATIVE } from '@cloakroom/shared';
import type { Journal, Ledger, LockedWithdrawal, SerialQueue } from '@cloakroom/shared';
import { encodeFunctionData, keccak256, parseAbi } from 'viem';
import type { Address, Hex, PublicClient, TransactionSerializableEIP1559 } from 'viem';
import type { Inventory } from './inventory.js';

const ERC20_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);

/** What the signing guard must see before it will sign an operation. */
export interface ExpectedTransaction {
  eoa: Address;
  to: Address;
  value: bigint;
  dataHash: Hex;
}

/** The part of Felix's KeyManager that the executor uses. */
export interface TransactionSigner {
  registerOp(opId: string, expected: ExpectedTransaction): void | Promise<void>;
  /** Returns the serialized signed transaction. Refuses anything not registered. */
  sign(eoa: Address, tx: TransactionSerializableEIP1559, opId: string): Promise<Hex>;
}

export type ExecutorChain = Pick<
  PublicClient,
  | 'estimateFeesPerGas'
  | 'estimateGas'
  | 'getTransactionCount'
  | 'sendRawTransaction'
  | 'waitForTransactionReceipt'
>;

export interface ExecutorDeps {
  chain: ExecutorChain;
  chainId: number;
  signer: TransactionSigner;
  inventory: Pick<Inventory, 'eoasLinkedTo' | 'free' | 'hold' | 'pick' | 'refresh'>;
  journal: Pick<Journal, 'append'>;
  /** The withdrawal ID must be the ref the funds were reserved under. */
  ledger: Pick<Ledger, 'consume' | 'release'>;
  queue: SerialQueue;
  confirmations: bigint;
  receiptTimeoutMs: number;
  /** Gas limit as a percentage of the estimate. */
  gasMarginPercent: bigint;
  /** How many times to try refreshing balances before freeing an EOA. */
  inventorySettleAttempts: number;
}

export type WithdrawalOutcome =
  | { status: 'confirmed'; txHash: Hex }
  | { status: 'failed'; reason: string; txHash?: Hex }
  /**
   * The transaction was broadcast but its result is unknown, and it may still land.
   * The funds stay reserved and the EOA stays busy until recovery settles it.
   */
  | { status: 'unresolved'; txHash: Hex };

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

  constructor(private readonly deps: ExecutorDeps) {}

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
