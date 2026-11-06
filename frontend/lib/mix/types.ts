export type MixAssetSymbol = "ETH" | "USDC";

export interface MixAssetMeta {
  symbol: MixAssetSymbol;
  name: string;
  decimals: number;
  iconBg: string;
  iconColor: string;
}

export type RateType = "oracle_estimate" | "live" | "unavailable";

export interface MixConfig {
  inputAsset: MixAssetSymbol;
  inputAmount: string;
  sourceAddress: string;
  destinationAddress: string;
  network: string;
  estimatedRate: number; // e.g. 3200.00 USDC per 1 ETH
  rateType: RateType;
  feePercent: number; // e.g. 0.001 (0.1%)
  feeAmount: string;
  estimatedOutput: string;
  quoteTimestamp: string;
}

export type MixExecutionState =
  | "preparing"
  | "awaiting_signature"
  | "submitted"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface MixExecutionRecord {
  id: string;
  config: MixConfig;
  status: MixExecutionState;
  txHash: string | null;
  batchId: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  isSimulation: boolean;
}

export interface MixActivityItem {
  id: string;
  type: "MIX";
  status: "completed" | "processing" | "failed";
  asset: string;
  amount: string;
  destination: string;
  txHash: string | null;
  batchId: string | null;
  timestamp: string;
  isSimulation: boolean;
}
