"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { MixHeader } from "@/components/mix/MixHeader";
import { MixProgress } from "@/components/mix/MixProgress";
import { MixReviewSummary } from "@/components/mix/MixReviewSummary";
import { MixEmptyState } from "@/components/mix/MixEmptyState";
import { MixConfig, MixAssetSymbol } from "@/lib/mix/types";
import { loadMixConfig, saveMixConfig } from "@/lib/mix/state";
import { calculateMixQuote } from "@/lib/mix/calculations";

function MixReviewParamsSync({
  onParams,
}: {
  onParams: (params: {
    asset: MixAssetSymbol;
    amount: string;
    source: string;
    destination: string;
    network: string;
  }) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const rawAsset = searchParams.get("asset")?.toUpperCase();
    const asset: MixAssetSymbol = rawAsset === "USDC" ? "USDC" : "ETH";
    const amount = searchParams.get("amount") || "";
    const source = searchParams.get("source") || "";
    const destination = searchParams.get("destination") || "";
    const network = searchParams.get("network") || "Sepolia Testnet";

    if (amount) {
      onParams({ asset, amount, source, destination, network });
    }
  }, [searchParams, onParams]);

  return null;
}

export default function MixReviewPage() {
  const router = useRouter();
  const [config, setConfig] = useState<MixConfig | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Initialize config from session storage or URL parameters
  useEffect(() => {
    const saved = loadMixConfig();
    if (saved && saved.inputAmount) {
      setConfig(saved);
    }
    setIsReady(true);
  }, []);

  const handleSyncParams = useCallback(
    (params: {
      asset: MixAssetSymbol;
      amount: string;
      source: string;
      destination: string;
      network: string;
    }) => {
      // If we don't have config yet or URL has valid params, derive config
      const quote = calculateMixQuote(params.asset, params.amount);
      const newConfig: MixConfig = {
        inputAsset: params.asset,
        inputAmount: params.amount,
        sourceAddress:
          params.source || "0x71C568a8F9B60471f54aC482C400cCE9C298B319",
        destinationAddress:
          params.destination || "0x98bF32D034c568A9412F581b83F11A48809F32d1",
        network: params.network || "Sepolia Testnet",
        estimatedRate: quote.rate,
        rateType: quote.rateType,
        feePercent: 0.001,
        feeAmount: quote.feeAmount,
        estimatedOutput: quote.estimatedOutput,
        quoteTimestamp: quote.quoteTimestamp,
      };
      setConfig(newConfig);
      saveMixConfig(newConfig);
    },
    []
  );

  const editSetupHref = config
    ? `/mix?asset=${encodeURIComponent(config.inputAsset)}&amount=${encodeURIComponent(
      config.inputAmount
    )}&source=${encodeURIComponent(
      config.sourceAddress
    )}&destination=${encodeURIComponent(
      config.destinationAddress
    )}&network=${encodeURIComponent(config.network)}`
    : "/mix";

  const handleConfirmAndProceed = () => {
    if (!config) return;

    const queryParams = new URLSearchParams({
      asset: config.inputAsset,
      amount: config.inputAmount,
      source: config.sourceAddress,
      destination: config.destinationAddress,
      network: config.network,
    }).toString();

    router.push(`/mix/execution?${queryParams}`);
  };

  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col selection:bg-[#A6DCF8]/20 selection:text-[#F5F5F7]">
      <Suspense fallback={null}>
        <MixReviewParamsSync onParams={handleSyncParams} />
      </Suspense>

      <MixHeader backHref={editSetupHref} backLabel="EDIT SETUP" />
      <MixProgress currentStep={2} setupHref={editSetupHref} />

      <main className="flex-1 max-w-xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 animate-fade-in flex flex-col items-center">
        {/* Intro */}
        <div className="w-full text-center max-w-md mb-8">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#92929B] uppercase mb-1.5">
            05 / INSPECTION & CONFIRMATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F5F7] mb-2">
            Review Mix Intent
          </h1>
          <p className="text-xs sm:text-sm text-[#92929B] leading-relaxed">
            Verify all parameters before dispatching to the confidential execution environment.
            No on-chain transaction occurs until execution confirmation.
          </p>
        </div>

        {isReady && !config ? (
          <MixEmptyState
            title="No Active MIX Configuration Found"
            description="You need to configure your asset and deposit amount before reviewing."
            primaryHref="/mix"
            primaryLabel="START MIX SETUP"
          />
        ) : config ? (
          <div className="w-full space-y-6">
            {/* Review Summary */}
            <MixReviewSummary config={config} />

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Link
                href={editSetupHref}
                className="w-full sm:w-auto flex-1 py-3 px-5 rounded-xl border border-[#292930] bg-[#141418] hover:bg-[#18181D] hover:border-[#3A3A46] text-xs font-mono font-medium text-[#92929B] hover:text-[#F5F5F7] transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft size={13} />
                <span>BACK TO EDIT</span>
              </Link>

              <button
                type="button"
                onClick={handleConfirmAndProceed}
                className="w-full sm:w-auto flex-[2] py-3 px-6 rounded-xl bg-[#A6DCF8] text-[#0C0C0C] hover:bg-[#BDE7FC] font-mono text-xs font-semibold tracking-wider uppercase transition-all shadow-[0_0_20px_rgba(166,220,248,0.25)] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>CONFIRM & PROCEED TO EXECUTION</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}