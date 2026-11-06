"use client";

import React from "react";
import { Coins, CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MixAssetSymbol } from "@/lib/mix/types";

interface BalanceBreakdownProps {
  inputAsset: MixAssetSymbol;
  committedAmount: string;
  ethBalance: string | null;
  usdcBalance: string | null;
  remainingBalance: string;
  isInsufficient: boolean;
}

export function BalanceBreakdown({
  inputAsset,
  committedAmount,
  ethBalance,
  usdcBalance,
  remainingBalance,
  isInsufficient,
}: BalanceBreakdownProps) {
  return (
    <div className="w-full p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] text-left text-xs font-mono space-y-3 shadow-lg">
      <div className="flex items-center justify-between text-[#94A3B8] border-b border-[#232B36] pb-2.5">
        <span className="uppercase tracking-wider text-[11px] font-semibold text-[#F0F4F8] flex items-center gap-1.5">
          <Coins size={13} className="text-[#3B82F6]" />
          <span>Balance Impact</span>
        </span>
        <span className="text-[10px] text-[#505D6E]">Live Account State</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center sm:text-left">
        {/* ETH Available */}
        <div className="p-2.5 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <div className="text-[10px] text-[#505D6E] uppercase">ETH Available</div>
          <div className="text-[#F0F4F8] font-semibold text-xs mt-0.5 truncate">
            {ethBalance !== null ? `${ethBalance} ETH` : "—"}
          </div>
        </div>

        {/* USDC Available */}
        <div className="p-2.5 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <div className="text-[10px] text-[#505D6E] uppercase">USDC Available</div>
          <div className="text-[#F0F4F8] font-semibold text-xs mt-0.5 truncate">
            {usdcBalance !== null ? `${usdcBalance} USDC` : "0.00 USDC"}
          </div>
        </div>

        {/* Amount Committed */}
        <div className="p-2.5 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <div className="text-[10px] text-[#505D6E] uppercase">Committed</div>
          <div className="text-[#3B82F6] font-bold text-xs mt-0.5 truncate">
            {committedAmount && parseFloat(committedAmount) > 0
              ? `${committedAmount} ${inputAsset}`
              : "0.00"}
          </div>
        </div>

        {/* Remaining */}
        <div
          className={cn(
            "p-2.5 rounded-xl border transition-colors",
            isInsufficient
              ? "bg-red-950/20 border-red-500/40 text-red-300"
              : "bg-[#1C222B] border-[#232B36] text-[#F0F4F8]"
          )}
        >
          <div className="text-[10px] text-[#505D6E] uppercase">Est. Remaining</div>
          <div className="font-semibold text-xs mt-0.5 truncate">
            {remainingBalance} {inputAsset}
          </div>
        </div>
      </div>

      {/* Insufficient Warning or Status */}
      {isInsufficient ? (
        <div className="p-2.5 rounded-lg bg-red-950/20 border border-red-800/40 text-red-300 flex items-center gap-2 text-[11px]">
          <AlertTriangle size={14} className="shrink-0 text-red-400" />
          <span>Committed amount exceeds your available balance in this session.</span>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[11px] text-[#94A3B8] pt-1">
          <div className="flex items-center gap-1.5 text-emerald-400">
            <CheckCircle2 size={13} />
            <span>Balance sufficient for enclave reservation</span>
          </div>
          <span className="text-[#505D6E]">Non-custodial batch</span>
        </div>
      )}
    </div>
  );
}
