import {
  BalanceResponseSchema,
  DepositSessionResponseSchema,
  DepositStatusResponseSchema,
  IntentStatusResponseSchema,
  LendingResponseSchema,
  MarginOrderResponseSchema,
  PositionsResponseSchema,
  WithdrawalResponseSchema,
  WithdrawalStatusResponseSchema,
} from '@cloakroom/shared';
import type {
  CancelIntentWire,
  DepositRequestWire,
  IntentWire,
  MarginAddCollateralWire,
  MarginCloseWire,
  MarginOpenWire,
  MarginSupplyWire,
  SessionGrantWire,
  SessionQueryWire,
  WithdrawalWire,
} from '@cloakroom/shared';
import type { SealContext } from '../crypto/transport';
import type { SignedWire } from '../wallet/typed-data';
import type { CloakroomApi } from './client';
import { IntentCancelledResponseSchema, IntentCreatedResponseSchema, OkResponseSchema, SessionResponseSchema } from './schemas';

/** Every private endpoint the enclave registers, with the signed type it expects. */
export const PRIVATE_ROUTES = {
  session: '/session',
  depositSession: '/deposit-session',
  balance: '/balance',
  intents: '/intents',
  intentStatus: '/intents/status',
  intentCancel: '/intents/cancel',
  withdrawals: '/withdrawals',
  depositStatus: '/deposits/status',
  withdrawalStatus: '/withdrawals/status',
  marginSupply: '/margin/lending/supply',
  marginRedeem: '/margin/lending/redeem',
  marginOpen: '/margin/positions/open',
  marginCollateral: '/margin/positions/collateral',
  marginClose: '/margin/positions/close',
  marginPositions: '/margin/positions',
  marginLending: '/margin/lending',
} as const;

const R = PRIVATE_ROUTES;

// Owner-signed (primary wallet).
export const createSession = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionGrantWire>) =>
  api.postPrivate(R.session, req, ctx, SessionResponseSchema);
export const getDepositStatuses = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionQueryWire>) =>
  api.postPrivate(R.depositStatus, req, ctx, DepositStatusResponseSchema);
export const openDepositSession = (api: CloakroomApi, ctx: SealContext, req: SignedWire<DepositRequestWire>) =>
  api.postPrivate(R.depositSession, req, ctx, DepositSessionResponseSchema);
export const createIntent = (api: CloakroomApi, ctx: SealContext, req: SignedWire<IntentWire>) =>
  api.postPrivate(R.intents, req, ctx, IntentCreatedResponseSchema);
export const cancelIntent = (api: CloakroomApi, ctx: SealContext, req: SignedWire<CancelIntentWire>) =>
  api.postPrivate(R.intentCancel, req, ctx, IntentCancelledResponseSchema);
export const createWithdrawal = (api: CloakroomApi, ctx: SealContext, req: SignedWire<WithdrawalWire>) =>
  api.postPrivate(R.withdrawals, req, ctx, WithdrawalResponseSchema);
export const marginSupply = (api: CloakroomApi, ctx: SealContext, req: SignedWire<MarginSupplyWire>) =>
  api.postPrivate(R.marginSupply, req, ctx, OkResponseSchema);
export const marginRedeem = (api: CloakroomApi, ctx: SealContext, req: SignedWire<MarginSupplyWire>) =>
  api.postPrivate(R.marginRedeem, req, ctx, OkResponseSchema);
export const marginOpen = (api: CloakroomApi, ctx: SealContext, req: SignedWire<MarginOpenWire>) =>
  api.postPrivate(R.marginOpen, req, ctx, MarginOrderResponseSchema);
export const marginAddCollateral = (api: CloakroomApi, ctx: SealContext, req: SignedWire<MarginAddCollateralWire>) =>
  api.postPrivate(R.marginCollateral, req, ctx, OkResponseSchema);
export const marginClose = (api: CloakroomApi, ctx: SealContext, req: SignedWire<MarginCloseWire>) =>
  api.postPrivate(R.marginClose, req, ctx, MarginOrderResponseSchema);

// Session-signed reads (browser-held session key).
export const getBalances = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionQueryWire>) =>
  api.postPrivate(R.balance, req, ctx, BalanceResponseSchema);
export const getIntentStatuses = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionQueryWire>) =>
  api.postPrivate(R.intentStatus, req, ctx, IntentStatusResponseSchema);
export const getWithdrawalStatuses = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionQueryWire>) =>
  api.postPrivate(R.withdrawalStatus, req, ctx, WithdrawalStatusResponseSchema);
export const getMarginPositions = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionQueryWire>) =>
  api.postPrivate(R.marginPositions, req, ctx, PositionsResponseSchema);
export const getMarginLending = (api: CloakroomApi, ctx: SealContext, req: SignedWire<SessionQueryWire>) =>
  api.postPrivate(R.marginLending, req, ctx, LendingResponseSchema);
