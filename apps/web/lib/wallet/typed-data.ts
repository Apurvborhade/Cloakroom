import { createDomain, deriveEnclaveSalt, EIP712_TYPES, MAX_EXPIRY_FUTURE_SEC } from '@cloakroom/shared';
import type {
  CancelIntentMsg,
  CancelIntentWire,
  DepositRequestMsg,
  DepositRequestWire,
  IntentMsg,
  IntentWire,
  MarginAddCollateralMsg,
  MarginAddCollateralWire,
  MarginCloseMsg,
  MarginCloseWire,
  MarginOpenMsg,
  MarginOpenWire,
  MarginSupplyMsg,
  MarginSupplyWire,
  SessionGrantMsg,
  SessionGrantWire,
  SessionQueryMsg,
  SessionQueryWire,
  WithdrawalMsg,
  WithdrawalWire,
} from '@cloakroom/shared';
import type { Address, Hex } from 'viem';
import { nowSec } from '../format/time';

/**
 * Builds every message from the shared EIP-712 definitions. Each builder returns the bigint form
 * the wallet signs and the decimal-string wire form the enclave parses, so the two cannot drift.
 */
export interface EnclaveBinding {
  chainId: number;
  enclavePubKey: Hex;
}

export type SignablePrimaryType = Exclude<keyof typeof EIP712_TYPES, 'AdminEoas'>;

export function domainFor(binding: EnclaveBinding) {
  return createDomain(binding.chainId, deriveEnclaveSalt(binding.enclavePubKey));
}

export interface TypedRequest<M, W> {
  primaryType: SignablePrimaryType;
  domain: ReturnType<typeof domainFor>;
  message: M;
  wire: W;
}

/** Lifetime of a signed mutation. The enclave accepts at most MAX_EXPIRY_FUTURE_SEC ahead. */
export const MUTATION_LIFETIME_SEC = 180;
/** Lifetime of a session-signed read. */
export const QUERY_LIFETIME_SEC = 120;

export function mutationExpiry(now = nowSec()): bigint {
  return BigInt(now + Math.min(MUTATION_LIFETIME_SEC, MAX_EXPIRY_FUTURE_SEC));
}

const str = (value: bigint) => value.toString();

export function buildSessionGrant(binding: EnclaveBinding, message: SessionGrantMsg): TypedRequest<SessionGrantMsg, SessionGrantWire> {
  return {
    primaryType: 'SessionGrant',
    domain: domainFor(binding),
    message,
    wire: { owner: message.owner, sessionKey: message.sessionKey, expiry: str(message.expiry) } as SessionGrantWire,
  };
}

export function buildSessionQuery(binding: EnclaveBinding, message: SessionQueryMsg): TypedRequest<SessionQueryMsg, SessionQueryWire> {
  return {
    primaryType: 'SessionQuery',
    domain: domainFor(binding),
    message,
    wire: { owner: message.owner, expiry: str(message.expiry) } as SessionQueryWire,
  };
}

export function buildDepositRequest(binding: EnclaveBinding, message: DepositRequestMsg): TypedRequest<DepositRequestMsg, DepositRequestWire> {
  return {
    primaryType: 'DepositRequest',
    domain: domainFor(binding),
    message,
    wire: { owner: message.owner, asset: message.asset, nonce: str(message.nonce), expiry: str(message.expiry) } as DepositRequestWire,
  };
}

export function buildIntent(binding: EnclaveBinding, message: IntentMsg): TypedRequest<IntentMsg, IntentWire> {
  if (message.comparator !== 0 && message.comparator !== 1) throw new Error('INVALID_COMPARATOR');
  return {
    primaryType: 'Intent',
    domain: domainFor(binding),
    message,
    wire: {
      owner: message.owner,
      tokenIn: message.tokenIn,
      tokenOut: message.tokenOut,
      amountIn: str(message.amountIn),
      comparator: message.comparator,
      triggerPrice: str(message.triggerPrice),
      maxSlippageBps: message.maxSlippageBps,
      nonce: str(message.nonce),
      expiry: str(message.expiry),
    } as IntentWire,
  };
}

