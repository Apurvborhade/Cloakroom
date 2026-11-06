import type { Hex } from 'viem';
import { apiGet } from './client';
import { AttestationResponseSchema, type AttestationResponse } from './schemas';

let cachedAttestation: AttestationResponse | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 60000; // 1 minute

export interface AttestationStatus {
  isAttested: boolean;
  isSimulated: boolean;
  enclavePubKey: Hex;
  buildHash: Hex;
  chainId: number;
  quoteLength: number;
  provider: 'AWS Nitro Enclave' | 'TEE-SIMULATED';
  rawQuote: string;
}

export async function fetchAttestation(forceRefresh = false): Promise<AttestationResponse> {
  const now = Date.now();
  if (!forceRefresh && cachedAttestation && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedAttestation;
  }

  const response = await apiGet('/attestation', AttestationResponseSchema);
  cachedAttestation = response;
  lastFetchTime = now;
  return response;
}

export async function getAttestationStatus(forceRefresh = false): Promise<AttestationStatus> {
  try {
    const data = await fetchAttestation(forceRefresh);
    const isRealQuote = typeof data.quote === 'string' && data.quote.length > 500;

    return {
      isAttested: isRealQuote,
      isSimulated: !isRealQuote,
      enclavePubKey: data.enclavePubKey,
      buildHash: data.buildHash,
      chainId: data.chainId,
      quoteLength: data.quote.length,
      provider: isRealQuote ? 'AWS Nitro Enclave' : 'TEE-SIMULATED',
      rawQuote: data.quote,
    };
  } catch (err: any) {
    // If backend is unreachable or simulated fallback
    return {
      isAttested: false,
      isSimulated: true,
      enclavePubKey: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      buildHash: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
      chainId: 11155111,
      quoteLength: 0,
      provider: 'TEE-SIMULATED',
      rawQuote: '',
    };
  }
}
