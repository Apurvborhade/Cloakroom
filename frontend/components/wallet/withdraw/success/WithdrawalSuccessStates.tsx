"use client";

import React from "react";
import Link from "next/link";
import {
  Loader2,
  Clock,
  AlertTriangle,
  XCircle,
  ArrowLeft,
  RotateCw,
} from "lucide-react";
import { VerificationState, VerifiedWithdrawalReceipt } from "@/lib/wallet/verification";
import { TransactionHash } from "./TransactionHash";

interface WithdrawalSuccessStatesProps {
  state: VerificationState;
  errorMessage?: string;
  receipt?: VerifiedWithdrawalReceipt;
  onRetry?: () => void;
}

export function WithdrawalSuccessStates({
  state,
  errorMessage,
  receipt,
  onRetry,
}: WithdrawalSuccessStatesProps) {
  // 1. Loading State
  if (state === "loading") {
    return (
      <div className="max-w-md mx-auto w-full p-8 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-4 font-mono shadow-xl">
        <div className="w-14 h-14 rounded-full bg-[#3B82F6]/10 border border-[#3B82F6]/30 flex items-center justify-center text-[#3B82F6] mx-auto">
          <Loader2 size={28} className="animate-spin" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-[#F0F4F8] font-sans">
            Verifying On-Chain Receipt
          </h2>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            Querying blockchain provider to verify transaction receipt and status...
          </p>
        </div>
      </div>
    );
  }

  // 2. Pending Transaction State (Mined block awaited)
  if (state === "pending") {
    return (
      <div className="max-w-lg mx-auto w-full p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-[#F59E0B]/30 text-center space-y-5 font-mono shadow-xl">
        <div className="w-16 h-16 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B] mx-auto">
          <Clock size={32} className="animate-pulse" />
        </div>

        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] text-[11px] font-bold uppercase tracking-wider mb-1">
            <span>Transaction Pending</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-[#F0F4F8] font-sans">
            Awaiting Block Confirmation
          </h2>

          <p className="text-xs text-[#94A3B8] leading-relaxed max-w-sm mx-auto">
            Your withdrawal transaction has been submitted to the mempool and is awaiting inclusion by network validators.
          </p>
        </div>

        {receipt?.txHash && (
          <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] text-xs space-y-2 text-left">
            <div className="flex items-center justify-between">
              <span className="text-[#94A3B8]">Transaction Hash:</span>
              <TransactionHash
                txHash={receipt.txHash}
                explorerUrl={receipt.explorerUrl}
              />
            </div>
            <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
              <span className="text-[#94A3B8]">Target Network:</span>
              <span className="text-[#F0F4F8] font-semibold">{receipt.networkName}</span>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[#F0F4F8] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <RotateCw size={13} />
              <span>Check Receipt Again</span>
            </button>
          )}

          <Link
            href="/wallet"
            className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shadow-md"
          >
            <ArrowLeft size={13} />
            <span>Return to Wallet</span>
          </Link>
        </div>
      </div>
    );
  }

  // 3. Failed or Reverted Transaction State
  if (state === "failed") {
    return (
      <div className="max-w-lg mx-auto w-full p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-[#EF4444]/30 text-center space-y-5 font-mono shadow-xl">
        <div className="w-16 h-16 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center text-[#EF4444] mx-auto">
          <XCircle size={34} />
        </div>

        <div className="space-y-1.5">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-[11px] font-bold uppercase tracking-wider mb-1">
            <span>Transaction Reverted</span>
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-[#F0F4F8] font-sans">
            Withdrawal Unsuccessful
          </h2>

          <p className="text-xs text-[#EF4444] leading-relaxed max-w-sm mx-auto">
            {errorMessage || "The transaction was executed on-chain but reverted by the smart contract. No funds have left protocol custody."}
          </p>
        </div>

        {receipt?.txHash && (
          <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] text-xs space-y-2 text-left">
            <div className="flex items-center justify-between">
              <span className="text-[#94A3B8]">Transaction Hash:</span>
              <TransactionHash
                txHash={receipt.txHash}
                explorerUrl={receipt.explorerUrl}
              />
            </div>
            <div className="flex items-center justify-between border-t border-[#232B36] pt-2">
              <span className="text-[#94A3B8]">Execution Status:</span>
              <span className="text-[#EF4444] font-bold uppercase">Reverted (0x0)</span>
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <Link
            href="/wallet/withdraw"
            className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[#F0F4F8] text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <span>Retry Withdrawal</span>
          </Link>

          <Link
            href="/wallet"
            className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors shadow-md"
          >
            <ArrowLeft size={13} />
            <span>Return to Wallet</span>
          </Link>
        </div>
      </div>
    );
  }

  // 4. Missing Transaction Data State (Direct navigation without tx context)
  if (state === "missing") {
    return (
      <div className="max-w-md mx-auto w-full p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-5 font-mono shadow-xl">
        <div className="w-14 h-14 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B] mx-auto">
          <AlertTriangle size={28} />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-[#F0F4F8] font-sans">
            No Verified Transaction Context
          </h2>
          <p className="text-xs text-[#94A3B8] leading-relaxed">
            The Payment Successful confirmation requires an authentic on-chain transaction hash. Direct navigation without a verified transaction is restricted.
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/wallet"
            className="inline-flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider transition-colors shadow-md"
          >
            <ArrowLeft size={14} />
            <span>Return to Wallet</span>
          </Link>
        </div>
      </div>
    );
  }

  // 5. Invalid Transaction Hash Syntax
  if (state === "invalid") {
    return (
      <div className="max-w-md mx-auto w-full p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-[#EF4444]/30 text-center space-y-5 font-mono shadow-xl">
        <div className="w-14 h-14 rounded-full bg-[#EF4444]/10 border border-[#EF4444]/30 flex items-center justify-center text-[#EF4444] mx-auto">
          <AlertTriangle size={28} />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-xl font-bold text-[#F0F4F8] font-sans">
            Invalid Transaction Hash
          </h2>
          <p className="text-xs text-[#EF4444] leading-relaxed">
            {errorMessage || "The specified transaction identifier does not conform to Ethereum standard format (32-byte hexadecimal string)."}
          </p>
        </div>

        <div className="pt-2">
          <Link
            href="/wallet"
            className="inline-flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider transition-colors shadow-md"
          >
            <ArrowLeft size={14} />
            <span>Return to Wallet</span>
          </Link>
        </div>
      </div>
    );
  }

  // 6. Unsupported Network
  return (
    <div className="max-w-md mx-auto w-full p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-[#F59E0B]/30 text-center space-y-5 font-mono shadow-xl">
      <div className="w-14 h-14 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B] mx-auto">
        <AlertTriangle size={28} />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-xl font-bold text-[#F0F4F8] font-sans">
          Unsupported Network
        </h2>
        <p className="text-xs text-[#F59E0B] leading-relaxed">
          {errorMessage || "Your connected Web3 wallet is on an unsupported blockchain network. Please switch to Ethereum Sepolia or Mainnet."}
        </p>
      </div>

      <div className="pt-2">
        <Link
          href="/wallet"
          className="inline-flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] text-xs font-bold uppercase tracking-wider transition-colors shadow-md"
        >
          <ArrowLeft size={14} />
          <span>Return to Wallet</span>
        </Link>
      </div>
    </div>
  );
}
