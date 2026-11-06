import { keccak256, type Address, type Hex } from 'viem';

export const NATIVE: Address = '0x0000000000000000000000000000000000000000';
export const DOMAIN_NAME = 'PrivateIntentNetwork' as const;
export const DOMAIN_VERSION = '1' as const;

export function deriveEnclaveSalt(enclavePubKey: Hex): Hex {
  return keccak256(enclavePubKey);
}

export function createDomain(chainId: number, enclaveKeyHash: Hex) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    salt: enclaveKeyHash,
  } as const;
}

export const EIP712_TYPES = {
  SessionGrant: [
    { name: 'owner', type: 'address' },
    { name: 'sessionKey', type: 'address' },
    { name: 'expiry', type: 'uint64' },
  ],
  SessionQuery: [
    { name: 'owner', type: 'address' },
    { name: 'expiry', type: 'uint64' },
  ],
  DepositRequest: [
    { name: 'owner', type: 'address' },
    { name: 'asset', type: 'address' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  Intent: [
    { name: 'owner', type: 'address' },
    { name: 'tokenIn', type: 'address' },
    { name: 'tokenOut', type: 'address' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'comparator', type: 'uint8' },     // 0: price >= trigger, 1: price <= trigger
    { name: 'triggerPrice', type: 'uint256' }, // 1e18 fixed point
    { name: 'maxSlippageBps', type: 'uint16' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  CancelIntent: [
    { name: 'owner', type: 'address' },
    { name: 'intentId', type: 'bytes32' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  Withdrawal: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
} as const;

export type SessionGrantMsg = {
  owner: Address;
  sessionKey: Address;
  expiry: bigint;
};

export type SessionQueryMsg = {
  owner: Address;
  expiry: bigint;
};

export type DepositRequestMsg = {
  owner: Address;
  asset: Address;
  nonce: bigint;
  expiry: bigint;
};

export type IntentMsg = {
  owner: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  comparator: number; // 0: price >= trigger, 1: price <= trigger
  triggerPrice: bigint;
  maxSlippageBps: number;
  nonce: bigint;
  expiry: bigint;
};

export type CancelIntentMsg = {
  owner: Address;
  intentId: Hex;
  nonce: bigint;
  expiry: bigint;
};

export type WithdrawalMsg = {
  owner: Address;
  token: Address;
  amount: bigint;
  to: Address;
  nonce: bigint;
  expiry: bigint;
};

export function buildTypedDataPayload(
  chainId: number,
  enclavePubKey: Hex,
  primaryType: keyof typeof EIP712_TYPES,
  message: Record<string, unknown>
) {
  const enclaveSalt = deriveEnclaveSalt(enclavePubKey);
  const domain = createDomain(chainId, enclaveSalt);
  return {
    domain,
    types: {
      [primaryType]: EIP712_TYPES[primaryType],
    },
    primaryType,
    message,
  };
}
