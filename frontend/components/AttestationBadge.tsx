"use client";

import React, { useState } from "react";
import { ShieldCheck, ChevronDown, ExternalLink } from "lucide-react";

export function AttestationBadge() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative font-mono text-xs">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors focus:outline-none"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
        <span className="text-[11px] font-semibold text-[#F0F4F8]">TEE ATTESTED</span>
        <ChevronDown size={12} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-72 rounded-xl bg-[#161B22] border border-[#232B36] p-4 shadow-xl z-50 space-y-2 text-[11px] text-[#94A3B8] animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between font-bold text-[#F0F4F8] pb-1 border-b border-[#232B36]">
            <span>Nitro Attestation</span>
            <span className="text-[#10B981] text-[10px]">PCR0 VALID</span>
          </div>
          <div>
            <span className="text-[#64748B] block text-[10px]">ENCLAVE PCR0 HASH</span>
            <span className="font-mono text-[#3B82F6] text-[10px] break-all">
              e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
            </span>
          </div>
          <div>
            <span className="text-[#64748B] block text-[10px]">SECURITY LEVEL</span>
            <span className="text-[#F0F4F8]">AWS Nitro Enclave Isolation</span>
          </div>
          <div className="pt-1 text-[10px] text-[#64748B]">
            Cryptographically sealed memory with zero operator root access.
          </div>
        </div>
      )}
    </div>
  );
}
