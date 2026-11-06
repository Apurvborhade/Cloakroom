"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetBalanceCardProps {
  symbol: "ETH" | "USDC";
  name: string;
  decimals: number;
  totalQuantity: string;
  availableQuantity: string;
  allocatedQuantity: string;
  purchasedQuantity?: string;
  spentQuantity?: string;
  estimatedUsdValue: string;
  valuationNote?: string;
  className?: string;
}

export function AssetBalanceCard({
  symbol,
  name,
  decimals,
  totalQuantity,
  availableQuantity,
  allocatedQuantity,
  purchasedQuantity,
  spentQuantity,
  estimatedUsdValue,
  valuationNote,
  className,
}: AssetBalanceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isEth = symbol === "ETH";

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all hover:border-[#3A4759] shadow-lg",
        className
      )}
    >
      {/* Top Header: Symbol, Name & Balance */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm border",
              isEth
                ? "bg-[#1C222B] border-[#3B82F6]/30 text-[#3B82F6]"
                : "bg-[#1C222B] border-emerald-500/30 text-emerald-400"
            )}
          >
            {isEth ? "Ξ" : "$"}
          </div>
          <div>
            <div className="font-bold text-sm text-[#F0F4F8] tracking-tight">{name}</div>
            <div className="text-[10px] text-[#505D6E] uppercase">
              {symbol} Native Asset • {decimals} Decimals
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-base sm:text-lg font-bold text-[#F0F4F8]">
            {totalQuantity} <span className="text-xs text-[#3B82F6]">{symbol}</span>
          </div>
          <div className="text-[11px] text-[#94A3B8] font-medium">{estimatedUsdValue} USD</div>
        </div>
      </div>

      {/* Primary Availability & Allocation Strip */}
      <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-[#1C222B] border border-[#232B36] text-xs">
        <div className="space-y-0.5">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-medium">
            AVAILABLE
          </span>
          <span className="font-bold text-emerald-400">
            {availableQuantity} {symbol}
          </span>
        </div>

        <div className="space-y-0.5 text-right">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-medium">
            ALLOCATED IN ORDERS
          </span>
          <span
            className={cn(
              "font-bold",
              parseFloat(allocatedQuantity) > 0 ? "text-amber-400" : "text-[#505D6E]"
            )}
          >
            {allocatedQuantity} {symbol}
          </span>
        </div>
      </div>

      {/* Expand/Collapse Toggle */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between text-[11px] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors pt-1 focus:outline-none cursor-pointer"
      >
        <span>{isExpanded ? "Hide Accounting Details" : "Show Full Accounting Details"}</span>
        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>

      {/* Expanded Breakdown */}
      {isExpanded && (
        <div className="pt-2 border-t border-[#232B36] space-y-2 text-xs text-[11px] animate-in fade-in duration-150">
          {purchasedQuantity !== undefined && (
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>Purchased via Swaps:</span>
              <span className="text-[#F0F4F8] font-medium">
                {purchasedQuantity} {symbol}
              </span>
            </div>
          )}

          {spentQuantity !== undefined && (
            <div className="flex items-center justify-between text-[#94A3B8]">
              <span>Disbursed in Trades:</span>
              <span className="text-[#F0F4F8] font-medium">
                {spentQuantity} {symbol}
              </span>
            </div>
          )}

          <div className="flex items-center justify-between text-[#94A3B8]">
            <span>On-Chain Precision:</span>
            <span className="text-[#3B82F6] font-semibold">{decimals} Decimals</span>
          </div>

          {valuationNote && (
            <div className="flex items-start gap-1.5 text-[10px] text-[#505D6E] pt-1">
              <Info size={11} className="shrink-0 mt-0.5" />
              <span>{valuationNote}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
