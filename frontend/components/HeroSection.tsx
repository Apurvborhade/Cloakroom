"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Lock, Zap } from "lucide-react";
import { HeroVisual } from "./HeroVisual";

export function HeroSection() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleStartClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setIsNavigating(true);
    setTimeout(() => {
      router.push("/deposit");
    }, 200);
  };

  return (
    <section className="relative min-h-[85vh] flex flex-col justify-center items-center pt-28 sm:pt-36 pb-16 px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Background Orbital Visual */}
      <div
        className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none overflow-hidden select-none opacity-40 transition-opacity duration-700"
        style={{ zIndex: 0 }}
      >
        <div className="relative top-[-3%]">
          <HeroVisual isBackground />
        </div>
      </div>

      {/* Hero Foreground Content */}
      <div
        className="w-full max-w-4xl mx-auto flex flex-col items-center text-center relative pointer-events-auto"
        style={{ zIndex: 2 }}
      >
        {/* Attestation Pill */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#161B22] border border-[#232B36] mb-6 shadow-sm hover:border-[#3A4759] transition-colors cursor-default">
          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
          <span className="font-mono text-[11px] font-semibold tracking-wider text-[#94A3B8] uppercase">
            ATTESTED TEE PRIVATE INTENT NETWORK
          </span>
        </div>

        {/* Main Headline */}
        <h1 className="font-sans font-bold tracking-tight text-[#F0F4F8] text-4xl sm:text-6xl md:text-7xl leading-[1.08] mb-6 select-none">
          Private Financial <br />
          <span className="text-[#3B82F6]">Infrastructure</span>
        </h1>

        {/* Subtitle */}
        <p className="max-w-2xl text-sm sm:text-base text-[#94A3B8] leading-relaxed mb-8 font-mono">
          Deposit assets into confidential enclave custody, execute conditional limit orders and private swaps, and settle off-chain claims with zero transaction graph linkage.
        </p>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto font-mono text-xs">
          <a
            href="/deposit"
            onClick={handleStartClick}
            className={`w-full sm:w-auto px-6 py-3 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-md focus:outline-none ${
              isNavigating ? "opacity-75 scale-[0.98]" : ""
            }`}
          >
            <span>START DEPOSIT</span>
            <ArrowRight size={14} />
          </a>

          <Link
            href="/pool"
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#161B22] hover:bg-[#1C222B] border border-[#232B36] text-[#F0F4F8] font-semibold uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
          >
            <Zap size={14} className="text-[#3B82F6]" />
            <span>CONFIDENTIAL POOL</span>
          </Link>

          <a
            href="#protocol"
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-transparent hover:bg-[#161B22] border border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] font-semibold uppercase tracking-wider transition-colors"
          >
            EXPLORE PROTOCOL
          </a>
        </div>

        {/* Three Value Metrics Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl mt-14 pt-8 border-t border-[#232B36] text-xs font-mono text-left">
          <div className="p-3.5 rounded-xl bg-[#161B22] border border-[#232B36] space-y-1">
            <span className="text-[10px] text-[#64748B] uppercase block">Hardware Execution</span>
            <div className="font-bold text-sm text-[#F0F4F8]">AWS Nitro Enclave</div>
            <span className="text-[10px] text-[#10B981] block">Sealed Memory Space</span>
          </div>

          <div className="p-3.5 rounded-xl bg-[#161B22] border border-[#232B36] space-y-1">
            <span className="text-[10px] text-[#64748B] uppercase block">Execution Models</span>
            <div className="font-bold text-sm text-[#F0F4F8]">MIX &amp; POOL Trading</div>
            <span className="text-[10px] text-[#3B82F6] block">Anonymity &amp; Matching</span>
          </div>

          <div className="p-3.5 rounded-xl bg-[#161B22] border border-[#232B36] space-y-1">
            <span className="text-[10px] text-[#64748B] uppercase block">Supported Assets</span>
            <div className="font-bold text-sm text-[#F0F4F8]">ETH (18) &amp; USDC (6)</div>
            <span className="text-[10px] text-[#94A3B8] block">Native &amp; ERC-20</span>
          </div>
        </div>
      </div>
    </section>
  );
}
