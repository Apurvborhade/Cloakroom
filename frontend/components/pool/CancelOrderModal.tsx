"use client";

import React, { useState } from "react";
import { AlertTriangle, X, Check, Loader2 } from "lucide-react";

interface CancelOrderModalProps {
  isOpen: boolean;
  orderId: string | null;
  sellAmount?: string;
  sellAsset?: string;
  targetPrice?: string;
  orderType?: string;
  onClose: () => void;
  onConfirm: (orderId: string) => void;
}

export function CancelOrderModal({
  isOpen,
  orderId,
  sellAmount = "1.0",
  sellAsset = "ETH",
  targetPrice,
  orderType = "LIMIT",
  onClose,
  onConfirm,
}: CancelOrderModalProps) {
  const [cancellationStage, setCancellationStage] = useState<"idle" | "requesting" | "confirmed">("idle");

  if (!isOpen || !orderId) return null;

  const handleConfirmCancel = () => {
    setCancellationStage("requesting");
    setTimeout(() => {
      onConfirm(orderId);
      setCancellationStage("confirmed");
      setTimeout(() => {
        setCancellationStage("idle");
        onClose();
      }, 700);
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 text-left shadow-2xl relative font-mono">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={cancellationStage !== "idle"}
          className="absolute top-4 right-4 text-[#94A3B8] hover:text-[#F0F4F8] transition-colors p-1 disabled:opacity-40"
        >
          <X size={18} />
        </button>

        {/* Warning Icon & Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-950/40 border border-amber-800/40 flex items-center justify-center text-amber-400 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#F0F4F8] uppercase tracking-wider">
              CANCEL {orderType} ORDER
            </h3>
            <p className="text-[11px] text-[#94A3B8]">
              Order ID: {orderId.slice(0, 14)}...
            </p>
          </div>
        </div>

        {/* Order Details Preview */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[#94A3B8]">Committed Asset:</span>
            <span className="text-[#F0F4F8] font-bold">
              {sellAmount} {sellAsset}
            </span>
          </div>

          {targetPrice && (
            <div className="flex items-center justify-between">
              <span className="text-[#94A3B8]">Target Condition:</span>
              <span className="text-[#3B82F6] font-bold">${targetPrice} USDC</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-[#232B36]">
            <span className="text-[#94A3B8]">Allocation Impact:</span>
            <span className="text-amber-400 font-medium">Releasing from Order Lock</span>
          </div>
        </div>

        {/* Explicit Disclosure */}
        <div className="p-3 rounded-xl bg-[#0F1318] border border-[#232B36] space-y-1 text-[11px] text-[#94A3B8] leading-relaxed">
          <p>
            • Withdrawing this order from the active matchmaker book immediately invalidates future execution triggers.
          </p>
          <p>
            • Your committed <span className="text-[#F0F4F8] font-medium">{sellAmount} {sellAsset}</span> will be unreserved and returned to available local balance.
          </p>
          <p>
            • No cancellation fee or penalty is assessed by the protocol.
          </p>
        </div>

        {/* Dynamic Action Buttons */}
        {cancellationStage === "idle" && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-4 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-xs font-semibold text-[#94A3B8] hover:text-[#F0F4F8] transition-all text-center focus:outline-none cursor-pointer"
            >
              KEEP ORDER ACTIVE
            </button>

            <button
              type="button"
              onClick={handleConfirmCancel}
              className="py-2.5 px-4 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 text-xs font-bold text-rose-300 transition-all text-center flex items-center justify-center gap-1.5 focus:outline-none shadow-lg cursor-pointer"
            >
              <span>CONFIRM CANCEL</span>
            </button>
          </div>
        )}

        {cancellationStage === "requesting" && (
          <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/40 text-center space-y-2 animate-pulse">
            <div className="flex items-center justify-center gap-2 text-xs font-semibold text-amber-400">
              <Loader2 size={14} className="animate-spin text-amber-400" />
              <span>CANCELLATION REQUESTED...</span>
            </div>
            <p className="text-[10px] text-[#94A3B8]">
              Broadcasting order revocation to confidential matching session.
            </p>
          </div>
        )}

        {cancellationStage === "confirmed" && (
          <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-center space-y-1">
            <div className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-400">
              <Check size={14} />
              <span>ORDER CANCELLED — FUNDS UNRESERVED</span>
            </div>
            <p className="text-[10px] text-[#94A3B8]">
              Local state updated. Funds returned to available portfolio balance.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
