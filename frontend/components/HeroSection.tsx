"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldCheck, Lock, Terminal } from "lucide-react";
import { HeroVisual } from "./HeroVisual";

export function HeroSection() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState(false);

  const handleStartClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setIsNavigating(true);
    // Smooth transition before route push
    setTimeout(() => {
      router.push("/deposit");
    }, 280);
  };

  return (
    <section className="relative min-h-[90vh] flex flex-col justify-center items-center pt-28 sm:pt-36 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
      {/* Layer 0: Background Confidential Visualization */}
      <div
        className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none overflow-hidden select-none opacity-45 sm:opacity-75 lg:opacity-90 transition-opacity duration-700"
        style={{ zIndex: 0 }}
      >
        {/* Slightly offset upward so the central enclave core centers behind the headline */}
        <div className="relative top-[-4%] sm:top-[-3%] md:top-[-2%]">
          <HeroVisual isBackground />
        </div>
      </div>

      {/* Subtle ambient lighting mesh */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[440px] bg-[#A6DCF8]/[0.02] blur-[150px] pointer-events-none rounded-full"
        style={{ zIndex: 0 }}
      />

      {/* Layer 2: Hero Foreground Content Container */}
      <div
        className="w-full max-w-5xl mx-auto flex flex-col items-center text-center relative pointer-events-auto"
        style={{ zIndex: 2 }}
      >
        {/* Small Top Label */}
        <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-[#141418]/90 border border-[#292930] mb-8 animate-fade-in shadow-sm hover:border-[#3A3A46] transition-colors cursor-default backdrop-blur-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-[#A6DCF8]" />
          <span className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#A6DCF8] uppercase">
            PRIVATE FINANCIAL INFRASTRUCTURE
          </span>
        </div>

        {/* Main Headline with contrast protection */}
        <h1 className="font-sans font-bold tracking-tight text-[#F5F5F7] text-4xl sm:text-6xl md:text-7xl lg:text-[5.15rem] leading-[1.08] sm:leading-[1.05] mb-6 animate-fade-in select-none drop-shadow-[0_4px_24px_rgba(12,12,14,0.98)]">
          <span className="block">Your finances.</span>
          <span className="block text-[#E4E4EB]">Your privacy.</span>
          <span className="block text-[#A6DCF8]">Your control.</span>
        </h1>

        {/* Supporting Description */}
        <p className="max-w-2xl text-base sm:text-lg md:text-xl text-[#92929B] font-normal leading-relaxed mb-10 animate-fade-in px-4 drop-shadow-[0_2px_12px_rgba(12,12,14,0.95)]">
          Move assets, manage private financial positions and execute conditional swaps without
          exposing your entire financial activity.
        </p>

        {/* CTA Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5 mb-10 animate-fade-in w-full sm:w-auto">
          {/* Primary CTA: START → */}
          <Link
            href="/deposit"
            onClick={handleStartClick}
            className={`group relative inline-flex items-center justify-center gap-2 px-9 py-4 rounded-full text-sm font-semibold tracking-wide bg-[#F5F5F7] text-[#0C0C0C] hover:bg-[#FFFFFF] active:scale-[0.98] transition-all duration-200 shadow-[0_0_24px_rgba(245,245,247,0.12)] hover:shadow-[0_0_32px_rgba(166,220,248,0.3)] w-full sm:w-auto ${isNavigating ? "opacity-75 scale-[0.98]" : ""
              }`}
          >
            <span>START</span>
            <ArrowRight
              size={16}
              className="text-[#0C0C0C] transition-transform duration-200 group-hover:translate-x-1"
            />
          </Link>

          {/* Secondary CTA: Explore Protocol */}
          <a
            href="#protocol"
            className="inline-flex items-center justify-center px-8 py-4 rounded-full text-sm font-medium tracking-wide bg-[#141418]/90 hover:bg-[#1A1A22] text-[#92929B] hover:text-[#F5F5F7] border border-[#292930] hover:border-[#3E3E48] backdrop-blur-sm transition-all duration-200 w-full sm:w-auto"
          >
            Explore Protocol
          </a>
        </div>

        {/* Technical Callout Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141418]/80 border border-[#292930] backdrop-blur-md text-[10px] font-mono text-[#92929B] shadow-lg mb-14 animate-fade-in">
          <span className="w-1.5 h-1.5 rounded-full bg-[#A6DCF8] animate-pulse" />
          <span>CONFIDENTIAL EXECUTION ENVIRONMENT</span>
          <span className="text-[#555560]">::</span>
          <span className="text-[#F5F5F7]">ISOLATED ENCLAVE</span>
        </div>

        {/* Technical Value Metrics Strip */}
        <div className="w-full max-w-4xl pt-8 border-t border-[#1C1C24]/80 grid grid-cols-2 md:grid-cols-4 gap-6 text-left backdrop-blur-[2px]">
          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase text-[#666672] flex items-center gap-1.5">
              <Lock size={12} className="text-[#A6DCF8]" /> Custody Architecture
            </div>
            <div className="text-sm font-medium text-[#F5F5F7]">Hardware TEE</div>
            <div className="text-xs text-[#92929B]">Attested AWS Nitro Core</div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase text-[#666672] flex items-center gap-1.5">
              <ShieldCheck size={12} className="text-[#A6DCF8]" /> Request Sealing
            </div>
            <div className="text-sm font-medium text-[#F5F5F7]">HPKE Encryption</div>
            <div className="text-xs text-[#92929B]">DHKEM(X25519) + AES</div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase text-[#666672] flex items-center gap-1.5">
              <Terminal size={12} className="text-[#A6DCF8]" /> Intent Execution
            </div>
            <div className="text-sm font-medium text-[#F5F5F7]">Pooled Inventory</div>
            <div className="text-xs text-[#92929B]">No Public Orderbook</div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] font-mono uppercase text-[#666672] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> RPC Obfuscation
            </div>
            <div className="text-sm font-medium text-[#F5F5F7]">Anon-RPC Routed</div>
            <div className="text-xs text-[#92929B]">Metadata-Free Relays</div>
          </div>
        </div>

      </div>
    </section>
  );
}
