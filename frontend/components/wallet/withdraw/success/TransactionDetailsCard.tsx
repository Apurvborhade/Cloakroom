"use client";

import React from "react";
import { CheckCircle2, ShieldCheck, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { DestinationAddress } from "./DestinationAddress";
import { TransactionHash } from "./TransactionHash";
import { VerifiedWithdrawalReceipt } from "@/lib/wallet/verification";

interface TransactionDetailsCardProps {
  receipt: VerifiedWithdrawalReceipt;
  className?: string;
}

export function TransactionDetailsCard({
  receipt,
  className,
}: TransactionDetailsCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all hover:border-[#3B82F6]/40 shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold">
          TRANSACTION SUMMARY
        </span>
        <span className="text-[10px] text-[#10B981] bg-[#10B981]/10 border border-[#10B981]/30 px-2 py-0.5 rounded-full flex items-center gap-1 font-semibold">
          <ShieldCheck size={11} />
          <span>Receipt Verified</span>
        </span>
      </div>

      <div className="space-y-2.5 text-xs bg-[#1C222B] p-4 rounded-xl border border-[#232B36]">
        {/* Status */}
        <div className="flex items-center justify-between">
          <span className="text-[#94A3B8]">Status</span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] text-xs font-semibold">
            <CheckCircle2 size={12} />
            <span>Confirmed</span>
          </span>
        </div>

        {/* Asset */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Asset</span>
          <span className="font-bold text-[#F0F4F8]">{receipt.asset}</span>
        </div>

        {/* Confirmed Amount */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Confirmed Amount</span>
          <span className="font-bold text-[#F0F4F8]">
            {receipt.amount} {receipt.asset}
          </span>
        </div>

        {/* Destination Wallet */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Destination</span>
          {receipt.destinationAddress ? (
            <DestinationAddress address={receipt.destinationAddress} />
          ) : (
            <span className="text-[#64748B]">Unavailable</span>
          )}
        </div>

        {/* Network */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Network</span>
          <span className="text-[#F0F4F8] font-semibold">{receipt.networkName}</span>
        </div>

        {/* Transaction Hash */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Transaction Hash</span>
          <TransactionHash
            txHash={receipt.txHash}
            explorerUrl={receipt.explorerUrl}
          />
        </div>

        {/* Network Fee */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8]">Network Gas Fee</span>
          <span className="text-[#3B82F6] font-semibold">
            {receipt.networkFeeEth ? `${receipt.networkFeeEth} ETH` : "Unavailable"}
          </span>
        </div>

        {/* Timestamp */}
        <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
          <span className="text-[#94A3B8] flex items-center gap-1">
            <Clock size={12} className="text-[#64748B]" />
            <span>Timestamp</span>
          </span>
          <span className="text-[#94A3B8] text-[11px]">
            {receipt.timestamp || "Unavailable"}
          </span>
        </div>
      </div>
    </div>
  );
}
