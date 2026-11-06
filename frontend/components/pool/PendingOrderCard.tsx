"use client";

import React from "react";
import Link from "next/link";
import {
  Clock,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  XCircle,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderRecord } from "@/lib/pool/types";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface PendingOrderCardProps {
  order: PoolOrderRecord;
  onCancelClick?: (order: PoolOrderRecord) => void;
  showControls?: boolean;
  className?: string;
}

export function PendingOrderCard({
  order,
  onCancelClick,
  showControls = true,
  className,
}: PendingOrderCardProps) {
  const isLimit = order.orderType === "LIMIT";
  const isActive =
    order.status === "active_waiting" ||
    order.status === "order_created" ||
    order.status === "submitted";
  const isExecuting = order.status === "condition_met" || order.status === "executing";
  const isCompleted = order.status === "completed";
  const isCancelled = order.status === "cancelled";

  const numericTarget = order.targetPrice ? parseFloat(order.targetPrice) : 0;
  const currentPrice = REFERENCE_ETH_PRICE;
  const priceDistance = numericTarget > 0 ? ((numericTarget - currentPrice) / currentPrice) * 100 : 0;

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
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all hover:border-[#3A4759] shadow-lg",
        className
      )}
    >
      {/* Top Header: Pair, Type & Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-bold text-sm text-[#F0F4F8] tracking-tight">
            {order.tradingPair}
          </span>
          <span
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
              isLimit
                ? "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/40"
                : "bg-purple-950/40 text-purple-400 border-purple-800/40"
            )}
          >
            {isLimit ? "LIMIT" : "MARKET"}
          </span>
          <span className="text-[10px] text-[#505D6E] hidden sm:inline-block">
            {formatDate(order.createdAt)}
          </span>
        </div>

        <div>
          {isActive && (
            <span className="px-2.5 py-0.5 rounded-full bg-amber-950/40 border border-amber-800/40 text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} className="animate-spin" />
              <span>Waiting Trigger</span>
            </span>
          )}
          {isExecuting && (
            <span className="px-2.5 py-0.5 rounded-full bg-[#1C222B] border border-[#3B82F6]/40 text-[10px] font-bold text-[#3B82F6] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-ping" />
              <span>Executing</span>
            </span>
          )}
          {isCompleted && (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-[10px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1">
              <CheckCircle2 size={11} />
              <span>Completed</span>
            </span>
          )}
          {isCancelled && (
            <span className="px-2.5 py-0.5 rounded-full bg-[#1C222B] border border-[#232B36] text-[10px] font-medium text-[#94A3B8] uppercase tracking-wider flex items-center gap-1">
              <XCircle size={11} />
              <span>Cancelled</span>
            </span>
          )}
        </div>
      </div>

      {/* Main Metric Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <span className="text-[10px] text-[#505D6E] uppercase block font-semibold">Sell Committed</span>
          <span className="text-sm font-bold text-[#F0F4F8] mt-0.5 block truncate">
            {order.sellAmount} {order.sellAsset}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <span className="text-[10px] text-[#505D6E] uppercase block font-semibold">
            {isLimit ? "Target Price" : "Reference Rate"}
          </span>
          <span className="text-sm font-bold text-[#3B82F6] mt-0.5 block truncate">
            ${order.targetPrice || "3,200.00"}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <span className="text-[10px] text-[#505D6E] uppercase block font-semibold">Expected Output</span>
          <span className="text-sm font-bold text-emerald-400 mt-0.5 block truncate">
            {order.actualOutput || order.estimatedOutput} {order.buyAsset}
          </span>
        </div>

        <div className="p-3 rounded-xl bg-[#1C222B] border border-[#232B36]">
          <span className="text-[10px] text-[#505D6E] uppercase block font-semibold">
            {isLimit ? "Price Gap" : "Network"}
          </span>
          <span className="text-sm font-semibold text-[#94A3B8] mt-0.5 block truncate">
            {isLimit
              ? `${priceDistance >= 0 ? `+${priceDistance.toFixed(2)}%` : `${priceDistance.toFixed(2)}%`}`
              : order.network || "Sepolia"}
          </span>
        </div>
      </div>

      {/* Footer Strip & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-[#232B36] text-[11px] text-[#94A3B8]">
        <div className="flex items-center gap-2">
          <span>Order ID: <code className="text-[#F0F4F8] font-mono">{order.id.slice(0, 16)}...</code></span>
          <span className="text-[#505D6E]">•</span>
          <span className="text-[#3B82F6] flex items-center gap-1 font-semibold">
            <ShieldCheck size={12} /> TEE Dark Pool
          </span>
        </div>

        {showControls && (
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {isActive && onCancelClick && (
              <button
                type="button"
                onClick={() => onCancelClick(order)}
                className="py-1 px-3 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/40 text-[11px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}

            <Link
              href={`/pool/execution?orderId=${encodeURIComponent(order.id)}`}
              className="py-1 px-3 rounded-lg bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] hover:border-[#3B82F6]/50 text-[#F0F4F8] text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1"
            >
              <span>Manage</span>
              <ArrowRight size={12} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
