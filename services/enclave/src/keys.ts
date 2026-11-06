import { createCipheriv, createDecipheriv, createSecretKey, hkdfSync, randomBytes } from 'node:crypto';
import { inspect } from 'node:util';
import { createTransportSuite, NATIVE } from '@cloakroom/shared';
import type { CustodyEOA, Envelope, Journal, JournalEvent } from '@cloakroom/shared';
import { encodeFunctionData, getAddress, keccak256, parseAbi, serializeTransaction } from 'viem';
import type { Address, Hex, TransactionSerializableEIP1559 } from 'viem';
import { HDKey, hdKeyToAccount } from 'viem/accounts';
import { z } from 'zod';
import type { ExpectedTransaction, TransactionSigner } from './executor.js';
import { openEnvelopeWithResponse } from './envelope.js';
import { FifoSerialQueue } from './queue.js';
import type { StateVault } from './sealed-state.js';

const HEX = z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/);
const STATE_SCHEMA = z.object({
  version: z.literal(1), seed: z.string().regex(/^[a-f0-9]{64}$/),
  allocations: z.array(z.enum(['deposit', 'inventory'])).max(10_000),
  seedingClaimed: z.boolean().default(false),
  signedOperations: z.array(z.object({
    opId: z.string().min(1).max(128), index: z.number().int().nonnegative(), raw: HEX,
    requestHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  }).strict()).max(10_000),
}).strict();
type State = z.infer<typeof STATE_SCHEMA>;
const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)']);
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
    this.#policy = Object.freeze({ ...policy });
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
      return Object.freeze({
        eoa: getAddress(expected.eoa), to: getAddress(expected.to), value: expected.value,
        dataHash: expected.dataHash.toLowerCase() as Hex,
      });
    } catch { throw denied(); }
  }

  async #authorize(opId: string, expected: ExpectedTransaction): Promise<void> {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(opId)) throw denied();
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
