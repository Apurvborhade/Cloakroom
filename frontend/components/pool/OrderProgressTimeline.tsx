"use client";

import React from "react";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { PoolOrderType, PoolExecutionState } from "@/lib/pool/types";

interface OrderProgressTimelineProps {
  orderType: PoolOrderType;
  status: PoolExecutionState;
  className?: string;
}

export function OrderProgressTimeline({
  orderType,
  status,
  className,
}: OrderProgressTimelineProps) {
  const isLimit = orderType === "LIMIT";

  const marketSteps = [
    { key: "preparing", label: "1. Order Prepared", description: "Order parameters configured and validated." },
    { key: "awaiting_signature", label: "2. Wallet Signature Requested", description: "Cryptographic intent authorization solicited." },
    { key: "submitted", label: "3. Transaction Submitted", description: "Ingested into confidential matching session." },
    { key: "processing", label: "4. Execution Processing", description: "Atomic settlement against pool liquidity." },
    { key: "completed", label: "5. Execution Confirmed", description: "Output assets settled to destination address." },
  ];

  const limitSteps = [
    { key: "order_created", label: "1. Order Created", description: "Limit order created with target price threshold." },
    { key: "funds_reserved", label: "2. Funds Reserved", description: "Asset allocation reserved in active trading session." },
    { key: "active_waiting", label: "3. Waiting for Target Price", description: "Monitoring market rate for price condition trigger." },
    { key: "condition_met", label: "4. Target Condition Met", description: "Benchmark rate triggered; activating execution." },
    { key: "executing", label: "5. Execution Initiated", description: "Atomic settlement processing in enclave." },
    { key: "completed", label: "6. Execution Confirmed", description: "Trade settled; destination address credited." },
  ];

  const steps = isLimit ? limitSteps : marketSteps;

  const getStepState = (stepKey: string, stepIdx: number) => {
    if (status === "cancelled" || status === "failed" || status === "expired") {
      return "neutral";
    }

    let activeIdx = 0;
    if (isLimit) {
      if (status === "order_created") activeIdx = 0;
      else if (status === "funds_reserved" || status === "awaiting_signature") activeIdx = 1;
      else if (status === "submitted" || status === "active_waiting") activeIdx = 2;
      else if (status === "condition_met") activeIdx = 3;
      else if (status === "executing") activeIdx = 4;
      else if (status === "completed") activeIdx = 5;
    } else {
      if (status === "preparing") activeIdx = 0;
      else if (status === "awaiting_signature") activeIdx = 1;
      else if (status === "submitted") activeIdx = 2;
      else if (status === "processing") activeIdx = 3;
      else if (status === "completed") activeIdx = 4;
    }

    if (stepIdx < activeIdx) return "completed";
    if (stepIdx === activeIdx) return "active";
    return "pending";
  };

  return (
    <div
      className={cn(
        "rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 font-mono text-left shadow-lg",
        className
      )}
    >
      <div className="flex items-center justify-between pb-3 border-b border-[#232B36]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-pulse" />
          <span className="text-xs uppercase tracking-wider text-[#94A3B8] font-semibold">
            ORDER LIFECYCLE PROGRESSION
          </span>
        </div>
        <span className="text-[11px] text-[#505D6E]">
          {isLimit ? "Conditional Limit Flow" : "Instant Swap Flow"}
        </span>
      </div>

      {/* Vertical Timeline */}
      <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-[#232B36]">
        {steps.map((step, idx) => {
          const state = getStepState(step.key, idx);

          return (
            <div key={step.key} className="relative flex items-start gap-4 group">
              {/* Timeline Indicator Dot */}
              <div
                className={cn(
                  "absolute -left-[30px] top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] border transition-all z-10",
                  state === "completed" &&
                    "bg-emerald-950/60 border-emerald-500 text-emerald-400 font-bold",
                  state === "active" &&
                    "bg-[#1C222B] border-[#3B82F6] text-[#3B82F6] ring-4 ring-[#3B82F6]/20 font-bold",
                  state === "pending" &&
                    "bg-[#0F1318] border-[#232B36] text-[#505D6E]",
                  state === "neutral" &&
                    "bg-[#0F1318] border-[#232B36] text-[#505D6E]"
                )}
              >
                {state === "completed" ? (
                  <CheckCircle2 size={12} className="text-emerald-400" />
                ) : state === "active" ? (
                  <span className="w-2 h-2 rounded-full bg-[#3B82F6] animate-ping" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>

              {/* Step Text Info */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-xs font-semibold tracking-wide",
                      state === "completed" && "text-emerald-400",
                      state === "active" && "text-[#F0F4F8]",
                      state === "pending" && "text-[#505D6E]",
                      state === "neutral" && "text-[#505D6E]"
                    )}
                  >
                    {step.label}
                  </span>

                  {state === "active" && (
                    <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#1C222B] text-[#3B82F6] border border-[#3B82F6]/40 font-bold animate-pulse">
                      CURRENT STAGE
                    </span>
                  )}
                  {state === "completed" && (
                    <span className="text-[9px] uppercase tracking-wider text-emerald-400 font-semibold">
                      DONE
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-[#94A3B8] leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {status === "cancelled" && (
        <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/40 flex items-center gap-2.5 text-xs text-rose-300">
          <XCircle size={16} className="text-rose-400 shrink-0" />
          <span>This order was cancelled by the user. Funds have been unreserved from the order book.</span>
        </div>
      )}

      {status === "failed" && (
        <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/40 flex items-center gap-2.5 text-xs text-rose-300">
          <AlertTriangle size={16} className="text-rose-400 shrink-0" />
          <span>Execution failed. Please check network connectivity or retry authorization.</span>
        </div>
      )}
    </div>
  );
}
