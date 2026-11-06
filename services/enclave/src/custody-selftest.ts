import { randomBytes } from 'node:crypto';
import { NATIVE, sealEnvelope } from '@cloakroom/shared';
import type { JournalEntry } from '@cloakroom/shared';
import { keccak256, recoverTransactionAddress } from 'viem';
import type { TransactionSerializedEIP1559 } from 'viem';
import { KeyManager } from './keys.js';
import { AesGcmStateVault, MemoryCipherBlobStore, simulationSealingKey } from './sealed-state.js';

/** Volatile unfunded test identity. This is not persistent production custody. */
export async function runCustodySelfTest(): Promise<void> {
  const entries: JournalEntry[] = [];
  const hash = `0x${'00'.repeat(32)}` as const;
  const journal = {
    async append(event: JournalEntry['event']): Promise<JournalEntry> {
      const entry = { sequence: entries.length, timestamp: 0, prevHash: hash, entryHash: hash, event };
      entries.push(entry); return entry;
    },
    async *replay() { yield* entries; },
  };
  const vault = new AesGcmStateVault(new MemoryCipherBlobStore(), simulationSealingKey(randomBytes(32).toString('hex'), true), true);
  const policy = { chainId: 11155111, maxGas: 30_000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, maxNativeValue: 1n };
  const options = { vault, journal, policy, simMode: true, allowCreate: true };
  const keys = new KeyManager(options);
  await keys.init();
  const eoa = await keys.allocate('inventory');
  const destination = '0x2222222222222222222222222222222222222222' as const;
  await journal.append({ t: 'WITHDRAWAL_LOCKED', id: 'bootstrap-selftest', owner: destination,
    token: NATIVE, amount: 1n, to: destination });
  await keys.registerOp('bootstrap-selftest', { eoa: eoa.address, to: destination, value: 1n, dataHash: keccak256('0x') });
  const raw = await keys.sign(eoa.address, { type: 'eip1559', chainId: policy.chainId,
    nonce: 0, to: destination, value: 1n, data: '0x', gas: 21_000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n }, 'bootstrap-selftest');
  if (await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerializedEIP1559 }) !== eoa.address) throw new Error('SELF_TEST_FAILED');
  const restarted = new KeyManager({ ...options, allowCreate: false });
  await restarted.init();
  await restarted.restoreSigningState();
  if (restarted.transportPublicKey() !== keys.transportPublicKey()
      || restarted.list()[0]?.address !== eoa.address) throw new Error('SELF_TEST_FAILED');
  const envelope = await sealEnvelope({ check: true }, { chainId: policy.chainId, path: '/selftest', enclavePubKey: keys.transportPublicKey() });
  const opened = await restarted.decrypt(envelope, '/selftest');
  if (JSON.stringify(opened) !== '{"check":true}') throw new Error('SELF_TEST_FAILED');
}
