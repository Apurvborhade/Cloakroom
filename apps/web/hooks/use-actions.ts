'use client';

import { MAX_EXPIRY_FUTURE_SEC, NATIVE } from '@cloakroom/shared';
import type { Address, Hex } from 'viem';
import {
  cancelIntent,
  createIntent,
  createWithdrawal,
  marginAddCollateral,
  marginClose,
  marginOpen,
  marginRedeem,
  marginSupply,
  openDepositSession,
} from '@/lib/api/endpoints';
import { recordDeposit, recordIntent, recordWithdrawal } from '@/lib/state/activity';
import { nowSec } from '@/lib/format/time';
import { nextNonce } from '@/lib/wallet/nonce';
import {
  buildCancelIntent,
  buildDepositRequest,
  buildIntent,
  buildMarginAddCollateral,
  buildMarginClose,
  buildMarginLending,
  buildMarginOpen,
  buildWithdrawal,
  mutationExpiry,
} from '@/lib/wallet/typed-data';
import { useSignedAction } from './use-signed-action';

/** Every owner-signed action in the app. Each one builds a fresh nonce and short expiry. */

export function useOpenDepositSession() {
  return useSignedAction({
    build: (_: void, { owner, binding }) =>
      buildDepositRequest(binding, { owner, asset: NATIVE, nonce: nextNonce(), expiry: mutationExpiry() }),
    send: openDepositSession,
    onSuccess: (result) =>
      recordDeposit({ sessionId: result.sessionId, depositAddress: result.depositAddress, expiresAt: result.expiresAt, createdAt: nowSec() }),
  });
}

export interface IntentInput {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  triggerPrice: bigint;
  comparator: 0 | 1;
  maxSlippageBps: number;
  /**
   * The enclave uses the signed expiry as the order's own lifetime, and accepts at most
   * MAX_EXPIRY_FUTURE_SEC ahead, so an intent can live a few minutes at most.
   */
  lifetimeSec: number;
}

export function useCreateIntent() {
  return useSignedAction({
    build: ({ lifetimeSec, ...input }: IntentInput, { owner, binding }) =>
      buildIntent(binding, { owner, ...input, nonce: nextNonce(), expiry: BigInt(nowSec() + intentLifetime(lifetimeSec)) }),
    send: createIntent,
    refresh: ['balance', 'intents'],
    onSuccess: (result, { lifetimeSec: _lifetime, ...input }, request) =>
      recordIntent({ id: result.intentId, ...input, signedAt: nowSec(), expiresAt: Number(request.message.expiry) }),
  });
}

/** Leaves 30 seconds for a browser clock running ahead of the enclave's. */
export const MAX_INTENT_LIFETIME_SEC = MAX_EXPIRY_FUTURE_SEC - 30;
export function intentLifetime(requested: number): number {
  return Math.max(30, Math.min(Math.floor(requested), MAX_INTENT_LIFETIME_SEC));
}

export function useCancelIntent() {
  return useSignedAction({
    build: (intentId: Hex, { owner, binding }) =>
      buildCancelIntent(binding, { owner, intentId, nonce: nextNonce(), expiry: mutationExpiry() }),
    send: cancelIntent,
    refresh: ['balance', 'intents'],
  });
}

export interface WithdrawalInput {
  token: Address;
  amount: bigint;
  to: Address;
}

export function useCreateWithdrawal() {
  return useSignedAction({
    build: (input: WithdrawalInput, { owner, binding }) =>
      buildWithdrawal(binding, { owner, ...input, nonce: nextNonce(), expiry: mutationExpiry() }),
    send: createWithdrawal,
    refresh: ['balance', 'withdrawals'],
    onSuccess: (result, input) => recordWithdrawal({ id: result.withdrawalId, ...input, createdAt: nowSec() }),
  });
}

export function useMarginLendingAction(kind: 'supply' | 'redeem') {
  return useSignedAction({
    build: (input: { token: Address; amount: bigint }, { owner, binding }) =>
      buildMarginLending(binding, kind === 'supply' ? 'MarginSupply' : 'MarginRedeem', {
        owner, token: input.token, amount: input.amount, nonce: nextNonce(), expiry: mutationExpiry(),
      }),
    send: kind === 'supply' ? marginSupply : marginRedeem,
    refresh: ['margin-lending', 'balance'],
  });
}

export interface MarginOpenInput {
  side: 0 | 1;
  collateral: bigint;
  leverageBps: number;
  limitPrice: bigint;
  maxSlippageBps: number;
}

export function useMarginOpen() {
  return useSignedAction({
    build: (input: MarginOpenInput, { owner, binding }) =>
      buildMarginOpen(binding, { owner, ...input, nonce: nextNonce(), expiry: mutationExpiry() }),
    send: marginOpen,
    refresh: ['margin-positions', 'margin-lending'],
  });
}

export function useMarginAddCollateral() {
  return useSignedAction({
    build: (input: { positionId: Hex; amount: bigint }, { owner, binding }) =>
      buildMarginAddCollateral(binding, { owner, ...input, nonce: nextNonce(), expiry: mutationExpiry() }),
    send: marginAddCollateral,
    refresh: ['margin-positions'],
  });
}

export function useMarginClose() {
  return useSignedAction({
    build: (input: { positionId: Hex; limitPrice: bigint; maxSlippageBps: number }, { owner, binding }) =>
      buildMarginClose(binding, { owner, ...input, nonce: nextNonce(), expiry: mutationExpiry() }),
    send: marginClose,
    refresh: ['margin-positions', 'margin-lending'],
  });
}
