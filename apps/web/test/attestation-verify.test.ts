import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnclaveIdentity } from '@/lib/attestation/enclave-identity';
import type { CloakroomApi } from '@/lib/api/client';

const check = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));
vi.mock('@cloakroom/attestation', () => ({
  verifyCustodyAttestation: async (...args: unknown[]) => {
    check.calls.push(args);
    if (check.fail) throw new Error('ATTESTATION_PCR_MISMATCH');
    return { verified: true };
  },
}));

const release = { buildHash: `0x${'11'.repeat(32)}`, chainId: 1, measurements: { PCR0: 'a', PCR1: 'b', PCR2: 'c' } };
const attestation = { quote: 'cXVvdGU=', buildHash: release.buildHash, chainId: 1, enclavePubKey: `0x${'22'.repeat(32)}` };
const api = {
  getAttestation: vi.fn(async () => attestation),
  getSimEnclaveKey: vi.fn(async () => ({ chainId: 1, enclavePubKey: attestation.enclavePubKey })),
} as unknown as CloakroomApi;

describe('enclave attestation check', () => {
  beforeEach(() => { check.calls = []; check.fail = false; });

  it('stays unverified, and checks nothing, without a pinned release', async () => {
    const identity = await loadEnclaveIdentity(api, { expectedChainId: 1, allowSimulated: false, trustedRelease: null });
    expect(identity.mode).toBe('attested-unverified');
    expect(check.calls).toEqual([]);
  });

  it('is verified only after the quote passes, using the nonce it sent', async () => {
    const identity = await loadEnclaveIdentity(api, { expectedChainId: 1, allowSimulated: false, trustedRelease: release });
    expect(identity.mode).toBe('attested-verified');
    expect(check.calls).toEqual([[attestation, { release, nonce: identity.attestationNonce }]]);
  });

  it('refuses the key when the check fails, even if simulation is allowed', async () => {
    check.fail = true;
    await expect(loadEnclaveIdentity(api, { expectedChainId: 1, allowSimulated: true, trustedRelease: release }))
      .rejects.toMatchObject({ code: 'ATTESTATION_INVALID' });
    expect(api.getSimEnclaveKey).not.toHaveBeenCalled();
  });
});
