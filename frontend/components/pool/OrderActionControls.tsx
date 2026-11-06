"use client";

import React from "react";
import {
  Plus,
  XCircle,
  Zap,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderRecord } from "@/lib/pool/types";

interface OrderActionControlsProps {
  order: PoolOrderRecord;
  onOpenAddFunds: () => void;
  onOpenCancel: () => void;
  onSimulateTargetHit?: () => void;
  onProceedToSuccess?: () => void;
  className?: string;
}

export function OrderActionControls({
  order,
  onOpenAddFunds,
  onOpenCancel,
  onSimulateTargetHit,
  onProceedToSuccess,
  className,
}: OrderActionControlsProps) {
  const isCancellable =
    order.status === "active_waiting" ||
    order.status === "submitted" ||
    order.status === "order_created" ||
    order.status === "preparing" ||
    order.status === "funds_reserved";

  const isModifiable = isCancellable;

  const isCompleted = order.status === "completed";
  const isCancelled = order.status === "cancelled";

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-4 font-mono text-left shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
        <span className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
          ORDER MANAGEMENT ACTIONS
        </span>
        <span className="text-[10px] text-[#505D6E]">
          {isCancellable ? "Live Order Controls Active" : "Order State Locked"}
        </span>
      </div>

      {/* Main Dual Actions (Add Funds & Cancel Order) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {/* Primary Action: ADD FUNDS */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onOpenAddFunds}
            disabled={!isModifiable}
            className="w-full py-3.5 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#1C222B] disabled:text-[#505D6E] disabled:border-[#232B36] disabled:cursor-not-allowed border border-[#3B82F6] text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg focus:outline-none cursor-pointer"
          >
            <Plus size={15} />
            <span>Add Funds</span>
          </button>
          <span className="text-[10px] text-[#94A3B8] block px-1 text-center sm:text-left">
            {isModifiable
              ? "Allocate additional ETH from connected wallet to this active order."
              : "Funds cannot be added to an executed or cancelled order."}
          </span>
        </div>

        {/* Secondary Action: CANCEL ORDER */}
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={onOpenCancel}
            disabled={!isCancellable}
            className="w-full py-3.5 px-4 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 disabled:bg-[#1C222B] disabled:text-[#505D6E] disabled:border-[#232B36] disabled:cursor-not-allowed border border-rose-800/50 text-rose-300 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 focus:outline-none shadow-lg cursor-pointer"
          >
            <XCircle size={15} />
            <span>Cancel Order</span>
          </button>
          <span className="text-[10px] text-[#94A3B8] block px-1 text-center sm:text-left">
            {isCancellable
              ? "Withdraw order from active book and unreserve committed funds."
              : isCompleted
              ? "Order completed and settled. Cancellation is no longer supported."
              : isCancelled
              ? "Order has already been cancelled."
              : "Execution in progress. Order cannot be cancelled."}
          </span>
        </div>
      </div>

      {/* Development / Sandbox Simulation Trigger */}
      {order.orderType === "LIMIT" && order.status === "active_waiting" && onSimulateTargetHit && (
        <div className="pt-2 border-t border-[#232B36]">
          <div className="p-3.5 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#3B82F6] font-semibold flex items-center gap-1.5">
                <Zap size={13} />
                <span>SANDBOX SIMULATION TRIGGER (TESTNET)</span>
              </span>
              <span className="text-[10px] text-[#505D6E]">DEV CONTROLS</span>
            </div>
            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              In testnet sandbox mode, click below to simulate an oracle price spike matching your target price of ${order.targetPrice} USDC to test the atomic execution pipeline.
            </p>
            <button
              type="button"
              onClick={onSimulateTargetHit}
              className="w-full py-2.5 px-3 rounded-lg bg-[#0F1318] hover:bg-[#232B36] border border-[#3B82F6]/40 text-[#3B82F6] text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 focus:outline-none cursor-pointer"
            >
              <Zap size={13} />
              <span>SIMULATE TARGET PRICE HIT (${order.targetPrice} USDC)</span>
            </button>
          </div>
        </div>
      )}

      {/* Completion CTA */}
      {isCompleted && onProceedToSuccess && (
        <div className="pt-2 border-t border-[#232B36]">
          <button
            type="button"
            onClick={onProceedToSuccess}
            className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg focus:outline-none cursor-pointer"
          >
            <CheckCircle2 size={15} />
            <span>VIEW SETTLEMENT CONFIRMATION SUMMARY</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
