'use client';

import type { DepositStatusResponse, IntentStatusResponse, LendingResponse, PositionsResponse, WithdrawalStatusResponse } from '@cloakroom/shared';
import {
  getBalances,
  getDepositStatuses,
  getIntentStatuses,
  getMarginLending,
  getMarginPositions,
  getWithdrawalStatuses,
} from '@/lib/api/endpoints';
import { appConfig } from '@/lib/config';
import { usePrivateRead } from './use-private-read';

/** While something is in progress, so a result shows within a couple of seconds. */
const FAST = 2_000;
/** Balances people are watching. */
const BALANCE = 4_000;
const SLOW = 20_000;

export function useBalances() {
  return usePrivateRead('balance', getBalances, { refetchInterval: BALANCE });
}

const OPEN_DEPOSIT = new Set(['awaiting_funds', 'awaiting_gas', 'awaiting_token']);
export function useDepositStatuses() {
  return usePrivateRead<DepositStatusResponse>('deposits', getDepositStatuses, {
    refetchInterval: (data) => (data?.deposits.some((item) => OPEN_DEPOSIT.has(item.status)) ? FAST : SLOW),
  });
}

const OPEN_INTENT = new Set(['pending', 'executing']);
export function useIntentStatuses() {
  return usePrivateRead<IntentStatusResponse>('intents', getIntentStatuses, {
    refetchInterval: (data) => (data?.intents.some((intent) => OPEN_INTENT.has(intent.status)) ? FAST : SLOW),
  });
}

const OPEN_WITHDRAWAL = new Set(['locked', 'sent']);
export function useWithdrawalStatuses() {
  return usePrivateRead<WithdrawalStatusResponse>('withdrawals', getWithdrawalStatuses, {
    refetchInterval: (data) => (data?.withdrawals.some((item) => OPEN_WITHDRAWAL.has(item.status)) ? FAST : SLOW),
  });
}

const BUSY_POSITION = new Set(['opening', 'closing', 'liquidating']);
export function useMarginPositions() {
  return usePrivateRead<PositionsResponse>('margin-positions', getMarginPositions, {
    enabled: appConfig.marginUi !== 'off',
    refetchInterval: (data) => (data?.positions.some((position) => BUSY_POSITION.has(position.status)) ? FAST : SLOW),
  });
}

export function useMarginLending() {
  return usePrivateRead<LendingResponse>('margin-lending', getMarginLending, {
    enabled: appConfig.marginUi !== 'off',
    refetchInterval: SLOW,
  });
}

export type MarginAvailability = 'off-by-config' | 'needs-session' | 'checking' | 'enabled' | 'disabled' | 'error';

/**
 * Margin has no public capability endpoint. Its routes exist only with MARGIN_ENABLED=true, so a
 * session-signed read of /margin/lending answering 404 means "disabled", and a successful one means
 * the routes are live.
 */
export function useMarginAvailability(): { availability: MarginAvailability; errorCode: string | null } {
  const lending = useMarginLending();
  if (appConfig.marginUi === 'off') return { availability: 'off-by-config', errorCode: null };
  if (lending.data) return { availability: 'enabled', errorCode: null };
  if (lending.error) {
    const code = lending.error.code;
    if (code === 'ROUTE_NOT_FOUND' || code === 'MARGIN_DISABLED') return { availability: 'disabled', errorCode: code };
    if (code === 'NO_SESSION' || code === 'UNKNOWN_SESSION') return { availability: 'needs-session', errorCode: code };
    return { availability: 'error', errorCode: code };
  }
  if (lending.fetchStatus === 'fetching') return { availability: 'checking', errorCode: null };
  return { availability: 'needs-session', errorCode: null };
}

export type { LendingResponse, PositionsResponse };
