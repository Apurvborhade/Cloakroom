import { createSecretKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NATIVE } from '@cloakroom/shared';
import { keccak256, parseTransaction } from 'viem';
import type { TransactionSerializableEIP1559 } from 'viem';
import { AttestationService } from '../src/attestation.js';
import { openNitroRuntime } from '../src/nitro-custody.js';
import * as kms from '../src/kms-sealing.js';
import { AesGcmStateVault, MemoryCipherBlobStore } from '../src/sealed-state.js';
import type { CipherBlobStore } from '../src/sealed-state.js';
import { openCustodyRuntime } from '../src/custody-runtime.js';
import { loadConfig, toSigningPolicy } from '../src/config.js';

const remote = vi.hoisted(() => new Map<string, CipherBlobStore>());
vi.mock('../src/sealed-state.js', async (original) => ({
  ...await original<typeof import('../src/sealed-state.js')>(),
  RemoteCipherBlobStore: class {
    constructor(_socket: string, _id: string, name: string) { return remote.get(name)!; }
  },
}));
const OPTIONS = {
  keyArn: 'arn:aws:kms:eu-central-1:123456789012:key/12345678-1234-1234-1234-123456789abc',
  region: 'eu-central-1', vaultId: 'ab'.repeat(32), buildHash: 'cd'.repeat(32),
  policy: { chainId: 1, maxGas: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, maxNativeValue: 1n },
};

