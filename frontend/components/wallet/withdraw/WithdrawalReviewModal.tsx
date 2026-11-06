"use client";

import React, { useState } from "react";
import { X, Lock, ShieldAlert, Check, Copy, AlertOctagon } from "lucide-react";
import { WithdrawalAsset } from "./WithdrawalBalanceOverview";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface WithdrawalReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: WithdrawalAsset;
  amount: string;
  account: string;
  networkName: string;
}

export function WithdrawalReviewModal({
  isOpen,
  onClose,
  asset,
  amount,
  account,
  networkName,
}: WithdrawalReviewModalProps) {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const isEth = asset === "ETH";
  const numericAmount = parseFloat(amount || "0");
  const estimatedUsd = isEth
    ? numericAmount * REFERENCE_ETH_PRICE
    : numericAmount * 1.0;

  const handleCopy = () => {
    if (!account) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm font-mono animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl bg-[#161B22] border border-[#232B36] shadow-2xl p-6 space-y-5 text-left text-[#F0F4F8]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#3B82F6]" />
            <span className="font-bold text-sm text-[#F0F4F8] tracking-wider uppercase">
              CONFIRM WITHDRAWAL REQUEST
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222B] transition-colors focus:outline-none"
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Withdrawal Details Card */}
        <div className="bg-[#1C222B] p-4 rounded-xl border border-[#232B36] space-y-3">
          <div className="text-center py-2 border-b border-[#232B36]">
            <div className="text-[11px] text-[#94A3B8] uppercase tracking-wider mb-1">
              Withdrawing
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-[#F0F4F8]">
              {amount} <span className="text-[#3B82F6]">{asset}</span>
            </div>
            <div className="text-xs text-[#94A3B8] mt-0.5">
              ~${estimatedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
            </div>
          </div>

          <div className="space-y-2 text-xs pt-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[#94A3B8] shrink-0">Destination:</span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[#F0F4F8] font-bold truncate font-mono text-[11px]">
                  {account}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="p-1 text-[#94A3B8] hover:text-[#F0F4F8] shrink-0"
                  title="Copy address"
                >
                  {copied ? (
                    <Check size={12} className="text-[#10B981]" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#94A3B8]">Network:</span>
              <span className="text-[#F0F4F8] font-semibold">{networkName || "Ethereum"}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#94A3B8]">Gateway Fee:</span>
              <span className="text-[#10B981] font-semibold">0.00% (Testnet Phase)</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[#94A3B8]">Network Gas Fee:</span>
              <span className="text-[#F59E0B] font-semibold">Not available (In Audit)</span>
            </div>
          </div>
        </div>

        {/* Security Notice */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-xs text-[#F59E0B] leading-relaxed">
          <ShieldAlert size={16} className="text-[#F59E0B] shrink-0 mt-0.5" />
          <div>
            Verify your destination address and network before proceeding. Blockchain transactions may be irreversible.
          </div>
        </div>

        {/* Critical Blockchain Boundary Callout */}
        <div className="p-4 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 space-y-2">
          <div className="flex items-center gap-2 text-[#F59E0B] text-xs font-bold tracking-wider uppercase">
            <AlertOctagon size={16} className="shrink-0" />
            <span>ON-CHAIN WITHDRAWAL GATEWAY IN AUDIT</span>
          </div>
          <p className="text-[11px] text-[#94A3B8] leading-relaxed">
            The Layer-1 Cash Out / Exit Gateway smart contract for NONY is currently undergoing formal security audit and Nitro Enclave attestation testing. On-chain transaction execution is disabled in this testnet milestone. No funds have been moved.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-2.5 pt-1">
          {/* Disabled Execution Action */}
          <button
            type="button"
            disabled
            className="w-full py-3.5 px-4 rounded-xl bg-[#1C222B] border border-[#232B36] text-[#64748B] font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-not-allowed"
          >
            <Lock size={14} />
            <span>EXECUTION CURRENTLY UNAVAILABLE</span>
          </button>

          {/* Dismiss / Return Button */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 px-4 rounded-xl bg-[#161B22] hover:bg-[#1C222B] border border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] font-semibold text-xs uppercase tracking-wider transition-colors"
          >
            Return to Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
