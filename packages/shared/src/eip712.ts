import { keccak256, type Address, type Hex } from 'viem';

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
  AdminEoas: [
    { name: 'admin', type: 'address' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
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
  MarginSupply: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  MarginRedeem: [
    { name: 'owner', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  MarginOpen: [
    { name: 'owner', type: 'address' },
    { name: 'side', type: 'uint8' },           // 0: long, 1: short
    { name: 'collateral', type: 'uint256' },   // USDC base units
    { name: 'leverageBps', type: 'uint32' },   // position size / collateral: 40000 is 4x
    { name: 'limitPrice', type: 'uint256' },   // 1e18 fixed point: highest for a long, lowest for a short
    { name: 'maxSlippageBps', type: 'uint16' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  MarginAddCollateral: [
    { name: 'owner', type: 'address' },
    { name: 'positionId', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint64' },
    { name: 'expiry', type: 'uint64' },
  ],
  MarginClose: [
    { name: 'owner', type: 'address' },
    { name: 'positionId', type: 'bytes32' },
    { name: 'limitPrice', type: 'uint256' },   // 1e18 fixed point: lowest for a long, highest for a short
    { name: 'maxSlippageBps', type: 'uint16' },
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

export type MarginSupplyMsg = {
  owner: Address;
  token: Address;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
};

export type MarginRedeemMsg = MarginSupplyMsg;

export type MarginOpenMsg = {
  owner: Address;
  side: number; // 0: long, 1: short
  collateral: bigint;
  leverageBps: number;
  limitPrice: bigint;
  maxSlippageBps: number;
  nonce: bigint;
  expiry: bigint;
};

export type MarginAddCollateralMsg = {
  owner: Address;
  positionId: Hex;
  amount: bigint;
  nonce: bigint;
  expiry: bigint;
};

export type MarginCloseMsg = {
  owner: Address;
  positionId: Hex;
  limitPrice: bigint;
  maxSlippageBps: number;
  nonce: bigint;
  expiry: bigint;
};
