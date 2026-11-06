"use client";

import React from "react";
import {
  TrendingUp,
  ShieldCheck,
  Zap,
  Layers,
  Info,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderType } from "@/lib/pool/types";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface PriceInformationProps {
  orderType: PoolOrderType;
  currentPrice?: number;
  targetPrice?: string;
  priceDeltaPercent?: number;
  priceImpact?: string;
  minimumReceived?: string;
  slippageTolerance?: number;
  network?: string;
  className?: string;
}

export function PriceInformation({
  orderType,
  currentPrice = REFERENCE_ETH_PRICE,
  targetPrice,
  priceDeltaPercent = 0,
  priceImpact = "< 0.05%",
  minimumReceived,
  slippageTolerance = 0.5,
  network = "Sepolia Testnet",
  className,
}: PriceInformationProps) {
  const isLimit = orderType === "LIMIT";
  const numericTarget = targetPrice ? parseFloat(targetPrice) : 0;
  const isAboveMarket = numericTarget > currentPrice;

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 text-xs font-mono shadow-lg",
        className
      )}
    >
      {/* Header with Oracle Reference */}
      <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="text-[#94A3B8] text-[11px] uppercase tracking-wider font-semibold">
            REFERENCE ORACLE (DEMO BENCHMARK)
          </span>
        </div>
        <span className="text-[11px] text-[#3B82F6] font-bold tracking-tight">
          1 ETH = ${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
        </span>
      </div>

      {/* Target Price Delta Banner for Limit Orders */}
      {isLimit && numericTarget > 0 && (
        <div
          className={cn(
            "p-3 rounded-xl border flex items-center justify-between transition-all",
            isAboveMarket
              ? "bg-[#1C222B] border-[#3B82F6]/40 text-[#F0F4F8]"
              : "bg-amber-950/30 border-amber-800/40 text-amber-300"
          )}
        >
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className={isAboveMarket ? "text-[#3B82F6]" : "text-amber-400"} />
            <span className="text-[11px] font-medium">
              {isAboveMarket ? "Target Spread:" : "Condition Notice:"}
            </span>
          </div>
          <div className="text-right">
            <span
              className={cn(
                "font-bold text-xs",
                isAboveMarket ? "text-[#3B82F6]" : "text-amber-400"
              )}
            >
              {priceDeltaPercent >= 0 ? `+${priceDeltaPercent.toFixed(2)}%` : `${priceDeltaPercent.toFixed(2)}%`}
            </span>
            <span className="text-[10px] text-[#505D6E] block">
              {isAboveMarket ? "above oracle rate" : "below oracle rate (may fill fast)"}
            </span>
          </div>
        </div>
      )}

      {/* Market Order Slippage & Protection */}
      {!isLimit && (
        <div className="grid grid-cols-2 gap-3 py-1">
          <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
            <div className="flex items-center gap-1.5 text-[#94A3B8] text-[10px]">
              <SlidersHorizontal size={12} />
              <span>SLIPPAGE TOLERANCE</span>
            </div>
            <div className="text-[#F0F4F8] font-semibold text-xs">
              {slippageTolerance}%
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
            <div className="flex items-center gap-1.5 text-[#94A3B8] text-[10px]">
              <Zap size={12} className="text-[#3B82F6]" />
              <span>EST. PRICE IMPACT</span>
            </div>
            <div className="text-[#3B82F6] font-bold text-xs">
              {priceImpact}
            </div>
          </div>
        </div>
      )}

      {/* Minimum Received row for Market Orders */}
      {!isLimit && minimumReceived && (
        <div className="flex items-center justify-between py-1 text-[11px]">
          <span className="text-[#94A3B8]">Guaranteed Minimum Received</span>
          <span className="text-emerald-400 font-bold">{minimumReceived} USDC</span>
        </div>
      )}

      {/* Enclave Info */}
      <div className="space-y-2 pt-2 border-t border-[#232B36]">
        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <Layers size={13} className="text-[#505D6E]" />
            <span>Simulated Enclave Depth</span>
          </div>
          <span className="text-[#F0F4F8] font-medium">Testnet Batch Pool (Demo)</span>
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <ShieldCheck size={13} className="text-[#3B82F6]" />
            <span>Mempool Sealing</span>
          </div>
          <span className="text-emerald-400 font-semibold">Encrypted Intent Routing (Sandbox)</span>
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <Info size={13} className="text-[#505D6E]" />
            <span>Target Environment</span>
          </div>
          <span className="text-[#505D6E]">{network}</span>
        </div>
      </div>
    </div>
  );
}
