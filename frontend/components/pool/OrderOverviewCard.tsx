"use client";

import React, { useState } from "react";
import {
  Copy,
  Check,
  Zap,
  Target,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderRecord, PoolExecutionState } from "@/lib/pool/types";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface OrderOverviewCardProps {
  order: PoolOrderRecord;
  className?: string;
}

export function OrderOverviewCard({ order, className }: OrderOverviewCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(order.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const isLimit = order.orderType === "LIMIT";

  const getStatusDisplay = (status: PoolExecutionState) => {
    switch (status) {
      case "preparing":
        return {
          label: "Preparing Order",
          color: "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/40",
          icon: <Loader2 size={13} className="animate-spin text-[#3B82F6]" />,
        };
      case "awaiting_signature":
        return {
          label: "Awaiting Signature",
          color: "bg-amber-950/40 text-amber-400 border-amber-800/40",
          icon: <Clock size={13} className="text-amber-400 animate-pulse" />,
        };
      case "submitted":
        return {
          label: "Order Submitted",
          color: "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/40",
          icon: <Loader2 size={13} className="animate-spin text-[#3B82F6]" />,
        };
      case "processing":
        return {
          label: "Processing Match",
          color: "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/40",
          icon: <Loader2 size={13} className="animate-spin text-[#3B82F6]" />,
        };
      case "funds_reserved":
        return {
          label: "Funds Reserved",
          color: "bg-amber-950/40 text-amber-400 border-amber-800/40",
          icon: <Clock size={13} className="text-amber-400" />,
        };
      case "active_waiting":
        return {
          label: "Waiting for Target Price",
          color: "bg-amber-950/40 text-amber-400 border-amber-800/40",
          icon: <TrendingUp size={13} className="text-amber-400 animate-pulse" />,
        };
      case "condition_met":
        return {
          label: "Target Price Reached",
          color: "bg-emerald-950/40 text-emerald-400 border-emerald-800/40",
          icon: <Zap size={13} className="text-emerald-400 animate-bounce" />,
        };
      case "executing":
        return {
          label: "Executing Settlement",
          color: "bg-[#1C222B] text-[#3B82F6] border-[#3B82F6]/40",
          icon: <Loader2 size={13} className="animate-spin text-[#3B82F6]" />,
        };
      case "completed":
        return {
          label: "Execution Confirmed",
          color: "bg-emerald-950/40 text-emerald-400 border-emerald-800/40",
          icon: <CheckCircle2 size={13} className="text-emerald-400" />,
        };
      case "cancellation_requested":
        return {
          label: "Cancellation Requested",
          color: "bg-amber-950/40 text-amber-400 border-amber-800/40",
          icon: <Loader2 size={13} className="animate-spin text-amber-400" />,
        };
      case "cancelled":
        return {
          label: "Order Cancelled",
          color: "bg-[#1C222B] text-[#94A3B8] border-[#232B36]",
          icon: <XCircle size={13} className="text-[#94A3B8]" />,
        };
      case "failed":
        return {
          label: "Execution Failed",
          color: "bg-rose-950/40 text-rose-400 border-rose-800/40",
          icon: <AlertTriangle size={13} className="text-rose-400" />,
        };
      case "expired":
        return {
          label: "Order Expired",
          color: "bg-[#1C222B] text-[#505D6E] border-[#232B36]",
          icon: <Clock size={13} className="text-[#505D6E]" />,
        };
      default:
        return {
          label: "Pending",
          color: "bg-[#1C222B] text-[#94A3B8] border-[#232B36]",
          icon: <Clock size={13} />,
        };
    }
  };

  const statusInfo = getStatusDisplay(order.status);

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  const numericTarget = order.targetPrice ? parseFloat(order.targetPrice) : 0;
  const currentPrice = REFERENCE_ETH_PRICE;
  const priceSpread = numericTarget > 0 ? ((numericTarget - currentPrice) / currentPrice) * 100 : 0;

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 font-mono text-left shadow-lg",
        className
      )}
    >
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#232B36]">
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "w-7 h-7 rounded-lg flex items-center justify-center border",
              isLimit
                ? "bg-[#1C222B] border-[#3B82F6]/40 text-[#3B82F6]"
                : "bg-[#1C222B] border-purple-500/40 text-purple-400"
            )}
          >
            {isLimit ? <Target size={14} /> : <Zap size={14} />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-[#F0F4F8] tracking-wider uppercase">
                {isLimit ? "LIMIT CONDITIONAL ORDER" : "MARKET SWAP ORDER"}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#1C222B] text-[#94A3B8] border border-[#232B36]">
                {order.tradingPair}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-[#94A3B8] mt-0.5">
              <span>ID: {order.id}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="hover:text-[#3B82F6] transition-colors p-0.5"
                title="Copy full order identifier"
              >
                {copied ? (
                  <Check size={11} className="text-emerald-400" />
                ) : (
                  <Copy size={11} />
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={cn(
              "px-3 py-1.5 rounded-xl border text-xs font-semibold uppercase tracking-wider flex items-center gap-2",
              statusInfo.color
            )}
          >
            {statusInfo.icon}
            <span>{statusInfo.label}</span>
          </div>
        </div>
      </div>

      {/* Numerical Metrics Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        {/* Metric 1 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            COMMITTED ALLOCATION
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-[#F0F4F8]">
              {order.sellAmount}
            </span>
            <span className="text-xs font-semibold text-[#3B82F6]">{order.sellAsset}</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            Token: Ethereum (18 Decimals)
          </span>
        </div>

        {/* Metric 2 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            {isLimit ? "TARGET TRIGGER PRICE" : "REFERENCE BENCHMARK"}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-[#3B82F6]">
              ${order.targetPrice || "3,200.00"}
            </span>
            <span className="text-xs text-[#94A3B8]">USDC / ETH</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            {isLimit
              ? `Spread: ${priceSpread >= 0 ? `+${priceSpread.toFixed(2)}%` : `${priceSpread.toFixed(2)}%`} vs ref ($3,200)`
              : "Demo Oracle Reference Rate"}
          </span>
        </div>

        {/* Metric 3 */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-1">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            {order.status === "completed" ? "EXECUTED PROCEEDS" : "EXPECTED PROCEEDS"}
          </span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-emerald-400">
              {order.actualOutput || order.estimatedOutput}
            </span>
            <span className="text-xs font-semibold text-emerald-400">{order.buyAsset}</span>
          </div>
          <span className="text-[10px] text-[#505D6E] block">
            {order.status === "completed" ? "Settled to Destination" : "Pending Execution Trigger"}
          </span>
        </div>
      </div>

      {/* Sub-info metadata */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-[11px] text-[#94A3B8]">
        <div>
          <span>Order Created: </span>
          <span className="text-[#F0F4F8] font-medium">{formatDate(order.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-[#1C222B] border border-[#232B36] text-[10px] text-[#94A3B8]">
            Network: {order.network || "Sepolia Testnet"}
          </span>
          <span className="px-2 py-0.5 rounded bg-[#1C222B] border border-[#3B82F6]/30 text-[10px] text-[#3B82F6] font-semibold">
            {order.isSimulation ? "Sandbox Environment" : "Live Enclave"}
          </span>
        </div>
      </div>
    </div>
  );
}
