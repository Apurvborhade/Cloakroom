"use client";

import React, { useState } from "react";
import { Copy, Check, ShieldCheck, Clock } from "lucide-react";
import { MixConfig } from "@/lib/mix/types";

interface MixReviewSummaryProps {
  config: MixConfig;
}

export function MixReviewSummary({ config }: MixReviewSummaryProps) {
  const [copiedSrc, setCopiedSrc] = useState(false);
  const [copiedDest, setCopiedDest] = useState(false);

  const handleCopy = (text: string, isSrc: boolean) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      if (isSrc) {
        setCopiedSrc(true);
        setTimeout(() => setCopiedSrc(false), 2000);
      } else {
        setCopiedDest(true);
        setTimeout(() => setCopiedDest(false), 2000);
      }
    }
  };

  return (
    <div className="w-full space-y-4 text-left">
      {/* Primary Summary Box */}
      <div className="p-5 sm:p-6 rounded-2xl bg-[#161B22] border border-[#232B36] space-y-4 font-mono text-xs shadow-lg">
        {/* Header Strip */}
        <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#3B82F6]" />
            <span className="font-bold text-[#F0F4F8] tracking-wider uppercase text-sm">
              MIX TRANSACTION REVIEW
            </span>
          </div>
          <span className="px-2.5 py-0.5 rounded-full bg-[#1C222B] border border-[#232B36] text-[10px] text-[#3B82F6] font-semibold uppercase">
            TEE Enclave Batch
          </span>
        </div>

        {/* Core Financial Terms */}
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-[#94A3B8]">Execution Mode:</span>
            <span className="text-[#F0F4F8] font-semibold">MIX (Private Pooling)</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#94A3B8]">Committed Asset:</span>
            <span className="text-[#3B82F6] font-bold text-base">
              {config.inputAmount} {config.inputAsset}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#94A3B8]">Estimated Output Allocation:</span>
            <span className="text-[#F0F4F8] font-semibold">
              {config.estimatedOutput} {config.inputAsset === "ETH" ? "USDC" : "ETH"}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#94A3B8]">Enclave Relaying Fee (0.10%):</span>
            <span className="text-[#94A3B8]">
              {config.feeAmount} {config.inputAsset}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[#94A3B8]">Network:</span>
            <span className="text-[#F0F4F8] flex items-center gap-1.5 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>{config.network}</span>
            </span>
          </div>
        </div>

        {/* Addresses Routing Box */}
        <div className="pt-3 border-t border-[#232B36] space-y-2.5">
          {/* Source Address */}
          <div className="flex items-center justify-between bg-[#1C222B] p-3 rounded-xl border border-[#232B36]">
            <div>
              <div className="text-[10px] text-[#505D6E] uppercase">Source / Custody:</div>
              <div className="text-xs text-[#F0F4F8] mt-0.5 font-medium">
                {config.sourceAddress.slice(0, 10)}...{config.sourceAddress.slice(-8)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(config.sourceAddress, true)}
              className="p-1.5 rounded-lg bg-[#0F1318] hover:bg-[#232B36] text-[#3B82F6] transition-colors"
              title="Copy source address"
            >
              {copiedSrc ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            </button>
          </div>

          {/* Destination Address */}
          <div className="flex items-center justify-between bg-[#1C222B] p-3 rounded-xl border border-[#232B36]">
            <div>
              <div className="text-[10px] text-[#505D6E] uppercase">Destination Recipient:</div>
              <div className="text-xs text-[#3B82F6] mt-0.5 font-bold">
                {config.destinationAddress.slice(0, 10)}...{config.destinationAddress.slice(-8)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleCopy(config.destinationAddress, false)}
              className="p-1.5 rounded-lg bg-[#0F1318] hover:bg-[#232B36] text-[#3B82F6] transition-colors"
              title="Copy destination address"
            >
              {copiedDest ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            </button>
          </div>
        </div>

        {/* Timestamp Notice */}
        <div className="pt-2 flex items-center justify-between text-[10px] text-[#505D6E] border-t border-[#232B36]">
          <span className="flex items-center gap-1">
            <Clock size={11} />
            <span>Config Timestamp: {new Date(config.quoteTimestamp).toLocaleTimeString()}</span>
          </span>
          <span className="text-[#94A3B8]">No on-chain broadcast until execution confirmation</span>
        </div>
      </div>

      {/* Security Disclaimer Note */}
      <div className="p-3.5 rounded-xl bg-[#0F1318] border border-[#232B36] text-xs text-[#94A3B8] leading-relaxed flex items-start gap-2.5 font-sans">
        <ShieldCheck size={16} className="text-[#3B82F6] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#F0F4F8]">Confidential Relaying Contract:</strong> Assets are committed to single-use enclave custody. Time-delayed randomized batching breaks transactional linkability before delivering shielded output.
        </div>
      </div>
    </div>
  );
}
