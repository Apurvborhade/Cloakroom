import { ERROR_CODES, ESCAPE_ERROR_CODES, ESCAPE_HATCH_ABI, NATIVE, escapeClaimId } from '@cloakroom/shared';
import type { EscapeActivateMsg, EscapeEvent, Journal, SerialQueue } from '@cloakroom/shared';
import { encodeFunctionData, getAddress, keccak256 } from 'viem';
import type { Address, Hex, PublicClient, TransactionReceipt } from 'viem';
import { AuthError } from './auth.js';
import type { EscapeRecord } from './escape-state.js';
import type { KeyManager } from './keys.js';
import type { InMemoryLedger } from './ledger.js';
import { FifoSerialQueue } from './queue.js';

export interface EscapeDeps {
  chain: PublicClient;
  chainId: number;
  hatch: Address;
  keys: KeyManager;
  journal: Pick<Journal, 'append' | 'replay'>;
  ledger: InMemoryLedger;
  queue: SerialQueue;
  confirmations: bigint;
  receiptTimeoutMs: number;
  gasMarginPercent: bigint;
  healthy?: () => boolean;
  onError?: () => void;
}

export class EscapeHatchService {
  private readonly operations = new FifoSerialQueue();
  private running = false;
  private stopped = false;
  private timeout = 0n;
  private lastHeartbeat = 0n;
  private expired = false;
  private readonly hatch: Address;
  constructor(private readonly deps: EscapeDeps) { this.hatch = getAddress(deps.hatch); }

  private async write(event: EscapeEvent): Promise<void> {
    await this.deps.queue.run(async () => {
      try { await this.deps.journal.append(event); this.deps.ledger.apply(event); }
      catch { this.stopped = true; this.deps.keys.close(); throw new Error('ESCAPE_JOURNAL_UNAVAILABLE'); }
    });
  }

