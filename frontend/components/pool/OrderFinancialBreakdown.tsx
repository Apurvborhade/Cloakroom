"use client";

import React from "react";
import { Coins, Wallet, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderRecord } from "@/lib/pool/types";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface OrderFinancialBreakdownProps {
  order: PoolOrderRecord;
  availableEthBalance: string | null;
  className?: string;
}

export function OrderFinancialBreakdown({
  order,
  availableEthBalance,
  className,
}: OrderFinancialBreakdownProps) {
  const isCompleted = order.status === "completed";
  const numericSell = parseFloat(order.sellAmount || "0");
  const referenceValueUsd = numericSell * REFERENCE_ETH_PRICE;

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
          <Coins size={14} className="text-[#3B82F6]" />
          <span className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
            FINANCIAL ALLOCATION & BALANCE BREAKDOWN
          </span>
        </div>
        <span className="text-[10px] text-[#505D6E] uppercase">
          Standard Token Decimals (ETH: 18 • USDC: 6)
        </span>
      </div>

      {/* Grid of Financial Items */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
        {/* Item 1: Initial ETH Committed */}
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            INITIAL ETH COMMITTED
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-[#F0F4F8]">
              {order.sellAmount} ETH
            </span>
            <span className="text-[11px] text-[#94A3B8]">
              ~${referenceValueUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Gross input committed to this order session
          </span>
        </div>

        {/* Item 2: USDC Committed */}
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            USDC COMMITTED (INPUT)
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-[#505D6E]">
              0.00 USDC
            </span>
            <span className="text-[11px] text-[#505D6E]">N/A (ETH Sell)</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Zero USDC committed as input for this trade direction
          </span>
        </div>

        {/* Item 3: ETH Expected */}
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            ETH EXPECTED / PURCHASED
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-[#505D6E]">
              0.0000 ETH
            </span>
            <span className="text-[11px] text-[#505D6E]">Source Asset Sold</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Order sells ETH in exchange for USDC proceeds
          </span>
        </div>

        {/* Item 4: USDC Expected */}
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            {isCompleted ? "USDC EXECUTED (SETTLED)" : "USDC EXPECTED PROCEEDS"}
          </span>
          <div className="flex items-baseline justify-between">
            <span className={cn("text-base font-bold", isCompleted ? "text-emerald-400" : "text-[#3B82F6]")}>
              {order.actualOutput || order.estimatedOutput} USDC
            </span>
            <span className="text-[11px] text-[#94A3B8]">
              {isCompleted ? "Confirmed Cleared" : "Pending Trigger"}
            </span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            {isCompleted ? "Credited to destination EOA" : "Quote at 0.10% relayer fee"}
          </span>
        </div>

        {/* Item 5: Current Allocation */}
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            CURRENT ALLOCATION IN ORDER
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-[#F0F4F8]">
              {order.sellAmount} ETH
            </span>
            <span className="text-[11px] text-amber-400 font-medium">
              {order.status === "completed" ? "Settled" : order.status === "cancelled" ? "Unreserved" : "Reserved in Session"}
            </span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Active size resting in confidential matcher
          </span>
        </div>

        {/* Item 6: Protocol Fee */}
        <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            ESTIMATED RELAYER FEE
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-base font-bold text-[#F0F4F8]">
              {order.feeAmount || "0.001"} ETH
            </span>
            <span className="text-[11px] text-[#94A3B8]">0.10% (10 bps)</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Deducted atomically upon settlement
          </span>
        </div>
      </div>

      {/* Item 7: Wallet Balance */}
      <div className="p-4 rounded-xl bg-[#1C222B] border border-[#3B82F6]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#0F1318] border border-[#232B36] flex items-center justify-center text-[#3B82F6]">
            <Wallet size={15} />
          </div>
          <div>
            <span className="text-[#F0F4F8] font-semibold block">
              Remaining Available Wallet Balance:
            </span>
            <span className="text-[10px] text-[#94A3B8]">
              Live read from connected Web3 provider (unreserved funds)
            </span>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <div className="text-base font-bold text-[#F0F4F8]">
            {availableEthBalance !== null ? `${availableEthBalance} ETH` : "—"}
          </div>
          <span className="text-[10px] text-emerald-400 font-semibold">Unreserved Balance</span>
        </div>
      </div>

      {/* Notice */}
      <div className="flex items-center gap-2 text-[10px] text-[#505D6E] pt-1">
        <Info size={12} className="shrink-0" />
        <span>
          Data Integrity Notice: Reference valuation reflects $3,200.00 USDC per 1 ETH demo benchmark. Reserved order allocations remain non-custodial and can be cancelled unconditionally prior to fill.
        </span>
      </div>
    </div>
  );
}
