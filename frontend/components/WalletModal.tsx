"use client";

import React, { useState, useEffect } from "react";
import { X, Wallet, ShieldAlert, CheckCircle2 } from "lucide-react";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect?: (address: string) => void;
}

export function WalletModal({ isOpen, onClose, onConnect }: WalletModalProps) {
  const [connecting, setConnecting] = useState<string | null>(null);
  const [hasInjected, setHasInjected] = useState(false);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ethereum) {
      setHasInjected(true);
      (window as any).ethereum
        .request({ method: "eth_accounts" })
        .then((accounts: string[]) => {
          if (accounts && accounts.length > 0 && accounts[0]) {
            setActiveAccount(accounts[0]);
          }
        })
        .catch(() => {});
    }
  }, []);

  if (!isOpen) return null;

  async function connectInjected() {
    setConnecting("injected");
    setError(null);
    try {
      if (typeof window !== "undefined" && (window as any).ethereum) {
        const accounts = await (window as any).ethereum.request({
          method: "eth_requestAccounts",
        });
        if (accounts && accounts.length > 0) {
          setActiveAccount(accounts[0]);
          onConnect?.(accounts[0]);
          setTimeout(() => onClose(), 600);
        }
      } else {
        setError("No Ethereum browser wallet detected. Install Rabby, MetaMask, or Rainbow.");
      }
    } catch (err: any) {
      setError(err?.message || "User rejected connection request.");
    } finally {
      setConnecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full max-w-md p-6 rounded-2xl bg-[#141418] border border-[#292930] shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#292930]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#1A1A22] border border-[#292930] flex items-center justify-center">
              <Wallet size={16} className="text-[#A6DCF8]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#F5F5F7]">Connect Wallet</h3>
              <p className="text-xs text-[#92929B]">EIP-712 Intent Signing Only</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#92929B] hover:text-[#F5F5F7] hover:bg-[#1E1E26] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-950/30 border border-red-900/50 flex items-start gap-2.5 text-xs text-red-200">
            <ShieldAlert size={16} className="shrink-0 text-red-400 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 space-y-2.5">
          <button
            onClick={connectInjected}
            disabled={connecting !== null}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#0C0C0C] border border-[#292930] hover:border-[#3E3E48] hover:bg-[#111116] transition-all group text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#181820] border border-[#252530] flex items-center justify-center font-mono text-xs text-[#A6DCF8]">
                Ξ
              </div>
              <div>
                <div className="text-sm font-medium text-[#F5F5F7] group-hover:text-[#A6DCF8] transition-colors">
                  Browser Wallet
                </div>
                <div className="text-xs text-[#666672]">
                  {hasInjected ? "MetaMask, Rabby, Rainbow detected" : "Standard injected provider"}
                </div>
              </div>
            </div>
            {activeAccount ? (
              <span className="flex items-center gap-1.5 text-xs font-mono text-emerald-400">
                <CheckCircle2 size={14} /> Connected
              </span>
            ) : connecting === "injected" ? (
              <span className="text-xs text-[#A6DCF8] font-mono animate-pulse">Requesting...</span>
            ) : (
              <span className="text-xs text-[#92929B] group-hover:text-[#F5F5F7]">Connect →</span>
            )}
          </button>

          <button
            onClick={() => {
              setError("WalletConnect relay requires a project ID configured in production .env");
            }}
            className="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#0C0C0C]/50 border border-[#202026] hover:border-[#292930] transition-all group text-left opacity-80 hover:opacity-100"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#181820] border border-[#252530] flex items-center justify-center font-mono text-xs text-[#92929B]">
                WC
              </div>
              <div>
                <div className="text-sm font-medium text-[#F5F5F7]">WalletConnect</div>
                <div className="text-xs text-[#666672]">Mobile Wallets & Hardware Keyrings</div>
              </div>
            </div>
            <span className="text-xs text-[#666672]">Configure</span>
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-[#202026] text-center">
          <p className="text-[11px] text-[#666672] leading-relaxed">
            Cloakroom never requests your private key. You sign structured EIP-712 deposit and intent
            envelopes sealed with HPKE directly to the attested AWS Nitro enclave.
          </p>
        </div>
      </div>
    </div>
  );
}

