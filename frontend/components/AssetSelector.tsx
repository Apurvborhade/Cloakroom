"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SupportedAsset {
  symbol: "ETH" | "USDC";
  name: string;
  decimals: number;
  type: "Native L1" | "ERC-20";
  balance?: string;
}

export const SUPPORTED_ASSETS: SupportedAsset[] = [
  {
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    type: "Native L1",
    balance: "1.0000",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    type: "ERC-20",
    balance: "0.00",
  },
];

interface AssetSelectorProps {
  selectedSymbol: "ETH" | "USDC";
  onSelect: (asset: SupportedAsset) => void;
  balances?: {
    ETH?: string;
    USDC?: string;
  };
  label?: string;
  className?: string;
  disabled?: boolean;
}

export function AssetSelector({
  selectedSymbol = "ETH",
  onSelect,
  balances,
  label,
  className,
  disabled = false,
}: AssetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedAsset =
    SUPPORTED_ASSETS.find((a) => a.symbol === selectedSymbol) || SUPPORTED_ASSETS[0];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  return (
    <div className={cn("relative inline-block font-mono text-left", className)} ref={containerRef}>
      {/* Trigger Button: [ETH icon] ETH ▼ */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all focus:outline-none focus:ring-1 focus:ring-[#3B82F6]",
          disabled
            ? "opacity-50 cursor-not-allowed bg-[#161B22] border-[#232B36] text-[#64748B]"
            : "bg-[#1C222B] hover:bg-[#232B36] border-[#232B36] text-[#F0F4F8]"
        )}
      >
        <div className="w-5 h-5 rounded-full bg-[#161B22] border border-[#232B36] flex items-center justify-center font-bold text-[10px] shrink-0 text-[#3B82F6]">
          {selectedAsset.symbol === "ETH" ? "Ξ" : "$"}
        </div>
        <span className="font-bold tracking-tight text-[#F0F4F8]">
          {selectedAsset.symbol}
        </span>
        <ChevronDown
          size={13}
          className={cn(
            "text-[#94A3B8] transition-transform duration-200",
            isOpen && "rotate-180 text-[#3B82F6]"
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          className="absolute right-0 mt-1.5 w-60 rounded-xl bg-[#161B22] border border-[#232B36] shadow-2xl z-50 p-1.5 space-y-1 animate-fade-in"
        >
          <div className="px-2.5 py-1 text-[10px] font-semibold text-[#64748B] uppercase tracking-wider border-b border-[#232B36] mb-1">
            Supported Protocol Assets
          </div>

          {SUPPORTED_ASSETS.map((asset) => {
            const isSelected = asset.symbol === selectedAsset.symbol;

            return (
              <button
                key={asset.symbol}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(asset);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between p-2 rounded-lg text-left transition-colors text-xs",
                  isSelected
                    ? "bg-[#1C222B] border border-[#3B82F6]/30 text-[#F0F4F8]"
                    : "hover:bg-[#1C222B] text-[#94A3B8] hover:text-[#F0F4F8]"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs border",
                      asset.symbol === "ETH"
                        ? "bg-[#0F1318] border-[#232B36] text-[#3B82F6]"
                        : "bg-[#0F1318] border-[#232B36] text-[#10B981]"
                    )}
                  >
                    {asset.symbol === "ETH" ? "Ξ" : "$"}
                  </div>
                  <div>
                    <div className="font-bold text-xs text-[#F0F4F8] leading-tight flex items-center gap-1.5">
                      <span>{asset.name}</span>
                      <span className="text-[10px] text-[#64748B] font-normal">
                        ({asset.symbol})
                      </span>
                    </div>
                    <div className="text-[10px] text-[#64748B]">
                      {asset.type} • {asset.decimals} Decimals
                      {balances && balances[asset.symbol] ? ` • ${balances[asset.symbol]} available` : ""}
                    </div>
                  </div>
                </div>

                {isSelected && (
                  <Check size={14} className="text-[#3B82F6] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
