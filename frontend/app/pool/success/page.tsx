"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ShieldCheck,
  RotateCcw,
  Wallet,
  Copy,
  Check,
  History,
} from "lucide-react";
import { PoolHeader } from "@/components/pool/PoolHeader";
import { PoolProgress } from "@/components/pool/PoolProgress";
import { PoolOrderType, PoolOrderRecord } from "@/lib/pool/types";
import { getPoolOrderById, loadPoolConfig } from "@/lib/pool/state";

function PoolSuccessParamsSync({
  onParams,
}: {
  onParams: (params: {
    orderId?: string;
    type?: PoolOrderType;
    sellAmount?: string;
    buyAmount?: string;
    txHash?: string;
    batchId?: string;
  }) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const orderId = searchParams.get("orderId") || undefined;
    const rawType = searchParams.get("type")?.toUpperCase();
    const type: PoolOrderType | undefined =
      rawType === "LIMIT" ? "LIMIT" : rawType === "MARKET" ? "MARKET" : undefined;
    const sellAmount = searchParams.get("sellAmount") || undefined;
    const buyAmount = searchParams.get("buyAmount") || undefined;
    const txHash = searchParams.get("txHash") || undefined;
    const batchId = searchParams.get("batchId") || undefined;

    if (orderId || type || sellAmount || buyAmount || txHash || batchId) {
      onParams({ orderId, type, sellAmount, buyAmount, txHash, batchId });
    }
  }, [searchParams, onParams]);

  return null;
}

