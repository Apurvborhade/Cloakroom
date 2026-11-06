"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, History } from "lucide-react";
import { PoolHeader } from "@/components/pool/PoolHeader";
import { PoolProgress } from "@/components/pool/PoolProgress";
import { OrderTypeSelector } from "@/components/pool/OrderTypeSelector";
import { MarketOrderForm } from "@/components/pool/MarketOrderForm";
import { LimitOrderForm } from "@/components/pool/LimitOrderForm";
import { PriceInformation } from "@/components/pool/PriceInformation";
import { useWallet } from "@/hooks/useWallet";
import {
  PoolOrderType,
  PoolOrderConfig,
} from "@/lib/pool/types";
import {
  calculateMarketQuote,
  calculateLimitQuote,
  REFERENCE_ETH_PRICE,
} from "@/lib/pool/calculations";
import {
  validatePoolSellAmount,
  validateLimitTargetPrice,
} from "@/lib/pool/validation";
import {
  savePoolConfig,
  loadPoolConfig,
  getActiveLimitOrders,
} from "@/lib/pool/state";

function PoolParamsSync({
  onParams,
}: {
  onParams: (params: {
    amount?: string;
    source?: string;
    destination?: string;
    network?: string;
    type?: PoolOrderType;
  }) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const amount = searchParams.get("amount") || undefined;
    const source = searchParams.get("source") || undefined;
    const destination = searchParams.get("destination") || undefined;
    const network = searchParams.get("network") || undefined;
    const rawType = searchParams.get("type")?.toUpperCase();
    const type: PoolOrderType | undefined =
      rawType === "LIMIT" ? "LIMIT" : rawType === "MARKET" ? "MARKET" : undefined;

    if (amount || source || destination || network || type) {
      onParams({ amount, source, destination, network, type });
    }
  }, [searchParams, onParams]);

  return null;
}