export function buildCancelIntent(binding: EnclaveBinding, message: CancelIntentMsg): TypedRequest<CancelIntentMsg, CancelIntentWire> {
  return {
    primaryType: 'CancelIntent',
    domain: domainFor(binding),
    message,
    wire: { owner: message.owner, intentId: message.intentId, nonce: str(message.nonce), expiry: str(message.expiry) } as CancelIntentWire,
  };
}

export function buildWithdrawal(binding: EnclaveBinding, message: WithdrawalMsg): TypedRequest<WithdrawalMsg, WithdrawalWire> {
  return {
    primaryType: 'Withdrawal',
    domain: domainFor(binding),
    message,
    wire: {
      owner: message.owner,
      token: message.token,
      amount: str(message.amount),
      to: message.to,
      nonce: str(message.nonce),
      expiry: str(message.expiry),
    } as WithdrawalWire,
  };
}

export function buildMarginLending(
  binding: EnclaveBinding,
  kind: 'MarginSupply' | 'MarginRedeem',
  message: MarginSupplyMsg,
): TypedRequest<MarginSupplyMsg, MarginSupplyWire> {
  return {
    primaryType: kind,
    domain: domainFor(binding),
    message,
    wire: {
      owner: message.owner,
      token: message.token,
      amount: str(message.amount),
      nonce: str(message.nonce),
      expiry: str(message.expiry),
    } as MarginSupplyWire,
  };
}

/** The signed type carries side as uint8 (0 long, 1 short); the wire carries the word. */
export function buildMarginOpen(binding: EnclaveBinding, message: MarginOpenMsg): TypedRequest<MarginOpenMsg, MarginOpenWire> {
  if (message.side !== 0 && message.side !== 1) throw new Error('INVALID_SIDE');
  return {
    primaryType: 'MarginOpen',
    domain: domainFor(binding),
    message,
    wire: {
      owner: message.owner,
      side: message.side === 0 ? 'long' : 'short',
      collateral: str(message.collateral),
      leverageBps: message.leverageBps,
      limitPrice: str(message.limitPrice),
      maxSlippageBps: message.maxSlippageBps,
      nonce: str(message.nonce),
      expiry: str(message.expiry),
    } as MarginOpenWire,
  };
}

export function buildMarginAddCollateral(
  binding: EnclaveBinding,
  message: MarginAddCollateralMsg,
): TypedRequest<MarginAddCollateralMsg, MarginAddCollateralWire> {
  return {
    primaryType: 'MarginAddCollateral',
    domain: domainFor(binding),
    message,
    wire: {
      owner: message.owner,
      positionId: message.positionId,
      amount: str(message.amount),
      nonce: str(message.nonce),
      expiry: str(message.expiry),
    } as MarginAddCollateralWire,
  };
}

export function buildMarginClose(binding: EnclaveBinding, message: MarginCloseMsg): TypedRequest<MarginCloseMsg, MarginCloseWire> {
  return {
    primaryType: 'MarginClose',
    domain: domainFor(binding),
    message,
    wire: {
      owner: message.owner,
      positionId: message.positionId,
      limitPrice: str(message.limitPrice),
      maxSlippageBps: message.maxSlippageBps,
      nonce: str(message.nonce),
      expiry: str(message.expiry),
    } as MarginCloseWire,
  };
}

/** Anything that can sign EIP-712 typed data: wagmi's signTypedDataAsync or a viem account. */
export type TypedDataSigner = (args: {
  domain: ReturnType<typeof domainFor>;
  types: typeof EIP712_TYPES;
  primaryType: SignablePrimaryType;
  message: Record<string, unknown>;
}) => Promise<Hex>;

export interface SignedWire<W> {
  message: W;
  signature: Hex;
}

export async function signRequest<M, W>(signer: TypedDataSigner, request: TypedRequest<M, W>): Promise<SignedWire<W>> {
  const signature = await signer({
    domain: request.domain,
    types: EIP712_TYPES,
    primaryType: request.primaryType,
    message: request.message as unknown as Record<string, unknown>,
  });
  return { message: request.wire, signature };
}

export type { Address };
