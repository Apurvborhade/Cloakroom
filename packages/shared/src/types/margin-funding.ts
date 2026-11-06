import type { Address } from 'viem';
import type { MarginSupplyMsg } from '../eip712.js';

export interface MarginAmount {
  token: Address;
  amount: bigint;
}

export interface MarginFundingRequest {
  opId: string;
  owner: Address;
  collateralUSDC: bigint;
  borrow: MarginAmount;
}

/** A funding hold, not permission to execute a swap. */
export interface MarginFundingReservation {
  opId: string;
  owner: Address;
  collateral: MarginAmount;
  borrow: MarginAmount;
  status: 'reserved' | 'released';
}

export type MarginFundingEvent =
  | ({ t: 'MARGIN_SUPPLIED'; opId: string } & MarginSupplyMsg)
  | ({ t: 'MARGIN_REDEEMED'; opId: string } & MarginSupplyMsg)
  | ({ t: 'MARGIN_OPEN_RESERVED' } & Omit<MarginFundingReservation, 'status'>)
  | { t: 'MARGIN_OPEN_RELEASED'; opId: string };
