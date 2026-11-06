"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface FinancialSummaryProps {
  totalDepositedEth?: string | null;
  totalSwappedEth: string;
  ethPurchased: string;
  usdcRemaining: string;
  ethRemaining: string;
  activeAllocationEth: string;
  totalFeesEth: string;
  totalWithdrawn?: string | null;
  className?: string;
}

export function FinancialSummary({
  totalDepositedEth,
  totalSwappedEth,
  ethPurchased,
  usdcRemaining,
  ethRemaining,
  activeAllocationEth,
  totalFeesEth,
  totalWithdrawn,
  className,
}: FinancialSummaryProps) {
  const summaryRows = [
    {
      metric: "Total Deposited",
      meaning: "Verified amount deposited",
      value: totalDepositedEth ? `${totalDepositedEth} ETH` : "Unavailable",
      isUnavailable: !totalDepositedEth,
      note: totalDepositedEth ? "Screen 2 allocation intent" : "Historical L1 deposit log requires indexer",
    },
    {
      metric: "Total Swapped",
      meaning: "Verified amount exchanged",
      value: `${totalSwappedEth} ETH`,
      isUnavailable: false,
      note: "Gross volume processed across completed orders",
    },
    {
      metric: "ETH Purchased",
      meaning: "Verified ETH received through swaps",
      value: `${ethPurchased} ETH`,
      isUnavailable: false,
      note: "Total incoming ETH acquired through executed trades",
    },
    {
      metric: "USDC Remaining",
      meaning: "Actual USDC balance",
      value: `${usdcRemaining} USDC`,
      isUnavailable: false,
      note: "Current settled USDC proceeds in portfolio",
    },
    {
      metric: "ETH Remaining",
      meaning: "Actual ETH balance",
      value: `${ethRemaining} ETH`,
      isUnavailable: false,
      note: "Live unreserved on-chain EOA balance",
    },
    {
      metric: "Active Allocation",
      meaning: "Funds committed to active orders",
      value: `${activeAllocationEth} ETH`,
      isUnavailable: false,
      note: "Capital reserved in open Market or Limit orders",
    },
    {
      metric: "Total Fees",
      meaning: "Verified protocol & relayer fees",
      value: `${totalFeesEth} ETH`,
      isUnavailable: false,
      note: "0.10% relayer fees assessed across executed trades",
    },
    {
      metric: "Total Withdrawn",
      meaning: "Verified withdrawal history",
      value: totalWithdrawn ? `${totalWithdrawn} ETH` : "Unavailable",
      isUnavailable: !totalWithdrawn,
      note: "Withdrawal gateway accessible via /wallet/withdraw",
    },
  ];

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-4 font-mono text-left shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
        <h3 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
          FINANCIAL ACCOUNTING SUMMARY
        </h3>
        <span className="text-[10px] text-[#64748B] uppercase">
          Verifiable Metrics Ledger
        </span>
      </div>

      {/* Table / Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead>
            <tr className="border-b border-[#232B36] text-[10px] text-[#64748B] uppercase tracking-wider">
              <th className="py-2.5 px-3 font-semibold">Metric</th>
              <th className="py-2.5 px-3 hidden sm:table-cell font-semibold">Meaning</th>
              <th className="py-2.5 px-3 text-right font-semibold">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#232B36]">
            {summaryRows.map((row) => (
              <tr key={row.metric} className="hover:bg-[#1C222B]/60 transition-colors">
                <td className="py-3 px-3 font-semibold text-[#F0F4F8]">
                  {row.metric}
                  <span className="block text-[10px] text-[#64748B] sm:hidden mt-0.5">
                    {row.meaning}
                  </span>
                </td>
                <td className="py-3 px-3 text-[#94A3B8] text-[11px] hidden sm:table-cell">
                  {row.meaning}
                </td>
                <td className="py-3 px-3 text-right font-bold">
                  <span
                    className={cn(
                      row.isUnavailable ? "text-[#64748B] font-normal" : "text-[#3B82F6]"
                    )}
                  >
                    {row.value}
                  </span>
                  <span className="block text-[9px] text-[#64748B] font-normal">
                    {row.note}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
