"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Home } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

interface SuccessActionsProps {
  explorerUrl?: string | null;
  className?: string;
}

export function SuccessActions({ explorerUrl, className }: SuccessActionsProps) {
  const router = useRouter();
  const { refreshBalance } = useWallet();

  const handleBackToWallet = () => {
    refreshBalance();
    router.push("/wallet");
  };

  return (
    <div className="space-y-3 font-mono text-center pt-2">
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {/* Primary Action: Back to Wallet with Refresh */}
        <button
          type="button"
          onClick={handleBackToWallet}
          className="w-full sm:w-auto py-3 px-8 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-[#F0F4F8] font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 focus:outline-none"
        >
          <ArrowLeft size={14} />
          <span>Back to Wallet</span>
        </button>

        {/* Secondary Action: View on Explorer */}
        {explorerUrl && (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:w-auto py-3 px-6 rounded-xl bg-[#161B22] hover:bg-[#1C222B] border border-[#232B36] hover:border-[#3B82F6]/40 text-[#F0F4F8] font-semibold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 focus:outline-none shadow-md"
          >
            <span>View Transaction</span>
            <ExternalLink size={14} className="text-[#3B82F6]" />
          </a>
        )}
      </div>

      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#F0F4F8] transition-colors py-1 focus:outline-none"
        >
          <Home size={12} />
          <span>Return to Home</span>
        </Link>
      </div>
    </div>
  );
}
