"use client";

import React from "react";
import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface PortfolioOverviewProps {
  totalEstimatedUsd: number;
  availableEth: number;
  allocatedEth: number;
  usdcBalance: number;
  lastUpdated: string;
  onOpenCashOut?: () => void;
  className?: string;
}

export function PortfolioOverview({
  totalEstimatedUsd,
  availableEth,
  allocatedEth,
  usdcBalance,
  lastUpdated,
  className,
}: PortfolioOverviewProps) {
  const totalEth = availableEth + allocatedEth;
  const allocatedEthUsd = allocatedEth * REFERENCE_ETH_PRICE;

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 sm:p-8 space-y-6 font-mono text-left shadow-lg",
        className
      )}
    >
      {/* Top Banner: Valuation & Primary Cash Out Action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 pb-6 border-b border-[#232B36]">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#94A3B8] uppercase tracking-wider font-semibold">
              ESTIMATED PORTFOLIO VALUATION
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1C222B] text-[#3B82F6] font-bold border border-[#232B36]">
              Oracle Ref: ${REFERENCE_ETH_PRICE.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>

          <div className="text-3xl sm:text-4xl font-bold text-[#F0F4F8] tracking-tight font-sans">
            ${totalEstimatedUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            <span className="text-sm font-normal text-[#94A3B8] font-mono">USD</span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-[#505D6E]">
            <Clock size={12} />
            <span>Last Updated: {lastUpdated}</span>
          </div>
        </div>

        {/* Primary Cash Out & Quick Action Buttons */}
        <div className="flex items-center gap-3">
          <Link
            href="/wallet/withdraw"
            className="py-3 px-5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_20px_rgba(59,130,246,0.3)] focus:outline-none cursor-pointer"
          >
            <ArrowUpRight size={15} />
            <span>CASH OUT</span>
          </Link>

          <Link
            href="/deposit"
            className="py-3 px-4 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-xs font-semibold text-[#F0F4F8] uppercase tracking-wider transition-all inline-flex items-center gap-1.5 focus:outline-none"
          >
            <ArrowDownLeft size={14} className="text-[#3B82F6]" />
            <span>DEPOSIT</span>
          </Link>

          <Link
            href="/pool"
            className="py-3 px-4 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#3B82F6]/30 text-xs font-semibold text-[#3B82F6] uppercase tracking-wider transition-all inline-flex items-center gap-1.5 focus:outline-none"
          >
            <Zap size={14} />
            <span>TRADE</span>
          </Link>
        </div>
      </div>

      {/* 4-Column Metric Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        {/* Metric 1 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-medium">
            TOTAL ETH HOLDINGS
          </span>
          <div className="text-lg sm:text-xl font-bold text-[#F0F4F8]">
            {totalEth.toFixed(4)} <span className="text-xs text-[#3B82F6]">ETH</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            ~${(totalEth * REFERENCE_ETH_PRICE).toFixed(2)} USD
          </span>
        </div>

        {/* Metric 2 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-medium">
            AVAILABLE ETH (UNRESERVED)
          </span>
          <div className="text-lg sm:text-xl font-bold text-emerald-400">
            {availableEth.toFixed(4)} <span className="text-xs text-emerald-400">ETH</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Live On-Chain EOA Balance
          </span>
        </div>

        {/* Metric 3 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-medium">
            ACTIVE ORDER ALLOCATION
          </span>
          <div className="text-lg sm:text-xl font-bold text-amber-400">
            {allocatedEth.toFixed(4)} <span className="text-xs text-amber-400">ETH</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Committed to Orders (~${allocatedEthUsd.toFixed(2)})
          </span>
        </div>

        {/* Metric 4 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-medium">
            SETTLED USDC PROCEEDS
          </span>
          <div className="text-lg sm:text-xl font-bold text-[#3B82F6]">
            {usdcBalance.toFixed(2)} <span className="text-xs text-[#3B82F6]">USDC</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            From Executed Trades (~${usdcBalance.toFixed(2)})
          </span>
        </div>
      </div>
    </div>
  );
}
