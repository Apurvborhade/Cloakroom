"use client";

import React from "react";
import { CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

export type WithdrawalAsset = "ETH" | "USDC";

interface WithdrawalBalanceOverviewProps {
  selectedAsset: WithdrawalAsset;
  onSelectAsset: (asset: WithdrawalAsset) => void;
  availableEth: number;
  availableUsdc: number;
  className?: string;
}

export function WithdrawalBalanceOverview({
  selectedAsset,
  onSelectAsset,
  availableEth,
  availableUsdc,
  className,
}: WithdrawalBalanceOverviewProps) {
  const ethUsd = availableEth * REFERENCE_ETH_PRICE;
  const usdcUsd = availableUsdc * 1.0;

  return (
    <div className={cn("space-y-3 font-mono text-left", className)}>
      <div className="flex items-center justify-between pb-1">
        <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold">
          1. SELECT ASSET TO WITHDRAW
        </span>
        <span className="text-[10px] text-[#64748B]">
          Click card to select
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* ETH Balance Card */}
        <button
          type="button"
          onClick={() => onSelectAsset("ETH")}
          className={cn(
            "p-4 rounded-2xl border text-left transition-all relative focus:outline-none shadow-lg",
            selectedAsset === "ETH"
              ? "bg-[#1C222B] border-[#3B82F6] ring-1 ring-[#3B82F6]/50"
              : "bg-[#161B22] border-[#232B36] hover:border-[#3B82F6]/40"
          )}
        >
          {selectedAsset === "ETH" && (
            <div className="absolute top-3 right-3 text-[#3B82F6]">
              <CheckCircle2 size={16} />
            </div>
          )}

          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/30 flex items-center justify-center font-bold text-xs text-[#3B82F6]">
              Ξ
            </div>
            <div>
              <div className="font-bold text-sm text-[#F0F4F8]">Ethereum</div>
              <div className="text-[10px] text-[#94A3B8] uppercase">ETH Native • 18 Decimals</div>
            </div>
          </div>

          <div className="space-y-0.5 pt-1 border-t border-[#232B36]">
            <div className="text-lg font-bold text-[#F0F4F8]">
              {availableEth.toFixed(4)} <span className="text-xs text-[#3B82F6]">ETH</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
              <span>~${ethUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              <span className="text-[#10B981] text-[10px] font-semibold">Live On-Chain EOA</span>
            </div>
          </div>
        </button>

        {/* USDC Balance Card */}
        <button
          type="button"
          onClick={() => onSelectAsset("USDC")}
          className={cn(
            "p-4 rounded-2xl border text-left transition-all relative focus:outline-none shadow-lg",
            selectedAsset === "USDC"
              ? "bg-[#1C222B] border-[#3B82F6] ring-1 ring-[#3B82F6]/50"
              : "bg-[#161B22] border-[#232B36] hover:border-[#3B82F6]/40"
          )}
        >
          {selectedAsset === "USDC" && (
            <div className="absolute top-3 right-3 text-[#3B82F6]">
              <CheckCircle2 size={16} />
            </div>
          )}

          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center font-bold text-xs text-[#10B981]">
              $
            </div>
            <div>
              <div className="font-bold text-sm text-[#F0F4F8]">USD Coin</div>
              <div className="text-[10px] text-[#94A3B8] uppercase">ERC-20 • 6 Decimals</div>
            </div>
          </div>

          <div className="space-y-0.5 pt-1 border-t border-[#232B36]">
            <div className="text-lg font-bold text-[#F0F4F8]">
              {availableUsdc.toFixed(2)} <span className="text-xs text-[#10B981]">USDC</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#94A3B8]">
              <span>~${usdcUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD</span>
              <span className="text-[#10B981] text-[10px] font-semibold">Settled Proceeds</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
