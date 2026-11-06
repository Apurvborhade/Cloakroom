"use client";

import React from "react";
import Link from "next/link";
import { Wallet, ArrowRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface WalletNavigationBannerProps {
  className?: string;
}

export function WalletNavigationBanner({ className }: WalletNavigationBannerProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 font-mono text-left space-y-4 shadow-lg",
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-[#3B82F6]" />
            <h3 className="text-base font-bold text-[#F0F4F8] tracking-tight uppercase">
              YOUR PORTFOLIO
            </h3>
          </div>
          <p className="text-xs text-[#94A3B8] max-w-lg leading-relaxed">
            View your complete asset distribution, available balances, active orders and transaction history.
          </p>
        </div>

        <Link
          href="/wallet"
          className="py-3 px-5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-xs font-bold text-white transition-all flex items-center justify-center gap-2 shrink-0 focus:outline-none shadow-lg cursor-pointer"
        >
          <span>VIEW WALLET</span>
          <ArrowRight size={14} />
        </Link>
      </div>

      <div className="pt-3 border-t border-[#232B36] flex items-center justify-between text-[11px] text-[#94A3B8]">
        <div className="flex items-center gap-1.5">
          <ShieldCheck size={13} className="text-emerald-400" />
          <span>Non-custodial cryptographic balance tracking</span>
        </div>
        <span className="text-[#505D6E]">NONY Privacy Architecture</span>
      </div>
    </div>
  );
}
