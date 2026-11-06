"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, X, AlertCircle } from "lucide-react";

interface CashOutModalProps {
  isOpen: boolean;
  availableEth: number;
  usdcBalance: number;
  onClose: () => void;
}

export function CashOutModal({
  isOpen,
  availableEth,
  usdcBalance,
  onClose,
}: CashOutModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 text-left shadow-2xl relative font-mono text-[#F0F4F8]">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-[#94A3B8] hover:text-[#F0F4F8] transition-colors p-1"
        >
          <X size={18} />
        </button>

        {/* Title & Stage Notice */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3B82F6]/10 border border-[#3B82F6]/30 flex items-center justify-center text-[#3B82F6] shrink-0">
            <ArrowUpRight size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#F0F4F8] uppercase tracking-wider">
              CASH OUT / EXIT GATEWAY
            </h3>
            <p className="text-[11px] text-[#94A3B8]">
              Route: /wallet/withdraw
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="p-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center gap-2.5 text-xs text-[#F59E0B]">
          <AlertCircle size={15} className="text-[#F59E0B] shrink-0" />
          <span>Exit Gateway is active in Testnet Security Review.</span>
        </div>

        {/* Asset Balances Eligible for Cash Out */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-2.5 text-xs">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block pb-1 border-b border-[#232B36] font-medium">
            ELIGIBLE WITHDRAWAL ASSETS
          </span>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Available ETH (EOA):</span>
            <span className="text-[#F0F4F8] font-bold">{availableEth.toFixed(4)} ETH</span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Settled USDC Proceeds:</span>
            <span className="text-[#10B981] font-bold">{usdcBalance.toFixed(2)} USDC</span>
          </div>
        </div>

        {/* Truthful Communication */}
        <p className="text-[11px] text-[#94A3B8] leading-relaxed">
          The external Layer-1 cash-out route (<code className="text-[#3B82F6]">/wallet/withdraw</code>) allows generating exit proofs to transfer assets out of the NONY settlement pool to external addresses. In this testnet milestone, the withdrawal contract gateway is under formal audit.
        </p>

        {/* Action Button */}
        <div className="pt-2 flex items-center gap-3">
          <Link
            href="/wallet/withdraw"
            onClick={onClose}
            className="flex-1 py-3 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-semibold uppercase tracking-wider transition-all text-center focus:outline-none shadow-md"
          >
            PROCEED TO WITHDRAW
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="py-3 px-4 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-xs font-semibold text-[#94A3B8] uppercase tracking-wider transition-all text-center focus:outline-none"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
