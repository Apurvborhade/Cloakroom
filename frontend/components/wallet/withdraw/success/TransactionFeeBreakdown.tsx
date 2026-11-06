"use client";

import React from "react";
import { Info, Fuel } from "lucide-react";
import { cn } from "@/lib/utils";

interface TransactionFeeBreakdownProps {
  gasUsed?: string;
  effectiveGasPriceGwei?: string;
  networkFeeEth?: string;
  protocolFee?: string;
  className?: string;
}

export function TransactionFeeBreakdown({
  gasUsed,
  effectiveGasPriceGwei,
  networkFeeEth,
  protocolFee = "0.00% (Testnet)",
  className,
}: TransactionFeeBreakdownProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-3.5 font-mono text-left transition-all hover:border-[#3B82F6]/40 shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold flex items-center gap-1.5">
          <Fuel size={13} className="text-[#3B82F6]" />
          <span>FEE &amp; EXECUTION BREAKDOWN</span>
        </span>
        <span className="text-[10px] text-[#64748B] uppercase">
          Receipt Metrics
        </span>
      </div>

      <div className="space-y-2 text-xs bg-[#1C222B] p-3.5 rounded-xl border border-[#232B36]">
        {/* Gas Used */}
        <div className="flex items-center justify-between">
          <span className="text-[#94A3B8]">Gas Units Consumed</span>
          <span className="text-[#F0F4F8] font-bold">
            {gasUsed || "Unavailable"}
          </span>
        </div>

        {/* Effective Gas Price */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Effective Gas Price</span>
          <span className="text-[#F0F4F8] font-semibold">
            {effectiveGasPriceGwei ? `${effectiveGasPriceGwei} Gwei` : "Unavailable"}
          </span>
        </div>

        {/* Total Network Gas Fee */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Total L1 Gas Fee</span>
          <span className="text-[#3B82F6] font-bold">
            {networkFeeEth ? `${networkFeeEth} ETH` : "Unavailable"}
          </span>
        </div>

        {/* Protocol Fee */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Gateway Protocol Fee</span>
          <span className="text-[#10B981] font-semibold">{protocolFee}</span>
        </div>
      </div>

      {/* Disclaimers */}
      <div className="flex items-start gap-2 text-[10px] text-[#64748B] leading-relaxed px-1">
        <Info size={12} className="shrink-0 mt-0.5 text-[#3B82F6]" />
        <span>
          L1 blockchain gas fees are incurred directly by the settlement transaction on Ethereum and are distinct from NONY protocol fees.
        </span>
      </div>
    </div>
  );
}
