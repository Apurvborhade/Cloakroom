"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
    <div className="min-h-screen bg-[#F7F8FA] text-[#17191D] flex flex-col selection:bg-[#377FA5]/15 selection:text-[#17191D]">
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
            <div className="p-6 sm:p-8 rounded-2xl bg-white border border-emerald-200 text-center space-y-4 shadow-sm">
              <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-300 flex items-center justify-center text-[#21865B] mx-auto shadow-sm">
                <CheckCircle2 size={36} strokeWidth={2.5} />
              </div>

              <div className="space-y-1.5 max-w-md mx-auto">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17191D]">
                  MIX Completed
                </h1>
                <p className="text-xs sm:text-sm text-[#626A75] leading-relaxed">
                  Your confidential mix batch has been processed by the enclave and
                  settled to the designated destination address.
                </p>
              </div>

              {/* Settlement Summary Pill */}
              <div className="p-4 rounded-xl bg-[#F7F8FA] border border-[#E3E6EB] text-xs font-mono space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#626A75]">Executed Amount:</span>
                  <span className="text-[#377FA5] font-bold text-sm">
                    {record.config.inputAmount} {record.config.inputAsset}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#626A75]">Estimated Shielded Output:</span>
                  <span className="text-[#17191D] font-semibold">
                    {record.config.estimatedOutput}{" "}
                    {record.config.inputAsset === "ETH" ? "USDC" : "ETH"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#626A75]">Protocol Fee (0.10%):</span>
                  <span className="text-[#9299A3]">
                    {record.config.feeAmount} {record.config.inputAsset}
                  </span>
                </div>
              </div>
            </div>

            {/* Cryptographic Execution Metadata */}
            <div className="p-5 rounded-2xl bg-white border border-[#E3E6EB] shadow-sm text-xs font-mono space-y-3">
              <div className="text-[11px] font-semibold text-[#377FA5] uppercase tracking-wider flex items-center justify-between pb-2 border-b border-[#E3E6EB]">
                <span>Execution Verification</span>
                <span className="text-[10px] text-[#9299A3]">
                  {record.isSimulation ? "Sandbox Environment" : "TEE Verified"}
                </span>
              </div>

              {/* Batch ID */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#626A75]">Enclave Batch ID:</span>
                <div className="flex items-center gap-2">
                  <span className="text-[#17191D] font-semibold">
                    {record.batchId}
                  </span>
                  {record.batchId && (
                    <button
                      type="button"
                      onClick={() => handleCopyBatch(record.batchId!)}
                      className="text-[#377FA5] hover:text-[#28607E] transition-colors"
                      title="Copy Batch ID"
                    >
                      {copiedBatch ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  )}
                </div>
              </div>

              {/* Destination */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#626A75]">Destination:</span>
                <span className="text-[#377FA5] font-medium">
                  {record.config.destinationAddress.slice(0, 10)}...
                  {record.config.destinationAddress.slice(-8)}
                </span>
              </div>

              {/* Network */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#626A75]">Network:</span>
                <span className="text-[#17191D]">{record.config.network}</span>
              </div>

              {/* Timestamp */}
              <div className="flex items-center justify-between py-1">
                <span className="text-[#626A75]">Timestamp:</span>
                <span className="text-[#9299A3]">
                  {new Date(record.completedAt || Date.now()).toLocaleString()}
                </span>
              </div>

              {/* Honest Transaction Hash Notice */}
              <div className="pt-2 border-t border-[#E3E6EB] text-[11px] text-[#626A75] leading-relaxed font-sans">
                {record.txHash ? (
                  <div className="flex items-center gap-1.5 text-[#21865B]">
                    <ExternalLink size={12} />
                    <span>Public L1 Hash: {record.txHash}</span>
                  </div>
                ) : (
                  <div>
                    <strong className="text-[#17191D]">Zero Public Footprint:</strong> Transaction was batch-relayed off-chain inside the confidential AWS Nitro Enclave to preserve transaction anonymity.
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Link
                href="/wallet"
                className="w-full sm:w-auto flex-[2] py-3.5 px-6 rounded-xl bg-[#17191D] text-white hover:bg-[#2B303B] font-mono text-xs font-semibold tracking-wider uppercase transition-all shadow-sm active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Wallet size={14} />
                <span>VIEW IN WALLET</span>
                <ArrowRight size={14} />
              </Link>

              <Link
                href="/mix"
                className="w-full sm:w-auto flex-1 py-3 px-5 rounded-xl border border-[#E3E6EB] bg-white hover:bg-[#F0F2F5] text-xs font-mono font-medium text-[#626A75] hover:text-[#17191D] transition-colors flex items-center justify-center gap-2 shadow-sm"
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
