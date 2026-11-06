import type { Address } from 'viem';
import { apiPostEnvelope } from './client';
import { BalanceResponseSchema, type BalanceResponse, type BalanceItem } from './schemas';
import { fetchAttestation } from './attestation';
import { getStoredSessionKey, signSessionQuery } from '../crypto/sessionKey';
import { buildTypedDataPayload, NATIVE } from '../crypto/typedData';

export interface FormattedBalance {
  token: Address;
  symbol: string;
  decimals: number;
  available: string; // Human readable string (e.g. "1.2500")
  reserved: string;  // Human readable string
  pending: string;   // Human readable string
  availableRaw: bigint;
  reservedRaw: bigint;
  pendingRaw: bigint;
}

const TOKEN_METADATA: Record<string, { symbol: string; decimals: number }> = {
  [NATIVE.toLowerCase()]: { symbol: 'ETH', decimals: 18 },
  '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238': { symbol: 'USDC', decimals: 6 },
};

function formatUnits(amount: bigint, decimals: number): string {
  const isNegative = amount < 0n;
  const abs = isNegative ? -amount : amount;
  const divisor = 10n ** BigInt(decimals);
  const integerPart = abs / divisor;
  const fractionalPart = abs % divisor;
  const paddedFractional = fractionalPart.toString().padStart(decimals, '0');
  // Trim trailing zeros to 4 decimals max for display
  const trimmed = paddedFractional.slice(0, Math.min(decimals, 4)).replace(/0+$/, '');
  const result = trimmed.length > 0 ? `${integerPart}.${trimmed}` : integerPart.toString();
  return isNegative ? `-${result}` : result;
}

export async function fetchConfidentialBalances(
  owner: Address,
  signTypedDataFallback?: (params: any) => Promise<any>
): Promise<FormattedBalance[]> {
  const attestation = await fetchAttestation();
  const session = getStoredSessionKey(owner);

  let signedQuery: { message: { owner: Address; expiry: string }; signature: string };

  if (session) {
    // 1. Preferred non-interactive path: sign with ephemeral browser session key
    signedQuery = await signSessionQuery(session, attestation.chainId, attestation.enclavePubKey);
  } else if (signTypedDataFallback) {
    // 2. Direct wallet signature fallback
    const now = Math.floor(Date.now() / 1000);
    const expiry = BigInt(now + 120);
    const payload = buildTypedDataPayload(
      attestation.chainId,
      attestation.enclavePubKey,
      'SessionQuery',
      { owner, expiry }
    );
    const signature = await signTypedDataFallback(payload);
    signedQuery = {
      message: { owner, expiry: expiry.toString() },
      signature,
    };
  } else {
    // Unauthenticated query
    return [
      {
        token: NATIVE,
        symbol: 'ETH',
        decimals: 18,
        available: '0.0000',
        reserved: '0.0000',
        pending: '0.0000',
        availableRaw: 0n,
        reservedRaw: 0n,
        pendingRaw: 0n,
      },
    ];
  }

  const response: BalanceResponse = await apiPostEnvelope(
    '/balance',
    signedQuery,
    {
      chainId: attestation.chainId,
      enclavePubKey: attestation.enclavePubKey,
    },
    BalanceResponseSchema
  );

  return response.balances.map((item: BalanceItem) => {
    const meta = TOKEN_METADATA[item.token.toLowerCase()] || {
      symbol: item.token.slice(0, 6),
      decimals: 18,
    };
    const availableRaw = BigInt(item.available);
    const reservedRaw = BigInt(item.reserved);
    const pendingRaw = BigInt(item.pending);

    return {
      token: item.token,
      symbol: meta.symbol,
      decimals: meta.decimals,
      available: formatUnits(availableRaw, meta.decimals),
      reserved: formatUnits(reservedRaw, meta.decimals),
      pending: formatUnits(pendingRaw, meta.decimals),
      availableRaw,
      reservedRaw,
      pendingRaw,
    };
  });
}
