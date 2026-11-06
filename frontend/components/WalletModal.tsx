"use client";

import React from "react";
import { X, Wallet, ShieldCheck, AlertCircle } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnect?: () => void;
}

export function WalletModal({ isOpen, onClose, onConnect }: WalletModalProps) {
  const { account, chainId, networkName, connect, disconnect, isConnecting, error } =
    useWallet();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 text-left shadow-2xl font-mono text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
          <div className="flex items-center gap-2">
            <Wallet size={16} className="text-[#3B82F6]" />
            <span className="font-bold text-sm text-[#F0F4F8] font-sans">
              Web3 Connection
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#94A3B8] hover:text-[#F0F4F8] hover:bg-[#1C222B] transition-colors focus:outline-none"
          >
            <X size={16} />
          </button>
        </div>

        {/* Status display */}
        {account ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-xl bg-[#12161D] border border-[#232B36] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#94A3B8]">Connected Network:</span>
                <span className="text-[#F0F4F8] font-semibold">{networkName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#94A3B8]">Account EOA:</span>
                <span className="text-[#3B82F6] font-bold">
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-[#10B981] pt-1">
                <ShieldCheck size={12} />
                <span>EIP-1193 Provider Active</span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                disconnect();
                onClose();
              }}
              className="w-full py-2.5 rounded-xl bg-[#2D1618] border border-[#EF4444]/30 hover:bg-[#3D1D20] text-[#EF4444] font-semibold transition-colors"
            >
              Disconnect Wallet
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-[#94A3B8] leading-relaxed">
              Connect your browser wallet (MetaMask, Coinbase Wallet, or Rabby) to sign cryptographic intents for NONY.
            </p>

            {error && (
              <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/30 text-red-300 flex items-start gap-2">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={async () => {
                const ok = await connect();
                if (ok) {
                  onConnect?.();
                  onClose();
                }
              }}
              disabled={isConnecting}
              className="w-full py-3 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:opacity-50 text-white font-bold tracking-wide transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <Wallet size={15} />
              <span>{isConnecting ? "Connecting to Provider..." : "Connect Browser Wallet"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
