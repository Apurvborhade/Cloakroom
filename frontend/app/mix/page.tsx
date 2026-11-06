"use client";

import React, { useState, useEffect, useCallback, useMemo, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ShieldCheck, ArrowDown, Info } from "lucide-react";
import { MixHeader } from "@/components/mix/MixHeader";
import { MixProgress } from "@/components/mix/MixProgress";
import { AssetInput } from "@/components/mix/AssetInput";
import { ConversionSummary } from "@/components/mix/ConversionSummary";
import { BalanceBreakdown } from "@/components/mix/BalanceBreakdown";
import { useWallet } from "@/hooks/useWallet";
import { MixAssetSymbol, MixConfig } from "@/lib/mix/types";
import {
  calculateMixQuote,
  calculateRemainingBalance,
  ETH_USDC_ESTIMATED_RATE,
} from "@/lib/mix/calculations";
import { validateMixAmount } from "@/lib/mix/validation";
import { saveMixConfig, loadMixConfig } from "@/lib/mix/state";

function MixSetupParamsSync({
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
    const source =
      searchParams.get("source") || "0x71C568a8F9B60471f54aC482C400cCE9C298B319";
    const destination =
      searchParams.get("destination") || "0x98bF32D034c568A9412F581b83F11A48809F32d1";
    const network = searchParams.get("network") || "Sepolia Testnet";

    onParams({ asset, amount, source, destination, network });
  }, [searchParams, onParams]);

  return null;
}

