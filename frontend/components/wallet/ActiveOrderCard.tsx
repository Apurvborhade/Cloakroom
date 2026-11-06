"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Target, Zap, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderRecord } from "@/lib/pool/types";

interface ActiveOrderCardProps {
  order: PoolOrderRecord;
  className?: string;
}

export function ActiveOrderCard({ order, className }: ActiveOrderCardProps) {
  const isLimit = order.orderType === "LIMIT";

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

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "active_waiting":
        return "Waiting for Target Price";
      case "awaiting_signature":
        return "Awaiting Signature";
      case "funds_reserved":
        return "Funds Reserved";
      case "submitted":
        return "Submitted to Matcher";
      case "processing":
        return "Processing Swap";
      case "cancellation_requested":
        return "Cancellation Requested";
      default:
        return status;
    }
  };

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-5 space-y-4 font-mono text-left transition-all hover:border-[#3B82F6]/50 shadow-lg",
        className
      )}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center border text-[11px]",
              isLimit
                ? "bg-[#3B82F6]/10 border-[#3B82F6]/30 text-[#3B82F6]"
                : "bg-purple-950/30 border-purple-800/30 text-purple-400"
            )}
          >
            {isLimit ? <Target size={12} /> : <Zap size={12} />}
          </div>
          <span className="font-bold text-sm text-[#F0F4F8]">
            {order.tradingPair}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1C222B] text-[#94A3B8] border border-[#232B36] font-semibold">
            {order.orderType}
          </span>
          <span className="text-[10px] text-[#64748B] hidden sm:inline-block">
            {order.id.slice(0, 10)}...
          </span>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] text-[10px] font-semibold uppercase tracking-wider">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
          <span>{getStatusLabel(order.status)}</span>
        </div>
      </div>

      {/* Numerical Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] text-xs">
        <div className="space-y-0.5">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">COMMITTED</span>
          <span className="text-[#F0F4F8] font-bold">
            {order.sellAmount} {order.sellAsset}
          </span>
        </div>

        <div className="space-y-0.5">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">
            {isLimit ? "TARGET PRICE" : "REF PRICE"}
          </span>
          <span className="text-[#3B82F6] font-bold">
            ${order.targetPrice || "3,200.00"}
          </span>
        </div>

        <div className="space-y-0.5">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">EXPECTED PROCEEDS</span>
          <span className="text-[#10B981] font-bold">
            {order.estimatedOutput} {order.buyAsset}
          </span>
        </div>

        <div className="space-y-0.5">
          <span className="text-[10px] text-[#94A3B8] uppercase block font-medium">CREATED</span>
          <span className="text-[#64748B] text-[11px]">{formatDate(order.createdAt)}</span>
        </div>
      </div>

      {/* Footer & Navigation CTA */}
      <div className="flex items-center justify-between pt-1 text-xs">
        <div className="flex items-center gap-1.5 text-[10px] text-[#94A3B8]">
          <ShieldCheck size={12} className="text-[#10B981]" />
          <span>Resting in confidential matching book</span>
        </div>

        <Link
          href={`/pool/execution?orderId=${encodeURIComponent(order.id)}`}
          className="py-1.5 px-3 rounded-lg bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] hover:border-[#3B82F6]/50 text-xs text-[#F0F4F8] hover:text-[#3B82F6] font-semibold transition-all inline-flex items-center gap-1.5 focus:outline-none"
        >
          <span>View Order</span>
          <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
