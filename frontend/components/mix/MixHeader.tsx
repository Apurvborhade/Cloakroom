"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Wallet } from "lucide-react";
import { Logo } from "@/components/Logo";
import { WalletModal } from "@/components/WalletModal";
import { useWallet } from "@/hooks/useWallet";

interface MixHeaderProps {
  backHref: string;
  backLabel: string;
}

export function MixHeader({ backHref, backLabel }: MixHeaderProps) {
  const { account } = useWallet();
  const [walletModalOpen, setWalletModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 bg-[#161B22]/90 backdrop-blur-md border-b border-[#232B36] py-3.5 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          {/* Brand + Private Session Indicator */}
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

            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#1C222B] border border-[#232B36] text-[10px] font-mono text-[#3B82F6] tracking-wider uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3B82F6] opacity-60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#3B82F6]" />
              </span>
              <span>PRIVATE SESSION</span>
            </div>
          </div>

          {/* Right Links & Wallet */}
          <div className="flex items-center gap-4 sm:gap-6 text-xs font-mono">
            <Link
              href="/#protocol"
              className="hidden md:inline-block text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              PROTOCOL
            </Link>

            {account ? (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] hover:border-[#3A4759] text-[#F0F4F8] text-xs transition-colors"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </button>
            ) : (
              <button
                onClick={() => setWalletModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] hover:border-[#3B82F6]/60 text-[#F0F4F8] font-medium text-xs transition-colors"
              >
                <Wallet size={12} className="text-[#3B82F6]" />
                <span>Connect Wallet</span>
              </button>
            )}

            <Link
              href={backHref}
              className="inline-flex items-center gap-1.5 text-[#94A3B8] hover:text-[#F0F4F8] transition-colors border-l border-[#232B36] pl-4"
              title={`Return to ${backLabel}`}
            >
              <ArrowLeft size={13} />
              <span className="hidden sm:inline uppercase">{backLabel}</span>
            </Link>
          </div>
        </div>
      </header>

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />
    </>
  );
}
