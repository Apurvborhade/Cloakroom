"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface ComparisonRow {
  attribute: string;
  mix: string;
  pool: string;
}

const COMPARISON_DATA: ComparisonRow[] = [
  {
    attribute: "Primary purpose",
    mix: "Privacy-oriented pooled execution",
    pool: "Conditional asset exchange",
  },
  {
    attribute: "Interface",
    mix: "Stake and balance allocation",
    pool: "Swap interface",
  },
  {
    attribute: "Asset interaction",
    mix: "Private pool workflow",
    pool: "ETH / USDC conversion",
  },
  {
    attribute: "Next step",
    mix: "Stake configuration",
    pool: "Exchange configuration",
  },
];

export function ModeComparison({
  selectedMode,
  onSelectMode,
}: {
  selectedMode: "MIX" | "POOL" | null;
  onSelectMode?: (mode: "MIX" | "POOL") => void;
}) {
  return (
    <section className="w-full mt-12 text-left">
      <div className="mb-4">
        <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#3B82F6] uppercase mb-1">
          COMPARISON MATRIX
        </div>
        <h3 className="text-base sm:text-lg font-bold tracking-tight text-[#F0F4F8]">
          UNDERSTANDING THE MODES
        </h3>
        <p className="text-xs text-[#94A3B8] mt-1">
          Architectural distinction between private enclave batch pooling and conditional order execution.
        </p>
      </div>

      {/* Desktop Table View (sm and up) */}
      <div className="hidden sm:block rounded-xl border border-[#232B36] bg-[#161B22] overflow-hidden">
        <div className="grid grid-cols-12 text-[11px] font-mono uppercase tracking-wider text-[#94A3B8] bg-[#1C222B] border-b border-[#232B36] py-3 px-5">
          <div className="col-span-4 font-semibold">Attribute</div>
          <div
            onClick={() => onSelectMode?.("MIX")}
            className={cn(
              "col-span-4 cursor-pointer transition-colors flex items-center gap-1.5",
              selectedMode === "MIX" ? "text-[#3B82F6] font-bold" : "hover:text-[#F0F4F8]"
            )}
          >
            <span>MIX</span>
            {selectedMode === "MIX" && (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#3B82F6]/10 border border-[#3B82F6]/30">
                ACTIVE
              </span>
            )}
          </div>
          <div
            onClick={() => onSelectMode?.("POOL")}
            className={cn(
              "col-span-4 cursor-pointer transition-colors flex items-center gap-1.5",
              selectedMode === "POOL" ? "text-[#3B82F6] font-bold" : "hover:text-[#F0F4F8]"
            )}
          >
            <span>POOL</span>
            {selectedMode === "POOL" && (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#3B82F6]/10 border border-[#3B82F6]/30">
                ACTIVE
              </span>
            )}
          </div>
        </div>

        <div className="divide-y divide-[#232B36]">
          {COMPARISON_DATA.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 text-xs py-3.5 px-5 hover:bg-[#1C222B]/60 transition-colors items-center"
            >
              <div className="col-span-4 font-mono text-[11px] text-[#94A3B8]">
                {row.attribute}
              </div>
              <div
                className={cn(
                  "col-span-4 transition-colors font-medium",
                  selectedMode === "MIX" ? "text-[#3B82F6]" : "text-[#F0F4F8]"
                )}
              >
                {row.mix}
              </div>
              <div
                className={cn(
                  "col-span-4 transition-colors font-medium",
                  selectedMode === "POOL" ? "text-[#3B82F6]" : "text-[#F0F4F8]"
                )}
              >
                {row.pool}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile Stacked View */}
      <div className="sm:hidden space-y-3">
        {COMPARISON_DATA.map((row, idx) => (
          <div
            key={idx}
            className="p-4 rounded-xl bg-[#161B22] border border-[#232B36] space-y-2 text-xs"
          >
            <div className="font-mono text-[11px] text-[#94A3B8] uppercase">
              {row.attribute}
            </div>
            <div className="flex items-start justify-between gap-4 pt-1 border-t border-[#232B36]">
              <div className="space-y-0.5">
                <div className="font-mono text-[10px] text-[#505D6E] uppercase">
                  MIX
                </div>
                <div
                  className={cn(
                    "text-xs",
                    selectedMode === "MIX" ? "text-[#3B82F6] font-semibold" : "text-[#F0F4F8]"
                  )}
                >
                  {row.mix}
                </div>
              </div>
              <div className="space-y-0.5 text-right">
                <div className="font-mono text-[10px] text-[#505D6E] uppercase">
                  POOL
                </div>
                <div
                  className={cn(
                    "text-xs",
                    selectedMode === "POOL" ? "text-[#3B82F6] font-semibold" : "text-[#F0F4F8]"
                  )}
                >
                  {row.pool}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
