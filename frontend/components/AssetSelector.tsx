"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SupportedAsset {
  symbol: "ETH" | "USDC";
  name: string;
  decimals: number;
  balance?: string | null;
  typeBadge?: string;
}

export const DEFAULT_SUPPORTED_ASSETS: SupportedAsset[] = [
  {
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18,
    typeBadge: "Native L1",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    typeBadge: "ERC-20",
  },
];

interface AssetSelectorProps {
  selectedAsset: "ETH" | "USDC";
  onSelectAsset: (asset: "ETH" | "USDC") => void;
  supportedAssets?: SupportedAsset[];
  balances?: {
    ETH?: string | null;
    USDC?: string | null;
  };
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}

export function AssetSelector({
  selectedAsset = "ETH",
  onSelectAsset,
  supportedAssets = DEFAULT_SUPPORTED_ASSETS,
  balances,
  disabled = false,
  className,
  size = "md",
}: AssetSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;

    if (e.key === "Escape") {
      setIsOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      if (!isOpen) {
        e.preventDefault();
        setIsOpen(true);
      }
    }
  };

  const currentAsset =
    supportedAssets.find((a) => a.symbol === selectedAsset) ||
    supportedAssets[0] ||
    DEFAULT_SUPPORTED_ASSETS[0];

  const renderIcon = (symbol: "ETH" | "USDC", iconSize: number = 18) => {
    if (symbol === "ETH") {
      return (
        <div
          className="w-6 h-6 rounded-full bg-[#E7F3FA] border border-[#CDE5F3] flex items-center justify-center shrink-0"
          aria-hidden="true"
        >
          <svg
            width={iconSize - 4}
            height={iconSize - 4}
            viewBox="0 0 24 24"
            fill="none"
            className="text-[#377FA5]"
          >
            <path
              d="M11.999 1.25L5.75 12.196L11.999 15.894L18.246 12.196L11.999 1.25Z"
              fill="currentColor"
              fillOpacity="0.9"
            />
            <path
              d="M11.999 17.086L5.75 13.388L11.999 22.75L18.248 13.388L11.999 17.086Z"
              fill="currentColor"
              fillOpacity="0.75"
            />
          </svg>
        </div>
      );
    }
    return (
      <div
        className="w-6 h-6 rounded-full bg-[#2775CA]/10 border border-[#2775CA]/25 flex items-center justify-center text-[#2775CA] font-bold text-[11px] shrink-0 font-sans"
        aria-hidden="true"
      >
        $
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block text-left", className)}
      onKeyDown={handleKeyDown}
    >
      {/* Selected Asset Pill Button */}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2.5 px-3 py-1.5 rounded-xl border bg-white text-[#17191D] font-mono transition-all select-none shadow-xs",
          isOpen
            ? "border-[#377FA5] ring-2 ring-[#377FA5]/15"
            : "border-[#E3E6EB] hover:border-[#CBD1D9] hover:bg-[#F7F8FA]",
          disabled && "opacity-60 cursor-not-allowed hover:bg-white border-[#E3E6EB]",
          size === "sm" && "px-2.5 py-1 text-xs",
          size === "md" && "px-3.5 py-1.5 text-xs",
          size === "lg" && "px-4 py-2 text-sm"
        )}
      >
        {renderIcon(currentAsset.symbol)}

        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1.5 font-bold tracking-tight">
            <span>{currentAsset.symbol}</span>
            <ChevronDown
              size={13}
              className={cn(
                "text-[#626A75] transition-transform duration-150",
                isOpen && "transform rotate-180 text-[#377FA5]"
              )}
            />
          </div>
        </div>
      </button>

      {/* Accessible Dropdown Popover */}
      {isOpen && (
        <div
          role="listbox"
          tabIndex={-1}
          aria-label="Supported assets"
          className="absolute left-0 mt-2 w-64 rounded-xl bg-white border border-[#E3E6EB] shadow-xl z-50 p-1.5 animate-in fade-in zoom-in-95 duration-100"
        >
          <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-[#9299A3] border-b border-[#E3E6EB] mb-1 font-semibold flex items-center justify-between">
            <span>Select Supported Asset</span>
            <span className="text-[#377FA5]">ETH Default</span>
          </div>

          <div className="space-y-0.5">
            {supportedAssets.map((asset) => {
              const isSelected = asset.symbol === selectedAsset;
              const assetBalance =
                balances?.[asset.symbol] !== undefined
                  ? balances[asset.symbol]
                  : asset.balance;

              return (
                <button
                  key={asset.symbol}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onSelectAsset(asset.symbol);
                    setIsOpen(false);
                    buttonRef.current?.focus();
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-2 rounded-lg text-left transition-colors font-mono text-xs",
                    isSelected
                      ? "bg-[#E7F3FA] text-[#17191D] font-semibold"
                      : "hover:bg-[#F7F8FA] text-[#17191D]"
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    {renderIcon(asset.symbol)}
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[#17191D]">
                          {asset.symbol}
                        </span>
                        {asset.typeBadge && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#F0F2F5] text-[#626A75] uppercase border border-[#E3E6EB]">
                            {asset.typeBadge}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#626A75] font-sans">
                        {asset.name}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {assetBalance !== undefined && assetBalance !== null && (
                      <div className="text-right text-[11px] text-[#626A75]">
                        <div className="text-[#17191D] font-medium">
                          {assetBalance}
                        </div>
                      </div>
                    )}
                    {isSelected && (
                      <Check size={14} className="text-[#377FA5] shrink-0" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-1 px-2.5 py-1.5 bg-[#F7F8FA] rounded-lg border border-[#E3E6EB] text-[10px] text-[#626A75] font-sans leading-tight">
            Ethereum (ETH) is default. Supported operations route through verified smart contracts.
          </div>
        </div>
      )}
    </div>
  );
}
