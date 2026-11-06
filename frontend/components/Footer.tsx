"use client";

import React from "react";
import Link from "next/link";
import { Logo } from "./Logo";
import { ShieldCheck } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-[#232B36] bg-[#12161D] py-10 px-4 sm:px-6 lg:px-8 font-mono text-xs text-[#94A3B8]">
      <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-3">
          <Logo size={20} />
          <div>
            <div className="font-sans font-bold text-sm text-[#F0F4F8] tracking-widest uppercase">
              NONY
            </div>
            <div className="text-[11px] text-[#64748B]">
              Confidential Financial Infrastructure • Attested AWS Nitro Enclave
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-[11px]">
          <Link href="/deposit" className="hover:text-[#F0F4F8] transition-colors">
            Deposit
          </Link>
          <Link href="/execution" className="hover:text-[#F0F4F8] transition-colors">
            Execution
          </Link>
          <Link href="/pool" className="hover:text-[#F0F4F8] transition-colors">
            Pool
          </Link>
          <Link href="/mix" className="hover:text-[#F0F4F8] transition-colors">
            Mix
          </Link>
          <Link href="/wallet" className="hover:text-[#F0F4F8] transition-colors">
            Wallet
          </Link>
          <Link href="/wallet/withdraw" className="hover:text-[#F0F4F8] transition-colors">
            Cash Out
          </Link>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
          <ShieldCheck size={13} className="text-[#10B981]" />
          <span>Non-Custodial Architecture</span>
        </div>
      </div>
    </footer>
  );
}
