import { deriveEnclaveSalt, transportPublicKey } from '@cloakroom/shared';
import type { Hex } from 'viem';
import type { CloakroomApi } from '../api/client';
import { ApiError, CLIENT_ERROR_CODES } from '../api/errors';

/**
 * Where the enclave key came from, and how much the browser actually knows about it.
 *
 * - `attested-unverified`: GET /attestation returned a Nitro quote, but this app does NOT verify
 *   the COSE signature, certificate chain or PCR measurements. Verify it with
 *   scripts/verify-attestation.py against trusted measurements before trusting the key.
 * - `simulated`: GET /sim/enclave-key. There is no TEE and no confidentiality claim.
 *
 * There is deliberately no "verified" state: none can be reached without a real verifier.
 */
export type EnclaveMode = 'attested-unverified' | 'simulated';

export interface EnclaveIdentity {
  mode: EnclaveMode;
  enclavePubKey: Hex;
  chainId: number;
  /** keccak256(enclavePubKey): the EIP-712 domain salt every signature in this app binds to. */
  salt: Hex;
  buildHash: Hex | null;
  quote: string | null;
  /** The freshness nonce sent with the attestation request, for offline verification. */
  attestationNonce: string | null;
  fetchedAt: number;
  /** Why /attestation was not used, when the simulated key was. */
  attestationFailure: string | null;
}

export function randomAttestationNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function checkKey(enclavePubKey: Hex): Hex {
  try {
    transportPublicKey(enclavePubKey);
  } catch {
    throw new ApiError(CLIENT_ERROR_CODES.BAD_RESPONSE, { path: '/attestation' });
  }
  return enclavePubKey.toLowerCase() as Hex;
}

/**
 * Loads the enclave key. Uses /attestation when it answers; falls back to /sim/enclave-key only
 * when NEXT_PUBLIC_ALLOW_SIMULATED_ENCLAVE=true, so a production build never silently signs for an
 * unattested key. Both answers must name the configured chain.
 */
export async function loadEnclaveIdentity(
  api: CloakroomApi,
  options: { expectedChainId: number; allowSimulated: boolean; now?: () => number },
): Promise<EnclaveIdentity> {
  const now = options.now ?? Date.now;
  const nonce = randomAttestationNonce();
  let attestationFailure: string;
  try {
    const attestation = await api.getAttestation(nonce);
    if (attestation.chainId !== options.expectedChainId) {
      throw new ApiError('WRONG_CHAIN', { path: '/attestation' });
    }
    const enclavePubKey = checkKey(attestation.enclavePubKey);
    return {
      mode: 'attested-unverified',
      enclavePubKey,
      chainId: attestation.chainId,
      salt: deriveEnclaveSalt(enclavePubKey),
      buildHash: attestation.buildHash,
      quote: attestation.quote,
      attestationNonce: nonce,
      fetchedAt: now(),
      attestationFailure: null,
    };
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'WRONG_CHAIN' || error.code === 'BAD_RESPONSE')) throw error;
    attestationFailure = error instanceof ApiError ? error.code : 'INTERNAL_ERROR';
  }

  if (!options.allowSimulated) {
    throw new ApiError(CLIENT_ERROR_CODES.ENCLAVE_UNAVAILABLE, { path: '/attestation' });
  }
  const simulated = await api.getSimEnclaveKey();
  if (simulated.chainId !== options.expectedChainId) {
    throw new ApiError('WRONG_CHAIN', { path: '/sim/enclave-key' });
  }
  const enclavePubKey = checkKey(simulated.enclavePubKey);
  return {
    mode: 'simulated',
    enclavePubKey,
    chainId: simulated.chainId,
    salt: deriveEnclaveSalt(enclavePubKey),
    buildHash: null,
    quote: null,
    attestationNonce: null,
    fetchedAt: now(),
    attestationFailure,
  };
}

/** The approximate size of the decoded quote, for display. Does not parse or verify it. */
export function quoteByteLength(quote: string | null): number | null {
  if (!quote) return null;
  const padding = quote.endsWith('==') ? 2 : quote.endsWith('=') ? 1 : 0;
  return Math.floor((quote.length * 3) / 4) - padding;
}
