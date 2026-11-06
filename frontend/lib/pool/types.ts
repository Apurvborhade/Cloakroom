export type PoolOrderType = "MARKET" | "LIMIT";
export type PoolTradingPair = "ETH/USDC";

export type MarketExecutionState =
  | "preparing"
  | "awaiting_signature"
  | "submitted"
  | "processing"
  | "completed"
  | "cancellation_requested"
  | "cancelled"
  | "failed";

export type LimitExecutionState =
  | "order_created"
  | "funds_reserved"
  | "awaiting_signature"
  | "submitted"
  | "active_waiting"
  | "condition_met"
  | "executing"
  | "completed"
  | "cancellation_requested"
  | "cancelled"
  | "expired"
  | "failed";

export type PoolExecutionState = MarketExecutionState | LimitExecutionState;

export interface PoolOrderConfig {
  orderType: PoolOrderType;
  tradingPair: PoolTradingPair;
  sellAsset: "ETH";
  buyAsset: "USDC";
  sellAmount: string;
  targetPrice?: string; // For Limit orders (USDC per 1 ETH)
  currentPrice: number; // Current reference price ($3,200.00)
  estimatedOutput: string; // Calculated USDC received
  minimumReceived?: string; // For Market orders with slippage
  slippageTolerance: number; // e.g. 0.005 (0.5%)
  feePercent: number; // 0.001 (0.10%)
  feeAmount: string; // Fee in ETH
  expiryDuration?: string; // e.g. "24 Hours", "7 Days", "GTC"
  network: string;
  sourceAddress: string;
  destinationAddress: string;
  quoteTimestamp: string;
}

export interface PoolOrderRecord {
  id: string;
  orderType: PoolOrderType;
  tradingPair: PoolTradingPair;
  sellAsset: "ETH";
  buyAsset: "USDC";
  sellAmount: string;
  targetPrice?: string;
  executionPrice?: string;
  estimatedOutput: string;
  actualOutput?: string;
  feeAmount: string;
  network: string;
  sourceAddress: string;
  destinationAddress: string;
  status: PoolExecutionState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  txHash?: string | null;
  batchId?: string | null;
  errorMessage?: string | null;
  isSimulation: boolean;
}

export interface PoolActivityItem {
  id: string;
  type: "POOL_MARKET" | "POOL_LIMIT";
  tradingPair: string;
  sellAmount: string;
  buyAmount: string;
  executionPrice: string;
  status: "completed" | "active" | "cancelled" | "failed";
  timestamp: string;
  txHash?: string | null;
  batchId?: string | null;
  isSimulation: boolean;
}

