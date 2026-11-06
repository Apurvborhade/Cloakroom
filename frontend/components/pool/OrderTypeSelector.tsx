"use client";

import React from "react";
import { Zap, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderType } from "@/lib/pool/types";

interface OrderTypeSelectorProps {
  orderType: PoolOrderType;
  onChange: (type: PoolOrderType) => void;
}

export function OrderTypeSelector({ orderType, onChange }: OrderTypeSelectorProps) {
  return (
    <div className="w-full space-y-2 text-left">
      <div className="grid grid-cols-2 p-1 rounded-xl bg-[#1C222B] border border-[#232B36] gap-1">
        {/* Market Tab */}
        <button
          type="button"
          onClick={() => onChange("MARKET")}
          className={cn(
            "py-2 px-3 rounded-lg text-xs font-mono font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
            orderType === "MARKET"
              ? "bg-[#161B22] text-[#F0F4F8] border border-[#232B36] shadow-sm font-bold text-[#3B82F6]"
              : "text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#161B22]/60"
          )}
        >
          <Zap size={13} className={orderType === "MARKET" ? "text-[#3B82F6]" : "text-[#505D6E]"} />
          <span>MARKET ORDER</span>
        </button>

        {/* Limit Tab */}
        <button
          type="button"
          onClick={() => onChange("LIMIT")}
          className={cn(
            "py-2 px-3 rounded-lg text-xs font-mono font-medium transition-all flex items-center justify-center gap-2 cursor-pointer",
            orderType === "LIMIT"
              ? "bg-[#161B22] text-[#F0F4F8] border border-[#232B36] shadow-sm font-bold text-[#3B82F6]"
              : "text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#161B22]/60"
          )}
        >
          <Target size={13} className={orderType === "LIMIT" ? "text-[#3B82F6]" : "text-[#505D6E]"} />
          <span>LIMIT ORDER</span>
        </button>
      </div>

      <div className="text-[11px] font-mono text-[#94A3B8] px-1">
        {orderType === "MARKET" ? (
          <span>Executes immediately against dark enclave inventory at current reference price.</span>
        ) : (
          <span>Executes automatically only when ETH price satisfies your target condition.</span>
        )}
      </div>
    </div>
  );
}
