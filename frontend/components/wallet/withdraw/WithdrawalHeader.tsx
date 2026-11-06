"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Logo } from "@/components/Logo";

interface WithdrawalHeaderProps {
  account: string | null;
  networkName: string;
}

export function WithdrawalHeader({ account, networkName }: WithdrawalHeaderProps) {
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
    <header className="sticky top-0 z-30 bg-[#0F1318]/90 backdrop-blur-md border-b border-[#232B36] py-3.5 px-4 sm:px-6 lg:px-8 font-mono">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left: Back Link & Branding */}
        <div className="flex items-center gap-3">
          <Link
            href="/wallet"
            className="flex items-center gap-1.5 text-xs text-[#94A3B8] hover:text-[#F0F4F8] transition-colors p-1 -ml-1 focus:outline-none"
            title="Back to Wallet"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline font-semibold">WALLET</span>
          </Link>

          <span className="h-3.5 w-[1px] bg-[#232B36]" />

          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-90 transition-opacity focus:outline-none"
          >
            <Logo size={20} />
            <span className="font-sans font-bold tracking-[0.2em] text-xs sm:text-sm text-[#F0F4F8] uppercase">
              NONY
            </span>
          </Link>

          <span className="h-3.5 w-[1px] bg-[#232B36] hidden md:inline-block" />

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#3B82F6]/10 border border-[#3B82F6]/30 text-[10px] text-[#3B82F6] tracking-wider uppercase font-semibold">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B82F6] opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3B82F6]" />
            </span>
            <span>CASH OUT GATEWAY</span>
          </div>
        </div>

        {/* Right: Connected Wallet Status & Network Indicator */}
        <div className="flex items-center gap-3 text-xs">
          {account ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#161B22] border border-[#232B36] text-[11px] text-[#94A3B8]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                <span>{networkName}</span>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#161B22] border border-[#232B36] hover:border-[#3B82F6]/50 text-[#F0F4F8] text-xs transition-colors focus:outline-none font-semibold"
                title="Click to copy full address"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
                <span>
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
                {copied ? (
                  <Check size={11} className="text-[#10B981]" />
                ) : (
                  <Copy size={11} className="text-[#64748B]" />
                )}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
              <span>Not Connected</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
