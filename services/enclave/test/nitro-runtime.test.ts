import { createSecretKey } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttestationService } from '../src/attestation.js';
import { openNitroRuntime } from '../src/nitro-custody.js';
import * as kms from '../src/kms-sealing.js';
import { AesGcmStateVault, MemoryCipherBlobStore } from '../src/sealed-state.js';
import type { CipherBlobStore } from '../src/sealed-state.js';
import { openCustodyRuntime } from '../src/custody-runtime.js';

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
afterEach(() => vi.restoreAllMocks());

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
});
