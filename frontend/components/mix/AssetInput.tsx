"use client";

import React from "react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { MixAssetSymbol } from "@/lib/mix/types";

interface AssetInputProps {
  asset: MixAssetSymbol;
  name: string;
  amount: string;
  onChangeAmount: (val: string) => void;
  availableBalance: string | null;
  onMaxClick?: () => void;
  error?: string | null;
  isReadOnly?: boolean;
  label?: string;
  sublabel?: string;
}

export function AssetInput({
  asset,
  name,
  amount,
  onChangeAmount,
  availableBalance,
  onMaxClick,
  error,
  isReadOnly = false,
  label = "Deposit Asset",
  sublabel,
}: AssetInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnly) return;
    const raw = e.target.value.replace(/,/g, ".");
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      const maxDecimals = asset === "ETH" ? 18 : 6;
      const parts = raw.split(".");
      if (parts[1] && parts[1].length > maxDecimals) return;
      onChangeAmount(raw);
    }
  };

  return (
    <div className="w-full p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] transition-colors text-left space-y-3 shadow-lg">
      {/* Top Header */}
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-[#94A3B8] uppercase tracking-wider text-[11px] font-semibold">
          {label}
        </span>

        <div className="flex items-center gap-1.5 text-[#94A3B8]">
          <Wallet size={12} className="text-[#505D6E]" />
          <span>
            {availableBalance !== null ? (
              <>
                <span className="text-[#505D6E]">Avail:</span>{" "}
                <span className="text-[#F0F4F8] font-semibold">
                  {availableBalance} {asset}
                </span>
              </>
            ) : (
              <span className="text-[#505D6E]">Wallet not connected</span>
            )}
          </span>
        </div>
      </div>

      {/* Input Row */}
      <div className="flex items-center justify-between gap-3">
        {/* Token Badge */}
        <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[#1C222B] border border-[#232B36] shrink-0">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs bg-[#0F1318] text-[#3B82F6] border border-[#232B36]">
            {asset === "ETH" ? "Ξ" : "$"}
          </div>
          <div className="text-left">
            <div className="font-bold text-xs text-[#F0F4F8] tracking-tight">
              {asset}
            </div>
            <div className="text-[10px] text-[#505D6E] leading-none">
              {name}
            </div>
          </div>
        </div>

        {/* Input & MAX */}
        <div className="flex-1 flex items-center justify-end gap-2">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.0"
            disabled={isReadOnly}
            value={amount}
            onChange={handleChange}
            className={cn(
              "w-full text-right text-xl sm:text-2xl font-mono font-semibold bg-transparent text-[#F0F4F8] placeholder-[#505D6E] focus:outline-none tracking-tight",
              isReadOnly && "opacity-80 cursor-default"
            )}
          />

          {!isReadOnly && onMaxClick && (
            <button
              type="button"
              onClick={onMaxClick}
              className="px-2.5 py-1 rounded bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] hover:border-[#3B82F6]/50 text-[10px] font-mono font-bold text-[#3B82F6] tracking-wider transition-colors shrink-0 cursor-pointer"
            >
              MAX
            </button>
          )}
        </div>
      </div>

      {sublabel && (
        <div className="text-[10px] font-mono text-[#94A3B8] leading-tight">
          {sublabel}
        </div>
      )}

      {error && (
        <div className="text-xs text-red-400 font-mono flex items-center gap-1.5">
          <span>•</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
