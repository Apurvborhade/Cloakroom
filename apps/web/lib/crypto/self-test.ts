import type { Hex } from 'viem';
import { sealRequest } from './transport';

/**
 * Seals a throwaway payload to the enclave key locally (nothing is sent) to prove the browser
 * can run the HPKE suite. Returns the encapsulated-key length on success.
 */
export async function hpkeSelfTest(chainId: number, enclavePubKey: Hex): Promise<{ ok: true; encBytes: number } | { ok: false }> {
  try {
    if (!globalThis.crypto?.subtle) return { ok: false };
    const sealed = await sealRequest({ selfTest: true }, '/balance', { chainId, enclavePubKey });
    return { ok: true, encBytes: Math.floor((sealed.envelope.enc.length * 3) / 4) };
  } catch {
    return { ok: false };
  }
}
