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

  const [orderType, setOrderType] = useState<PoolOrderType>("MARKET");
  const [sellAmount, setSellAmount] = useState<string>("1.0");
  const [targetPrice, setTargetPrice] = useState<string>("3500");
  const [expiryDuration, setExpiryDuration] = useState<string>("7 Days");

  const [sourceAddress, setSourceAddress] = useState<string>(
    account || "0x71C568a8F9B60471f54aC482C400cCE9C298B319"
  );
  const [destinationAddress, setDestinationAddress] = useState<string>(
    "0x98bF32D034c568A9412F581b83F11A48809F32d1"
  );
  const [network, setNetwork] = useState<string>(networkName || "Sepolia Testnet");

  const [sellError, setSellError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [activeOrderCount, setActiveOrderCount] = useState<number>(0);

  useEffect(() => {
    if (account) {
      setSourceAddress(account);
    }
    if (networkName) {
      setNetwork(networkName);
    }
  }, [account, networkName]);

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

  const marketQuote = calculateMarketQuote(sellAmount, REFERENCE_ETH_PRICE);
  const limitQuote = calculateLimitQuote(sellAmount, targetPrice, REFERENCE_ETH_PRICE);

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
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <PoolParamsSync onParams={handleParams} />
      </Suspense>

      <PoolHeader
        activeOrdersCount={activeOrderCount}
        backHref="/execution"
      />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 font-mono">
        <PoolProgress currentStep={1} />

        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] text-[11px] text-[#3B82F6] tracking-wider uppercase font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse" />
            <span>CONFIDENTIAL TEE EXCHANGE</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8] uppercase">
            POOL EXECUTION TRADING
          </h1>
          <p className="text-xs sm:text-sm text-[#94A3B8] max-w-lg mx-auto leading-relaxed">
            Trade ETH to USDC directly with zero public mempool leakage, MEV front-running protection, and deterministic settlement.
          </p>
        </div>

        <div className="flex flex-col items-center gap-3">
          <OrderTypeSelector orderType={orderType} onChange={setOrderType} />
        </div>

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

          <PriceInformation
            orderType={orderType}
            currentPrice={REFERENCE_ETH_PRICE}
            targetPrice={targetPrice}
            priceDeltaPercent={limitQuote.priceDeltaPercent}
            minimumReceived={marketQuote.minimumReceived}
            network={network}
          />

          <div className="space-y-4 pt-2">
            <button
              type="button"
              onClick={handleReviewProceed}
              disabled={!isFormValid}
              className="w-full py-4 px-6 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] disabled:bg-[#1C222B] disabled:text-[#505D6E] disabled:cursor-not-allowed text-white font-bold text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(59,130,246,0.25)] flex items-center justify-center gap-2 focus:outline-none cursor-pointer"
            >
              <span>
                {orderType === "MARKET"
                  ? "REVIEW MARKET ORDER"
                  : "REVIEW LIMIT CONDITIONAL ORDER"}
              </span>
              <ArrowRight size={15} />
            </button>

            <div className="flex items-center justify-between text-xs text-[#94A3B8] px-1">
              <Link
                href="/execution"
                className="hover:text-[#F0F4F8] transition-colors"
              >
                ← Back to Mode Selection
              </Link>

              <Link
                href="/pool/orders"
                className="hover:text-[#3B82F6] transition-colors flex items-center gap-1.5 font-bold"
              >
                <History size={13} />
                <span>Orders Dashboard ({activeOrderCount} Active)</span>
              </Link>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#232B36] py-6 px-4 text-center text-xs text-[#505D6E] font-mono bg-[#12161D]">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>DETERMINISTIC TEE EXECUTION</span>
        </div>
      </footer>
    </div>
  );
}
