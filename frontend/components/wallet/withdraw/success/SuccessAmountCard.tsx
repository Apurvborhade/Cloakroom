"use client";

import React from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface SuccessAmountCardProps {
  asset: "ETH" | "USDC";
  amount: string;
  usdEquivalent?: string;
  isDevPreview?: boolean;
  className?: string;
}

export function SuccessAmountCard({
  asset,
  amount,
  usdEquivalent,
  isDevPreview,
  className,
}: SuccessAmountCardProps) {
  const numericAmount = parseFloat(amount || "0");
  const computedUsd = usdEquivalent
    ? usdEquivalent
    : !isNaN(numericAmount) && numericAmount > 0
    ? asset === "ETH"
      ? (numericAmount * REFERENCE_ETH_PRICE).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : (numericAmount * 1.0).toFixed(2)
    : null;

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 sm:p-8 text-center space-y-5 font-mono shadow-xl relative overflow-hidden",
        className
      )}
    >
      {/* Dev Preview Warning Watermark if applicable */}
      {isDevPreview && (
        <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-2.5 text-xs text-[#F59E0B] font-bold uppercase tracking-wider text-center">
          ⚠ ISOLATED DEV PREVIEW FIXTURE — L1 GATEWAY IN SECURITY AUDIT — NOT A REAL ON-CHAIN WITHDRAWAL
        </div>
      )}

      {/* Success Icon */}
      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 flex items-center justify-center text-[#10B981] mx-auto shadow-md transition-transform animate-in zoom-in-90 duration-300">
        <CheckCircle2 size={40} strokeWidth={2.2} />
      </div>

      {/* Main Heading & Subtitle */}
      <div className="space-y-1.5 max-w-md mx-auto">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] text-[11px] font-bold uppercase tracking-wider mb-1">
          <ShieldCheck size={12} />
          <span>Confirmed on-chain</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8] font-sans">
          Payment Successful
        </h1>

        <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
          Your withdrawal has been confirmed on the blockchain.
        </p>
      </div>

      {/* Withdrawal Amount Display */}
      <div className="p-4 sm:p-5 rounded-xl bg-[#1C222B] border border-[#232B36] max-w-sm mx-auto space-y-1">
        <div className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-medium">
          Transferred Amount
        </div>
        <div className="text-2xl sm:text-3xl font-bold text-[#F0F4F8] tracking-tight">
          {amount} <span className="text-[#3B82F6]">{asset}</span>
        </div>
        {computedUsd && (
          <div className="text-xs text-[#94A3B8] font-medium">
            ≈ ${computedUsd} USD
          </div>
        )}
      </div>
    </div>
  );
}
