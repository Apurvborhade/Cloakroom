"use client";

import React, { useState } from "react";
import { ShieldCheck, ExternalLink, ChevronDown, Cpu, KeyRound } from "lucide-react";

export function AttestationBadge() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141418] border border-[#292930] hover:border-[#3E3E48] text-xs font-mono text-[#92929B] hover:text-[#F5F5F7] transition-all duration-200"
        title="Hardware TEE Attestation Status"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#A6DCF8] opacity-60"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#A6DCF8]"></span>
        </span>
        <span className="text-[11px] uppercase tracking-wider text-[#F5F5F7]">TEE Attested</span>
        <span className="text-[#555560] hidden sm:inline">|</span>
        <span className="text-[11px] text-[#A6DCF8] hidden sm:inline">Nitro PCR0</span>
        <ChevronDown
          size={12}
          className={`text-[#92929B] transition-transform duration-200 ${isOpen ? "rotate-180" : ""
            }`}
        />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 p-4 rounded-xl bg-[#141418] border border-[#292930] shadow-2xl shadow-black/80 z-50 backdrop-blur-xl animate-fade-in text-left">
          <div className="flex items-center justify-between pb-3 border-b border-[#292930]">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className="text-[#A6DCF8]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#F5F5F7]">
                Enclave Attestation
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#A6DCF8]/10 text-[#A6DCF8] border border-[#A6DCF8]/20">
              AWS Nitro EIF
            </span>
          </div>

          <div className="py-3 space-y-2.5 font-mono text-xs">
            <div>
              <div className="text-[10px] uppercase text-[#666672] flex items-center gap-1.5">
                <Cpu size={12} /> PCR0 Measurement (Image Hash)
              </div>
              <div className="text-[#92929B] text-[11px] break-all bg-[#0C0C0C] p-1.5 rounded border border-[#202026] mt-1 select-all">
                0x7f4a21e09c84df12...c92a6f7b11
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase text-[#666672] flex items-center gap-1.5">
                <KeyRound size={12} /> Enclave HPKE Public Key
              </div>
              <div className="text-[#92929B] text-[11px] break-all bg-[#0C0C0C] p-1.5 rounded border border-[#202026] mt-1 select-all">
                0x03a98e1f5d2b7814...59bc20d7
              </div>
            </div>

            <div className="flex items-center justify-between text-[11px] pt-1 text-[#92929B]">
              <span>Cipher Suite</span>
              <span className="text-[#F5F5F7]">DHKEM(X25519) + AES-128-GCM</span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#92929B]">
              <span>RPC Mode</span>
              <span className="text-[#A6DCF8]">Anon-RPC Oblivious Relayed</span>
            </div>
          </div>

          <div className="pt-2 border-t border-[#292930] flex items-center justify-between text-[11px]">
            <span className="text-[#666672]">Reproducible Build</span>
            <a
              href="https://github.com/Apurvborhade/Cloakroom/blob/main/docs/reproducible-builds.md"
              target="_blank"
              rel="noreferrer"
              className="text-[#A6DCF8] hover:text-[#BDDEFF] flex items-center gap-1 transition-colors"
            >
              Verify Build <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

