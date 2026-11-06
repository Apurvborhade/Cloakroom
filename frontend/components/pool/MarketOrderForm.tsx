"use client";

import React, { useState } from "react";
import { ArrowDown, Wallet, AlertCircle } from "lucide-react";
import { MarketQuoteResult } from "@/lib/pool/calculations";
import { AssetSelector, SupportedAsset } from "@/components/AssetSelector";

interface MarketOrderFormProps {
  sellAmount: string;
  onSellAmountChange: (val: string) => void;
  onMaxClick: () => void;
  availableEthBalance: string | null;
  availableUsdcBalance: string | null;
  quote: MarketQuoteResult;
  error?: string | null;
}

export function MarketOrderForm({
  sellAmount,
  onSellAmountChange,
  onMaxClick,
  availableEthBalance,
  availableUsdcBalance,
  quote,
  error,
}: MarketOrderFormProps) {
  const [selectedSellAsset, setSelectedSellAsset] = useState<"ETH" | "USDC">("ETH");

  const handleAmountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, ".");
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      const parts = raw.split(".");
      if (parts[1] && parts[1].length > 18) return;
      onSellAmountChange(raw);
    }
  };

  return (
    <div className="w-full space-y-4 text-left">
      {/* 1. SELL ETH PANEL */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] shadow-lg transition-colors space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#94A3B8] uppercase tracking-wider text-[11px] font-semibold">
            You Sell (Market)
          </span>
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <Wallet size={12} className="text-[#505D6E]" />
            <span>
              {availableEthBalance !== null ? (
                <>
                  <span className="text-[#505D6E]">Avail:</span>{" "}
                  <span className="text-[#F0F4F8] font-semibold">{availableEthBalance} ETH</span>
                </>
              ) : (
                <span className="text-[#505D6E]">Wallet not connected</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <AssetSelector
            selectedSymbol={selectedSellAsset}
            onSelect={(asset: SupportedAsset) => setSelectedSellAsset(asset.symbol)}
          />

          <div className="flex-1 flex items-center justify-end gap-2">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={sellAmount}
              onChange={handleAmountInput}
              className="w-full text-right text-xl sm:text-2xl font-mono font-semibold bg-transparent text-[#F0F4F8] placeholder-[#505D6E] focus:outline-none tracking-tight"
            />
            <button
              type="button"
              onClick={onMaxClick}
              className="px-2.5 py-1 rounded-lg bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[10px] font-mono font-bold text-[#3B82F6] transition-colors shrink-0 uppercase tracking-wider cursor-pointer"
            >
              MAX
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-mono pt-1">
            <AlertCircle size={12} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Directional Connector */}
      <div className="flex justify-center -my-2 relative z-10">
        <div className="w-8 h-8 rounded-full bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] shadow-md">
          <ArrowDown size={14} />
        </div>
      </div>

      {/* 2. BUY USDC PANEL */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] shadow-lg space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#94A3B8] uppercase tracking-wider text-[11px] font-semibold">
            You Receive (Estimated)
          </span>
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <Wallet size={12} className="text-[#505D6E]" />
            <span>
              {availableUsdcBalance !== null ? (
                <>
                  <span className="text-[#505D6E]">Avail:</span>{" "}
                  <span className="text-[#F0F4F8] font-semibold">{availableUsdcBalance} USDC</span>
                </>
              ) : (
                <span className="text-[#505D6E]">0.00 USDC</span>
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-[#1C222B] border border-[#232B36] shrink-0">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center font-bold text-xs bg-[#0F1318] text-[#3B82F6] border border-[#232B36]">
              $
            </div>
            <div>
              <div className="font-bold text-xs text-[#F0F4F8]">USDC</div>
              <div className="text-[10px] text-[#505D6E] leading-none">USD Coin</div>
            </div>
          </div>

          <div className="flex-1 text-right">
            <div className="text-xl sm:text-2xl font-mono font-bold text-[#3B82F6] tracking-tight truncate">
              {quote.estimatedUsdcOutput}
            </div>
          </div>
        </div>
      </div>

      {/* 3. EXECUTION DETAILS BOX */}
      <div className="p-4 rounded-xl bg-[#161B22] border border-[#232B36] shadow-lg font-mono text-xs space-y-2.5">
        <div className="flex items-center justify-between text-[#94A3B8]">
          <span>Prevailing Reference Price:</span>
          <span className="text-[#F0F4F8] font-medium">1 ETH ≈ $3,200.00 USDC</span>
        </div>
        <div className="flex items-center justify-between text-[#94A3B8]">
          <span>Protocol Relayer Fee (0.10%):</span>
          <span className="text-[#F0F4F8]">{quote.feeAmount} ETH</span>
        </div>
        <div className="flex items-center justify-between text-[#94A3B8]">
          <span>Minimum Received (0.5% Slippage):</span>
          <span className="text-emerald-400 font-semibold">{quote.minimumReceived} USDC</span>
        </div>
        <div className="flex items-center justify-between text-[#94A3B8]">
          <span>Estimated Price Impact:</span>
          <span className="text-[#F0F4F8]">{quote.priceImpact}</span>
        </div>
      </div>
    </div>
  );
}
