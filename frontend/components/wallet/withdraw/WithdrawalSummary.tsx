"use client";

import React from "react";
import { ArrowRight, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { WithdrawalAsset } from "./WithdrawalBalanceOverview";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface WithdrawalSummaryProps {
  asset: WithdrawalAsset;
  amount: string;
  availableBalance: number;
  account: string | null;
  networkName: string;
  isValid: boolean;
  onOpenReview: () => void;
  className?: string;
}

export function WithdrawalSummary({
  asset,
  amount,
  availableBalance,
  account,
  networkName,
  isValid,
  onOpenReview,
  className,
}: WithdrawalSummaryProps) {
  const isEth = asset === "ETH";
  const numericAmount = parseFloat(amount || "0");
  const estimatedUsd = isNaN(numericAmount)
    ? 0
    : isEth
    ? numericAmount * REFERENCE_ETH_PRICE
    : numericAmount * 1.0;

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
          WITHDRAWAL SUMMARY
        </span>
        <span className="text-[10px] text-[#64748B] uppercase">
          Dynamic Quote
        </span>
      </div>

      {/* Summary table */}
      <div className="space-y-2.5 text-xs bg-[#1C222B] p-4 rounded-xl border border-[#232B36]">
        {/* Asset */}
        <div className="flex items-center justify-between">
          <span className="text-[#94A3B8]">Asset</span>
          <span className="font-bold text-[#F0F4F8]">{asset}</span>
        </div>

        {/* Withdrawal amount */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Withdrawal Amount</span>
          <div className="text-right">
            <span className="font-bold text-[#F0F4F8]">
              {formattedAmount} {asset}
            </span>
            <span className="text-[10px] text-[#94A3B8] block">
              ~${estimatedUsd.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              USD
            </span>
          </div>
        </div>

        {/* Destination */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Destination</span>
          <span className="text-[#F0F4F8] font-semibold font-mono text-[11px]">
            {account
              ? `${account.slice(0, 6)}...${account.slice(-4)}`
              : "Not connected"}
          </span>
        </div>

        {/* Network */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Network</span>
          <span className="text-[#F0F4F8] font-semibold">{networkName || "Ethereum"}</span>
        </div>

        {/* Network fee */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Network Fee</span>
          <span className="text-[#F59E0B] font-semibold">Not available (In Audit)</span>
        </div>

        {/* Estimated received */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8] font-semibold">Estimated Received</span>
          <div className="text-right">
            <span className="text-[#10B981] font-bold text-sm">
              {formattedAmount} {asset}
            </span>
            <span className="text-[10px] text-[#64748B] block">
              Calculated when gas data is confirmed
            </span>
          </div>
        </div>
      </div>

      {/* Security Notice */}
      <div className="p-3.5 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-start gap-2.5 text-[11px] text-[#F59E0B] leading-relaxed">
        <ShieldAlert size={16} className="text-[#F59E0B] shrink-0 mt-0.5" />
        <div>
          <span className="text-[#F0F4F8] font-bold block mb-0.5">Security Notice</span>
          Verify your destination address and network before proceeding. Blockchain transactions may be irreversible.
        </div>
      </div>

      {/* Primary Action Button */}
      <button
        type="button"
        onClick={onOpenReview}
        disabled={!isValid}
        className={cn(
          "w-full py-3.5 px-4 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md focus:outline-none",
          isValid
            ? "bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] cursor-pointer"
            : "bg-[#1C222B] text-[#64748B] border border-[#232B36] cursor-not-allowed"
        )}
      >
        <span>Review Withdrawal</span>
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
