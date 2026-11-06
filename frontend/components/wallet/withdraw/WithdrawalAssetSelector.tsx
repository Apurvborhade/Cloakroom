"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { WithdrawalAsset } from "./WithdrawalBalanceOverview";
import { AssetSelector, SupportedAsset } from "@/components/AssetSelector";

interface WithdrawalAssetSelectorProps {
  selectedAsset: WithdrawalAsset;
  onSelectAsset: (asset: WithdrawalAsset) => void;
  availableEth: number;
  availableUsdc: number;
  className?: string;
}

export function WithdrawalAssetSelector({
  selectedAsset,
  onSelectAsset,
  availableEth,
  availableUsdc,
  className,
}: WithdrawalAssetSelectorProps) {
  const handleSelect = (asset: SupportedAsset) => {
    onSelectAsset(asset.symbol);
  };

  return (
    <div className={cn("space-y-2 font-mono text-left", className)}>
      <div className="flex items-center justify-between">
        <label className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold">
          2. ASSET SPECIFICATION
        </label>
        <span className="text-[10px] text-[#64748B]">
          Active: <strong className="text-[#3B82F6]">{selectedAsset}</strong>
        </span>
      </div>

      <AssetSelector
        selectedSymbol={selectedAsset}
        onSelect={handleSelect}
        balances={{
          ETH: availableEth.toFixed(4),
          USDC: availableUsdc.toFixed(2),
        }}
        label="Select Withdrawal Asset"
      />
    </div>
  );
}
