"use client";

import React, { useState } from "react";
import {
  Shield,
  Layers,
  ArrowRight,
  EyeOff,
  Cpu,
  Lock,
} from "lucide-react";

export function ProtocolSection() {
  const [activeTab, setActiveTab] = useState<"flow" | "specs" | "assumptions">("flow");

  return (
    <section id="protocol" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-[#232B36] bg-[#0F1318] font-mono text-left">
      <div className="max-w-6xl mx-auto">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#161B22] border border-[#232B36] mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
            <span className="text-[11px] text-[#3B82F6] uppercase tracking-wider font-semibold">
              Architecture &amp; Mechanics
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F0F4F8] mb-4 font-sans">
            Confidential Coordination without Privacy-Contract Calls
          </h2>
          <p className="text-sm sm:text-base text-[#94A3B8] leading-relaxed">
            Conventional privacy pools require interacting with recognizable on-chain mixer contracts.
            NONY eliminates this footprint by shifting state coordination into an attested TEE enclave,
            settling exclusively via standard peer-to-peer and decentralized protocol transfers.
          </p>
        </div>

        {/* 3 Core Architecture Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20 text-xs">
          
          {/* Pillar 1 */}
          <div className="p-8 rounded-2xl bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] mb-6">
              <Cpu size={20} />
            </div>
            <div className="text-[11px] text-[#3B82F6] uppercase tracking-widest mb-2 font-semibold">
              Pillar 01
            </div>
            <h3 className="text-base font-semibold text-[#F0F4F8] mb-3 font-sans">
              Attested Nitro Enclave
            </h3>
            <p className="text-xs text-[#94A3B8] leading-relaxed mb-4">
              A single reproducible AWS Nitro Enclave maintains the entire off-chain ledger.
              Hardware cryptographic attestation proves that no operator, host root, or third party
              can inspect internal states or tamper with execution.
            </p>
            <div className="pt-4 border-t border-[#232B36] flex items-center justify-between text-xs text-[#64748B]">
              <span>PCR0 Verified</span>
              <span className="text-[#3B82F6] font-semibold">Hardware Root of Trust</span>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="p-8 rounded-2xl bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] mb-6">
              <Lock size={20} />
            </div>
            <div className="text-[11px] text-[#3B82F6] uppercase tracking-widest mb-2 font-semibold">
              Pillar 02
            </div>
            <h3 className="text-base font-semibold text-[#F0F4F8] mb-3 font-sans">
              HPKE Sealed Requests
            </h3>
            <p className="text-xs text-[#94A3B8] leading-relaxed mb-4">
              All intents and deposit allocations are signed as EIP-712 structured data and sealed
              using Hybrid Public Key Encryption directly to the enclave’s ephemeral key.
              No node or proxy can read your trade parameters in transit.
            </p>
            <div className="pt-4 border-t border-[#232B36] flex items-center justify-between text-xs text-[#64748B]">
              <span>RFC 9180</span>
              <span className="text-[#3B82F6] font-semibold">DHKEM(X25519)</span>
            </div>
          </div>

          {/* Pillar 3 */}
          <div className="p-8 rounded-2xl bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] mb-6">
              <EyeOff size={20} />
            </div>
            <div className="text-[11px] text-[#3B82F6] uppercase tracking-widest mb-2 font-semibold">
              Pillar 03
            </div>
            <h3 className="text-base font-semibold text-[#F0F4F8] mb-3 font-sans">
              Pooled Execution &amp; Anon-RPC
            </h3>
            <p className="text-xs text-[#94A3B8] leading-relaxed mb-4">
              Conditional swaps execute against internal pooled inventory or routed through Uniswap
              from enclave-controlled inventory. Chain reads route through Anon-RPC to strip IP, timing,
              and RPC tracking headers.
            </p>
            <div className="pt-4 border-t border-[#232B36] flex items-center justify-between text-xs text-[#64748B]">
              <span>Oblivious Relays</span>
              <span className="text-[#10B981] font-semibold">Zero Frontrunning</span>
            </div>
          </div>

        </div>

        {/* Detailed Mechanics & Data Flow Section */}
        <div id="how-it-works" className="p-8 sm:p-10 rounded-2xl bg-[#161B22] border border-[#232B36]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#232B36] mb-8">
            <div>
              <h3 className="text-lg font-semibold text-[#F0F4F8] font-sans">
                Transaction Lifecycle in NONY
              </h3>
              <p className="text-xs text-[#94A3B8] mt-1">
                How funds move between the public Ethereum settlement layer and the private enclave
              </p>
            </div>

            {/* Toggle Tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0F1318] border border-[#232B36] self-start sm:self-auto text-xs">
              <button
                onClick={() => setActiveTab("flow")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "flow"
                    ? "bg-[#1C222B] text-[#3B82F6] font-semibold shadow-sm"
                    : "text-[#64748B] hover:text-[#94A3B8]"
                }`}
              >
                Dataflow
              </button>
              <button
                onClick={() => setActiveTab("specs")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "specs"
                    ? "bg-[#1C222B] text-[#3B82F6] font-semibold shadow-sm"
                    : "text-[#64748B] hover:text-[#94A3B8]"
                }`}
              >
                Cryptography Specs
              </button>
              <button
                onClick={() => setActiveTab("assumptions")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "assumptions"
                    ? "bg-[#1C222B] text-[#3B82F6] font-semibold shadow-sm"
                    : "text-[#64748B] hover:text-[#94A3B8]"
                }`}
              >
                Trust Model
              </button>
            </div>
          </div>

          {activeTab === "flow" && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs">
              <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36]">
                <div className="text-[10px] text-[#3B82F6] font-semibold mb-1.5">STEP 01</div>
                <div className="text-xs font-semibold text-[#F0F4F8] mb-2">Deposit Session</div>
                <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                  User requests an ephemeral deposit address from the enclave. A unique custody EOA is provisioned.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36]">
                <div className="text-[10px] text-[#3B82F6] font-semibold mb-1.5">STEP 02</div>
                <div className="text-xs font-semibold text-[#F0F4F8] mb-2">Fund Allocation</div>
                <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                  User sends ETH or ERC20. The transaction on-chain looks like a typical peer-to-peer transfer.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36]">
                <div className="text-[10px] text-[#3B82F6] font-semibold mb-1.5">STEP 03</div>
                <div className="text-xs font-semibold text-[#F0F4F8] mb-2">HPKE Intent</div>
                <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                  Conditional limit or swap intents are sealed directly to the enclave. Execution triggers in zero-knowledge.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36]">
                <div className="text-[10px] text-[#3B82F6] font-semibold mb-1.5">STEP 04</div>
                <div className="text-xs font-semibold text-[#F0F4F8] mb-2">Pooled Payout</div>
                <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                  Enclave executes payout from pooled reserves to user's specified destination wallet.
                </p>
              </div>
            </div>
          )}

          {activeTab === "specs" && (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36]">
                  <div className="text-[10px] text-[#64748B] uppercase mb-1">EIP-712 Intent Domain</div>
                  <div className="text-[#F0F4F8] font-semibold">NONY Intent Network (Sepolia / Mainnet)</div>
                  <div className="text-[#94A3B8] text-[11px] mt-1">
                    Salt verified against hash of the attested enclave public key.
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0F1318] border border-[#232B36]">
                  <div className="text-[10px] text-[#64748B] uppercase mb-1">Envelope Encryption</div>
                  <div className="text-[#3B82F6] font-semibold">HPKE RFC 9180 Base Mode</div>
                  <div className="text-[#94A3B8] text-[11px] mt-1">
                    KEM: DHKEM(X25519, HKDF-SHA256) | KDF: HKDF-SHA256 | AEAD: AES-128-GCM
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "assumptions" && (
            <div className="p-5 rounded-xl bg-[#0F1318] border border-[#232B36] text-xs leading-relaxed text-[#94A3B8] space-y-2">
              <div className="flex items-center gap-2 text-[#F0F4F8] font-semibold text-sm">
                <Shield size={16} className="text-[#3B82F6]" />
                <span>Honest Cryptographic Transparency</span>
              </div>
              <p>
                We never claim undetectable magic. Instead, NONY removes the public privacy-contract target.
                The operator, KMS policy administrator and AWS Nitro TEE hardware are trusted roots.
                Deposit and payout amounts are visible on-chain, but internal balances, trigger orders,
                and state transitions occur within the enclave boundary.
              </p>
            </div>
          )}
        </div>

      </div>
    </section>
  );
}
