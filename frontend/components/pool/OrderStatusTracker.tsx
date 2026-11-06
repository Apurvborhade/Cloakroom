"use client";

import React from "react";
import Link from "next/link";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  RotateCcw,
  Clock,
  Zap,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  PoolOrderType,
  PoolExecutionState,
  PoolOrderConfig,
} from "@/lib/pool/types";
import { REFERENCE_ETH_PRICE } from "@/lib/pool/calculations";

interface OrderStatusTrackerProps {
  orderType: PoolOrderType;
  status: PoolExecutionState;
  config: PoolOrderConfig;
  orderId: string | null;
  txHash: string | null;
  batchId: string | null;
  errorMessage: string | null;
  isSimulation: boolean;
  onSign?: () => void;
  onCancelClick?: () => void;
  onSimulateTargetHit?: () => void;
  onProceedToSuccess?: () => void;
  onRetry?: () => void;
}

export function OrderStatusTracker({
  orderType,
  status,
  config,
  orderId,
  txHash,
  batchId,
  errorMessage,
  isSimulation,
  onSign,
  onCancelClick,
  onSimulateTargetHit,
  onProceedToSuccess,
  onRetry,
}: OrderStatusTrackerProps) {
  const isLimit = orderType === "LIMIT";

  // Define steps according to order type
  const marketSteps: { key: PoolExecutionState; label: string }[] = [
    { key: "preparing", label: "Session Prepare" },
    { key: "awaiting_signature", label: "Wallet Authorization" },
    { key: "submitted", label: "TEE Batch Ingestion" },
    { key: "processing", label: "Private Match & Settlement" },
    { key: "completed", label: "Settlement Complete" },
  ];

  const limitSteps: { key: PoolExecutionState; label: string }[] = [
    { key: "order_created", label: "Order Created" },
    { key: "awaiting_signature", label: "Authorize Order" },
    { key: "submitted", label: "TEE Ingestion" },
    { key: "active_waiting", label: "Awaiting Target Price" },
    { key: "condition_met", label: "Target Triggered" },
    { key: "executing", label: "Clearing & Settlement" },
    { key: "completed", label: "Order Filled" },
  ];

  const currentSteps = isLimit ? limitSteps : marketSteps;

  const getStepStatus = (stepKey: PoolExecutionState) => {
    if (status === "failed" || status === "cancelled" || status === "expired") {
      return "neutral";
    }

    const keys = currentSteps.map((s) => s.key);
    const currentIndex = keys.indexOf(status);
    const stepIndex = keys.indexOf(stepKey);

    if (stepIndex < currentIndex) return "done";
    if (stepIndex === currentIndex) return "active";
    return "pending";
  };

  const numericTarget = config.targetPrice ? parseFloat(config.targetPrice) : 0;
  const currentPrice = REFERENCE_ETH_PRICE;

  return (
    <div className="w-full space-y-6 text-left font-mono">
      {/* Simulation / Verification Top Pill */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#377FA5] animate-pulse" />
          <span className="text-[#626A75] uppercase tracking-wider text-[11px] font-semibold">
            {isLimit ? "CONFIDENTIAL LIMIT MATCHER" : "ENCLAVE POOL PIPELINE"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[10px] font-mono border uppercase tracking-wider font-semibold",
              isSimulation
                ? "bg-[#E7F3FA] text-[#377FA5] border-[#CDE5F3]"
                : "bg-emerald-50 text-[#21865B] border-emerald-300"
            )}
          >
            {isSimulation ? "Sandbox Environment" : "Hardware TEE Enclave"}
          </span>
        </div>
      </div>

      {/* Main Status Hero Card */}
      <div className="p-6 sm:p-8 rounded-2xl bg-white border border-[#E3E6EB] text-center space-y-5 shadow-sm">
        {/* Status Icon */}
        <div className="flex justify-center">
          {(status === "preparing" ||
            status === "order_created" ||
            status === "submitted" ||
            status === "processing" ||
            status === "executing") && (
            <div className="w-16 h-16 rounded-2xl bg-[#F7F8FA] border border-[#E3E6EB] flex items-center justify-center text-[#377FA5]">
              <Loader2 size={32} className="animate-spin text-[#377FA5]" />
            </div>
          )}

          {status === "awaiting_signature" && (
            <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-300 flex items-center justify-center text-amber-700 animate-pulse">
              <Clock size={32} />
            </div>
          )}

          {status === "active_waiting" && (
            <div className="w-16 h-16 rounded-2xl bg-[#E7F3FA] border border-[#CDE5F3] flex items-center justify-center text-[#377FA5]">
              <TrendingUp size={32} className="animate-pulse" />
            </div>
          )}

          {status === "condition_met" && (
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center justify-center text-[#21865B]">
              <Zap size={32} className="animate-bounce" />
            </div>
          )}

          {status === "completed" && (
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-300 flex items-center justify-center text-[#21865B] shadow-sm">
              <CheckCircle2 size={32} />
            </div>
          )}

          {status === "cancelled" && (
            <div className="w-16 h-16 rounded-2xl bg-[#F7F8FA] border border-[#E3E6EB] flex items-center justify-center text-[#9299A3]">
              <XCircle size={32} />
            </div>
          )}

          {status === "failed" && (
            <div className="w-16 h-16 rounded-2xl bg-rose-50 border border-rose-300 flex items-center justify-center text-rose-700">
              <AlertTriangle size={32} />
            </div>
          )}
        </div>

        {/* State Titles & Explanations */}
        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#17191D] uppercase">
            {status === "preparing" && "INITIALIZING POOL SESSION"}
            {status === "order_created" && "ORDER CREATED"}
            {status === "awaiting_signature" && "WALLET AUTHORIZATION REQUIRED"}
            {status === "submitted" && "TRANSMITTING TO TEE ENCLAVE"}
            {status === "processing" && "EXECUTING CONFIDENTIAL SWAP"}
            {status === "active_waiting" && "LIMIT ORDER ACTIVE IN ENCLAVE"}
            {status === "condition_met" && "TARGET PRICE CONDITION MET"}
            {status === "executing" && "EXECUTING TEE SETTLEMENT"}
            {status === "completed" && (isLimit ? "LIMIT ORDER FILLED" : "MARKET SWAP COMPLETED")}
            {status === "cancelled" && "ORDER CANCELLED — FUNDS RELEASED"}
            {status === "failed" && "EXECUTION HALTED"}
          </h2>

          <p className="text-xs sm:text-sm text-[#626A75] max-w-lg mx-auto leading-relaxed">
            {status === "preparing" &&
              "Querying current oracle reference rates and locking enclave liquidity batch."}
            {status === "order_created" &&
              "Generating cryptographic order payload with encrypted intent parameters."}
            {status === "awaiting_signature" &&
              "Please confirm the signature in your connected wallet to authorize the confidential allocation."}
            {status === "submitted" &&
              "Order committed to the private enclave matching engine without public mempool broadcast."}
            {status === "processing" &&
              "Matching against enclave liquidity pool. Confidential atomic batch settlement in progress."}
            {status === "active_waiting" &&
              `Monitoring market price. Order will trigger automatically when 1 ETH reaches $${numericTarget.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC.`}
            {status === "condition_met" &&
              `ETH market price reached $${numericTarget.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC. Awakening matchmaker engine.`}
            {status === "executing" &&
              "Settling swap atomically inside secure enclave and crediting destination address."}
            {status === "completed" &&
              "The trade has settled successfully. Destination address has been credited with zero public leakage."}
            {status === "cancelled" &&
              "This order was withdrawn from the confidential book. Your funds have been unlocked with zero penalty."}
            {status === "failed" &&
              (errorMessage || "The transaction encountered an enclave routing failure. Please retry.")}
          </p>
        </div>

        {/* Interactive Action Controls based on status */}
        <div className="pt-2">
          {status === "awaiting_signature" && onSign && (
            <button
              type="button"
              onClick={onSign}
              className="py-3 px-6 rounded-xl bg-[#17191D] hover:bg-[#2B303B] text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-sm flex items-center justify-center gap-2 mx-auto focus:outline-none"
            >
              <span>SIGN IN WALLET</span>
              <ArrowRight size={14} />
            </button>
          )}

          {status === "active_waiting" && (
            <div className="space-y-4 max-w-md mx-auto">
              {/* Target Price comparison bar */}
              <div className="p-3.5 rounded-xl bg-[#F7F8FA] border border-[#E3E6EB] text-xs space-y-2 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[#626A75]">Current Oracle Price:</span>
                  <span className="text-[#17191D] font-semibold">
                    ${currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#626A75]">Target Trigger Price:</span>
                  <span className="text-[#377FA5] font-semibold">
                    ${numericTarget.toLocaleString("en-US", { minimumFractionDigits: 2 })} USDC
                  </span>
                </div>
              </div>

              {/* Simulation Testing Button */}
              {onSimulateTargetHit && (
                <div className="p-3 rounded-xl bg-[#E7F3FA] border border-[#CDE5F3] space-y-2 text-left">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#377FA5] font-semibold">
                      SIMULATION ENVIRONMENT
                    </span>
                    <span className="text-[10px] text-[#626A75]">DEV TRIGGER</span>
                  </div>
                  <p className="text-[10px] text-[#626A75]">
                    Simulate an oracle price spike to ${numericTarget} USDC to test the automatic execution and settlement flow.
                  </p>
                  <button
                    type="button"
                    onClick={onSimulateTargetHit}
                    className="w-full py-2 px-3 rounded-lg bg-white hover:bg-[#F7F8FA] border border-[#CDE5F3] text-[#377FA5] text-[11px] font-semibold transition-all flex items-center justify-center gap-2 focus:outline-none shadow-xs"
                  >
                    <Zap size={13} />
                    <span>SIMULATE TARGET HIT (${numericTarget} USDC)</span>
                  </button>
                </div>
              )}

              {/* Order Actions */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {onCancelClick && (
                  <button
                    type="button"
                    onClick={onCancelClick}
                    className="py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold transition-all focus:outline-none"
                  >
                    CANCEL ORDER
                  </button>
                )}

                <Link
                  href="/pool/orders"
                  className="py-2.5 px-4 rounded-xl bg-white hover:bg-[#F0F2F5] border border-[#E3E6EB] text-[#17191D] text-xs font-semibold transition-all inline-flex items-center justify-center gap-1.5 focus:outline-none shadow-xs"
                >
                  <span>ORDERS LIST</span>
                  <ArrowRight size={13} />
                </Link>
              </div>

              <p className="text-[10px] text-[#9299A3] leading-relaxed">
                Order is stored safely in enclave memory. You can navigate away at any time.
              </p>
            </div>
          )}

          {status === "completed" && onProceedToSuccess && (
            <button
              type="button"
              onClick={onProceedToSuccess}
              className="py-3 px-6 rounded-xl bg-[#17191D] hover:bg-[#2B303B] text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-sm flex items-center justify-center gap-2 mx-auto focus:outline-none"
            >
              <span>VIEW TRADE SUMMARY</span>
              <ArrowRight size={14} />
            </button>
          )}

          {status === "cancelled" && (
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/pool"
                className="py-2.5 px-5 rounded-xl bg-[#17191D] text-white text-xs font-semibold uppercase tracking-wider transition-all shadow-sm"
              >
                NEW ORDER
              </Link>
              <Link
                href="/wallet"
                className="py-2.5 px-5 rounded-xl bg-white border border-[#E3E6EB] text-[#17191D] text-xs font-semibold uppercase tracking-wider transition-all shadow-xs"
              >
                VIEW WALLET
              </Link>
            </div>
          )}

          {status === "failed" && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="py-2.5 px-5 rounded-xl bg-white hover:bg-[#F0F2F5] border border-[#E3E6EB] text-[#17191D] text-xs font-semibold uppercase tracking-wider transition-all inline-flex items-center gap-2 mx-auto focus:outline-none shadow-xs"
            >
              <RotateCcw size={14} />
              <span>RETRY EXECUTION</span>
            </button>
          )}
        </div>
      </div>

      {/* Sequential Pipeline Progress Checklist */}
      <div className="p-6 rounded-2xl bg-white border border-[#E3E6EB] space-y-4 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-[#E3E6EB] text-xs">
          <span className="text-[#626A75] uppercase tracking-wider text-[11px] font-semibold">
            PIPELINE MILESTONES
          </span>
          <span className="text-[#377FA5] text-[11px] font-medium">
            {isLimit ? "Limit Conditional Flow" : "Instant Batch Flow"}
          </span>
        </div>

        <div className="space-y-3">
          {currentSteps.map((step, idx) => {
            const stepStatus = getStepStatus(step.key);

            return (
              <div
                key={step.key}
                className={cn(
                  "flex items-center justify-between p-3 rounded-xl border text-xs transition-all",
                  stepStatus === "done" &&
                    "bg-emerald-50/50 border-emerald-200 text-[#21865B]",
                  stepStatus === "active" &&
                    "bg-[#E7F3FA] border-[#377FA5] text-[#17191D] shadow-xs",
                  stepStatus === "pending" &&
                    "bg-[#F7F8FA] border-[#E3E6EB] text-[#9299A3]",
                  stepStatus === "neutral" &&
                    "bg-[#F7F8FA] border-[#E3E6EB] text-[#9299A3]"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-semibold border",
                      stepStatus === "done" &&
                        "bg-emerald-50 border-emerald-400 text-[#21865B] font-bold",
                      stepStatus === "active" &&
                        "bg-[#377FA5] border-[#377FA5] text-white",
                      stepStatus === "pending" &&
                        "bg-white border-[#E3E6EB] text-[#9299A3]",
                      stepStatus === "neutral" &&
                        "bg-white border-[#E3E6EB] text-[#9299A3]"
                    )}
                  >
                    {stepStatus === "done" ? (
                      <CheckCircle2 size={12} className="text-[#21865B]" />
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span className="font-medium text-xs">{step.label}</span>
                </div>

                <div>
                  {stepStatus === "done" && (
                    <span className="text-[10px] uppercase tracking-wider text-[#21865B] font-semibold">
                      DONE
                    </span>
                  )}
                  {stepStatus === "active" && (
                    <span className="text-[10px] uppercase tracking-wider text-[#377FA5] font-semibold animate-pulse">
                      PROCESSING
                    </span>
                  )}
                  {stepStatus === "pending" && (
                    <span className="text-[10px] uppercase tracking-wider text-[#9299A3]">
                      QUEUED
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Identifiers & Technical Metadata */}
      {(orderId || batchId) && (
        <div className="p-4 rounded-xl bg-white border border-[#E3E6EB] text-xs space-y-2 shadow-xs">
          {orderId && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#626A75]">Internal Order ID</span>
              <span className="text-[#17191D] font-mono">{orderId}</span>
            </div>
          )}
          {batchId && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#626A75]">TEE Enclave Batch ID</span>
              <span className="text-[#377FA5] font-mono font-medium">{batchId}</span>
            </div>
          )}
          {txHash && (
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#626A75]">Settlement Transaction</span>
              <span className="text-[#21865B] font-mono">
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}