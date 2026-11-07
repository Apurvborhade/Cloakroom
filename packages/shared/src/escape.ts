import { encodeAbiParameters, keccak256, parseAbi, parseAbiParameters } from 'viem';
import type { Address, Hex } from 'viem';

export function escapeClaimId(chainId: number | bigint, hatch: Address, owner: Address, code: Hex): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,bytes32'),
    [BigInt(chainId), hatch, owner, code]));
}

export const ESCAPE_HATCH_ABI = parseAbi([
  'function enclaveSigner() view returns (address)',
  'function timeout() view returns (uint256)',
  'function lastHeartbeat() view returns (uint256)',
  'function totalReserved() view returns (uint256)',
  'function expired() view returns (bool)',
  'function registered(bytes32 claimId) view returns (bool)',
  'function claims(bytes32 claimId) view returns (uint256)',
  'function registerClaim(bytes32 claimId,uint256 amountWei)',
  'function heartbeat()',
  'function claim(bytes32 code)',
  'event ClaimRegistered(bytes32 indexed claimId,uint256 amountWei)',
  'event Claimed(bytes32 indexed claimId,address indexed owner,uint256 amountWei)',
]);

export type EscapeEvent =
  | { t: 'ESCAPE_RESERVED'; id: string; owner: Address; hatch: Address; claimId: Hex; amount: bigint }
  | { t: 'ESCAPE_BROADCAST'; id: string; nonce: number; txHash: Hex; raw: Hex }
  | { t: 'ESCAPE_REGISTERED'; id: string }
  | { t: 'ESCAPE_FAILED'; id: string; reason: string }
  | { t: 'ESCAPE_CLAIMED'; id: string };

export const ESCAPE_ERROR_CODES = {
  ESCAPE_INELIGIBLE: 'ESCAPE_INELIGIBLE',
  ESCAPE_UNAVAILABLE: 'ESCAPE_UNAVAILABLE',
  ESCAPE_ALREADY_REGISTERED: 'ESCAPE_ALREADY_REGISTERED',
} as const;
export type EscapeErrorCode = (typeof ESCAPE_ERROR_CODES)[keyof typeof ESCAPE_ERROR_CODES];