  private async assertHealthy(): Promise<void> {
    if (this.stopped || this.deps.healthy?.() === false) throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_UNAVAILABLE);
    this.deps.keys.transportPublicKey();
    this.deps.ledger.assertInvariants();
    for await (const _entry of this.deps.journal.replay()) { /* Detect closed/corrupt storage. */ }
  }

  async init(): Promise<void> {
    const { chain, keys, ledger } = this.deps;
    if (await chain.getChainId() !== this.deps.chainId) throw new Error('ESCAPE_CHAIN_MISMATCH');
    const signer = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'enclaveSigner' });
    if (getAddress(signer) !== keys.escapeSignerAddress()) throw new Error('ESCAPE_SIGNER_MISMATCH');
    this.timeout = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'timeout' });
    if (this.timeout < 3n) throw new Error('ESCAPE_TIMEOUT_TOO_SHORT');
    if (ledger.escape.all().some((record) => record.hatch !== this.hatch && record.status !== 'failed')) {
      throw new Error('ESCAPE_CONTRACT_MISMATCH');
    }
    await this.operations.run(async () => {
      await this.restorePending();
      for (const record of ledger.escape.all()) {
        if (record.status !== 'reserved') continue;
        const registered = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI,
          functionName: 'registered', args: [record.claimId] });
        if (registered) throw new Error('ESCAPE_STATE_MISMATCH');
        // No signature exists and nothing could have left this enclave.
        await this.write({ t: 'ESCAPE_FAILED', id: record.id, reason: 'INTERRUPTED' });
      }
      await this.reconcile();
    });
  }

  private async restorePending(): Promise<void> {
    const { keys, ledger } = this.deps;
    const pending = keys.escapePending();
    if (ledger.escape.all().some((record) => record.status === 'broadcast' && record.id !== pending?.id)) {
      throw new Error('ESCAPE_STATE_MISMATCH');
    }
    if (!pending) {
      if (ledger.escape.all().some((record) => record.status === 'broadcast')) throw new Error('ESCAPE_STATE_MISMATCH');
      return;
    }
    if (pending.id) {
      const record = ledger.escape.get(pending.id);
      if (!record || record.hatch !== this.hatch) throw new Error('ESCAPE_STATE_MISMATCH');
      if (record.status === 'reserved') {
        await this.write({ t: 'ESCAPE_BROADCAST', id: record.id, nonce: pending.nonce,
          raw: pending.raw, txHash: keccak256(pending.raw) });
      } else if (record.raw !== pending.raw || record.txHash !== keccak256(pending.raw)) {
        throw new Error('ESCAPE_STATE_MISMATCH');
      }
    }
    await this.finishPending();
  }

  private async receipt(hash: Hex): Promise<TransactionReceipt | undefined> {
    try {
      const receipt = await this.deps.chain.getTransactionReceipt({ hash });
      const head = await this.deps.chain.getBlockNumber({ cacheTime: 0 });
      return head >= receipt.blockNumber + this.deps.confirmations ? receipt : undefined;
    } catch { return undefined; }
  }

  private async finishPending(): Promise<boolean> {
    const { chain, keys, ledger } = this.deps;
    const pending = keys.escapePending();
    if (!pending) return true;
    const hash = keccak256(pending.raw);
    let receipt = await this.receipt(hash);
    if (!receipt) {
      if (!pending.id) await this.assertHealthy();
      try { await chain.sendRawTransaction({ serializedTransaction: pending.raw }); } catch { /* Keep the same signed bytes. */ }
      try {
        await chain.waitForTransactionReceipt({ hash, confirmations: Number(this.deps.confirmations) + 1,
          timeout: this.deps.receiptTimeoutMs });
      } catch { return false; }
      receipt = await this.receipt(hash);
      if (!receipt) return false;
    }
    if (pending.id) {
      const record = ledger.escape.get(pending.id);
      if (!record) throw new Error('ESCAPE_STATE_MISMATCH');
      if (record.status === 'broadcast') {
        const registered = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI,
          functionName: 'registered', args: [record.claimId], blockNumber: receipt.blockNumber });
        const amount = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI,
          functionName: 'claims', args: [record.claimId], blockNumber: receipt.blockNumber });
        if (registered) {
          if (receipt.status !== 'success' || amount !== record.amount) throw new Error('ESCAPE_STATE_MISMATCH');
          await this.write({ t: 'ESCAPE_REGISTERED', id: record.id });
        } else if (receipt.status === 'reverted') {
          await this.write({ t: 'ESCAPE_FAILED', id: record.id, reason: 'REGISTRATION_REVERTED' });
        } else throw new Error('ESCAPE_STATE_MISMATCH');
      } else if (record.status !== 'registered' && record.status !== 'claimed' && record.status !== 'failed') {
        throw new Error('ESCAPE_STATE_MISMATCH');
      }
    }
    await keys.clearEscapePending(hash);
    return true;
  }

  private async reconcile(): Promise<void> {
    const { chain, ledger } = this.deps;
    const head = await chain.getBlockNumber({ cacheTime: 0 });
    const blockNumber = head >= this.deps.confirmations ? head - this.deps.confirmations : 0n;
    let total = 0n;
    for (const record of ledger.escape.all()) {
      if (record.status === 'failed' || record.status === 'reserved') continue;
      const registered = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI,
        functionName: 'registered', args: [record.claimId], blockNumber });
      const amount = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI,
        functionName: 'claims', args: [record.claimId], blockNumber });
      if (record.status === 'broadcast') {
        if (registered) total += amount;
        continue;
      }
      if (!registered || (amount !== 0n && amount !== record.amount)
          || (record.status === 'claimed' && amount !== 0n)) throw new Error('ESCAPE_STATE_MISMATCH');
      total += amount;
      if (amount === 0n && record.status === 'registered') await this.write({ t: 'ESCAPE_CLAIMED', id: record.id });
    }
    const reserved = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'totalReserved', blockNumber });
    if (reserved !== total) throw new Error('ESCAPE_STATE_MISMATCH');
    this.lastHeartbeat = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'lastHeartbeat' });
    this.expired = await chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'expired' });
  }

  private async eligible(owner: Address, amount: bigint): Promise<void> {
    const { ledger, journal } = this.deps;
    const previous = ledger.escape.owner(owner);
    if (previous && previous.status !== 'failed') throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_ALREADY_REGISTERED);
    const balances = ledger.balances(owner);
    if (amount <= 0n || ledger.getBalance(owner, NATIVE).available !== amount
        || balances.some((balance) => balance.reserved > 0n || (balance.token !== NATIVE && balance.available > 0n))) {
      throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_INELIGIBLE);
    }
    const sessions = new Set<string>();
    for await (const { event } of journal.replay()) {
      if (event.t === 'DEPOSIT_SESSION_OPENED' && getAddress(event.owner) === owner) sessions.add(event.id);
      if (event.t === 'DEPOSIT_SESSION_CLOSED' || event.t === 'DEPOSIT_COMPLETED') sessions.delete(event.id);
      if ((event.t === 'INTENT_CREATED' || event.t === 'MARGIN_SUPPLIED' || event.t === 'MARGIN_REDEEMED'
          || event.t === 'MARGIN_OPEN_RESERVED' || event.t === 'MARGIN_OP_APPROVED') && getAddress(event.owner) === owner) {
        throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_INELIGIBLE);
      }
    }
    if (sessions.size > 0) throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_INELIGIBLE);
  }

  validateActivation(message: EscapeActivateMsg, code: Hex): void {
    const owner = getAddress(message.owner);
    if (getAddress(message.hatch) !== this.hatch || escapeClaimId(this.deps.chainId, this.hatch, owner, code) !== message.claimId.toLowerCase()) {
      throw new AuthError(ERROR_CODES.INVALID_PAYLOAD);
    }
  }

  async activate(message: EscapeActivateMsg, code: Hex): Promise<EscapeRecord> {
    this.validateActivation(message, code);
    await this.assertHealthy();
    const owner = getAddress(message.owner);
    if (await this.deps.chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'registered', args: [message.claimId] })) {
      throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_ALREADY_REGISTERED);
    }
    if (await this.deps.chain.readContract({ address: this.hatch, abi: ESCAPE_HATCH_ABI, functionName: 'expired' })) {
      throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_UNAVAILABLE);
    }
    const id = `escape:${owner}:${message.nonce}`;
    await this.deps.queue.run(async () => {
      await this.eligible(owner, message.amount);
      if (this.deps.ledger.escape.all().some((record) => record.claimId.toLowerCase() === message.claimId.toLowerCase() && record.status !== 'failed')) {
        throw new AuthError(ESCAPE_ERROR_CODES.ESCAPE_ALREADY_REGISTERED);
      }
      const event = { t: 'ESCAPE_RESERVED', id, owner, hatch: this.hatch, claimId: message.claimId.toLowerCase() as Hex, amount: message.amount } as const;
      try { await this.deps.journal.append(event); this.deps.ledger.apply(event); }
      catch { this.stopped = true; this.deps.keys.close(); throw new Error('ESCAPE_JOURNAL_UNAVAILABLE'); }
    });
    void this.operations.run(() => this.register(id)).catch(() => this.deps.onError?.());
    return this.deps.ledger.escape.get(id)!;
  }

  private async transaction(data: Hex) {
    const { chain, keys } = this.deps;
    const account = keys.escapeSignerAddress();
    const [gasEstimate, fees, nonce, balance] = await Promise.all([
      chain.estimateGas({ account, to: this.hatch, data, value: 0n }), chain.estimateFeesPerGas(),
      chain.getTransactionCount({ address: account, blockTag: 'pending' }), chain.getBalance({ address: account, blockTag: 'pending' }),
    ]);
    const gas = gasEstimate * this.deps.gasMarginPercent / 100n;
    if (balance < gas * fees.maxFeePerGas) throw new Error('ESCAPE_GAS_REQUIRED');
    return { type: 'eip1559' as const, chainId: this.deps.chainId, to: this.hatch, value: 0n, data,
      nonce, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
  }

  private async register(id: string): Promise<void> {
    if (this.stopped) return;
    await this.assertHealthy();
    if (!await this.finishPending()) return;
    const record = this.deps.ledger.escape.get(id);
    if (!record || record.status !== 'reserved') return;
    try {
      const data = encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'registerClaim', args: [record.claimId, record.amount] });
      const tx = await this.transaction(data);
      const raw = await this.deps.keys.signEscape(tx, id);
      await this.write({ t: 'ESCAPE_BROADCAST', id, raw, nonce: tx.nonce, txHash: keccak256(raw) });
    } catch {
      // A signed or uncertain sealed write may still recover; never release it here.
      if (this.stopped) throw new Error('ESCAPE_JOURNAL_UNAVAILABLE');
      const pending = this.deps.keys.escapePending();
      if (pending) throw new Error('ESCAPE_PENDING');
      await this.write({ t: 'ESCAPE_FAILED', id, reason: 'REGISTRATION_UNAVAILABLE' });
      return;
    }
    await this.finishPending();
    await this.reconcile();
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.operations.run(async () => {
        await this.assertHealthy();
        if (!await this.finishPending()) return;
        await this.reconcile();
        if (this.expired) {
          for (const record of this.deps.ledger.escape.all()) {
            if (record.status === 'reserved') await this.write({ t: 'ESCAPE_FAILED', id: record.id, reason: 'ESCAPE_EXPIRED' });
          }
          return;
        }
        for (const record of this.deps.ledger.escape.all()) {
          if (record.status === 'reserved') await this.register(record.id);
          if (this.deps.keys.escapePending()) return;
        }
        if (!this.deps.ledger.escape.all().some((record) => record.status === 'registered')) return;
        const block = await this.deps.chain.getBlock();
        if (block.timestamp < this.lastHeartbeat + this.timeout / 3n) return;
        const data = encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'heartbeat' });
        await this.deps.keys.signEscape(await this.transaction(data));
        await this.finishPending();
        await this.reconcile();
      });
    } finally { this.running = false; }
  }

  start(): () => Promise<void> {
    const interval = Math.max(1000, Math.min(5000, Number(this.timeout * 1000n / 4n)));
    const timer = setInterval(() => { void this.tick().catch(() => this.deps.onError?.()); }, interval);
    timer.unref();
    return async () => { this.stopped = true; clearInterval(timer); await this.operations.run(async () => {}); };
  }

  status(owner: Address) {
    return { hatch: this.hatch, escapeSigner: this.deps.keys.escapeSignerAddress(), expired: this.expired,
      lastHeartbeat: this.lastHeartbeat.toString(), timeout: this.timeout.toString(), claim: this.deps.ledger.escape.owner(owner) ?? null };
  }
}
