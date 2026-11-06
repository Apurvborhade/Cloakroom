"use client";

import React from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Shield,
  ArrowRight,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MixExecutionState, MixConfig } from "@/lib/mix/types";

interface MixExecutionStatusProps {
  status: MixExecutionState;
  config: MixConfig;
  batchId: string | null;
  txHash: string | null;
  errorMessage: string | null;
  isSimulation: boolean;
  onRetry: () => void;
  onProceedToSuccess: () => void;
  onCancel?: () => void;
}

export function MixExecutionStatus({
  status,
  config,
  batchId,
  txHash,
  errorMessage,
  isSimulation,
  onRetry,
  onProceedToSuccess,
  onCancel,
}: MixExecutionStatusProps) {
  const steps: { key: MixExecutionState; label: string }[] = [
    { key: "preparing", label: "Session Prepare" },
    { key: "awaiting_signature", label: "Wallet Authorization" },
    { key: "submitted", label: "Batch Submission" },
    { key: "processing", label: "Confidential Relaying" },
    { key: "completed", label: "Settlement Complete" },
  ];

  const getStepStatus = (stepKey: MixExecutionState) => {
    const order: MixExecutionState[] = [
      "preparing",
      "awaiting_signature",
      "submitted",
      "processing",
      "completed",
    ];
    const currentIndex = order.indexOf(status);
    const stepIndex = order.indexOf(stepKey);

    if (status === "failed" || status === "cancelled") {
      return "neutral";
    }
    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  return (
    <div className="w-full space-y-6 text-left">
      {/* Simulation / Environment Badge */}
      <div className="flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse" />
          <span className="text-[#94A3B8] uppercase tracking-wider text-[11px] font-semibold">
            EXECUTION PIPELINE
          </span>
        </div>
        <span
          className={cn(
            "px-2.5 py-0.5 rounded-full text-[10px] font-mono border uppercase tracking-wider font-semibold",
            isSimulation
              ? "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/30"
              : "bg-emerald-950/30 text-emerald-400 border-emerald-800/40"
          )}
        >
          {isSimulation ? "Sandbox Simulation" : "Verified Enclave"}
        </span>
      </div>

      {/* Main Status Hero Card */}
      <div className="p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-5 shadow-2xl">
        {/* Status Icon */}
        <div className="flex justify-center">
          {status === "preparing" && (
            <div className="w-16 h-16 rounded-2xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6]">
              <Loader2 size={32} className="animate-spin text-[#3B82F6]" />
            </div>
          )}

          {status === "awaiting_signature" && (
            <div className="w-16 h-16 rounded-2xl bg-[#1C222B] border border-[#3B82F6]/50 flex items-center justify-center text-[#3B82F6] shadow-[0_0_20px_rgba(59,130,246,0.2)]">
              <Shield size={32} className="animate-pulse text-[#3B82F6]" />
            </div>
          )}

          {status === "submitted" && (
            <div className="w-16 h-16 rounded-2xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6]">
              <Loader2 size={32} className="animate-spin text-[#3B82F6]" />
            </div>
          )}

          {status === "processing" && (
            <div className="w-16 h-16 rounded-2xl bg-[#1C222B] border border-[#3B82F6]/40 flex items-center justify-center text-[#3B82F6] shadow-[0_0_24px_rgba(59,130,246,0.15)]">
              <Loader2 size={32} className="animate-spin text-[#3B82F6]" />
            </div>
          )}

          {status === "completed" && (
            <div className="w-16 h-16 rounded-2xl bg-emerald-950/50 border border-emerald-500/50 flex items-center justify-center text-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.2)]">
              <CheckCircle2 size={34} />
            </div>
          )}

          {status === "failed" && (
            <div className="w-16 h-16 rounded-2xl bg-rose-950/50 border border-rose-500/50 flex items-center justify-center text-rose-400 shadow-[0_0_24px_rgba(244,63,94,0.2)]">
              <AlertTriangle size={34} />
            </div>
          )}

          {status === "cancelled" && (
            <div className="w-16 h-16 rounded-2xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#94A3B8]">
              <XCircle size={34} />
            </div>
          )}
        </div>

        {/* State Titles & Descriptions */}
        <div className="space-y-1.5 max-w-md mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#F0F4F8]">
            {status === "preparing" && "Preparing Mix Session..."}
            {status === "awaiting_signature" && "Awaiting Wallet Signature"}
            {status === "submitted" && "Batch Submitted to Enclave"}
            {status === "processing" && "Executing Confidential Mix..."}
            {status === "completed" && "Execution Verified & Completed"}
            {status === "failed" && "Execution Failed"}
            {status === "cancelled" && "Execution Cancelled"}
          </h2>

          <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
            {status === "preparing" &&
              "Configuring ephemeral custody bounds and allocating mixing batch pool."}
            {status === "awaiting_signature" &&
              "Please review and authorize the intent envelope in your browser wallet."}
            {status === "submitted" &&
              "Intent received by enclave gateway. Enqueueing into next randomized batch."}
            {status === "processing" &&
              "Randomizing internal custody hops inside AWS Nitro TEE to sever transaction graph linkage."}
            {status === "completed" &&
              "Assets have been successfully shielded and settled to your destination address."}
            {status === "failed" &&
              (errorMessage || "The enclave execution encountered an unexpected relay error.")}
            {status === "cancelled" &&
              "The operation was cancelled by the user. No funds were committed or deducted."}
          </p>
        </div>

        {/* Linear Stepper */}
        <div className="pt-4 border-t border-[#232B36] max-w-lg mx-auto">
          <div className="flex items-center justify-between text-[11px] font-mono">
            {steps.map((st, i) => {
              const state = getStepStatus(st.key);
              return (
                <div key={st.key} className="flex flex-col items-center gap-1.5">
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-[10px] border transition-colors",
                      state === "done" &&
                        "bg-emerald-950/60 border-emerald-700 text-emerald-400 font-bold",
                      state === "active" &&
                        "bg-[#1C222B] border-[#3B82F6] text-[#3B82F6] font-bold shadow-[0_0_8px_rgba(59,130,246,0.4)]",
                      state === "pending" && "bg-[#1C222B] border-[#232B36] text-[#505D6E]",
                      state === "neutral" && "bg-[#1C222B] border-[#232B36] text-[#505D6E]"
                    )}
                  >
                    {state === "done" ? "✓" : i + 1}
                  </div>
                  <span
                    className={cn(
                      "hidden sm:inline text-[9px] uppercase tracking-wider",
                      state === "active" ? "text-[#3B82F6] font-bold" : "text-[#505D6E]"
                    )}
                  >
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Metadata Strip */}
        <div className="p-3 rounded-xl bg-[#0F1318] border border-[#232B36] text-xs font-mono text-[#94A3B8] flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            <span className="text-[#505D6E]">Batch ID:</span>{" "}
            <span className="text-[#F0F4F8] font-medium">{batchId || "Allocating..."}</span>
          </div>
          <div>
            <span className="text-[#505D6E]">Committed:</span>{" "}
            <span className="text-[#3B82F6] font-bold">
              {config.inputAmount} {config.inputAsset}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          {status === "completed" && (
            <button
              type="button"
              onClick={onProceedToSuccess}
              className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#3B82F6] text-white hover:bg-[#2563EB] font-mono font-bold text-xs transition-all shadow-[0_0_16px_rgba(59,130,246,0.3)] flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>VIEW COMPLETION SUMMARY</span>
              <ArrowRight size={14} />
            </button>
          )}

          {(status === "failed" || status === "cancelled") && (
            <>
              <button
                type="button"
                onClick={onRetry}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#3B82F6] text-white hover:bg-[#2563EB] font-mono font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <RotateCcw size={13} />
                <span>RETRY EXECUTION</span>
              </button>

              <Link
                href="/mix/review"
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-[#1C222B] border border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] font-mono text-xs transition-colors text-center"
              >
                BACK TO REVIEW
              </Link>
            </>
          )}

          {(status === "preparing" || status === "awaiting_signature") && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs font-mono text-[#505D6E] hover:text-[#94A3B8] transition-colors cursor-pointer"
            >
              Cancel Operation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
