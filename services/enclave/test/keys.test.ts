import { inspect } from 'node:util';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NATIVE, sealEnvelope } from '@cloakroom/shared';
import type { JournalEvent } from '@cloakroom/shared';
import { memoryJournal } from './helpers/memory-journal.js';
import { encodeFunctionData, keccak256, parseAbi, parseTransaction, recoverTransactionAddress } from 'viem';
import type { Address, TransactionSerializableEIP1559 } from 'viem';
import { KeyManager } from '../src/keys.js';
import { InMemoryLedger } from '../src/ledger.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from '../src/sealed-state.js';

const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const DESTINATION = '0x2222222222222222222222222222222222222222' as Address;
const TOKEN = '0x3333333333333333333333333333333333333333' as Address;
const POLICY = { chainId: 11155111, maxGas: 200_000n, maxFeePerGas: 100_000_000_000n,
  maxPriorityFeePerGas: 10_000_000_000n, maxNativeValue: 10n ** 18n };


async function setup() {
  const log = memoryJournal();
  const storage = new MemoryCipherBlobStore();
  const vault = new AesGcmStateVault(storage, simulationSealingKey('ab'.repeat(32), true), true);
  const options = { vault, journal: log.journal, policy: POLICY, simMode: true, allowCreate: true };
  const keys = new KeyManager(options);
  await keys.init();
  const eoa = await keys.allocate('inventory');
  async function authorize(opId = 'withdrawal-1', token = NATIVE) {
    const value = token === NATIVE ? 10n : 0n;
    const data = token === NATIVE ? '0x' as const : encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
      functionName: 'transfer', args: [DESTINATION, 10n],
    });
    await log.journal.append({ t: 'WITHDRAWAL_LOCKED', id: opId, owner: OWNER, token,
      amount: 10n, to: DESTINATION });
    await keys.registerOp(opId, { eoa: eoa.address, to: token === NATIVE ? DESTINATION : token,
      value, dataHash: keccak256(data) });
    const tx: TransactionSerializableEIP1559 = { type: 'eip1559', chainId: POLICY.chainId,
      nonce: 0, to: token === NATIVE ? DESTINATION : token, value, data, gas: 100_000n,
      maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
    return tx;
  }
  return { keys, options, eoa, storage, authorize, ...log };
}

