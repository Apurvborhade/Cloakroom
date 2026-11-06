"use client";

import React, { useState } from "react";
import {
  History,
  Copy,
  Check,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type WalletActivityEntry = {
  id: string;
  source: "POOL" | "MIX" | "DEPOSIT";
  type: string;
  asset: string;
  amount: string;
  counterAmount?: string;
  counterAsset?: string;
  status: "completed" | "active" | "cancelled" | "failed" | "pending";
  timestamp: string;
  txHash?: string | null;
  batchId?: string | null;
  isSimulation: boolean;
};

interface RecentActivityProps {
  activities: WalletActivityEntry[];
  className?: string;
}

type FilterOption = "ALL" | "COMPLETED" | "ACTIVE" | "CANCELLED";

export function RecentActivity({ activities, className }: RecentActivityProps) {
  const [filter, setFilter] = useState<FilterOption>("ALL");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const filtered = activities.filter((item) => {
    if (filter === "ALL") return true;
    if (filter === "COMPLETED") return item.status === "completed";
    if (filter === "ACTIVE") return item.status === "active" || item.status === "pending";
    if (filter === "CANCELLED") return item.status === "cancelled";
    return true;
  });

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div className={cn("space-y-4 font-mono text-left", className)}>
      {/* Title & Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[#232B36]">
        <div className="flex items-center gap-2">
          <History size={14} className="text-[#3B82F6]" />
          <h3 className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
            RECENT ACTIVITY ({activities.length})
          </h3>
        </div>

        {/* Filter Switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
          <button
            type="button"
            onClick={() => setFilter("ALL")}
            className={cn(
              "py-1 px-2.5 rounded-lg border text-[11px] transition-colors",
              filter === "ALL"
                ? "bg-[#3B82F6] border-[#3B82F6] text-[#F0F4F8] font-semibold"
                : "bg-[#161B22] border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8]"
            )}
          >
            All
          </button>

          <button
            type="button"
            onClick={() => setFilter("COMPLETED")}
            className={cn(
              "py-1 px-2.5 rounded-lg border text-[11px] transition-colors",
              filter === "COMPLETED"
                ? "bg-[#3B82F6] border-[#3B82F6] text-[#F0F4F8] font-semibold"
                : "bg-[#161B22] border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8]"
            )}
          >
            Completed
          </button>

          <button
            type="button"
            onClick={() => setFilter("ACTIVE")}
            className={cn(
              "py-1 px-2.5 rounded-lg border text-[11px] transition-colors",
              filter === "ACTIVE"
                ? "bg-[#3B82F6] border-[#3B82F6] text-[#F0F4F8] font-semibold"
                : "bg-[#161B22] border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8]"
            )}
          >
            Active
          </button>

          <button
            type="button"
            onClick={() => setFilter("CANCELLED")}
            className={cn(
              "py-1 px-2.5 rounded-lg border text-[11px] transition-colors",
              filter === "CANCELLED"
                ? "bg-[#3B82F6] border-[#3B82F6] text-[#F0F4F8] font-semibold"
                : "bg-[#161B22] border-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8]"
            )}
          >
            Cancelled
          </button>
        </div>
      </div>

      {/* Activity List */}
      {filtered.length === 0 ? (
        <div className="p-8 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-2 shadow-lg">
          <Inbox size={20} className="text-[#64748B] mx-auto" />
          <div className="text-xs font-semibold text-[#F0F4F8] uppercase tracking-wider">
            NO TRANSACTION RECORDS FOUND
          </div>
          <p className="text-[11px] text-[#94A3B8] max-w-sm mx-auto">
            {filter === "ALL"
              ? "Completed orders, swaps, and confidential privacy batch records will appear here."
              : "No activity records match the selected filter."}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#232B36] bg-[#161B22] overflow-hidden divide-y divide-[#232B36] text-xs shadow-lg">
          {filtered.map((item) => {
            const isCompleted = item.status === "completed";
            const isCancelled = item.status === "cancelled";
            const isActive = item.status === "active" || item.status === "pending";

            return (
              <div
                key={item.id}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#1C222B]/60 transition-colors"
              >
                {/* Left Column: Type, Batch, Hash */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "w-2 h-2 rounded-full",
                        isCompleted && "bg-[#10B981]",
                        isActive && "bg-[#F59E0B] animate-pulse",
                        isCancelled && "bg-[#EF4444]"
                      )}
                    />
                    <span className="font-semibold text-[#F0F4F8]">
                      {item.type}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#3B82F6]/10 text-[#3B82F6] font-semibold border border-[#3B82F6]/30">
                      {item.source}
                    </span>
                    <span
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold",
                        isCompleted && "bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30",
                        isActive && "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30",
                        isCancelled && "bg-[#EF4444]/10 text-[#EF4444] border-[#EF4444]/30"
                      )}
                    >
                      {item.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#94A3B8]">
                    <span>Timestamp: {formatDate(item.timestamp)}</span>
                    {item.batchId && (
                      <span>Batch: {item.batchId}</span>
                    )}
                    {item.txHash && (
                      <div className="flex items-center gap-1">
                        <span>Ref: {item.txHash.slice(0, 8)}...</span>
                        <button
                          type="button"
                          onClick={() => handleCopy(item.id, item.txHash!)}
                          className="hover:text-[#3B82F6] transition-colors"
                          title="Copy hash"
                        >
                          {copiedId === item.id ? (
                            <Check size={11} className="text-[#10B981]" />
                          ) : (
                            <Copy size={11} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Amount & Verification Tag */}
                <div className="text-left sm:text-right space-y-1">
                  <div className="text-sm font-bold text-[#F0F4F8]">
                    {item.amount}
                    {item.counterAmount && (
                      <span className="text-[#10B981] font-semibold">
                        {" "}→ {item.counterAmount}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#64748B] block">
                    {item.isSimulation ? "Sandbox Simulated" : "Verified Enclave Batch"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
