"use client";

import React from "react";
import { Clock, Zap } from "lucide-react";
import { CalculationResult } from "@/lib/mix/calculations";
import { MixAssetSymbol } from "@/lib/mix/types";

interface ConversionSummaryProps {
  inputAsset: MixAssetSymbol;
  calculation: CalculationResult;
}

export function ConversionSummary({
  inputAsset,
  calculation,
}: ConversionSummaryProps) {
  const isEthInput = inputAsset === "ETH";
  const outputAsset = isEthInput ? "USDC" : "ETH";

  return (
    <div className="w-full p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] space-y-3.5 text-left text-xs font-mono shadow-lg">
      {/* Title */}
      <div className="flex items-center justify-between text-[#94A3B8] border-b border-[#232B36] pb-2.5">
        <span className="uppercase tracking-wider text-[11px] font-semibold text-[#3B82F6] flex items-center gap-1.5">
          <Zap size={13} />
          <span>Pool Allocation Breakdown</span>
        </span>
        <div className="flex items-center gap-1 text-[10px] text-[#505D6E]">
          <Clock size={11} />
          <span>Oracle Estimate</span>
        </div>
      </div>

      {/* Breakdown Rows */}
      <div className="space-y-2 text-[12px]">
        {/* Estimated Rate */}
        <div className="flex items-center justify-between">
          <span className="text-[#94A3B8]">Estimated Rate:</span>
          <span className="text-[#F0F4F8] font-medium">
            1 ETH ≈ ${calculation.rate.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
          </span>
        </div>

        {/* Protocol Enclave Relayer Fee */}
        <div className="flex items-center justify-between">
          <span className="text-[#94A3B8]">Enclave Relayer Fee (0.10%):</span>
          <span className="text-[#F0F4F8]">
            {calculation.feeAmount} {inputAsset}
          </span>
        </div>

        {/* Estimated Shielded Allocation */}
        <div className="flex items-center justify-between pt-2 border-t border-[#232B36]">
          <span className="text-[#94A3B8]">Estimated Output Allocation:</span>
          <span className="text-[#3B82F6] font-bold text-sm">
            {calculation.estimatedOutput} {outputAsset}
          </span>
        </div>
      </div>
    </div>
  );
}
