"use client";

import React, { useState } from "react";
import { Wallet, Copy, Check, ShieldCheck, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface WithdrawalDestinationProps {
  account: string | null;
  networkName: string;
  onConnectWallet?: () => void;
  className?: string;
}

export function WithdrawalDestination({
  account,
  networkName,
  onConnectWallet,
  className,
}: WithdrawalDestinationProps) {
  const [copied, setCopied] = useState(false);

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
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all hover:border-[#3B82F6]/40 shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold">
          3. CONFIRM DESTINATION WALLET
        </span>
        <span className="text-[10px] text-[#10B981] flex items-center gap-1 font-semibold">
          <ShieldCheck size={12} />
          Self-Custodial EOA
        </span>
      </div>

      {account ? (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-[#3B82F6]/10 border border-[#3B82F6]/30 flex items-center justify-center shrink-0 text-[#3B82F6]">
                <Wallet size={16} />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] text-[#94A3B8] uppercase">
                  Connected Web3 Account ({networkName})
                </div>
                <div className="text-xs sm:text-sm font-bold text-[#F0F4F8] truncate font-mono">
                  {account}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#161B22] hover:bg-[#232B36] border border-[#232B36] text-xs text-[#94A3B8] hover:text-[#F0F4F8] transition-colors shrink-0 focus:outline-none"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-[#10B981]" />
                  <span className="text-[#10B981] font-semibold">Copied!</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>Copy Address</span>
                </>
              )}
            </button>
          </div>

          <div className="text-[11px] text-[#94A3B8] leading-relaxed bg-[#1C222B] p-3 rounded-xl border border-[#232B36]">
            <p>
              Withdrawals are settled directly to your connected Web3 address. Funds will exit the NONY settlement pool and transfer to this destination.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={18} className="text-[#F59E0B] shrink-0 mt-0.5" />
            <div className="text-xs text-[#F59E0B]">
              <span className="font-bold">Wallet Not Connected.</span> You must connect a Web3 wallet to specify the destination settlement address for your withdrawal.
            </div>
          </div>
          {onConnectWallet && (
            <button
              type="button"
              onClick={onConnectWallet}
              className="w-full py-2 px-3 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider transition-colors shadow-md"
            >
              Connect Wallet to Proceed
            </button>
          )}
        </div>
      )}
    </div>
  );
}
