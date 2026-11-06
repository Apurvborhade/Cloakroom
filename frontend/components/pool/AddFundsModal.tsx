"use client";

import React, { useState } from "react";
import { Plus, X, Wallet, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { PoolOrderRecord } from "@/lib/pool/types";
import {
  calculateMarketQuote,
  calculateLimitQuote,
  REFERENCE_ETH_PRICE,
} from "@/lib/pool/calculations";
import { validatePoolSellAmount } from "@/lib/pool/validation";

interface AddFundsModalProps {
  isOpen: boolean;
  order: PoolOrderRecord;
  availableEthBalance: string | null;
  onClose: () => void;
  onConfirmAddFunds: (additionalEth: string) => void;
}

export function AddFundsModal({
  isOpen,
  order,
  availableEthBalance,
  onClose,
  onConfirmAddFunds,
}: AddFundsModalProps) {
  const [additionalAmount, setAdditionalAmount] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentEth = parseFloat(order.sellAmount || "0");
  const addNum = parseFloat(additionalAmount || "0");
  const newTotalEth = (!isNaN(addNum) && addNum > 0 ? (currentEth + addNum).toFixed(4) : currentEth.toFixed(4));

  const previewQuote =
    order.orderType === "LIMIT"
      ? calculateLimitQuote(newTotalEth, order.targetPrice || "3500", REFERENCE_ETH_PRICE)
      : calculateMarketQuote(newTotalEth, REFERENCE_ETH_PRICE);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, ".");
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      setAdditionalAmount(raw);
      setError(null);
    }
  };

  const handleMaxClick = () => {
    if (availableEthBalance) {
      setAdditionalAmount(availableEthBalance);
      setError(null);
    }
  };

  const handleConfirm = () => {
    const val = validatePoolSellAmount(additionalAmount, availableEthBalance);
    if (!val.isValid) {
      setError(val.error);
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      onConfirmAddFunds(additionalAmount);
      setIsSubmitting(false);
      setAdditionalAmount("");
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-[#161B22] border border-[#232B36] p-6 space-y-5 text-left shadow-2xl relative font-mono">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-4 right-4 text-[#94A3B8] hover:text-[#F0F4F8] transition-colors p-1"
        >
          <X size={18} />
        </button>

        {/* Title */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] shrink-0">
            <Plus size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-[#F0F4F8] uppercase tracking-wider">
              ADD FUNDS TO ORDER
            </h3>
            <p className="text-[11px] text-[#94A3B8]">
              Order ID: {order.id.slice(0, 14)}...
            </p>
          </div>
        </div>

        {/* Supported Asset Choice */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
            CHOOSE SUPPORTED ASSET
          </label>
          <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-[#1C222B] border border-[#232B36]">
            <div className="w-6 h-6 rounded-lg bg-[#0F1318] border border-[#232B36] flex items-center justify-center text-xs font-bold text-[#3B82F6]">
              Ξ
            </div>
            <div className="text-xs font-bold text-[#F0F4F8]">ETH</div>
            <span className="text-[10px] text-[#94A3B8]">— Ethereum Native (Default)</span>
            <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-[#0F1318] text-[#3B82F6] border border-[#232B36] font-semibold">
              Active Pair
            </span>
          </div>
        </div>

        {/* Input Field */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[#94A3B8]">
            <span>ADDITIONAL ETH AMOUNT</span>
            <div className="flex items-center gap-1.5">
              <Wallet size={12} className="text-[#505D6E]" />
              <span>Avail: {availableEthBalance || "0.0000"} ETH</span>
              <button
                type="button"
                onClick={handleMaxClick}
                className="ml-1 px-1.5 py-0.5 rounded bg-[#1C222B] hover:bg-[#232B36] text-[10px] text-[#3B82F6] border border-[#232B36] transition-colors font-bold cursor-pointer"
              >
                MAX
              </button>
            </div>
          </div>

          <div className="relative">
            <input
              type="text"
              inputMode="decimal"
              value={additionalAmount}
              onChange={handleAmountChange}
              placeholder="0.0"
              disabled={isSubmitting}
              className="w-full bg-[#0F1318] border border-[#232B36] focus:border-[#3B82F6] rounded-xl py-3 px-4 text-sm font-semibold text-[#F0F4F8] placeholder-[#505D6E] outline-none transition-all"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[#3B82F6]">
              ETH
            </span>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-red-400">
              <AlertCircle size={13} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Revised Configuration Preview */}
        <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] space-y-2 text-xs">
          <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block pb-1 border-b border-[#232B36] font-semibold">
            REVISED ORDER SUMMARY
          </span>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Current Allocated:</span>
            <span className="text-[#F0F4F8] font-medium">{order.sellAmount} ETH</span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">New Total Committed:</span>
            <span className="text-[#3B82F6] font-bold">{newTotalEth} ETH</span>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Updated Expected Output:</span>
            <span className="text-emerald-400 font-bold">
              {order.orderType === "LIMIT"
                ? (previewQuote as any).expectedUsdcOutput
                : (previewQuote as any).estimatedUsdcOutput}{" "}
              USDC
            </span>
          </div>

          <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#232B36]">
            <span className="text-[#94A3B8]">Estimated Relayer Fee (0.10%):</span>
            <span className="text-[#505D6E]">{previewQuote.feeAmount} ETH</span>
          </div>
        </div>

        <p className="text-[10px] text-[#94A3B8] leading-relaxed">
          Adding funds increases your committed allocation for this order. The revised balance is reserved in your active session and will execute atomically at your configured parameters.
        </p>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="py-2.5 px-4 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-xs font-semibold text-[#94A3B8] hover:text-[#F0F4F8] transition-all text-center focus:outline-none cursor-pointer"
          >
            DISMISS
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !additionalAmount || parseFloat(additionalAmount) <= 0}
            className="py-2.5 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#1C222B] disabled:text-[#505D6E] disabled:cursor-not-allowed text-xs font-bold text-white transition-all text-center flex items-center justify-center gap-1.5 focus:outline-none shadow-lg cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={13} className="animate-spin text-white" />
                <span>UPDATING...</span>
              </>
            ) : (
              <>
                <span>CONFIRM ALLOCATION</span>
                <ArrowRight size={13} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
