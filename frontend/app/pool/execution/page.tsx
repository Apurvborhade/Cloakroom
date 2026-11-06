"use client";

import React, { useState, useEffect, Suspense, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PoolHeader } from "@/components/pool/PoolHeader";
import { PoolProgress } from "@/components/pool/PoolProgress";
import { OrderOverviewCard } from "@/components/pool/OrderOverviewCard";
import { OrderProgressTimeline } from "@/components/pool/OrderProgressTimeline";
import { OrderFinancialBreakdown } from "@/components/pool/OrderFinancialBreakdown";
import { OrderActionControls } from "@/components/pool/OrderActionControls";
import { WalletNavigationBanner } from "@/components/pool/WalletNavigationBanner";
import { AddFundsModal } from "@/components/pool/AddFundsModal";
import { CancelOrderModal } from "@/components/pool/CancelOrderModal";
import { PoolEmptyState } from "@/components/pool/PoolEmptyState";
import { WalletModal } from "@/components/WalletModal";
import { Wallet } from "lucide-react";
import {
  PoolOrderConfig,
  PoolOrderType,
  PoolOrderRecord,
} from "@/lib/pool/types";
import {
  loadPoolConfig,
  savePoolConfig,
  savePoolOrder,
  getPoolOrderById,
  cancelPoolOrder,
  addFundsToPoolOrder,
  requestCancelPoolOrder,
} from "@/lib/pool/state";
import {
  calculateMarketQuote,
  calculateLimitQuote,
  REFERENCE_ETH_PRICE,
} from "@/lib/pool/calculations";
import { useWallet } from "@/hooks/useWallet";

