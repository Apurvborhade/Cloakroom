"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ArrowRight,
  Wallet,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { MixHeader } from "@/components/mix/MixHeader";
import { MixProgress } from "@/components/mix/MixProgress";
import { MixEmptyState } from "@/components/mix/MixEmptyState";
import { MixExecutionRecord } from "@/lib/mix/types";
import { loadMixExecution } from "@/lib/mix/state";

export default function MixSuccessPage() {
  const [record, setRecord] = useState<MixExecutionRecord | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [copiedBatch, setCopiedBatch] = useState(false);

  useEffect(() => {
    const saved = loadMixExecution();
    if (saved && saved.status === "completed") {
      setRecord(saved);
    }
    setIsReady(true);
  }, []);

  const handleCopyBatch = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedBatch(true);
      setTimeout(() => setCopiedBatch(false), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <MixHeader backHref="/wallet" backLabel="WALLET" />
      <MixProgress currentStep={4} />

      <main className="flex-1 max-w-xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 animate-fade-in flex flex-col items-center">
        {isReady && !record ? (
          <MixEmptyState
            title="No Verified Completion Found"
            description="You do not have a recently completed MIX operation in this session."
            primaryHref="/mix"
            primaryLabel="START MIX SETUP"
          />
        ) : record ? (
          <div className="w-full space-y-6 text-left">
            {/* Success Hero Badge */}
            <div className="p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-emerald-500/40 text-center space-y-4 shadow-2xl">
              <div className="w-16 h-16 rounded-full bg-emerald-950/60 border border-emerald-500/50 flex items-center justify-center text-emerald-400 mx-auto shadow-[0_0_24px_rgba(16,185,129,0.2)]">
                <CheckCircle2 size={36} strokeWidth={2.5} />
              </div>

              <div className="space-y-1.5 max-w-md mx-auto">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8]">
                  MIX Completed
                </h1>
                <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
                  Your confidential mix batch has been processed by the enclave and
                  settled to the designated destination address.
                </p>
              </div>

              {/* Settlement Summary Pill */}
              <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] text-xs font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#94A3B8]">Executed Amount:</span>
                  <span className="text-[#3B82F6] font-bold text-sm">
                    {record.config.inputAmount} {record.config.inputAsset}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#94A3B8]">Estimated Shielded Output:</span>
                  <span className="text-[#F0F4F8] font-semibold">
                    {record.config.estimatedOutput}{" "}
                    {record.config.inputAsset === "ETH" ? "USDC" : "ETH"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#94A3B8]">Protocol Fee (0.10%):</span>
                  <span className="text-[#505D6E]">
                    {record.config.feeAmount} {record.config.inputAsset}
                  </span>
                </div>
              </div>
            </div>

            {/* Cryptographic Execution Metadata */}
            <div className="p-5 rounded-2xl bg-[#161B22] border border-[#232B36] shadow-lg text-xs font-mono space-y-3">
              <div className="text-[11px] font-semibold text-[#3B82F6] uppercase tracking-wider flex items-center justify-between pb-2 border-b border-[#232B36]">
                <span>Execution Verification</span>
                <span className="text-[10px] text-[#505D6E] font-medium">
                  {record.isSimulation ? "Sandbox Environment" : "TEE Verified"}
                </span>
              </div>

              {/* Batch ID */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#94A3B8]">Enclave Batch ID:</span>
                <div className="flex items-center gap-2">
                  <span className="text-[#F0F4F8] font-semibold">
                    {record.batchId}
                  </span>
                  {record.batchId && (
                    <button
                      type="button"
                      onClick={() => handleCopyBatch(record.batchId!)}
                      className="text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
                      title="Copy Batch ID"
                    >
                      {copiedBatch ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Destination */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#94A3B8]">Destination:</span>
                <span className="text-[#3B82F6] font-medium">
                  {record.config.destinationAddress.slice(0, 10)}...
                  {record.config.destinationAddress.slice(-8)}
                </span>
              </div>

              {/* Network */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#94A3B8]">Network:</span>
                <span className="text-[#F0F4F8]">{record.config.network}</span>
              </div>

              {/* Timestamp */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#94A3B8]">Timestamp:</span>
                <span className="text-[#505D6E]">
                  {new Date(record.completedAt || Date.now()).toLocaleString()}
                </span>
              </div>

              {/* Honest Transaction Hash Notice */}
              <div className="pt-2 border-t border-[#232B36] text-[11px] text-[#94A3B8] leading-relaxed font-sans">
                {record.txHash ? (
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <ExternalLink size={12} />
                    <span>Public L1 Hash: {record.txHash}</span>
                  </div>
                ) : (
                  <div>
                    <strong className="text-[#F0F4F8]">Zero Public Footprint:</strong> Transaction was batch-relayed off-chain inside the confidential AWS Nitro Enclave to preserve transaction anonymity.
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Link
                href="/wallet"
                className="w-full sm:w-auto flex-[2] py-3.5 px-6 rounded-xl bg-[#3B82F6] text-white hover:bg-[#2563EB] font-mono text-xs font-bold tracking-wider uppercase transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Wallet size={14} />
                <span>VIEW IN WALLET</span>
                <ArrowRight size={14} />
              </Link>

              <Link
                href="/mix"
                className="w-full sm:w-auto flex-1 py-3 px-5 rounded-xl border border-[#232B36] bg-[#161B22] hover:bg-[#1C222B] text-xs font-mono font-medium text-[#94A3B8] hover:text-[#F0F4F8] transition-colors flex items-center justify-center gap-2"
              >
                <span>NEW MIX</span>
              </Link>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
