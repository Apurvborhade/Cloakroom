"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PoolHeader } from "@/components/pool/PoolHeader";
import { PoolProgress } from "@/components/pool/PoolProgress";
import { OrderReviewSummary } from "@/components/pool/OrderReviewSummary";
import { PoolEmptyState } from "@/components/pool/PoolEmptyState";
import { PoolOrderConfig, PoolOrderType } from "@/lib/pool/types";
import { loadPoolConfig, savePoolConfig } from "@/lib/pool/state";
import {
  calculateMarketQuote,
  calculateLimitQuote,
  REFERENCE_ETH_PRICE,
} from "@/lib/pool/calculations";

function PoolReviewParamsSync({
  onParams,
}: {
  onParams: (params: {
    type?: PoolOrderType;
    amount?: string;
    targetPrice?: string;
    source?: string;
    destination?: string;
    network?: string;
  }) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const rawType = searchParams.get("type")?.toUpperCase();
    const type: PoolOrderType | undefined =
      rawType === "LIMIT" ? "LIMIT" : rawType === "MARKET" ? "MARKET" : undefined;
    const amount = searchParams.get("amount") || undefined;
    const targetPrice = searchParams.get("targetPrice") || undefined;
    const source = searchParams.get("source") || undefined;
    const destination = searchParams.get("destination") || undefined;
    const network = searchParams.get("network") || undefined;

    if (amount || type || targetPrice || source || destination || network) {
      onParams({ type, amount, targetPrice, source, destination, network });
    }
  }, [searchParams, onParams]);

  return null;
}

export default function PoolReviewPage() {
  const router = useRouter();
  const [config, setConfig] = useState<PoolOrderConfig | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const saved = loadPoolConfig();
    if (saved && saved.sellAmount) {
      setConfig(saved);
    }
    setIsReady(true);
  }, []);

  const handleSyncParams = useCallback(
    (params: {
      type?: PoolOrderType;
      amount?: string;
      targetPrice?: string;
      source?: string;
      destination?: string;
      network?: string;
    }) => {
      if (params.amount) {
        const orderType = params.type || "MARKET";
        const targetPrice = params.targetPrice || (orderType === "LIMIT" ? "3500" : undefined);
        const marketQuote = calculateMarketQuote(params.amount, REFERENCE_ETH_PRICE);
        const limitQuote = calculateLimitQuote(
          params.amount,
          targetPrice || "3500",
          REFERENCE_ETH_PRICE
        );

        const newConfig: PoolOrderConfig = {
          orderType,
          tradingPair: "ETH/USDC",
          sellAsset: "ETH",
          buyAsset: "USDC",
          sellAmount: params.amount,
          targetPrice,
          currentPrice: REFERENCE_ETH_PRICE,
          estimatedOutput:
            orderType === "LIMIT"
              ? limitQuote.expectedUsdcOutput
              : marketQuote.estimatedUsdcOutput,
          minimumReceived:
            orderType === "MARKET" ? marketQuote.minimumReceived : undefined,
          slippageTolerance: 0.005,
          feePercent: 0.001,
          feeAmount: orderType === "LIMIT" ? limitQuote.feeAmount : marketQuote.feeAmount,
          expiryDuration: orderType === "LIMIT" ? "7 Days" : undefined,
          network: params.network || "Sepolia Testnet",
          sourceAddress:
            params.source || "0x71C568a8F9B60471f54aC482C400cCE9C298B319",
          destinationAddress:
            params.destination || "0x98bF32D034c568A9412F581b83F11A48809F32d1",
          quoteTimestamp: new Date().toISOString(),
        };

        setConfig(newConfig);
        savePoolConfig(newConfig);
      }
    },
    []
  );

  const editHref = config
    ? `/pool?type=${encodeURIComponent(config.orderType)}&amount=${encodeURIComponent(
        config.sellAmount
      )}&source=${encodeURIComponent(
        config.sourceAddress
      )}&destination=${encodeURIComponent(config.destinationAddress)}&network=${encodeURIComponent(
        config.network
      )}${config.targetPrice ? `&targetPrice=${encodeURIComponent(config.targetPrice)}` : ""}`
    : "/pool";

  const handleConfirmAndProceed = () => {
    if (!config) return;
    router.push("/pool/execution");
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <PoolReviewParamsSync onParams={handleSyncParams} />
      </Suspense>

      <PoolHeader backHref={editHref} />

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 font-mono">
        <PoolProgress currentStep={2} />

        {isReady && !config ? (
          <PoolEmptyState />
        ) : config ? (
          <>
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] text-[11px] text-[#3B82F6] tracking-wider uppercase font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse" />
                <span>CONFIDENTIAL VERIFICATION</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8] uppercase">
                REVIEW POOL ORDER
              </h1>
              <p className="text-xs sm:text-sm text-[#94A3B8] max-w-md mx-auto leading-relaxed">
                Verify your order terms before cryptographically authorizing the transaction inside the Secure Enclave.
              </p>
            </div>

            <OrderReviewSummary config={config} />

            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={handleConfirmAndProceed}
                className="w-full py-4 px-6 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(59,130,246,0.25)] flex items-center justify-center gap-2 focus:outline-none cursor-pointer"
              >
                <span>
                  {config.orderType === "LIMIT"
                    ? "AUTHORIZE & PLACE LIMIT ORDER"
                    : "AUTHORIZE & EXECUTE MARKET SWAP"}
                </span>
                <ArrowRight size={15} />
              </button>

              <div className="flex items-center justify-between text-xs text-[#94A3B8] px-1">
                <Link
                  href={editHref}
                  className="hover:text-[#F0F4F8] transition-colors flex items-center gap-1"
                >
                  <ArrowLeft size={13} />
                  <span>Edit Parameters</span>
                </Link>

                <span className="text-[11px] text-[#505D6E]">
                  {config.orderType === "LIMIT"
                    ? "Cancellable at any time prior to execution"
                    : "Zero slippage beyond 0.5% threshold"}
                </span>
              </div>
            </div>
          </>
        ) : null}
      </main>

      <footer className="border-t border-[#232B36] py-6 px-4 text-center text-xs text-[#505D6E] font-mono bg-[#12161D]">
        <div className="max-w-2xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>REVIEW & VERIFICATION STEP</span>
        </div>
      </footer>
    </div>
  );
}