export default function MixSetupPage() {
  const router = useRouter();
  const { account, balance: ethBalance, networkName } = useWallet();

  // Primary Configuration State
  const [inputAsset, setInputAsset] = useState<MixAssetSymbol>("ETH");
  const [inputAmount, setInputAmount] = useState<string>("1.0");
  const [sourceAddress, setSourceAddress] = useState<string>(
    "0x71C568a8F9B60471f54aC482C400cCE9C298B319"
  );
  const [destinationAddress, setDestinationAddress] = useState<string>(
    "0x98bF32D034c568A9412F581b83F11A48809F32d1"
  );
  const [network, setNetwork] = useState<string>("Sepolia Testnet");

  // Mock USDC balance (or 0 if disconnected/no contract read)
  const usdcBalance = account ? "2,450.00" : null;

  // Restore previous config if present
  useEffect(() => {
    const saved = loadMixConfig();
    if (saved && saved.inputAmount) {
      setInputAsset(saved.inputAsset);
      setInputAmount(saved.inputAmount);
      setSourceAddress(saved.sourceAddress);
      setDestinationAddress(saved.destinationAddress);
      setNetwork(saved.network);
    }
  }, []);

  const handleSyncParams = useCallback(
    (params: {
      asset: MixAssetSymbol;
      amount: string;
      source: string;
      destination: string;
      network: string;
    }) => {
      // Prioritize URL params if passed from Screen 4
      if (params.asset) setInputAsset(params.asset);
      if (params.amount) setInputAmount(params.amount);
      if (params.source) setSourceAddress(params.source);
      if (params.destination) setDestinationAddress(params.destination);
      if (params.network) setNetwork(params.network);
    },
    []
  );

  // Financial Calculations
  const quoteCalculation = useMemo(() => {
    return calculateMixQuote(inputAsset, inputAmount, ETH_USDC_ESTIMATED_RATE);
  }, [inputAsset, inputAmount]);

  // Balance & Validation
  const activeBalance = inputAsset === "ETH" ? ethBalance : usdcBalance;
  const validation = useMemo(() => {
    return validateMixAmount(inputAmount, inputAsset, activeBalance);
  }, [inputAmount, inputAsset, activeBalance]);

  const { remaining, isInsufficient } = useMemo(() => {
    return calculateRemainingBalance(activeBalance, inputAmount);
  }, [activeBalance, inputAmount]);

  const canContinue = validation.isValid && !isInsufficient;

  // MAX Handler
  const handleMaxClick = () => {
    if (!activeBalance) return;
    const rawNum = parseFloat(activeBalance.replace(/,/g, ""));
    if (isNaN(rawNum) || rawNum <= 0) return;

    if (inputAsset === "ETH") {
      // Reserve 0.005 ETH for gas cushion
      const safe = Math.max(0, rawNum - 0.005);
      setInputAmount(safe > 0 ? safe.toFixed(4) : activeBalance);
    } else {
      setInputAmount(rawNum.toFixed(2));
    }
  };

  const handleContinue = () => {
    if (!canContinue) return;

    const config: MixConfig = {
      inputAsset,
      inputAmount,
      sourceAddress,
      destinationAddress,
      network: networkName || network,
      estimatedRate: quoteCalculation.rate,
      rateType: quoteCalculation.rateType,
      feePercent: 0.001,
      feeAmount: quoteCalculation.feeAmount,
      estimatedOutput: quoteCalculation.estimatedOutput,
      quoteTimestamp: quoteCalculation.quoteTimestamp,
    };

    saveMixConfig(config);

    const queryParams = new URLSearchParams({
      asset: inputAsset,
      amount: inputAmount,
      source: sourceAddress,
      destination: destinationAddress,
      network: networkName || network,
    }).toString();

    router.push(`/mix/review?${queryParams}`);
  };

  const executionBackHref = `/execution?asset=${encodeURIComponent(
    inputAsset
  )}&amount=${encodeURIComponent(inputAmount)}&source=${encodeURIComponent(
    sourceAddress
  )}&destination=${encodeURIComponent(destinationAddress)}&mode=MIX`;

  return (
    <div className="min-h-screen bg-[#0C0C0C] text-[#F5F5F7] flex flex-col selection:bg-[#A6DCF8]/20 selection:text-[#F5F5F7]">
      <Suspense fallback={null}>
        <MixSetupParamsSync onParams={handleSyncParams} />
      </Suspense>

      {/* Header */}
      <MixHeader backHref={executionBackHref} backLabel="EXECUTION STRATEGY" />

      {/* Progress */}
      <MixProgress currentStep={1} />

      {/* Main Setup Content */}
      <main className="flex-1 max-w-xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 animate-fade-in flex flex-col items-center">
        {/* Intro */}
        <div className="w-full text-center max-w-md mb-8">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#92929B] uppercase mb-1.5">
            04 / MIX CONFIGURATION
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F5F5F7] mb-2">
            Configure Private Mix
          </h1>
          <p className="text-xs sm:text-sm text-[#92929B] leading-relaxed">
            Commit assets to confidential enclave pooling. Assets are batch-processed
            to eliminate transaction graph linkage before shielded settlement.
          </p>
        </div>

        {/* Input Panels */}
        <div className="w-full space-y-4">
          {/* Primary Deposit Asset Input */}
          <AssetInput
            asset="ETH"
            name="Ethereum"
            amount={inputAmount}
            onChangeAmount={setInputAmount}
            availableBalance={ethBalance}
            onMaxClick={handleMaxClick}
            error={validation.error}
            label="Committed Asset (ETH)"
            sublabel="Assets will be deposited into single-use enclave custody."
          />

          {/* Directional Indicator */}
          <div className="flex justify-center -my-2 relative z-10">
            <div className="w-8 h-8 rounded-full bg-[#18181D] border border-[#292930] flex items-center justify-center text-[#A6DCF8] shadow-md">
              <ArrowDown size={14} />
            </div>
          </div>

          {/* Estimated Shielded Allocation (USDC) */}
          <AssetInput
            asset="USDC"
            name="USD Coin"
            amount={quoteCalculation.estimatedOutput}
            onChangeAmount={() => {}}
            availableBalance={usdcBalance}
            isReadOnly
            label="Estimated Shielded Allocation (USDC)"
            sublabel="Calculated oracle allocation allocated inside private pool."
          />

          {/* Conversion Details Summary */}
          <ConversionSummary
            inputAsset={inputAsset}
            calculation={quoteCalculation}
          />

          {/* Dynamic Balance Breakdown */}
          <BalanceBreakdown
            inputAsset={inputAsset}
            committedAmount={inputAmount}
            ethBalance={ethBalance}
            usdcBalance={usdcBalance}
            remainingBalance={remaining}
            isInsufficient={isInsufficient}
          />

          {/* Supporting Protocol Note */}
          <div className="p-4 rounded-xl bg-[#141418] border border-[#292930] text-xs font-mono text-[#92929B] space-y-1.5 text-left">
            <div className="text-[11px] font-semibold text-[#F5F5F7] uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-[#A6DCF8]" />
              <span>Next: Transaction Inspection</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Clicking continue advances to the final review screen where all session parameters,
              fees, and destination keys can be verified before execution.
            </p>
          </div>

          {/* Primary CTA Button */}
          <div className="pt-3">
            <button
              type="button"
              disabled={!canContinue}
              onClick={handleContinue}
              className={`w-full py-3.5 px-6 rounded-xl font-mono text-xs font-semibold tracking-wider uppercase transition-all duration-200 flex items-center justify-center gap-2 ${
                canContinue
                  ? "bg-[#A6DCF8] text-[#0C0C0C] hover:bg-[#BDE7FC] shadow-[0_0_20px_rgba(166,220,248,0.25)] active:scale-[0.98] cursor-pointer"
                  : "bg-[#18181D] text-[#666670] border border-[#292930] cursor-not-allowed opacity-50"
              }`}
            >
              <span>CONTINUE TO REVIEW</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}