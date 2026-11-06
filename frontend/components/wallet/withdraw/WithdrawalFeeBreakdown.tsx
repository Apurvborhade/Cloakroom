"use client";

import React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { WithdrawalAsset } from "./WithdrawalBalanceOverview";

interface WithdrawalFeeBreakdownProps {
  asset: WithdrawalAsset;
  amount: string;
  networkName: string;
  className?: string;
}

export function WithdrawalFeeBreakdown({
  asset,
  amount,
  networkName,
  className,
}: WithdrawalFeeBreakdownProps) {
  const numericAmount = parseFloat(amount || "0");
  const formattedAmount =
    amount && !isNaN(numericAmount) && numericAmount > 0 ? amount : "0.00";

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all hover:border-[#3B82F6]/40 shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold">
          NETWORK &amp; FEE BREAKDOWN
        </span>
        <span className="text-[10px] text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-2 py-0.5 rounded-full font-semibold">
          Pending Contract Audit
        </span>
      </div>

      {/* 6 Structured Breakdown Rows */}
      <div className="space-y-2.5 text-xs">
        {/* 1. Selected Asset */}
        <div className="flex items-center justify-between py-1.5 border-b border-[#232B36]">
          <span className="text-[#94A3B8]">Selected Asset</span>
          <span className="text-[#F0F4F8] font-bold">{asset}</span>
        </div>

        {/* 2. Withdrawal Amount */}
        <div className="flex items-center justify-between py-1.5 border-b border-[#232B36]">
          <span className="text-[#94A3B8]">Withdrawal Amount</span>
          <span className="text-[#F0F4F8] font-bold">
            {formattedAmount} {asset}
          </span>
        </div>

        {/* 3. Destination Network */}
        <div className="flex items-center justify-between py-1.5 border-b border-[#232B36]">
          <span className="text-[#94A3B8]">Execution Network</span>
          <span className="text-[#F0F4F8] font-semibold">{networkName || "Ethereum"}</span>
        </div>

        {/* 4. Estimated Network Fee */}
        <div className="flex items-center justify-between py-1.5 border-b border-[#232B36]">
          <span className="text-[#94A3B8]">Estimated Network Fee</span>
          <div className="text-right">
            <span className="text-[#F59E0B] font-semibold block">Not available</span>
            <span className="text-[10px] text-[#64748B] block">Awaiting contract audit</span>
          </div>
        </div>

        {/* 5. Fee Calculation Status */}
        <div className="flex items-center justify-between py-1.5 border-b border-[#232B36]">
          <span className="text-[#94A3B8]">Fee Calculation Status</span>
          <span className="text-[#F59E0B] font-semibold">Pending contract audit</span>
        </div>

        {/* 6. Estimated Amount Received */}
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[#94A3B8]">Estimated Received</span>
          <div className="text-right">
            <span className="text-[#10B981] font-bold block">
              {formattedAmount} {asset}
            </span>
            <span className="text-[10px] text-[#64748B] block">Excludes uncalculated L1 gas</span>
          </div>
        </div>
      </div>

      {/* Transparency Callout */}
      <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-start gap-2.5 text-[11px] text-[#94A3B8] leading-relaxed">
        <Info size={15} className="text-[#3B82F6] shrink-0 mt-0.5" />
        <div>
          Network gas fees are determined by Layer-1 gas market conditions at execution time. The Cash-Out Gateway contract is undergoing formal audit, so live gas estimation via <code className="text-[#3B82F6] bg-[#161B22] px-1 py-0.5 rounded border border-[#232B36] text-[10px]">eth_estimateGas</code> is currently unavailable.
        </div>
      </div>
    </div>
  );
}
