import type { Address, Hex } from 'viem';
import type { MarginAddCollateralMsg, MarginCloseMsg, MarginOpenMsg, MarginSupplyMsg } from '../eip712.js';
import type { PriceReport } from './oracle.js';

export type MarginSide = 'long' | 'short';
export type MarginOperationKind = 'open' | 'close' | 'liquidate';

export type PositionStatus =
  | 'opening'
  | 'open'
  | 'closing'
  | 'liquidating'
  | 'closed'
  | 'liquidated'
  | 'failed';

/** One Uniswap swap that accounting has checked, reserved funds for, and journaled. */
export interface MarginOperation {
  /** Always `margin:<id>`, and never reused. */
  opId: string;
  kind: MarginOperationKind;
  positionId: Hex;
  owner: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  maxSlippageBps: number;
  /** Unix seconds. Nothing is signed for this operation after it. */
  expiry: number;
}

/** The confirmed on-chain result, read from the receipt. */
export interface MarginExecutionResult {
  amountIn: bigint;
  amountOut: bigint;
  gasCost: bigint;
  txHash: Hex;
}

/** The swap did not happen. If it was sent and reverted, the gas was still spent. */
export interface MarginExecutionFailure {
  reason: string;
  gasCost?: bigint;
  txHash?: Hex;
}

export interface PositionView {
  id: Hex;
  owner: Address;
  side: MarginSide;
  status: PositionStatus;
  collateral: bigint;
  /** Collateral times leverage, in USDC base units. */
  sizeUsd: bigint;
  debtToken: Address;
  debt: bigint;
  assetToken: Address;
  asset: bigint;
  entryPrice?: bigint;
  liquidationPrice?: bigint;
  equity?: bigint;
  payout?: bigint;
  shortfall?: bigint;
}

export interface LendingView {
  token: Address;
  supplied: bigint;
  /** What could be redeemed now: supplied funds not currently out on loan. */
  available: bigint;
}

/**
 * What the margin API and execution need from accounting. Accounting is the only writer of margin
 * balances and debt. Rejections throw an error carrying a code from ERROR_CODES.
 *
 * Each prepare method checks the risk, reserves the funds, and journals MARGIN_OP_APPROVED before
 * returning. Execution then ends every operation in exactly one settle or fail, each of which must
 * journal MARGIN_OP_SETTLED or MARGIN_OP_FAILED. A broadcast with no receipt calls neither, and the
 * funds stay reserved until recovery finds the result.
 */
export interface MarginAccounting {
  supply(owner: Address, message: MarginSupplyMsg): Promise<void>;
  redeem(owner: Address, message: MarginSupplyMsg): Promise<void>;
  addCollateral(owner: Address, message: MarginAddCollateralMsg): Promise<void>;

  prepareOpen(owner: Address, message: MarginOpenMsg, price: PriceReport): Promise<MarginOperation>;
  prepareClose(owner: Address, message: MarginCloseMsg, price: PriceReport): Promise<MarginOperation>;
  /** Positions below maintenance margin at this price. A read: it reserves nothing. */
  liquidationCandidates(price: PriceReport): Promise<readonly Hex[]>;
  /** Checks the position again. Null means it is healthy or already being closed. */
  prepareLiquidation(positionId: Hex, price: PriceReport): Promise<MarginOperation | null>;

  settle(opId: string, result: MarginExecutionResult): Promise<void>;
  fail(opId: string, failure: MarginExecutionFailure): Promise<void>;

  positions(owner: Address, price: PriceReport | null): readonly PositionView[];
  lending(owner: Address): readonly LendingView[];
}
