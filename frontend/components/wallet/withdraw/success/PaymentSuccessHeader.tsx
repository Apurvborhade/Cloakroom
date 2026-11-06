"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { Logo } from "@/components/Logo";

interface PaymentSuccessHeaderProps {
  networkName: string;
}

export function PaymentSuccessHeader({ networkName }: PaymentSuccessHeaderProps) {
  return (
    <header className="sticky top-0 z-30 bg-[#0F1318]/90 backdrop-blur-md border-b border-[#232B36] py-3.5 px-4 sm:px-6 lg:px-8 font-mono">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
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

          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 text-[10px] text-[#10B981] tracking-wider uppercase font-semibold">
            <CheckCircle2 size={11} />
            <span>CONFIRMED RECEIPT</span>
          </div>
        </div>

        {/* Right: Network indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#161B22] border border-[#232B36] text-[11px] text-[#94A3B8]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
          <span>{networkName}</span>
        </div>
      </div>
    </header>
  );
}
