"use client";

import React, { useState } from "react";
import {
  Shield,
  Layers,
  ArrowRight,
  EyeOff,
  Cpu,
  Lock,
  GitBranch,
  TerminalSquare,
} from "lucide-react";

export function ProtocolSection() {
  const [activeTab, setActiveTab] = useState<"flow" | "specs" | "assumptions">("flow");

  return (
    <section id="protocol" className="relative py-24 sm:py-32 px-4 sm:px-6 lg:px-8 border-t border-[#1C1C22] bg-[#0C0C0C]">
      <div className="max-w-6xl mx-auto">
        
        {/* Section Header */}
        <div className="max-w-2xl mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#141418] border border-[#292930] mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[#A6DCF8]" />
            <span className="font-mono text-[11px] text-[#A6DCF8] uppercase tracking-wider">
              Architecture & Mechanics
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[#F5F5F7] mb-4">
            Confidential Coordination without Privacy-Contract Calls
          </h2>
          <p className="text-base text-[#92929B] leading-relaxed">
            Conventional privacy pools require interacting with recognizable on-chain mixer contracts.
            Cloakroom eliminates this footprint by shifting state coordination into an attested TEE enclave,
            settling exclusively via standard peer-to-peer and decentralized protocol transfers.
          </p>
        </div>

        {/* 3 Core Architecture Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          
          {/* Pillar 1 */}
          <div className="p-8 rounded-2xl bg-[#141418] border border-[#292930] hover:border-[#3E3E48] transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#1C1C24] border border-[#2A2A36] flex items-center justify-center text-[#A6DCF8] mb-6">
              <Cpu size={20} />
            </div>
            <div className="font-mono text-[11px] text-[#A6DCF8] uppercase tracking-widest mb-2">
              Pillar 01
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7] mb-3">
              Attested Nitro Enclave
            </h3>
            <p className="text-sm text-[#92929B] leading-relaxed mb-4">
              A single reproducible AWS Nitro Enclave maintains the entire off-chain ledger.
              Hardware cryptographic attestation proves that no operator, host root, or third party
              can inspect internal states or tamper with execution.
            </p>
            <div className="pt-4 border-t border-[#202028] flex items-center justify-between text-xs font-mono text-[#666672]">
              <span>PCR0 Verified</span>
              <span className="text-[#A6DCF8]">Hardware Root of Trust</span>
            </div>
          </div>

          {/* Pillar 2 */}
          <div className="p-8 rounded-2xl bg-[#141418] border border-[#292930] hover:border-[#3E3E48] transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#1C1C24] border border-[#2A2A36] flex items-center justify-center text-[#A6DCF8] mb-6">
              <Lock size={20} />
            </div>
            <div className="font-mono text-[11px] text-[#A6DCF8] uppercase tracking-widest mb-2">
              Pillar 02
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7] mb-3">
              HPKE Sealed Requests
            </h3>
            <p className="text-sm text-[#92929B] leading-relaxed mb-4">
              All intents and deposit allocations are signed as EIP-712 structured data and sealed
              using Hybrid Public Key Encryption directly to the enclave’s ephemeral key.
              No node or proxy can read your trade parameters in transit.
            </p>
            <div className="pt-4 border-t border-[#202028] flex items-center justify-between text-xs font-mono text-[#666672]">
              <span>RFC 9180</span>
              <span className="text-[#A6DCF8]">DHKEM(X25519)</span>
            </div>
          </div>

          {/* Pillar 3 */}
          <div className="p-8 rounded-2xl bg-[#141418] border border-[#292930] hover:border-[#3E3E48] transition-all group">
            <div className="w-10 h-10 rounded-xl bg-[#1C1C24] border border-[#2A2A36] flex items-center justify-center text-[#A6DCF8] mb-6">
              <EyeOff size={20} />
            </div>
            <div className="font-mono text-[11px] text-[#A6DCF8] uppercase tracking-widest mb-2">
              Pillar 03
            </div>
            <h3 className="text-lg font-semibold text-[#F5F5F7] mb-3">
              Pooled Execution & Anon-RPC
            </h3>
            <p className="text-sm text-[#92929B] leading-relaxed mb-4">
              Conditional swaps execute against internal pooled inventory or routed through Uniswap
              from enclave-controlled inventory. Chain reads route through Anon-RPC to strip IP, timing,
              and RPC tracking headers.
            </p>
            <div className="pt-4 border-t border-[#202028] flex items-center justify-between text-xs font-mono text-[#666672]">
              <span>Oblivious Relays</span>
              <span className="text-[#A6DCF8]">Zero Frontrunning</span>
            </div>
          </div>

        </div>

        {/* Detailed Mechanics & Data Flow Section */}
        <div id="how-it-works" className="p-8 sm:p-10 rounded-2xl bg-[#141418] border border-[#292930]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#292930] mb-8">
            <div>
              <h3 className="text-lg font-semibold text-[#F5F5F7]">
                Transaction Lifecycle in Cloakroom
              </h3>
              <p className="text-xs text-[#92929B] mt-1">
                How funds move between the public Ethereum settlement layer and the private enclave
              </p>
            </div>

            {/* Toggle Tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0C0C0C] border border-[#252530] self-start sm:self-auto font-mono text-xs">
              <button
                onClick={() => setActiveTab("flow")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "flow"
                    ? "bg-[#1E1E26] text-[#A6DCF8] shadow-sm"
                    : "text-[#666672] hover:text-[#92929B]"
                }`}
              >
                Dataflow
              </button>
              <button
                onClick={() => setActiveTab("specs")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "specs"
                    ? "bg-[#1E1E26] text-[#A6DCF8] shadow-sm"
                    : "text-[#666672] hover:text-[#92929B]"
                }`}
              >
                Cryptography Specs
              </button>
              <button
                onClick={() => setActiveTab("assumptions")}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === "assumptions"
                    ? "bg-[#1E1E26] text-[#A6DCF8] shadow-sm"
                    : "text-[#666672] hover:text-[#92929B]"
                }`}
              >
                Trust Model
              </button>
            </div>
          </div>

          {activeTab === "flow" && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 font-mono">
              <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026] relative">
                <div className="text-[10px] text-[#A6DCF8] mb-1.5">STEP 01</div>
                <div className="text-xs font-semibold text-[#F5F5F7] mb-2">Deposit Session</div>
                <p className="text-[11px] text-[#92929B] leading-relaxed">
                  User requests an ephemeral deposit address from the enclave. A unique custody EOA is provisioned.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026] relative">
                <div className="text-[10px] text-[#A6DCF8] mb-1.5">STEP 02</div>
                <div className="text-xs font-semibold text-[#F5F5F7] mb-2">Fund Allocation</div>
                <p className="text-[11px] text-[#92929B] leading-relaxed">
                  User sends ETH or ERC20. The transaction on-chain looks like a typical peer-to-peer transfer.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026] relative">
                <div className="text-[10px] text-[#A6DCF8] mb-1.5">STEP 03</div>
                <div className="text-xs font-semibold text-[#F5F5F7] mb-2">HPKE Intent</div>
                <p className="text-[11px] text-[#92929B] leading-relaxed">
                  Conditional limit or swap intents are sealed directly to the enclave. Execution triggers in zero-knowledge.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026] relative">
                <div className="text-[10px] text-[#A6DCF8] mb-1.5">STEP 04</div>
                <div className="text-xs font-semibold text-[#F5F5F7] mb-2">Pooled Payout</div>
                <p className="text-[11px] text-[#92929B] leading-relaxed">
                  Enclave executes payout from pooled reserves to user's specified destination wallet.
                </p>
              </div>
            </div>
          )}

          {activeTab === "specs" && (
            <div className="space-y-4 font-mono text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026]">
                  <div className="text-[10px] text-[#666672] uppercase mb-1">EIP-712 Intent Domain</div>
                  <div className="text-[#F5F5F7]">Cloakroom Intent Network (Sepolia / Mainnet)</div>
                  <div className="text-[#92929B] text-[11px] mt-1">
                    Salt verified against hash of the attested enclave public key.
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0C0C0C] border border-[#202026]">
                  <div className="text-[10px] text-[#666672] uppercase mb-1">Envelope Encryption</div>
                  <div className="text-[#A6DCF8]">HPKE RFC 9180 Base Mode</div>
                  <div className="text-[#92929B] text-[11px] mt-1">
                    KEM: DHKEM(X25519, HKDF-SHA256) | KDF: HKDF-SHA256 | AEAD: AES-128-GCM
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "assumptions" && (
            <div className="p-5 rounded-xl bg-[#0C0C0C] border border-[#202026] text-xs leading-relaxed text-[#92929B] space-y-2">
              <div className="flex items-center gap-2 text-[#F5F5F7] font-semibold text-sm">
                <Shield size={16} className="text-[#A6DCF8]" />
                <span>Honest Cryptographic Transparency</span>
              </div>
              <p>
                We never claim undetectable magic. Instead, Cloakroom removes the public privacy-contract target.
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

