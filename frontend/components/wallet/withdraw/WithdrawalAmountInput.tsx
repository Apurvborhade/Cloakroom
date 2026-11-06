"use client";

import React from "react";
import { AlertCircle, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { WithdrawalAsset } from "./WithdrawalBalanceOverview";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface WithdrawalAmountInputProps {
  asset: WithdrawalAsset;
  amount: string;
  onChange: (val: string) => void;
  onMaxClick: () => void;
  availableBalance: number;
  error: string | null;
  className?: string;
}

export function WithdrawalAmountInput({
  asset,
  amount,
  onChange,
  onMaxClick,
  availableBalance,
  error,
  className,
}: WithdrawalAmountInputProps) {
  const maxDecimals = asset === "ETH" ? 18 : 6;
  const isEth = asset === "ETH";

  // Real-time USD conversion
  const numericAmount = parseFloat(amount || "0");
  const estimatedUsd = isNaN(numericAmount)
    ? 0
    : isEth
    ? numericAmount * REFERENCE_ETH_PRICE
    : numericAmount * 1.0;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/[^0-9.]/g, "");

    // Prevent multiple decimal points
    const parts = val.split(".");
    if (parts.length > 2) {
      val = `${parts[0]}.${parts.slice(1).join("")}`;
    }

    // Limit decimal precision
    if (parts.length === 2 && parts[1].length > maxDecimals) {
      val = `${parts[0]}.${parts[1].slice(0, maxDecimals)}`;
    }

    onChange(val);
  };

  const handlePercentageClick = (percentage: number) => {
    if (availableBalance <= 0) return;
    const maxPrecision = maxDecimals === 18 ? 6 : 2;
    const calcVal = (availableBalance * percentage).toFixed(maxPrecision);
    // Remove trailing zeros after decimal if any
    const cleanVal = calcVal.replace(/\.?0+$/, "");
    onChange(cleanVal);
  };

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all shadow-lg",
        error ? "border-red-500/50" : "hover:border-[#3B82F6]/40",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="withdrawal-amount"
          className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold"
        >
          ENTER WITHDRAWAL AMOUNT
        </label>
        <span className="text-[10px] text-[#64748B]">
          Precision: {maxDecimals} decimals max
        </span>
      </div>

      {/* Input Box */}
      <div className="space-y-2">
        <div className="flex items-center bg-[#1C222B] border border-[#232B36] focus-within:border-[#3B82F6] rounded-xl px-4 py-3 transition-colors">
          <input
            id="withdrawal-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={handleInputChange}
            className="w-full bg-transparent text-xl sm:text-2xl font-bold text-[#F0F4F8] placeholder-[#64748B] focus:outline-none tracking-tight font-mono"
            autoComplete="off"
            spellCheck="false"
          />

          <div className="flex items-center gap-2 pl-3 shrink-0">
            <button
              type="button"
              onClick={onMaxClick}
              className="px-2.5 py-1 rounded bg-[#3B82F6]/10 hover:bg-[#3B82F6]/20 text-[#3B82F6] text-[11px] font-bold tracking-wider uppercase transition-colors border border-[#3B82F6]/30"
            >
              MAX
            </button>

            <div className="flex items-center gap-1.5 pl-2 border-l border-[#232B36] text-sm font-bold text-[#F0F4F8]">
              <span
                className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold",
                  isEth
                    ? "bg-[#3B82F6]/10 text-[#3B82F6]"
                    : "bg-[#10B981]/10 text-[#10B981]"
                )}
              >
                {isEth ? "Ξ" : "$"}
              </span>
              <span>{asset}</span>
            </div>
          </div>
        </div>

        {/* Available Balance Displayed Directly Below Input */}
        <div className="flex items-center justify-between px-1 text-xs text-[#94A3B8]">
          <div className="flex items-center gap-1.5">
            <Wallet size={12} className="text-[#64748B]" />
            <span>Available Balance:</span>
            <span className="font-bold text-[#F0F4F8]">
              {isEth
                ? availableBalance.toFixed(4)
                : availableBalance.toFixed(2)}{" "}
              {asset}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <span>Est. USD:</span>
            <span className="text-[#F0F4F8] font-semibold">
              ~${estimatedUsd.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Select Percentages */}
      <div className="grid grid-cols-4 gap-2 pt-1">
        {[
          { label: "25%", value: 0.25 },
          { label: "50%", value: 0.5 },
          { label: "75%", value: 0.75 },
          { label: "100%", value: 1.0 },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handlePercentageClick(item.value)}
            disabled={availableBalance <= 0}
            className="py-1.5 px-2 rounded-lg bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-xs font-semibold text-[#94A3B8] hover:text-[#F0F4F8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Real-time Validation Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-red-950/30 border border-red-800/40 text-xs text-red-400">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-red-400" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
