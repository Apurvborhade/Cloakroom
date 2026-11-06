"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Wallet,
  RotateCcw,
  Copy,
  Check,
  Plus,
} from "lucide-react";
import { Logo } from "@/components/Logo";

interface WalletHeaderProps {
  account: string | null;
  networkName: string;
  isConnecting?: boolean;
  onRefreshBalance: () => void;
  onOpenConnectModal: () => void;
}

export function WalletHeader({
  account,
  networkName,
  isConnecting = false,
  onRefreshBalance,
  onOpenConnectModal,
}: WalletHeaderProps) {
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleCopy = () => {
    if (!account) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(account);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    onRefreshBalance();
    setTimeout(() => setIsRefreshing(false), 800);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#161B22]/90 backdrop-blur-md border-b border-[#232B36] py-3.5 px-4 sm:px-6 lg:px-8 font-mono">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Brand & Section Indicator */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2.5 hover:opacity-90 transition-opacity focus:outline-none"
          >
            <Logo size={22} />
            <span className="font-sans font-bold tracking-[0.2em] text-xs sm:text-sm text-[#F0F4F8] uppercase">
              NONY
            </span>
          </Link>

          <span className="h-3.5 w-[1px] bg-[#232B36] hidden sm:inline-block" />

          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1C222B] border border-[#232B36] text-[10px] text-[#3B82F6] font-bold tracking-wider uppercase">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B82F6] opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3B82F6]" />
            </span>
            <span>PORTFOLIO</span>
          </div>
        </div>

        {/* Right Navigation Controls */}
        <div className="flex items-center gap-3 sm:gap-4 text-xs">
          {/* Trade / Swap Link */}
          <Link
            href="/pool"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
          >
            <Plus size={13} className="text-[#3B82F6]" />
            <span>TRADE</span>
          </Link>

          {/* Connected Account & Status */}
          {account ? (
            <div className="flex items-center gap-1.5 bg-[#1C222B] border border-[#232B36] px-2.5 py-1 rounded-xl">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-[#F0F4F8] font-medium">
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="text-[#94A3B8] hover:text-[#F0F4F8] transition-colors p-1"
                title="Copy address"
              >
                {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenConnectModal}
              disabled={isConnecting}
              className="flex items-center gap-1.5 py-1.5 px-3 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-xs transition-colors shadow-lg cursor-pointer"
            >
              <Wallet size={13} />
              <span>{isConnecting ? "CONNECTING..." : "CONNECT WALLET"}</span>
            </button>
          )}

          {/* Network Indicator */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#1C222B] border border-[#232B36] text-[11px] text-[#94A3B8]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
            <span>{networkName}</span>
          </div>

          {/* Manual Refresh Balance Button */}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors cursor-pointer"
            title="Refresh on-chain balance"
          >
            <RotateCcw
              size={14}
              className={isRefreshing ? "animate-spin text-[#3B82F6]" : ""}
            />
          </button>
        </div>
      </div>
    </header>
  );
}
