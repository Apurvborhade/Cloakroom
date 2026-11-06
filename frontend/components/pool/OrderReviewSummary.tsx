"use client";

import React, { useState } from "react";
import {
  ArrowDown,
  ShieldCheck,
  Clock,
  Copy,
  Check,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderConfig } from "@/lib/pool/types";

interface OrderReviewSummaryProps {
  config: PoolOrderConfig;
  className?: string;
}

export function OrderReviewSummary({ config, className }: OrderReviewSummaryProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (key: string, text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const isLimit = config.orderType === "LIMIT";

  return (
    <div className={cn("space-y-4 font-mono text-left", className)}>
      {/* Order Type Banner */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-[#161B22] border border-[#232B36] shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] animate-pulse" />
          <span className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
            EXECUTION STRATEGY
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider border",
              isLimit
                ? "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/40"
                : "bg-emerald-950/40 text-emerald-400 border-emerald-800/40"
            )}
          >
            {isLimit ? "LIMIT CONDITIONAL ORDER" : "INSTANT MARKET SWAP"}
          </span>
        </div>
      </div>

      {/* Trade Flow (Sell ETH -> Buy USDC) */}
      <div className="rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 shadow-lg">
        {/* Sell Section */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
              YOU ALLOCATE / SELL
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#F0F4F8] tracking-tight">
                {config.sellAmount}
              </span>
              <span className="text-sm font-semibold text-[#3B82F6]">ETH</span>
            </div>
          </div>
          <div className="text-right space-y-1">
            <span className="text-[10px] text-[#505D6E] block">ORACLE VALUATION</span>
            <span className="text-xs text-[#94A3B8]">
              ~${(parseFloat(config.sellAmount || "0") * config.currentPrice).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{" "}
              USD
            </span>
          </div>
        </div>

        {/* Direction Indicator */}
        <div className="flex items-center justify-center -my-2 relative z-10">
          <div className="w-8 h-8 rounded-full bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] shadow-md">
            <ArrowDown size={14} />
          </div>
        </div>

        {/* Buy Section */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
              {isLimit ? "EXPECTED OUTPUT UPON TRIGGER" : "ESTIMATED PROCEEDS"}
            </span>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-400 tracking-tight">
                {config.estimatedOutput}
              </span>
              <span className="text-sm font-semibold text-emerald-400">USDC</span>
            </div>
          </div>
          <div className="text-right space-y-1">
            <span className="text-[10px] text-[#505D6E] block">
              {isLimit ? "TARGET PRICE" : "REF PRICE"}
            </span>
            <span className="text-xs text-[#3B82F6] font-bold">
              {isLimit
                ? `$${parseFloat(config.targetPrice || "0").toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  })}`
                : `$${config.currentPrice.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  })}`}
            </span>
          </div>
        </div>

        {/* Execution Condition Notice for Limit */}
        {isLimit && (
          <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-start gap-3">
            <Clock size={16} className="text-[#3B82F6] shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <span className="text-[#F0F4F8] font-semibold block">
                Conditional Activation Trigger
              </span>
              <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                This order will sit securely in the confidential enclave book until 1 ETH reaches or
                exceeds{" "}
                <span className="text-[#3B82F6] font-semibold">
                  ${parseFloat(config.targetPrice || "0").toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  USDC
                </span>
                . If the condition is not met within{" "}
                <span className="text-[#F0F4F8] font-semibold">
                  {config.expiryDuration || "7 Days"}
                </span>
                , you can cancel at any time with 0 penalty.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Routing & Addresses Details */}
      <div className="rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-3.5 text-xs shadow-lg">
        <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
          <span className="text-[#94A3B8] text-[11px] uppercase tracking-wider font-semibold">
            TRANSACTION ROUTING
          </span>
          <span className="text-[#3B82F6] text-[11px] font-medium">{config.network}</span>
        </div>

        {/* Source */}
        <div className="flex items-center justify-between py-1">
          <span className="text-[#94A3B8]">Source Address</span>
          <div className="flex items-center gap-2">
            <span className="text-[#F0F4F8] font-mono text-[11px]">
              {config.sourceAddress.slice(0, 8)}...{config.sourceAddress.slice(-6)}
            </span>
            <button
              type="button"
              onClick={() => handleCopy("source", config.sourceAddress)}
              className="text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
              title="Copy source address"
            >
              {copiedKey === "source" ? (
                <Check size={12} className="text-emerald-400" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </div>
        </div>

        {/* Relayer / Matchmaker */}
        <div className="flex items-center justify-between py-1">
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <Lock size={12} className="text-[#3B82F6]" />
            <span>Execution Venue</span>
          </div>
          <span className="text-emerald-400 font-semibold text-[11px]">NONY TEE Dark Pool</span>
        </div>

        {/* Destination */}
        <div className="flex items-center justify-between py-1">
          <span className="text-[#94A3B8]">Destination Address</span>
          <div className="flex items-center gap-2">
            <span className="text-[#F0F4F8] font-mono text-[11px]">
              {config.destinationAddress.slice(0, 8)}...{config.destinationAddress.slice(-6)}
            </span>
            <button
              type="button"
              onClick={() => handleCopy("destination", config.destinationAddress)}
              className="text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
              title="Copy destination address"
            >
              {copiedKey === "destination" ? (
                <Check size={12} className="text-emerald-400" />
              ) : (
                <Copy size={12} />
              )}
            </button>
          </div>
        </div>

        {/* Fees & Parameters */}
        <div className="pt-2 border-t border-[#232B36] space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Relayer Fee (0.10%)</span>
            <span className="text-[#F0F4F8] font-medium">{config.feeAmount} ETH</span>
          </div>

          {!isLimit && config.minimumReceived && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#94A3B8]">Minimum Received (0.5% Slippage)</span>
              <span className="text-[#F0F4F8] font-medium">{config.minimumReceived} USDC</span>
            </div>
          )}

          {isLimit && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#94A3B8]">Order Expiry</span>
              <span className="text-[#3B82F6] font-bold">
                {config.expiryDuration || "7 Days"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Security & Confidentiality Safeguards */}
      <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36] space-y-2 text-xs">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold text-[11px] uppercase tracking-wider">
          <ShieldCheck size={14} />
          <span>CONFIDENTIAL ENCLAVE GUARANTEES</span>
        </div>
        <p className="text-[11px] text-[#94A3B8] leading-relaxed">
          Order terms and user intents remain encrypted within our hardware-isolated Secure Enclave.
          Zero public mempool leakage prevents front-running, sandwiching, or toxic flow manipulation.
          {isLimit && " You retain complete cryptographic authority to cancel this order anytime prior to execution."}
        </p>
      </div>
    </div>
  );
}