export default function PoolPage() {
  const router = useRouter();
  const { account, balance: liveEthBalance, networkName } = useWallet();

  // Active form state
  const [orderType, setOrderType] = useState<PoolOrderType>("MARKET");
  const [sellAmount, setSellAmount] = useState<string>("1.0");
  const [targetPrice, setTargetPrice] = useState<string>("3500");
  const [expiryDuration, setExpiryDuration] = useState<string>("7 Days");

  // Transfer routing params (inherited from Screen 2 & 3)
  const [sourceAddress, setSourceAddress] = useState<string>(
    account || "0x71C568a8F9B60471f54aC482C400cCE9C298B319"
  );
  const [destinationAddress, setDestinationAddress] = useState<string>(
    "0x98bF32D034c568A9412F581b83F11A48809F32d1"
  );
  const [network, setNetwork] = useState<string>(networkName || "Sepolia Testnet");

  // Error states
  const [sellError, setSellError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  // Active orders count
  const [activeOrderCount, setActiveOrderCount] = useState<number>(0);

  // Sync wallet address if connected
  useEffect(() => {
    if (account) {
      setSourceAddress(account);
    }
    if (networkName) {
      setNetwork(networkName);
    }
  }, [account, networkName]);

  // Load existing config and active order count on mount
  useEffect(() => {
    const saved = loadPoolConfig();
    if (saved) {
      setOrderType(saved.orderType);
      if (saved.sellAmount) setSellAmount(saved.sellAmount);
      if (saved.targetPrice) setTargetPrice(saved.targetPrice);
      if (saved.expiryDuration) setExpiryDuration(saved.expiryDuration);
      if (saved.sourceAddress) setSourceAddress(saved.sourceAddress);
      if (saved.destinationAddress) setDestinationAddress(saved.destinationAddress);
      if (saved.network) setNetwork(saved.network);
    }

    const active = getActiveLimitOrders();
    setActiveOrderCount(active.length);
  }, []);

  // Handle URL query parameters
  const handleParams = useCallback(
    (params: {
      amount?: string;
      source?: string;
      destination?: string;
      network?: string;
      type?: PoolOrderType;
    }) => {
      if (params.type) setOrderType(params.type);
      if (params.amount) setSellAmount(params.amount);
      if (params.source) setSourceAddress(params.source);
      if (params.destination) setDestinationAddress(params.destination);
      if (params.network) setNetwork(params.network);
    },
    []
  );

  // Calculations
  const marketQuote = calculateMarketQuote(sellAmount, REFERENCE_ETH_PRICE);
  const limitQuote = calculateLimitQuote(sellAmount, targetPrice, REFERENCE_ETH_PRICE);

  // Real-time validation
  const validateForm = (): boolean => {
    const sVal = validatePoolSellAmount(sellAmount, liveEthBalance);
    setSellError(sVal.error);

    if (orderType === "LIMIT") {
      const tVal = validateLimitTargetPrice(targetPrice);
      setTargetError(tVal.error);
      return sVal.isValid && tVal.isValid;
    }

    return sVal.isValid;
  };

  const isFormValid =
    orderType === "MARKET"
      ? validatePoolSellAmount(sellAmount, liveEthBalance).isValid
      : validatePoolSellAmount(sellAmount, liveEthBalance).isValid &&
        validateLimitTargetPrice(targetPrice).isValid;

  // Handle Review Proceed
  const handleReviewProceed = () => {
    if (!validateForm()) return;

    const estimatedOutput =
      orderType === "MARKET"
        ? marketQuote.estimatedUsdcOutput
        : limitQuote.expectedUsdcOutput;

    const feeAmount =
      orderType === "MARKET" ? marketQuote.feeAmount : limitQuote.feeAmount;

    const config: PoolOrderConfig = {
      orderType,
      tradingPair: "ETH/USDC",
      sellAsset: "ETH",
      buyAsset: "USDC",
      sellAmount,
      targetPrice: orderType === "LIMIT" ? targetPrice : undefined,
      currentPrice: REFERENCE_ETH_PRICE,
      estimatedOutput,
      minimumReceived:
        orderType === "MARKET" ? marketQuote.minimumReceived : undefined,
      slippageTolerance: 0.005,
      feePercent: 0.001,
      feeAmount,
      expiryDuration: orderType === "LIMIT" ? expiryDuration : undefined,
      network,
      sourceAddress,
      destinationAddress,
      quoteTimestamp: new Date().toISOString(),
    };

    savePoolConfig(config);
    router.push("/pool/review");
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#17191D] flex flex-col selection:bg-[#377FA5]/15 selection:text-[#17191D]">
      <Suspense fallback={null}>
        <PoolParamsSync onParams={handleParams} />
      </Suspense>

      {/* Navigation Header */}
      <PoolHeader
        activeOrdersCount={activeOrderCount}
        backHref="/execution"
      />

      {/* Main Content */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 font-mono">
        {/* Step Progress Tracker */}
        <PoolProgress currentStep={1} />

        {/* Section Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E7F3FA] border border-[#CDE5F3] text-[11px] text-[#377FA5] tracking-wider uppercase font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#377FA5] animate-pulse" />
            <span>CONFIDENTIAL TEE EXCHANGE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17191D] uppercase">
            POOL EXECUTION TRADING
          </h1>
          <p className="text-xs sm:text-sm text-[#626A75] max-w-lg mx-auto leading-relaxed">
            Trade ETH to USDC directly with zero public mempool leakage, MEV front-running protection, and deterministic settlement.
          </p>
        </div>

        {/* Order Type Selector Tabs */}
        <div className="flex flex-col items-center gap-3">
          <OrderTypeSelector orderType={orderType} onChange={setOrderType} />
        </div>

        {/* Form Container */}
        <div className="space-y-6">
          {orderType === "MARKET" ? (
            <MarketOrderForm
              sellAmount={sellAmount}
              onSellAmountChange={(val) => {
                setSellAmount(val);
                setSellError(null);
              }}
              onMaxClick={() => {
                if (liveEthBalance) {
                  setSellAmount(liveEthBalance);
                  setSellError(null);
                }
              }}
              quote={marketQuote}
              availableEthBalance={liveEthBalance}
              availableUsdcBalance="0.00"
              error={sellError}
            />
          ) : (
            <LimitOrderForm
              sellAmount={sellAmount}
              onSellAmountChange={(val) => {
                setSellAmount(val);
                setSellError(null);
              }}
              targetPrice={targetPrice}
              onTargetPriceChange={(val) => {
                setTargetPrice(val);
                setTargetError(null);
              }}
              expiryDuration={expiryDuration}
              onExpiryDurationChange={setExpiryDuration}
              onMaxClick={() => {
                if (liveEthBalance) {
                  setSellAmount(liveEthBalance);
                  setSellError(null);
                }
              }}
              quote={limitQuote}
              availableEthBalance={liveEthBalance}
              amountError={sellError}
              priceError={targetError}
            />
          )}

          {/* Technical Price & Enclave Liquidity Breakdown */}
          <PriceInformation
            orderType={orderType}
            currentPrice={REFERENCE_ETH_PRICE}
            targetPrice={targetPrice}
            priceDeltaPercent={limitQuote.priceDeltaPercent}
            minimumReceived={marketQuote.minimumReceived}
            network={network}
          />

          {/* Action CTA & Orders Link */}
          <div className="space-y-4 pt-2">
            <button
              type="button"
              onClick={handleReviewProceed}
              disabled={!isFormValid}
              className="w-full py-3.5 px-6 rounded-xl bg-[#17191D] hover:bg-[#2B303B] disabled:bg-[#E3E6EB] disabled:text-[#9299A3] disabled:cursor-not-allowed text-white font-semibold text-xs uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-2 focus:outline-none"
            >
              <span>
                {orderType === "MARKET"
                  ? "REVIEW MARKET ORDER"
                  : "REVIEW LIMIT CONDITIONAL ORDER"}
              </span>
              <ArrowRight size={15} />
            </button>

            {/* Sub-links */}
            <div className="flex items-center justify-between text-xs text-[#626A75] px-1">
              <Link
                href="/execution"
                className="hover:text-[#17191D] transition-colors"
              >
                ← Back to Mode Selection
              </Link>

              <Link
                href="/pool/orders"
                className="hover:text-[#377FA5] transition-colors flex items-center gap-1.5 font-medium"
              >
                <History size={13} />
                <span>Orders Dashboard ({activeOrderCount} Active)</span>
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#E3E6EB] py-6 px-4 text-center text-xs text-[#9299A3] font-mono">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>DETERMINISTIC TEE EXECUTION</span>
        </div>
      </footer>
    </div>
  );
}
