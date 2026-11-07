import { createCipheriv, createDecipheriv, createSecretKey, hkdfSync, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { createTransportSuite, ESCAPE_HATCH_ABI, NATIVE, PERMIT2_ADDRESS } from '@cloakroom/shared';
import type { CustodyEOA, Envelope, Journal, JournalEvent } from '@cloakroom/shared';
import { encodeFunctionData, getAddress, keccak256, parseAbi, parseTransaction, serializeTransaction } from 'viem';
import type { Address, Hex, TransactionSerializableEIP1559 } from 'viem';
import { HDKey, hdKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import type { ExpectedTransaction, TransactionSigner } from './executor.js';
import { openEnvelopeWithResponse } from './envelope.js';
import { FifoSerialQueue } from './queue.js';
import type { StateVault } from './sealed-state.js';
import { assertSafeSwapCalldata, assertSafeTokenToNativeCalldata, limitFloor } from './swap-calldata.js';

const HEX = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/);
const STATE_SCHEMA = z.object({
  version: z.literal(1), seed: z.string().regex(/^[a-f0-9]{64}$/),
  allocations: z.array(z.enum(['deposit', 'inventory'])).max(10_000),
  seedingClaimed: z.boolean().default(false),
  escapePending: z.object({ raw: HEX, nonce: z.number().int().nonnegative(), id: z.string().optional() }).strict().optional(),
  signedOperations: z.array(z.object({
    opId: z.string().min(1).max(128), index: z.number().int().nonnegative(), raw: HEX,
    requestHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  }).strict()).max(10_000),
}).strict();
type State = z.infer<typeof STATE_SCHEMA>;
const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
const APPROVAL_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
const MAX_UINT256 = 2n ** 256n - 1n;
const MAX_UINT160 = 2n ** 160n - 1n;
const MAX_UINT48 = 2 ** 48 - 1;
const denied = () => new Error('SIGNING_DENIED');

/** Attestation-only bootstrap. Full custody uses KeyManager's sealed identity instead. */
export async function createBootstrapIdentity() {
  const suite = createTransportSuite();
  const pair = await suite.kem.generateKeyPair();
  const publicKey = `0x${Buffer.from(await suite.kem.serializePublicKey(pair.publicKey)).toString('hex')}` as Hex;
  return { transportPublicKey: () => publicKey };
}

export interface SigningPolicy {
  chainId: number;
  maxGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxNativeValue: bigint;
  swaps?: {
    routerAddress: Address;
    tokenOut: Address;
    tokenOutDecimals: number;
    feeBps: number;
  };
  /** Present only when margin trading is switched on. */
  margin?: { wethAddress: Address };
  escapeHatch?: Address;
}

export interface JournalCipher {
  encrypt(plaintext: Uint8Array, associatedData: Uint8Array): Uint8Array;
  decrypt(ciphertext: Uint8Array, associatedData: Uint8Array): Uint8Array;
}

/** Private custody and transport material stays behind this object; no secret getters. */
export class KeyManager implements TransactionSigner {
  readonly #vault: StateVault;
  readonly #journal: Pick<Journal, 'append' | 'replay'>;
  readonly #policy: Readonly<SigningPolicy>;
  readonly #allowCreate: boolean;
  readonly #onFault?: () => void;
  readonly #queue = new FifoSerialQueue();
  readonly #registered = new Map<string, ExpectedTransaction>();
  #state: State | undefined;
  #revision: number | null = null;
  #transport: CryptoKeyPair | undefined;
  #transportPublicKey: Hex | undefined;
  #initializing: Promise<void> | undefined;
  #faulted = false;
  #initialized = false;

  constructor(options: {
    vault: StateVault; journal: Pick<Journal, 'append' | 'replay'>;
    policy: SigningPolicy; simMode?: boolean; allowCreate?: boolean; onFault?: () => void;
  }) {
    if (options.vault.protection === 'simulation' && options.simMode !== true) throw new Error('SIM_MODE_REQUIRED');
    const policy = options.policy;
    if (!Number.isSafeInteger(policy.chainId) || policy.chainId <= 0
        || [policy.maxGas, policy.maxFeePerGas, policy.maxPriorityFeePerGas, policy.maxNativeValue]
          .some((value) => typeof value !== 'bigint' || value <= 0n)) throw new Error('INVALID_SIGNING_POLICY');
    this.#vault = options.vault;
    this.#journal = options.journal;
    try {
      const swaps = policy.swaps;
      if (swaps && (!Number.isInteger(swaps.tokenOutDecimals)
          || swaps.tokenOutDecimals < 0 || swaps.tokenOutDecimals > 255
          || !Number.isInteger(swaps.feeBps) || swaps.feeBps < 0 || swaps.feeBps >= 10_000)) throw new Error();
      this.#policy = Object.freeze({ ...policy, ...(policy.escapeHatch ? { escapeHatch: getAddress(policy.escapeHatch) } : {}), ...(swaps ? { swaps: Object.freeze({
        routerAddress: getAddress(swaps.routerAddress), tokenOut: getAddress(swaps.tokenOut),
        tokenOutDecimals: swaps.tokenOutDecimals, feeBps: swaps.feeBps,
      }) } : {}) });
    } catch { throw new Error('INVALID_SIGNING_POLICY'); }
    this.#allowCreate = options.allowCreate === true;
    this.#onFault = options.onFault;
  }

  [inspect.custom](): string { return '[KeyManager]'; }
  toJSON(): string { return '[KeyManager]'; }

  async init(): Promise<void> {
    this.#initializing ??= this.#initialize();
    return this.#initializing;
  }

  close(): void { this.#faulted = true; }

  #fault(): void { this.#faulted = true; this.#onFault?.(); }

  async #initialize(): Promise<void> {
    try {
      const saved = await this.#vault.read();
      if (saved) {
        this.#state = STATE_SCHEMA.parse(JSON.parse(Buffer.from(saved.plaintext).toString('utf8')));
        this.#revision = saved.revision;
      } else {
        if (!this.#allowCreate) throw new Error('SEALED_STATE_MISSING');
        const initial: State = { version: 1, seed: randomBytes(32).toString('hex'), allocations: [], signedOperations: [], seedingClaimed: false };
        await this.#persist(initial);
      }
      const state = this.#ready();
      const transportSeed = this.#derive('cloakroom/transport/v1');
      try { this.#transport = await createTransportSuite().kem.deriveKeyPair(transportSeed); }
      finally { transportSeed.fill(0); }
      const publicKey = await createTransportSuite().kem.serializePublicKey(this.#transport.publicKey);
      this.#transportPublicKey = `0x${Buffer.from(publicKey).toString('hex')}`;
      const seen = new Set<string>();
      for (const operation of state.signedOperations) {
        if (operation.index >= state.allocations.length || seen.has(operation.opId)) throw new Error();
        seen.add(operation.opId);
      }
      this.#initialized = true;
    } catch {
      this.#fault();
      throw new Error('KEY_MANAGER_UNAVAILABLE');
    }
  }

  /** Call after the journal has been opened with journalCipher(). Signing also calls it. */
  restoreSigningState(): Promise<void> {
    return this.#queue.run(() => this.#restoreSigningState());
  }

  async #restoreSigningState(): Promise<void> {
    const state = this.#ready();
    if (!this.#initialized) throw new Error('KEY_MANAGER_UNAVAILABLE');
    try {
      for await (const { event } of this.#journal.replay()) {
        if (event.t === 'SIGNING_REGISTERED') {
          if (event.chainId !== this.#policy.chainId) throw new Error();
          this.#registered.set(event.opId, this.#normalize(event));
        }
        if (event.t === 'SIGNING_COMPLETED') {
          const operation = state.signedOperations.find((record) => record.opId === event.opId);
          if (!operation || keccak256(operation.raw as Hex) !== event.txHash) throw new Error('SEALED_STATE_ROLLBACK');
        }
      }
    } catch {
      this.#fault();
      throw new Error('KEY_MANAGER_UNAVAILABLE');
    }
  }

  #ready(): State {
    if (this.#faulted || !this.#state) throw new Error('KEY_MANAGER_UNAVAILABLE');
    return this.#state;
  }

  #derive(label: string): Buffer {
    return Buffer.from(hkdfSync('sha256', Buffer.from(this.#ready().seed, 'hex'), Buffer.alloc(0), label, 32));
  }

  async #persist(next: State): Promise<void> {
    try {
      this.#revision = await this.#vault.write(Buffer.from(JSON.stringify(next)), this.#revision);
      this.#state = next;
    } catch {
      // A write may have committed before its acknowledgement was lost. Never guess.
      this.#fault();
      throw new Error('KEY_MANAGER_UNAVAILABLE');
    }
  }

  #account(index: number) {
    const seed = Buffer.from(this.#ready().seed, 'hex');
    try { return hdKeyToAccount(HDKey.fromMasterSeed(seed), { addressIndex: index }); }
    finally { seed.fill(0); }
  }

  list(): CustodyEOA[] {
    if (!this.#initialized) throw new Error('KEY_MANAGER_UNAVAILABLE');
    return this.#ready().allocations.map((role, index) => ({
      index, role, address: this.#account(index).address, lastUsedAt: 0,
    }));
  }

  allocate(role: CustodyEOA['role']): Promise<CustodyEOA> {
    return this.#queue.run(async () => {
      if (!this.#initialized) throw new Error('KEY_MANAGER_UNAVAILABLE');
      if (role !== 'deposit' && role !== 'inventory') throw new Error('INVALID_ROLE');
      const current = this.#ready();
      if (current.allocations.length >= 10_000) throw new Error('ALLOCATION_LIMIT');
      const index = current.allocations.length;
      const address = this.#account(index).address;
      await this.#persist({ ...current, allocations: [...current.allocations, role] });
      return { index, role, address, lastUsedAt: 0 };
    });
  }

  transportPublicKey(): Hex {
    this.#ready();
    if (!this.#initialized || !this.#transportPublicKey) throw new Error('KEY_MANAGER_UNAVAILABLE');
    return this.#transportPublicKey;
  }

  #escapeAccount() {
    if (!this.#initialized) throw new Error('KEY_MANAGER_UNAVAILABLE');
    const seed = this.#derive('cloakroom/escape/v1');
    try { return hdKeyToAccount(HDKey.fromMasterSeed(seed)); }
    finally { seed.fill(0); }
  }

  escapeSignerAddress(): Address { return this.#escapeAccount().address; }
  attestedEscapeSigner(): Address | undefined {
    return this.#policy.escapeHatch ? this.escapeSignerAddress() : undefined;
  }

  /** Registration bytes are journaled before broadcast. Heartbeats spend no custody principal. */
  signEscape(input: TransactionSerializableEIP1559, id?: string): Promise<Hex> {
    const tx = Object.freeze({ ...input });
    return this.#queue.run(async () => {
      await this.#restoreSigningState();
      const allowed = new Set(['type', 'chainId', 'nonce', 'to', 'value', 'data', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas']);
      if (this.#ready().escapePending || !this.#policy.escapeHatch || Object.keys(tx).some((field) => !allowed.has(field))
          || tx.type !== 'eip1559' || tx.chainId !== this.#policy.chainId || !tx.to
          || getAddress(tx.to) !== this.#policy.escapeHatch || tx.value !== 0n
          || typeof tx.nonce !== 'number' || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0
          || typeof tx.gas !== 'bigint' || tx.gas <= 0n || tx.gas > this.#policy.maxGas
          || typeof tx.maxFeePerGas !== 'bigint' || tx.maxFeePerGas <= 0n || tx.maxFeePerGas > this.#policy.maxFeePerGas
          || typeof tx.maxPriorityFeePerGas !== 'bigint' || tx.maxPriorityFeePerGas < 0n
          || tx.maxPriorityFeePerGas > this.#policy.maxPriorityFeePerGas || tx.maxPriorityFeePerGas > tx.maxFeePerGas) throw denied();
      let data: Hex;
      if (id === undefined) {
        data = encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'heartbeat' });
      } else {
        let approved: Extract<JournalEvent, { t: 'ESCAPE_RESERVED' }> | undefined;
        const reservations: Extract<JournalEvent, { t: 'ESCAPE_RESERVED' }>[] = [];
        const failed = new Set<string>();
        for await (const { event } of this.#journal.replay()) {
          if (event.t === 'ESCAPE_RESERVED') reservations.push(event);
          if (event.t === 'ESCAPE_FAILED') failed.add(event.id);
          if (event.t === 'ESCAPE_RESERVED' && event.id === id) {
            if (approved) throw denied();
            approved = event;
          }
          if ((event.t === 'ESCAPE_BROADCAST' || event.t === 'ESCAPE_REGISTERED'
              || event.t === 'ESCAPE_FAILED' || event.t === 'ESCAPE_CLAIMED') && event.id === id) throw denied();
        }
        if (!approved || getAddress(approved.hatch) !== this.#policy.escapeHatch || approved.amount <= 0n) throw denied();
        if (reservations.some((entry) => entry.id !== id && !failed.has(entry.id)
            && (getAddress(entry.owner) === getAddress(approved!.owner) || entry.claimId.toLowerCase() === approved!.claimId.toLowerCase()))) throw denied();
        data = encodeFunctionData({ abi: ESCAPE_HATCH_ABI, functionName: 'registerClaim', args: [approved.claimId, approved.amount] });
      }
      if (tx.data !== data) throw denied();
      const raw = await this.#escapeAccount().signTransaction(tx);
      await this.#persist({ ...this.#ready(), escapePending: { raw, nonce: tx.nonce, ...(id ? { id } : {}) } });
      return raw;
    });
  }

  escapePending(): { raw: Hex; nonce: number; id?: string } | undefined {
    const pending = this.#ready().escapePending;
    if (!pending) return undefined;
    const tx = parseTransaction(pending.raw as Hex);
    if (!this.#policy.escapeHatch || !tx.to || getAddress(tx.to) !== this.#policy.escapeHatch
        || tx.chainId !== this.#policy.chainId || (tx.value ?? 0n) !== 0n) throw denied();
    return { ...pending, raw: pending.raw as Hex };
  }

  clearEscapePending(txHash: Hex): Promise<void> {
    return this.#queue.run(async () => {
      const current = this.#ready();
      if (!current.escapePending || keccak256(current.escapePending.raw as Hex) !== txHash) throw denied();
      const { escapePending: _pending, ...next } = current;
      await this.#persist(next);
    });
  }

  /** Authorization belongs to the admin route. Persist consumption before disclosure. */
  claimSeedingAddresses(): Promise<Address[]> {
    return this.#queue.run(async () => {
      const current = this.#ready();
      if (!this.#initialized || current.seedingClaimed) throw new Error('SEEDING_DISABLED');
      const addresses = this.list().filter((item) => item.role === 'inventory').map((item) => item.address);
      if (addresses.length === 0 || addresses.length > 128) throw new Error('INVALID_SEEDING_POOL');
      await this.#persist({ ...current, seedingClaimed: true });
      return addresses;
    });
  }

  async decrypt(envelope: Envelope, path: string): Promise<unknown> {
    return (await this.decryptWithResponse(envelope, path)).payload;
  }

  async decryptWithResponse(envelope: Envelope, path: string) {
    const enclavePubKey = this.transportPublicKey();
    if (!this.#transport) throw new Error('KEY_MANAGER_UNAVAILABLE');
    return openEnvelopeWithResponse(this.#transport.privateKey, envelope, { path, chainId: this.#policy.chainId, enclavePubKey });
  }

  journalCipher(): JournalCipher {
    if (!this.#initialized) throw new Error('KEY_MANAGER_UNAVAILABLE');
    const bytes = this.#derive('cloakroom/journal/v1');
    const key = createSecretKey(bytes);
    bytes.fill(0);
    return {
      encrypt(plaintext, associatedData) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(associatedData);
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
      },
      decrypt(ciphertext, associatedData) {
        try {
          const bytes = Buffer.from(ciphertext);
          if (bytes.length < 28) throw new Error();
          const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
          cipher.setAAD(associatedData);
          cipher.setAuthTag(bytes.subarray(12, 28));
          return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]);
        } catch { throw new Error('JOURNAL_DECRYPT_FAILED'); }
      },
    };
  }

  #normalize(expected: ExpectedTransaction): ExpectedTransaction {
    try {
      if (typeof expected.value !== 'bigint' || expected.value < 0n || !/^0x[a-fA-F0-9]{64}$/.test(expected.dataHash)) throw new Error();
      if (expected.data !== undefined && (!HEX.safeParse(expected.data).success
          || keccak256(expected.data) !== expected.dataHash.toLowerCase())) throw new Error();
      return Object.freeze({
        eoa: getAddress(expected.eoa), to: getAddress(expected.to), value: expected.value,
        dataHash: expected.dataHash.toLowerCase() as Hex,
        ...(expected.data === undefined ? {} : { data: expected.data.toLowerCase() as Hex }),
      });
    } catch { throw denied(); }
  }

  async #authorize(opId: string, expected: ExpectedTransaction): Promise<void> {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(opId)) throw denied();
    if (opId.startsWith('exec:')) return this.#authorizeSwap(opId, expected);
    if (opId.startsWith('margin:')) return this.#authorizeMargin(opId, expected);
    if (opId.startsWith('approval:')) return this.#authorizeApproval(expected);
    let locked: Extract<JournalEvent, { t: 'WITHDRAWAL_LOCKED' }> | undefined;
    const deposits: Extract<JournalEvent, { t: 'DEPOSIT_SESSION_OPENED' }>[] = [];
    for await (const { event } of this.#journal.replay()) {
      if (event.t === 'WITHDRAWAL_LOCKED' && event.id === opId) {
        if (locked) throw denied();
        locked = event;
      }
      if ((event.t === 'WITHDRAWAL_FAILED' || event.t === 'WITHDRAWAL_CONFIRMED'
          || event.t === 'WITHDRAWAL_BROADCAST') && event.id === opId) throw denied();
      if (event.t === 'DEPOSIT_SESSION_OPENED') deposits.push(event);
    }
    if (!locked || locked.amount <= 0n) throw denied();
    if (deposits.some((deposit) => deposit.owner.toLowerCase() === locked!.owner.toLowerCase()
        && deposit.eoa.toLowerCase() === expected.eoa.toLowerCase())) throw denied();
    const native = locked.token.toLowerCase() === NATIVE.toLowerCase();
    const payment = native
      ? { to: locked.to, value: locked.amount, data: '0x' as Hex }
      : { to: locked.token, value: 0n, data: encodeFunctionData({
        abi: TRANSFER_ABI, functionName: 'transfer', args: [locked.to, locked.amount],
      }) };
    if (getAddress(payment.to) !== expected.to || payment.value !== expected.value
        || keccak256(payment.data) !== expected.dataHash) throw denied();
  }

  async #authorizeSwap(opId: string, expected: ExpectedTransaction): Promise<void> {
    try {
      const swaps = this.#policy.swaps;
      if (!swaps || expected.data === undefined || keccak256(expected.data) !== expected.dataHash) throw denied();
      const id = opId.slice('exec:'.length);
      if (!id) throw denied();
      let created: Extract<JournalEvent, { t: 'INTENT_CREATED' }> | undefined;
      const owners = new Map<string, Address>();
      const deposits: Extract<JournalEvent, { t: 'DEPOSIT_SESSION_OPENED' }>[] = [];
      const broadcasts: Extract<JournalEvent, { t: 'EXEC_BROADCAST' }>[] = [];
      for await (const { event } of this.#journal.replay()) {
        if (event.t === 'INTENT_CREATED') {
          owners.set(`exec:${event.id}`, event.owner);
          if (event.id === id) {
            if (created) throw denied();
            created = event;
          }
        }
        if (event.t === 'INTENT_CANCELLED' || event.t === 'INTENT_EXPIRED') {
          if (event.id === id) throw denied();
        }
        if (event.t === 'EXEC_BROADCAST' || event.t === 'EXEC_SETTLED' || event.t === 'EXEC_FAILED') {
          if (event.opId === opId || event.intentId === id) throw denied();
          if (event.t === 'EXEC_BROADCAST') broadcasts.push(event);
          else owners.set(event.opId, event.owner);
        }
        if (event.t === 'DEPOSIT_SESSION_OPENED') deposits.push(event);
      }
      if (!created) throw denied();
      const { intent } = created;
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const owner = getAddress(created.owner);
      if (getAddress(intent.owner) !== owner || intent.comparator !== 0
          || typeof intent.expiry !== 'bigint' || intent.expiry <= nowSec
          || typeof intent.amountIn !== 'bigint' || intent.amountIn <= 0n
          || intent.amountIn > this.#policy.maxNativeValue
          || typeof intent.triggerPrice !== 'bigint' || intent.triggerPrice <= 0n
          || getAddress(intent.tokenIn) !== getAddress(NATIVE) || getAddress(intent.tokenOut) !== swaps.tokenOut
          || expected.to !== swaps.routerAddress || expected.value !== intent.amountIn) throw denied();
      if (deposits.some((event) => getAddress(event.owner) === owner && getAddress(event.eoa) === expected.eoa)
          || broadcasts.some((event) => getAddress(event.eoa) === expected.eoa
            && [owners.get(event.opId), event.intentId ? owners.get(`exec:${event.intentId}`) : undefined]
              .some((previous) => previous !== undefined && getAddress(previous) === owner))) throw denied();
      const floor = limitFloor(intent.amountIn, intent.triggerPrice, swaps.tokenOutDecimals, swaps.feeBps);
      assertSafeSwapCalldata({ data: expected.data, eoa: expected.eoa, tokenOut: swaps.tokenOut,
        minOut: floor, floor, nowSec });
    } catch { throw denied(); }
  }

  /**
   * Signs a margin swap only against the operation accounting journaled. No fresh user signature
   * exists for a liquidation, so the journaled amounts and minimum are what bound the spend.
   */
  async #authorizeMargin(opId: string, expected: ExpectedTransaction): Promise<void> {
    try {
      const { margin, swaps } = this.#policy;
      if (!margin || !swaps || expected.data === undefined
          || keccak256(expected.data) !== expected.dataHash) throw denied();
      let approved: Extract<JournalEvent, { t: 'MARGIN_OP_APPROVED' }> | undefined;
      const deposits: Extract<JournalEvent, { t: 'DEPOSIT_SESSION_OPENED' }>[] = [];
      for await (const { event } of this.#journal.replay()) {
        if (event.t === 'MARGIN_OP_APPROVED' && event.opId === opId) {
          if (approved) throw denied();
          approved = event;
        }
        if ((event.t === 'MARGIN_OP_BROADCAST' || event.t === 'MARGIN_OP_SETTLED'
            || event.t === 'MARGIN_OP_FAILED') && event.opId === opId) throw denied();
        if (event.t === 'DEPOSIT_SESSION_OPENED') deposits.push(event);
      }
      if (!approved) throw denied();
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      const { amountIn, minAmountOut } = approved;
      if (BigInt(approved.expiry) <= nowSec || amountIn <= 0n || minAmountOut <= 0n
          || expected.to !== swaps.routerAddress) throw denied();
      const owner = getAddress(approved.owner);
      if (deposits.some((event) => getAddress(event.owner) === owner
          && getAddress(event.eoa) === expected.eoa)) throw denied();

      const tokenIn = getAddress(approved.tokenIn);
      const tokenOut = getAddress(approved.tokenOut);
      if (tokenIn === getAddress(NATIVE) && tokenOut === swaps.tokenOut) {
        if (expected.value !== amountIn || amountIn > this.#policy.maxNativeValue) throw denied();
        assertSafeSwapCalldata({ data: expected.data, eoa: expected.eoa, tokenOut,
          minOut: minAmountOut, floor: minAmountOut, nowSec });
      } else if (tokenIn === swaps.tokenOut && tokenOut === getAddress(NATIVE)) {
        if (expected.value !== 0n) throw denied();
        assertSafeTokenToNativeCalldata({ data: expected.data, eoa: expected.eoa, tokenIn,
          wethAddress: margin.wethAddress, amountIn, minOut: minAmountOut, nowSec });
      } else {
        throw denied();
      }
    } catch { throw denied(); }
  }

  /** The two one-time approvals that let the router, and nothing else, spend an EOA's token. */
  async #authorizeApproval(expected: ExpectedTransaction): Promise<void> {
    const { margin, swaps } = this.#policy;
    if (!margin || !swaps || expected.value !== 0n) throw denied();
    const permit2 = getAddress(PERMIT2_ADDRESS);
    const allowed = expected.to === swaps.tokenOut
      ? encodeFunctionData({ abi: APPROVAL_ABI, functionName: 'approve', args: [permit2, MAX_UINT256] })
      : expected.to === permit2
        ? encodeFunctionData({ abi: APPROVAL_ABI, functionName: 'approve',
          args: [swaps.tokenOut, swaps.routerAddress, MAX_UINT160, MAX_UINT48] })
        : undefined;
    if (!allowed || keccak256(allowed) !== expected.dataHash) throw denied();
  }

  registerOp(opId: string, input: ExpectedTransaction): Promise<void> {
    const snapshot = Object.freeze({ ...input });
    return this.#queue.run(async () => {
      await this.#restoreSigningState();
      const state = this.#ready();
      const expected = this.#normalize(snapshot);
      if (!this.list().some((eoa) => eoa.address === expected.eoa)
          || state.signedOperations.some((operation) => operation.opId === opId)) throw denied();
      await this.#authorize(opId, expected);
      const existing = this.#registered.get(opId);
      if (existing) {
        if (existing.eoa !== expected.eoa || existing.to !== expected.to
            || existing.value !== expected.value || existing.dataHash !== expected.dataHash) throw denied();
        return;
      }
      await this.#journal.append({ t: 'SIGNING_REGISTERED', opId, ...expected, chainId: this.#policy.chainId });
      this.#registered.set(opId, expected);
    });
  }

  sign(eoa: Address, input: TransactionSerializableEIP1559, opId: string): Promise<Hex> {
    // Callers cannot change transaction fields while durable authorization is awaited.
    const tx = Object.freeze({ ...input });
    return this.#queue.run(async () => {
      await this.#restoreSigningState();
      const state = this.#ready();
      const expected = this.#registered.get(opId);
      if (!expected || state.signedOperations.length >= 10_000
          || state.signedOperations.some((operation) => operation.opId === opId)) throw denied();
      const allowed = new Set(['type', 'chainId', 'nonce', 'to', 'value', 'data', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas']);
      if (Object.keys(tx).some((field) => !allowed.has(field)) || tx.type !== 'eip1559'
          || tx.chainId !== this.#policy.chainId || typeof tx.nonce !== 'number'
          || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0
          || typeof tx.gas !== 'bigint' || tx.gas <= 0n || tx.gas > this.#policy.maxGas
          || typeof tx.maxFeePerGas !== 'bigint' || tx.maxFeePerGas <= 0n || tx.maxFeePerGas > this.#policy.maxFeePerGas
          || typeof tx.maxPriorityFeePerGas !== 'bigint' || tx.maxPriorityFeePerGas < 0n
          || tx.maxPriorityFeePerGas > this.#policy.maxPriorityFeePerGas || tx.maxPriorityFeePerGas > tx.maxFeePerGas
          || typeof tx.value !== 'bigint' || tx.value < 0n || tx.value > this.#policy.maxNativeValue
          || !tx.to || !/^0x(?:[a-fA-F0-9]{2})*$/.test(tx.data ?? '0x')) throw denied();
      let actual: ExpectedTransaction;
      try {
        actual = this.#normalize({ eoa, to: tx.to, value: tx.value, dataHash: keccak256(tx.data ?? '0x') });
      } catch { throw denied(); }
      if (actual.eoa !== expected.eoa || actual.to !== expected.to || actual.value !== expected.value
          || actual.dataHash !== expected.dataHash) throw denied();
      await this.#authorize(opId, expected);
      const index = this.list().find((account) => account.address === expected.eoa)?.index;
      if (index === undefined) throw denied();
      const raw = await this.#account(index).signTransaction(tx);
      const operation = { opId, index, raw, requestHash: keccak256(serializeTransaction(tx)) };
      await this.#persist({ ...state, signedOperations: [...state.signedOperations, operation] });
      await this.#journal.append({ t: 'SIGNING_COMPLETED', opId, txHash: keccak256(raw) });
      return raw;
    });
  }

  /** Recover the same cached bytes, never a new signature or changed transaction. */
  async recoverSigned(opId: string): Promise<Hex | undefined> {
    await this.restoreSigningState();
    const operation = this.#ready().signedOperations.find((record) => record.opId === opId);
    if (!operation) return undefined;
    const expected = this.#registered.get(opId);
    if (!expected) throw denied();
    await this.#authorize(opId, expected);
    return operation.raw as Hex;
  }
}
