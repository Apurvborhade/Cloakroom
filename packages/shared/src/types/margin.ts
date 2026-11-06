import type { Address, Hex } from 'viem';
import type { PriceReport } from './oracle.js';

// Internal accounting contracts: token base units as bigint, timestamps in Unix seconds.
export interface MarginAmount {
  token: Address;
  amount: bigint;
}

export type MarginSide = 'long' | 'short';
export type MarginPositionStatus =
  | 'opening' | 'open' | 'closing' | 'liquidating' | 'closed' | 'liquidated' | 'failed';

export interface MarginPosition {
  id: string;
  owner: Address;
  side: MarginSide;
  status: MarginPositionStatus;
  /** Original USDC contribution (6 decimals), not an additional asset on top of holdings. */
  collateralUSDC: bigint;
  holdings: readonly MarginAmount[];
  debt: {
    token: Address;
    principal: bigint;
    interest: bigint;
    accruedAt: number;
  };
  /** Uncovered debt in debt.token units after liquidation; never credited as repaid. */
  shortfall: bigint;
  activeOpId?: string;
}

export interface MarginLendingBalance {
  token: Address;
  claimAmount: bigint;
  /** Portion currently redeemable from unborrowed, unreserved lending liquidity. */
  redeemableAmount: bigint;
}

export interface MarginFundingRequest extends MarginCommand {
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
  | ({ t: 'MARGIN_SUPPLIED' } & MarginLendingCommand)
  | ({ t: 'MARGIN_REDEEMED' } & MarginLendingCommand)
  | ({ t: 'MARGIN_OPEN_RESERVED' } & Omit<MarginFundingReservation, 'status'>)
  | { t: 'MARGIN_OPEN_RELEASED'; opId: string };

export interface MarginHealth {
  equityUSDC: bigint;
  pnlUSDC: bigint;
  maintenanceUSDC: bigint;
  liquidationPrice: bigint | null; // USDC per ETH, scaled by 1e18.
  liquidatable: boolean;
}

/** Stable ID for one authenticated command. Reuse with different parameters must fail. */
export interface MarginCommand {
  opId: string;
  owner: Address;
}

export interface MarginLendingCommand extends MarginCommand, MarginAmount {}

export interface MarginTradeLimits {
  maxSlippageBps: number;
  deadline: number;
}

export interface MarginOpenCommand extends MarginCommand, MarginTradeLimits {
  side: MarginSide;
  collateralUSDC: bigint;
  borrow: MarginAmount;
}

export interface MarginCloseCommand extends MarginCommand, MarginTradeLimits {
  positionId: string;
}

export interface MarginCollateralCommand extends MarginCommand {
  positionId: string;
  amountUSDC: bigint;
}

/** Full-position swaps; exact output permits repaying a short's ETH debt without overbuying. */
export type MarginSwap = {
  tokenIn: Address;
  tokenOut: Address;
  deadline: number;
} & (
  | { kind: 'exactIn'; amountIn: bigint; minAmountOut: bigint }
  | { kind: 'exactOut'; amountOut: bigint; maxAmountIn: bigint }
);

export interface PreparedMarginOperation {
  opId: string;
  positionId: string;
  owner: Address;
  action: 'open' | 'close' | 'liquidate';
  swap: MarginSwap;
}

/**
 * Swap amounts are custody debits/credits before protocol fees, excluding gas.
 * gasCostWei is cumulative confirmed gas expenditure, including approvals.
 */
export type MarginExecutionResult = { gasCostWei: bigint } & (
  | {
      status: 'confirmed';
      txHash: Hex;
      blockNumber: bigint;
      amountIn: bigint;
      amountOut: bigint;
    }
  | {
      status: 'not_sent'; // No swap was submitted; approvals may already have spent gas.
      reason: string;
    }
  | {
      status: 'reverted';
      txHash: Hex;
      blockNumber: bigint;
      reason: string;
    }
  | {
      status: 'unresolved'; // A timeout is not a failure; reservations remain locked.
      txHash: Hex;
    }
);

export interface MarginOperation extends PreparedMarginOperation {
  result?: MarginExecutionResult;
}

export interface MarginAccounting {
  supply(command: MarginLendingCommand): Promise<MarginLendingBalance>;
  redeem(command: MarginLendingCommand): Promise<MarginLendingBalance>;
  addCollateral(command: MarginCollateralCommand): Promise<MarginPosition>;

  /** Reserve and journal before returning execution limits. Risk prices are not swap quotes. */
  prepareOpen(command: MarginOpenCommand, price: PriceReport): Promise<PreparedMarginOperation>;
  prepareClose(command: MarginCloseCommand, price: PriceReport): Promise<PreparedMarginOperation>;
  prepareLiquidation(opId: string, positionId: string, price: PriceReport): Promise<PreparedMarginOperation>;

  /** Apply a terminal result once; conflicting repeats fail, unresolved results keep holds. */
  recordExecution(opId: string, result: MarginExecutionResult): Promise<MarginOperation>;
  /** Replay before serving requests, then return unfinished operations for executor recovery. */
  recover(): Promise<readonly MarginOperation[]>;

  getOperation(opId: string): MarginOperation | undefined;
  getPosition(positionId: string): MarginPosition | undefined;
  positions(owner?: Address): readonly MarginPosition[];
  lendingBalances(owner: Address): readonly MarginLendingBalance[];
  health(positionId: string, price: PriceReport): MarginHealth;
}