beforeEach(() => {
  remote.clear();
  for (const name of ['wrapping', 'custody', 'journal']) remote.set(name, new MemoryCipherBlobStore());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

function configureEnvironment() {
  const env = { ...parseEnv(readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8')),
    RPC_URL: 'https://rpc.example', UNISWAP_API_KEY: 'test-key',
    ADMIN_ADDRESS: '0x1111111111111111111111111111111111111111', ALLOWED_ORIGIN: 'https://app.example' };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return loadConfig(env);
}

describe('Nitro runtime composition', () => {
  it.each([0, 1, 2, 3, 4, 5, 6])('rejects incomplete storage set %i before KMS access or creation', async (mask) => {
    const create = vi.spyOn(kms, 'createRecipientKms');
    const names = ['wrapping', 'custody', 'journal'];
    for (let index = 0; index < names.length; index++) {
      if (mask & (1 << index)) await remote.get(names[index]!)!.compareAndSwap(null, Buffer.from('existing'));
    }
    const writes = names.map((name) => vi.spyOn(remote.get(name)!, 'compareAndSwap'));
    await expect(openNitroRuntime({ ...OPTIONS, allowCreate: mask !== 0 })).rejects.toThrow('CUSTODY_STATE_MISSING');
    expect(create).not.toHaveBeenCalled();
    for (const write of writes) expect(write).not.toHaveBeenCalled();
  });

  it('restores the complete state through the Nitro sealing provider and binds attestation to it', async () => {
    const key = createSecretKey(Buffer.alloc(32, 42));
    const fixture = await openCustodyRuntime({ ...OPTIONS, allowCreate: true,
      vault: new AesGcmStateVault(remote.get('custody')!, { protection: 'nitro-kms', getKey: async () => key }),
      journalStore: remote.get('journal')!, quote: async () => Buffer.from('fixture'),
    });
    const identity = fixture.keys.transportPublicKey(); await fixture.close();
    await remote.get('wrapping')!.compareAndSwap(null, Buffer.from('wrapped KMS fixture'));
    const restore = vi.spyOn(kms.NitroKmsSealingKey.prototype, 'getKey').mockResolvedValue(key);
    const attest = vi.spyOn(AttestationService.prototype, 'response').mockImplementation(async function (this: AttestationService) {
      return { quote: 'fixture', enclavePubKey: this.options.identity.transportPublicKey(),
        buildHash: this.buildHash, chainId: this.options.chainId };
    });
    const create = vi.spyOn(kms, 'createRecipientKms');
    const runtime = await openNitroRuntime(OPTIONS);
    expect(restore).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ region: OPTIONS.region, relaySocket: '\0cloakroom-kms' }));
    expect(attest).toHaveBeenCalledTimes(1);
    expect(runtime.keys.transportPublicKey()).toBe(identity);
    expect((await runtime.attestation.response()).enclavePubKey).toBe(identity);
    await runtime.close();
  });

  it('fails without a fallback when KMS cannot restore the wrapping key', async () => {
    const key = createSecretKey(Buffer.alloc(32, 42));
    const vault = new AesGcmStateVault(remote.get('custody')!, { protection: 'nitro-kms', getKey: async () => key });
    await vault.write(Buffer.from('existing custody'), null);
    await remote.get('wrapping')!.compareAndSwap(null, Buffer.from('wrapped'));
    await remote.get('journal')!.compareAndSwap(null, Buffer.from('encrypted journal'));
    vi.spyOn(kms.NitroKmsSealingKey.prototype, 'getKey').mockRejectedValue(new Error('KMS_UNAVAILABLE'));
    await expect(openNitroRuntime({ ...OPTIONS, allowCreate: true })).rejects.toThrow('SEALED_STATE_UNAVAILABLE');
  });

  it('enforces environment signing limits after boot, including gas with the executor margin', async () => {
    const config = configureEnvironment();
    const policy = toSigningPolicy(config);
    const key = createSecretKey(Buffer.alloc(32, 42));
    const owner = '0x1111111111111111111111111111111111111111';
    const to = '0x2222222222222222222222222222222222222222';
    const fixture = await openCustodyRuntime({ ...OPTIONS, policy, allowCreate: true,
      vault: new AesGcmStateVault(remote.get('custody')!, { protection: 'nitro-kms', getKey: async () => key }),
      journalStore: remote.get('journal')!, quote: async () => Buffer.from('fixture'),
    });
    const eoa = await fixture.keys.allocate('inventory');
    await fixture.journal.append({ t: 'DEPOSIT_CREDITED', id: 'funding', owner, amount: 100n, block: 1n });
    await fixture.journal.append({ t: 'WITHDRAWAL_LOCKED', id: 'payout', owner, token: NATIVE, amount: 10n, to });
    await fixture.keys.registerOp('payout', { eoa: eoa.address, to, value: 10n, dataHash: keccak256('0x') });
    await fixture.close();
    await remote.get('wrapping')!.compareAndSwap(null, Buffer.from('wrapped KMS fixture'));
    vi.spyOn(kms.NitroKmsSealingKey.prototype, 'getKey').mockResolvedValue(key);
    vi.spyOn(AttestationService.prototype, 'response').mockImplementation(async function (this: AttestationService) {
      return { quote: 'fixture', enclavePubKey: this.options.identity.transportPublicKey(),
        buildHash: this.buildHash, chainId: this.options.chainId };
    });
    const { policy: _explicitPolicy, ...options } = OPTIONS;
    const runtime = await openNitroRuntime(options);
    try {
      const tx: TransactionSerializableEIP1559 = { type: 'eip1559', chainId: config.CHAIN_ID,
        nonce: 0, to, value: 10n, data: '0x', gas: (900_000n * BigInt(config.GAS_MARGIN_PERCENT)) / 100n,
        maxFeePerGas: policy.maxFeePerGas, maxPriorityFeePerGas: policy.maxPriorityFeePerGas };
      for (const change of [
        { gas: policy.maxGas + 1n },
        { maxFeePerGas: policy.maxFeePerGas + 1n },
        { maxPriorityFeePerGas: policy.maxPriorityFeePerGas + 1n },
      ]) {
        await expect(runtime.keys.sign(eoa.address, { ...tx, ...change }, 'payout')).rejects.toThrow('SIGNING_DENIED');
      }
      const raw = await runtime.keys.sign(eoa.address, tx, 'payout');
      expect(parseTransaction(raw)).toMatchObject({ gas: tx.gas, chainId: config.CHAIN_ID });
      expect(runtime.ledger.getBalance(owner, NATIVE)).toMatchObject({ available: 90n, reserved: 10n });
    } finally { await runtime.close(); }
  });

  it('rejects missing signing configuration before reading storage or calling KMS', async () => {
    configureEnvironment();
    vi.stubEnv('SIGNING_MAX_GAS', undefined);
    const reads = [...remote.values()].map((store) => vi.spyOn(store, 'read'));
    const create = vi.spyOn(kms, 'createRecipientKms');
    const { policy: _explicitPolicy, ...options } = OPTIONS;
    await expect(openNitroRuntime({ ...options, allowCreate: true })).rejects.toThrow('SIGNING_MAX_GAS');
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