function PoolExecutionParamsSync({
  onParams,
}: {
  onParams: (params: {
    orderId?: string;
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
    const orderId = searchParams.get("orderId") || undefined;
    const rawType = searchParams.get("type")?.toUpperCase();
    const type: PoolOrderType | undefined =
      rawType === "LIMIT" ? "LIMIT" : rawType === "MARKET" ? "MARKET" : undefined;
    const amount = searchParams.get("amount") || undefined;
    const targetPrice = searchParams.get("targetPrice") || undefined;
    const source = searchParams.get("source") || undefined;
    const destination = searchParams.get("destination") || undefined;
    const network = searchParams.get("network") || undefined;

    if (orderId || amount || type || targetPrice || source || destination || network) {
      onParams({ orderId, type, amount, targetPrice, source, destination, network });
    }
  }, [searchParams, onParams]);

  return null;
}

export default function PoolExecutionPage() {
  const router = useRouter();
  const { account, balance: liveEthBalance } = useWallet();

  const [config, setConfig] = useState<PoolOrderConfig | null>(null);
  const [order, setOrder] = useState<PoolOrderRecord | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  // Modals state
  const [isAddFundsOpen, setIsAddFundsOpen] = useState<boolean>(false);
  const [isCancelOpen, setIsCancelOpen] = useState<boolean>(false);
  const [walletModalOpen, setWalletModalOpen] = useState<boolean>(false);

  // Prevent duplicate execution lifecycle triggers on re-render
  const lifecycleInitiatedRef = useRef<boolean>(false);

  // Initial load from session storage
  useEffect(() => {
    const saved = loadPoolConfig();
    if (saved && saved.sellAmount) {
      setConfig(saved);
    }
    setIsReady(true);
  }, []);

  // Synchronize URL parameters if navigated with direct query
  const handleSyncParams = useCallback(
    (params: {
      orderId?: string;
      type?: PoolOrderType;
      amount?: string;
      targetPrice?: string;
      source?: string;
      destination?: string;
      network?: string;
    }) => {
      // 1. If an existing order ID is provided, load that exact record
      if (params.orderId) {
        const found = getPoolOrderById(params.orderId);
        if (found) {
          setOrder(found);

          const derivedConfig: PoolOrderConfig = {
            orderType: found.orderType,
            tradingPair: found.tradingPair,
            sellAsset: found.sellAsset,
            buyAsset: found.buyAsset,
            sellAmount: found.sellAmount,
            targetPrice: found.targetPrice,
            currentPrice: REFERENCE_ETH_PRICE,
            estimatedOutput: found.estimatedOutput,
            slippageTolerance: 0.005,
            feePercent: 0.001,
            feeAmount: found.feeAmount,
            network: found.network,
            sourceAddress: found.sourceAddress,
            destinationAddress: found.destinationAddress,
            quoteTimestamp: found.createdAt,
          };
          setConfig(derivedConfig);
          return;
        }
      }

      // 2. Otherwise derive config if parameters are provided
      if (params.amount && !config) {
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
    [config]
  );

  // Lifecycle Runner: Advances lifecycle states deterministically
  useEffect(() => {
    if (!config || lifecycleInitiatedRef.current) return;

    // Check if we are already viewing a loaded order
    if (order && order.id) {
      return;
    }

    lifecycleInitiatedRef.current = true;

    // Create a new order record
    const newOrderId = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.floor(
      Math.random() * 1000
    )}`;
    const newBatchId = `ENCLAVE-POOL-${Date.now().toString(36).toUpperCase()}`;

    const initialRecord: PoolOrderRecord = {
      id: newOrderId,
      orderType: config.orderType,
      tradingPair: config.tradingPair,
      sellAsset: config.sellAsset,
      buyAsset: config.buyAsset,
      sellAmount: config.sellAmount,
      targetPrice: config.targetPrice,
      estimatedOutput: config.estimatedOutput,
      feeAmount: config.feeAmount,
      network: config.network,
      sourceAddress: config.sourceAddress,
      destinationAddress: config.destinationAddress,
      status: config.orderType === "LIMIT" ? "order_created" : "preparing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      batchId: newBatchId,
      isSimulation: true,
    };

    savePoolOrder(initialRecord);
    setOrder(initialRecord);

    if (config.orderType === "MARKET") {
      // Market Flow: preparing -> awaiting_signature -> submitted -> processing -> completed
      const t1 = setTimeout(() => {
        initialRecord.status = "awaiting_signature";
        initialRecord.updatedAt = new Date().toISOString();
        savePoolOrder(initialRecord);
        setOrder({ ...initialRecord });

        const t2 = setTimeout(() => {
          initialRecord.status = "submitted";
          initialRecord.updatedAt = new Date().toISOString();
          savePoolOrder(initialRecord);
          setOrder({ ...initialRecord });

          const t3 = setTimeout(() => {
            initialRecord.status = "processing";
            initialRecord.updatedAt = new Date().toISOString();
            savePoolOrder(initialRecord);
            setOrder({ ...initialRecord });

            const t4 = setTimeout(() => {
              initialRecord.status = "completed";
              initialRecord.completedAt = new Date().toISOString();
              initialRecord.updatedAt = new Date().toISOString();
              initialRecord.actualOutput = config.estimatedOutput;
              initialRecord.txHash = null; // Honest: Off-chain enclave batch settlement
              savePoolOrder(initialRecord);
              setOrder({ ...initialRecord });
            }, 2500);

            return () => clearTimeout(t4);
          }, 1800);

          return () => clearTimeout(t3);
        }, 1600);

        return () => clearTimeout(t2);
      }, 1000);

      return () => clearTimeout(t1);
    } else {
      // Limit Flow: order_created -> funds_reserved -> awaiting_signature -> submitted -> active_waiting
      const t1 = setTimeout(() => {
        initialRecord.status = "funds_reserved";
        initialRecord.updatedAt = new Date().toISOString();
        savePoolOrder(initialRecord);
        setOrder({ ...initialRecord });

        const t2 = setTimeout(() => {
          initialRecord.status = "awaiting_signature";
          initialRecord.updatedAt = new Date().toISOString();
          savePoolOrder(initialRecord);
          setOrder({ ...initialRecord });

          const t3 = setTimeout(() => {
            initialRecord.status = "submitted";
            initialRecord.updatedAt = new Date().toISOString();
            savePoolOrder(initialRecord);
            setOrder({ ...initialRecord });

            const t4 = setTimeout(() => {
              // Reaches active_waiting and rests in confidential book without closing
              initialRecord.status = "active_waiting";
              initialRecord.updatedAt = new Date().toISOString();
              savePoolOrder(initialRecord);
              setOrder({ ...initialRecord });
            }, 1600);

            return () => clearTimeout(t4);
          }, 1400);

          return () => clearTimeout(t3);
        }, 1200);

        return () => clearTimeout(t2);
      }, 900);

      return () => clearTimeout(t1);
    }
  }, [config, order]);

  // Handle Add Funds Action
  const handleConfirmAddFunds = (additionalEth: string) => {
    if (!order) return;
    const updated = addFundsToPoolOrder(order.id, additionalEth);
    if (updated) {
      setOrder({ ...updated });
    }
  };

  // Handle Cancel Order Action
  const handleConfirmCancel = (orderId: string) => {
    requestCancelPoolOrder(orderId);
    const success = cancelPoolOrder(orderId);
    if (success && order) {
      setOrder({
        ...order,
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  };

  // Handle Dev Simulation: Target Price Spike Hit
  const handleSimulateTargetHit = () => {
    if (!order || order.status !== "active_waiting") return;

    order.status = "condition_met";
    order.updatedAt = new Date().toISOString();
    savePoolOrder(order);
    setOrder({ ...order });

    setTimeout(() => {
      order.status = "executing";
      order.updatedAt = new Date().toISOString();
      savePoolOrder(order);
      setOrder({ ...order });

      setTimeout(() => {
        order.status = "completed";
        order.completedAt = new Date().toISOString();
        order.updatedAt = new Date().toISOString();
        order.actualOutput = order.estimatedOutput;
        order.txHash = null;
        savePoolOrder(order);
        setOrder({ ...order });
      }, 2000);
    }, 1500);
  };

  const handleProceedToSuccess = () => {
    router.push("/pool/success");
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#17191D] flex flex-col selection:bg-[#377FA5]/15 selection:text-[#17191D]">
      <Suspense fallback={null}>
        <PoolExecutionParamsSync onParams={handleSyncParams} />
      </Suspense>

      {/* Navigation Header */}
      <PoolHeader backHref="/pool" backLabel="TRADE" />

      {/* Main Content */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 font-mono">
        {/* Step Progress Tracker */}
        <PoolProgress currentStep={3} />

        {isReady && !order ? (
          <PoolEmptyState
            title="No Active Order Selected"
            description="No order was found to monitor. Please create an order or select an existing one from your orders dashboard."
            primaryHref="/pool"
            primaryLabel="CREATE POOL ORDER"
          />
        ) : order ? (
          <>
            {/* Screen Category Title */}
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#E7F3FA] border border-[#CDE5F3] text-[11px] text-[#377FA5] tracking-wider uppercase font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#377FA5] animate-pulse" />
                <span>CONFIDENTIAL ORDER STATUS & MANAGEMENT</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17191D] uppercase">
                ORDER MONITORING & MANAGEMENT
              </h1>
              <p className="text-xs sm:text-sm text-[#626A75] max-w-lg mx-auto leading-relaxed">
                Real-time tracking of committed assets, execution lifecycle status, fund modification, and unconditional cancellation.
              </p>
            </div>

            {/* Missing Wallet Notice */}
            {!account && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-amber-800">
                  <Wallet size={15} className="text-amber-600 shrink-0" />
                  <span>Wallet Disconnected: Connect your Web3 wallet to authorize allocations or manage funds.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletModalOpen(true)}
                  className="py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold whitespace-nowrap transition-colors shadow-xs"
                >
                  Connect Wallet
                </button>
              </div>
            )}

            {/* B. Order Overview Card */}
            <OrderOverviewCard order={order} />

            {/* C. Order Progress Tracker (Visual Timeline) */}
            <OrderProgressTimeline
              orderType={order.orderType}
              status={order.status}
            />

            {/* D. Financial Breakdown Card */}
            <OrderFinancialBreakdown
              order={order}
              availableEthBalance={liveEthBalance}
            />

            {/* E. Order Management Actions (Add Funds / Cancel Order) */}
            <OrderActionControls
              order={order}
              onOpenAddFunds={() => setIsAddFundsOpen(true)}
              onOpenCancel={() => setIsCancelOpen(true)}
              onSimulateTargetHit={handleSimulateTargetHit}
              onProceedToSuccess={handleProceedToSuccess}
            />

            {/* F. Wallet Navigation Banner */}
            <WalletNavigationBanner />
          </>
        ) : null}
      </main>

      {/* Primary Action Modal: Add Funds */}
      {order && (
        <AddFundsModal
          isOpen={isAddFundsOpen}
          order={order}
          availableEthBalance={liveEthBalance}
          onClose={() => setIsAddFundsOpen(false)}
          onConfirmAddFunds={handleConfirmAddFunds}
        />
      )}

      {/* Secondary Action Modal: Cancel Order */}
      {order && (
        <CancelOrderModal
          isOpen={isCancelOpen}
          orderId={order.id}
          sellAmount={order.sellAmount}
          sellAsset={order.sellAsset}
          targetPrice={order.targetPrice}
          orderType={order.orderType}
          onClose={() => setIsCancelOpen(false)}
          onConfirm={handleConfirmCancel}
        />
      )}

      {/* Wallet Modal */}
      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />

      {/* Footer */}
      <footer className="border-t border-[#E3E6EB] py-6 px-4 text-center text-xs text-[#9299A3] font-mono">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>ORDER STATUS & MANAGEMENT PIPELINE</span>
        </div>
      </footer>
    </div>
  );
}