export default function PoolSuccessPage() {
  const [order, setOrder] = useState<PoolOrderRecord | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [orderType, setOrderType] = useState<PoolOrderType>("MARKET");
  const [sellAmount, setSellAmount] = useState<string>("1.0");
  const [buyAmount, setBuyAmount] = useState<string>("3,196.80");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);

  useEffect(() => {
    const config = loadPoolConfig();
    if (config) {
      setOrderType(config.orderType);
      setSellAmount(config.sellAmount);
      setBuyAmount(config.estimatedOutput);
    }
  }, []);

  const handleSyncParams = useCallback(
    (params: {
      orderId?: string;
      type?: PoolOrderType;
      sellAmount?: string;
      buyAmount?: string;
      txHash?: string;
      batchId?: string;
    }) => {
      if (params.orderId) {
        const found = getPoolOrderById(params.orderId);
        if (found) {
          setOrder(found);
          setOrderType(found.orderType);
          setSellAmount(found.sellAmount);
          setBuyAmount(found.actualOutput || found.estimatedOutput);
          setTxHash(found.txHash || null);
          setBatchId(found.batchId || null);
          return;
        }
      }

      if (params.type) setOrderType(params.type);
      if (params.sellAmount) setSellAmount(params.sellAmount);
      if (params.buyAmount) setBuyAmount(params.buyAmount);
      if (params.txHash) setTxHash(params.txHash);
      if (params.batchId) setBatchId(params.batchId);
    },
    []
  );

  const handleCopy = (key: string, text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const isLimit = orderType === "LIMIT";

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <PoolSuccessParamsSync onParams={handleSyncParams} />
      </Suspense>

      <PoolHeader backHref="/pool" />

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 font-mono">
        <PoolProgress currentStep={4} />

        <div className="p-6 sm:p-8 rounded-2xl bg-[#161B22] border border-emerald-500/40 text-center space-y-5 shadow-2xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-950/60 border border-emerald-500/50 flex items-center justify-center text-emerald-400 mx-auto shadow-[0_0_24px_rgba(16,185,129,0.2)]">
            <CheckCircle2 size={36} />
          </div>

          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-800/40 text-emerald-400 text-[10px] uppercase tracking-wider font-bold">
              <span>CONFIDENTIAL SETTLEMENT CONFIRMED</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8] uppercase">
              {isLimit ? "LIMIT ORDER FILLED" : "MARKET SWAP COMPLETED"}
            </h1>
            <p className="text-xs sm:text-sm text-[#94A3B8] max-w-md mx-auto leading-relaxed">
              Your assets have settled atomically through the NONY Private Enclave. No public mempool leakage occurred.
            </p>
          </div>

          {/* Settled Amounts Banner */}
          <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-[#1C222B] border border-[#232B36] text-left">
            <div className="space-y-1">
              <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
                DELIVERED / SOLD
              </span>
              <div className="text-xl sm:text-2xl font-bold text-[#F0F4F8]">
                {sellAmount} <span className="text-xs text-[#3B82F6]">ETH</span>
              </div>
            </div>

            <div className="space-y-1 text-right">
              <span className="text-[10px] text-[#94A3B8] uppercase tracking-wider block font-semibold">
                RECEIVED / CREDITED
              </span>
              <div className="text-xl sm:text-2xl font-bold text-emerald-400">
                {buyAmount} <span className="text-xs text-emerald-400">USDC</span>
              </div>
            </div>
          </div>

          {/* Trade Details Table */}
          <div className="p-4 rounded-xl bg-[#1C222B] border border-[#232B36] text-xs space-y-2.5 text-left">
            <div className="flex items-center justify-between pb-2 border-b border-[#232B36]">
              <span className="text-[#94A3B8] text-[11px] uppercase tracking-wider font-semibold">
                EXECUTION PROOF
              </span>
              <span className="text-emerald-400 text-[11px] flex items-center gap-1 font-semibold">
                <ShieldCheck size={12} />
                <span>Zero Public Traces</span>
              </span>
            </div>

            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#94A3B8]">Execution Venue</span>
              <span className="text-[#F0F4F8] font-medium">NONY TEE Dark Relayer</span>
            </div>

            {batchId && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#94A3B8]">TEE Enclave Batch ID</span>
                <span className="text-[#3B82F6] font-mono font-medium">{batchId}</span>
              </div>
            )}

            {txHash && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[#94A3B8]">Settlement Hash</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[#F0F4F8] font-mono">
                    {txHash.slice(0, 8)}...{txHash.slice(-6)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy("txHash", txHash)}
                    className="text-[#94A3B8] hover:text-[#F0F4F8] transition-colors"
                  >
                    {copiedKey === "txHash" ? (
                      <Check size={12} className="text-emerald-400" />
                    ) : (
                      <Copy size={12} />
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] pt-1 border-t border-[#232B36]">
              <span className="text-[#94A3B8]">Relayer Fee</span>
              <span className="text-[#505D6E]">0.001 ETH (0.10%)</span>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Link
              href="/wallet"
              className="w-full py-3.5 px-4 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-xs uppercase tracking-wider transition-all text-center flex items-center justify-center gap-2 focus:outline-none shadow-[0_0_20px_rgba(59,130,246,0.25)]"
            >
              <Wallet size={14} />
              <span>VIEW IN WALLET</span>
            </Link>

            <Link
              href="/pool"
              className="w-full py-3.5 px-4 rounded-xl bg-[#1C222B] hover:bg-[#232B36] border border-[#232B36] text-[#F0F4F8] font-bold text-xs uppercase tracking-wider transition-all text-center flex items-center justify-center gap-2 focus:outline-none"
            >
              <RotateCcw size={14} />
              <span>TRADE AGAIN</span>
            </Link>
          </div>

          <div className="pt-1 text-center">
            <Link
              href="/pool/orders"
              className="text-xs text-[#94A3B8] hover:text-[#3B82F6] transition-colors inline-flex items-center gap-1 font-semibold"
            >
              <History size={12} />
              <span>Open Orders Dashboard</span>
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#232B36] py-6 px-4 text-center text-xs text-[#505D6E] font-mono bg-[#12161D]">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>SETTLEMENT COMPLETE</span>
        </div>
      </footer>
    </div>
  );
}
