"use client";

import React from "react";
import { PieChart } from "lucide-react";
import { cn } from "@/lib/utils";

interface PortfolioDistributionProps {
  availableEthUsd: number;
  allocatedEthUsd: number;
  usdcBalanceUsd: number;
  className?: string;
}

export function PortfolioDistribution({
  availableEthUsd,
  allocatedEthUsd,
  usdcBalanceUsd,
  className,
}: PortfolioDistributionProps) {
  const totalValuation = availableEthUsd + allocatedEthUsd + usdcBalanceUsd;

  const availableEthPct =
    totalValuation > 0 ? ((availableEthUsd / totalValuation) * 100).toFixed(1) : "0.0";
  const allocatedEthPct =
    totalValuation > 0 ? ((allocatedEthUsd / totalValuation) * 100).toFixed(1) : "0.0";
  const usdcPct =
    totalValuation > 0 ? ((usdcBalanceUsd / totalValuation) * 100).toFixed(1) : "0.0";

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 font-mono text-left shadow-lg",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
        <div className="flex items-center gap-2">
          <PieChart size={14} className="text-[#3B82F6]" />
          <h3 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
            PORTFOLIO BREAKDOWN
          </h3>
        </div>
        <span className="text-[10px] text-[#64748B] uppercase">
          Capital Distribution by Commitment
        </span>
      </div>

      {/* Segmented Distribution Bar */}
      <div className="space-y-2">
        <div className="w-full h-3 rounded-full bg-[#1C222B] overflow-hidden flex p-0.5 border border-[#232B36]">
          {parseFloat(availableEthPct) > 0 && (
            <div
              className="h-full bg-[#10B981] rounded-l-full transition-all duration-500"
              style={{ width: `${availableEthPct}%` }}
              title={`Available ETH: ${availableEthPct}%`}
            />
          )}
          {parseFloat(allocatedEthPct) > 0 && (
            <div
              className="h-full bg-[#F59E0B] transition-all duration-500"
              style={{ width: `${allocatedEthPct}%` }}
              title={`Allocated in Orders: ${allocatedEthPct}%`}
            />
          )}
          {parseFloat(usdcPct) > 0 && (
            <div
              className="h-full bg-[#3B82F6] rounded-r-full transition-all duration-500"
              style={{ width: `${usdcPct}%` }}
              title={`USDC Holdings: ${usdcPct}%`}
            />
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#94A3B8] pt-1">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981]" />
            <span>Available ETH ({availableEthPct}%)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B]" />
            <span>Active Order Allocations ({allocatedEthPct}%)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6]" />
            <span>USDC Proceeds ({usdcPct}%)</span>
          </div>
        </div>
      </div>

      {/* Detailed Numerical Breakdown Table */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-[#232B36] text-xs">
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">
            AVAILABLE CAPITAL (ETH)
          </span>
          <div className="text-sm font-bold text-[#10B981]">
            ${availableEthUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#64748B] block">
            Unrestricted live balance
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">
            ORDER COMMITMENTS
          </span>
          <div className="text-sm font-bold text-[#F59E0B]">
            ${allocatedEthUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#64748B] block">
            Reserved in matching contracts
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">
            SETTLED PROCEEDS (USDC)
          </span>
          <div className="text-sm font-bold text-[#3B82F6]">
            ${usdcBalanceUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] text-[#64748B] block">
            Cleared trade proceeds
          </span>
        </div>
      </div>
    </div>
  );
}
