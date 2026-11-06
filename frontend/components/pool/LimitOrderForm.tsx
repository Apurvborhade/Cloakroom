"use client";

import React, { useState } from "react";
import { Wallet, Target, Clock, ShieldCheck, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { LimitQuoteResult } from "@/lib/pool/calculations";
import { AssetSelector, SupportedAsset } from "@/components/AssetSelector";

interface LimitOrderFormProps {
  sellAmount: string;
  onSellAmountChange: (val: string) => void;
  targetPrice: string;
  onTargetPriceChange: (val: string) => void;
  expiryDuration: string;
  onExpiryDurationChange: (val: string) => void;
  onMaxClick: () => void;
  availableEthBalance: string | null;
  quote: LimitQuoteResult;
  amountError?: string | null;
  priceError?: string | null;
}

export function LimitOrderForm({
  sellAmount,
  onSellAmountChange,
  targetPrice,
  onTargetPriceChange,
  expiryDuration,
  onExpiryDurationChange,
  onMaxClick,
  availableEthBalance,
  quote,
  amountError,
  priceError,
}: LimitOrderFormProps) {
  const [selectedSellAsset, setSelectedSellAsset] = useState<"ETH" | "USDC">("ETH");

  const handleAmountInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, ".");
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      const parts = raw.split(".");
      if (parts[1] && parts[1].length > 18) return;
      onSellAmountChange(raw);
    }
  };

  const handlePriceInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, ".");
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      onTargetPriceChange(raw);
    }
  };

  const setPresetPrice = (multiplier: number) => {
    const preset = 3200 * multiplier;
    onTargetPriceChange(preset.toFixed(2));
  };

  return (
    <div className="w-full space-y-4 text-left">
      {/* 1. SELL ETH PANEL */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] hover:border-[#3A4759] shadow-lg transition-colors space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#94A3B8] uppercase tracking-wider text-[11px] font-semibold">
            You Sell (Quantity)
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

        {amountError && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-mono pt-1">
            <AlertCircle size={12} className="shrink-0" />
            <span>{amountError}</span>
          </div>
        )}
      </div>

      {/* 2. TARGET LIMIT PRICE PANEL */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#161B22] border border-[#232B36] shadow-lg space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-[#94A3B8] uppercase tracking-wider text-[11px] font-semibold flex items-center gap-1.5">
            <Target size={13} className="text-[#3B82F6]" />
            <span>Target Price Condition (USDC per 1 ETH)</span>
          </span>
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
              quote.isAboveMarket
                ? "bg-emerald-950/40 text-emerald-400 border-emerald-800/40"
                : "bg-amber-950/40 text-amber-400 border-amber-800/40"
            )}
          >
            {quote.priceDeltaPercent >= 0 ? "+" : ""}
            {quote.priceDeltaPercent.toFixed(2)}% vs Market
          </span>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-[#505D6E]">$</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="3,500.00"
              value={targetPrice}
              onChange={handlePriceInput}
              className="w-full text-left text-xl sm:text-2xl font-mono font-semibold bg-transparent text-[#F0F4F8] placeholder-[#505D6E] focus:outline-none tracking-tight"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setPresetPrice(1.05)}
              className="px-2 py-1 rounded-md bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[10px] font-mono text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              +5%
            </button>
            <button
              type="button"
              onClick={() => setPresetPrice(1.1)}
              className="px-2 py-1 rounded-md bg-[#1C222B] hover:bg-[#232B36] border border-[#3B82F6]/40 text-[10px] font-mono text-[#3B82F6] transition-colors font-bold"
            >
              +10%
            </button>
            <button
              type="button"
              onClick={() => setPresetPrice(1.2)}
              className="px-2 py-1 rounded-md bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[10px] font-mono text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
            >
              +20%
            </button>
          </div>
        </div>

        {priceError && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-mono pt-1">
            <AlertCircle size={12} className="shrink-0" />
            <span>{priceError}</span>
          </div>
        )}
      </div>

      {/* 3. EXPECTED OUTPUT & VALIDITY PANEL */}
      <div className="p-4 rounded-xl bg-[#161B22] border border-[#232B36] shadow-lg font-mono text-xs space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[#94A3B8]">Expected USDC at Target:</span>
          <span className="text-[#3B82F6] font-bold text-base">
            ${quote.expectedUsdcOutput} USDC
          </span>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-[#232B36]">
          <span className="text-[#94A3B8] flex items-center gap-1.5">
            <Clock size={12} />
            <span>Order Expiry:</span>
          </span>
          <div className="flex items-center gap-1 text-[10px]">
            {["24 Hours", "7 Days", "GTC"].map((dur) => (
              <button
                key={dur}
                type="button"
                onClick={() => onExpiryDurationChange(dur)}
                className={cn(
                  "px-2.5 py-0.5 rounded border transition-colors cursor-pointer",
                  expiryDuration === dur
                    ? "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6] font-bold"
                    : "bg-[#0F1318] text-[#505D6E] border-[#232B36] hover:text-[#94A3B8]"
                )}
              >
                {dur}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 4. TRIGGER NOTICE */}
      <div className="p-3.5 rounded-xl bg-[#0F1318] border border-[#232B36] text-xs text-[#94A3B8] leading-relaxed flex items-start gap-2.5 font-sans">
        <ShieldCheck size={16} className="text-[#3B82F6] shrink-0 mt-0.5" />
        <div>
          <strong className="text-[#F0F4F8]">Conditional Enclave Matching:</strong> Limit orders are held in private enclave memory until ETH market price hits or exceeds your target (${targetPrice} USDC). You may cancel this order at any time to release your committed ETH.
        </div>
      </div>
    </div>
  );
}