describe('KeyManager', () => {
  it('requires explicit simulation and initialization', async () => {
    const { options } = await setup();
    expect(() => new KeyManager({ ...options, simMode: false })).toThrow('SIM_MODE_REQUIRED');
    const cold = new KeyManager(options);
    expect(() => cold.list()).toThrow('KEY_MANAGER_UNAVAILABLE');
  });

  it('does not silently replace missing custody state on a normal restart', async () => {
    const { options } = await setup();
    const empty = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey('ab'.repeat(32), true), true);
    await expect(new KeyManager({ ...options, vault: empty, allowCreate: false }).init())
      .rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
  });

  it('initializes key material before the encrypted journal is opened', async () => {
    const { options, journal } = await setup();
    let opened = false;
    const gated = {
      append: journal.append,
      async *replay() {
        if (!opened) throw new Error('journal not opened');
        yield* journal.replay();
      },
    };
    const restarted = new KeyManager({ ...options, journal: gated });
    await restarted.init();
    expect(restarted.journalCipher()).toBeDefined();
    opened = true;
    await restarted.restoreSigningState();
  });

  it('restores the same HD addresses and transport key after restart', async () => {
    const { keys, options, eoa } = await setup();
    const deposit = await keys.allocate('deposit');
    const restarted = new KeyManager(options);
    await restarted.init();
    expect(restarted.list()).toEqual(keys.list());
    expect(restarted.transportPublicKey()).toBe(keys.transportPublicKey());
    expect((await restarted.allocate('inventory')).index).toBe(2);
    expect(deposit.address).not.toBe(eoa.address);
  });

  it('persists allocations before returning them and returns copies', async () => {
    const { keys } = await setup();
    const copies = keys.list();
    copies[0]!.role = 'deposit';
    expect(keys.list()[0]!.role).toBe('inventory');
    const allocations = await Promise.all(Array.from({ length: 8 }, () => keys.allocate('inventory')));
    expect(new Set(allocations.map((eoa) => eoa.address)).size).toBe(8);
    expect(keys.list()).toHaveLength(9);
  });

  it('signs native and ERC-20 withdrawals only after a durable registration', async () => {
    for (const token of [NATIVE, TOKEN]) {
      const { keys, eoa, authorize, events } = await setup();
      const tx = await authorize('withdrawal-1', token);
      const raw = await keys.sign(eoa.address, tx, 'withdrawal-1');
      expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(eoa.address);
      expect(events.map((event) => event.t)).toEqual(['WITHDRAWAL_LOCKED', 'SIGNING_REGISTERED', 'SIGNING_COMPLETED']);
    }
  });

  it('refuses unknown, unjournaled and mismatched operations', async () => {
    const { keys, eoa, authorize } = await setup();
    await expect(keys.registerOp('unknown', { eoa: eoa.address, to: DESTINATION,
      value: 10n, dataHash: keccak256('0x') })).rejects.toThrow('SIGNING_DENIED');
    const tx = await authorize();
    await expect(keys.sign(eoa.address, tx, 'missing')).rejects.toThrow('SIGNING_DENIED');
    for (const change of [
      { to: OWNER }, { value: 11n }, { data: '0x12' }, { chainId: 1 },
      { gas: POLICY.maxGas + 1n }, { maxFeePerGas: POLICY.maxFeePerGas + 1n },
      { maxPriorityFeePerGas: POLICY.maxPriorityFeePerGas + 1n }, { nonce: -1 },
    ]) await expect(keys.sign(eoa.address, { ...tx, ...change } as TransactionSerializableEIP1559, 'withdrawal-1'))
      .rejects.toThrow('SIGNING_DENIED');
    await expect(keys.sign(OWNER, tx, 'withdrawal-1')).rejects.toThrow('SIGNING_DENIED');
  });

  it('replays signing events without changing ledger reservations', async () => {
    const { keys, eoa, authorize, journal } = await setup();
    const tx = await authorize();
    await keys.sign(eoa.address, tx, 'withdrawal-1');
    const ledger = new InMemoryLedger();
    ledger.credit(OWNER, NATIVE, 20n, 'funding');
    for await (const { event } of journal.replay()) ledger.apply(event);
    expect(ledger.getBalance(OWNER, NATIVE)).toMatchObject({ available: 10n, reserved: 10n });
    ledger.assertInvariants();
  });

  it('refuses an EOA previously linked to the withdrawing owner', async () => {
    const { keys, eoa, journal } = await setup();
    await journal.append({ t: 'DEPOSIT_SESSION_OPENED', id: 'deposit', owner: OWNER, eoa: eoa.address, expiry: 1 });
    await journal.append({ t: 'WITHDRAWAL_LOCKED', id: 'withdrawal', owner: OWNER, token: NATIVE, amount: 10n, to: DESTINATION });
    await expect(keys.registerOp('withdrawal', { eoa: eoa.address, to: DESTINATION,
      value: 10n, dataHash: keccak256('0x') })).rejects.toThrow('SIGNING_DENIED');
  });

  it('snapshots transaction fields before waiting for asynchronous authorization', async () => {
    const { keys, eoa, authorize } = await setup();
    const tx = await authorize();
    const signing = keys.sign(eoa.address, tx, 'withdrawal-1');
    tx.to = OWNER;
    tx.value = 999n;
    const parsed = parseTransaction(await signing);
    expect(parsed.to?.toLowerCase()).toBe(DESTINATION.toLowerCase());
    expect(parsed.value).toBe(10n);
  });

  it('signs an operation once under concurrency and preserves that rule after restart', async () => {
    const { keys, options, eoa, authorize } = await setup();
    const tx = await authorize();
    const outcomes = await Promise.allSettled([
      keys.sign(eoa.address, tx, 'withdrawal-1'), keys.sign(eoa.address, tx, 'withdrawal-1'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const restarted = new KeyManager(options);
    await restarted.init();
    await expect(restarted.sign(eoa.address, tx, 'withdrawal-1')).rejects.toThrow('SIGNING_DENIED');
    const success = outcomes.find((result) => result.status === 'fulfilled');
    if (success?.status !== 'fulfilled') throw new Error('Missing signature');
    expect(await restarted.recoverSigned('withdrawal-1')).toBe(success.value);
  });

  it('refuses registrations whose journal append failed', async () => {
    const { keys, journal, failWrites, eoa } = await setup();
    await journal.append({ t: 'WITHDRAWAL_LOCKED', id: 'withdrawal', owner: OWNER, token: NATIVE, amount: 10n, to: DESTINATION });
    failWrites();
    await expect(keys.registerOp('withdrawal', { eoa: eoa.address, to: DESTINATION,
      value: 10n, dataHash: keccak256('0x') })).rejects.toThrow();
  });

  it('never returns a signature after a failed state write', async () => {
    const { keys, options, authorize, eoa } = await setup();
    const tx = await authorize();
    options.vault.write = async () => { throw new Error('unavailable storage'); };
    await expect(keys.sign(eoa.address, tx, 'withdrawal-1')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    expect(() => keys.list()).toThrow('KEY_MANAGER_UNAVAILABLE');
  });

  it('handles a committed write whose acknowledgement was lost without signing twice', async () => {
    const { keys, options, authorize, eoa } = await setup();
    const tx = await authorize();
    const originalWrite = options.vault.write.bind(options.vault);
    options.vault.write = async (...args) => {
      await originalWrite(...args);
      throw new Error('acknowledgement lost');
    };
    await expect(keys.sign(eoa.address, tx, 'withdrawal-1')).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
    options.vault.write = originalWrite;
    const restarted = new KeyManager(options);
    await restarted.init();
    await expect(restarted.sign(eoa.address, tx, 'withdrawal-1')).rejects.toThrow('SIGNING_DENIED');
    expect(await restarted.recoverSigned('withdrawal-1')).toMatch(/^0x02/);
  });

  it('detects sealed-state rollback relative to the journal', async () => {
    const { keys, options, storage, authorize, eoa } = await setup();
    const tx = await authorize();
    const old = (await storage.read())!;
    await keys.sign(eoa.address, tx, 'withdrawal-1');
    const current = (await storage.read())!;
    await storage.compareAndSwap(createHash('sha256').update(current).digest('hex'), old);
    const restarted = new KeyManager(options);
    await restarted.init();
    await expect(restarted.restoreSigningState()).rejects.toThrow('KEY_MANAGER_UNAVAILABLE');
  });

  it('refuses completed, cancelled and already-broadcast withdrawal records', async () => {
    for (const event of [
      { t: 'WITHDRAWAL_CONFIRMED', id: 'withdrawal-1', owner: OWNER },
      { t: 'WITHDRAWAL_FAILED', id: 'withdrawal-1', owner: OWNER, reason: 'cancelled' },
      { t: 'WITHDRAWAL_BROADCAST', id: 'withdrawal-1', eoa: OWNER, nonce: 0,
        txHash: `0x${'00'.repeat(32)}`, raw: '0x' },
    ] as JournalEvent[]) {
      const { keys, journal, authorize, eoa } = await setup();
      const tx = await authorize();
      await journal.append(event);
      await expect(keys.sign(eoa.address, tx, 'withdrawal-1')).rejects.toThrow('SIGNING_DENIED');
    }
  });

  it('decrypts against the same transport key that is exposed for attestation', async () => {
    const { keys } = await setup();
    const context = { enclavePubKey: keys.transportPublicKey(), chainId: POLICY.chainId, path: '/balance' };
    const envelope = await sealEnvelope({ message: { expiry: '1' }, signature: '0x' }, context);
    expect(await keys.decrypt(envelope, '/balance')).toEqual({ message: { expiry: '1' }, signature: '0x' });
    await expect(keys.decrypt(envelope, '/withdrawals')).rejects.toThrow('INVALID_PAYLOAD');
  });

  it('derives a stable journal cipher with authenticated metadata', async () => {
    const { keys, options } = await setup();
    const restarted = new KeyManager(options);
    await restarted.init();
    const aad = Buffer.from('sequence:1');
    const encrypted = keys.journalCipher().encrypt(Buffer.from('private event'), aad);
    expect(Buffer.from(restarted.journalCipher().decrypt(encrypted, aad)).toString()).toBe('private event');
    expect(() => restarted.journalCipher().decrypt(encrypted, Buffer.from('sequence:2'))).toThrow('JOURNAL_DECRYPT_FAILED');
  });

  it('exposes no private state through JSON or inspection', async () => {
    const { keys } = await setup();
    expect(JSON.stringify(keys)).toBe('"[KeyManager]"');
    expect(inspect(keys)).toBe('[KeyManager]');
  });
});
