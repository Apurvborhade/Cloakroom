"use client";

import React, { useState, useEffect, Suspense, useCallback, useRef } from "react";
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

  const lifecycleInitiatedRef = useRef<boolean>(false);

  useEffect(() => {
    const saved = loadPoolConfig();
    if (saved && saved.sellAmount) {
      setConfig(saved);
    }
    setIsReady(true);
  }, []);

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
      if (params.orderId) {
        const found = getPoolOrderById(params.orderId);
        if (found) {
          setOrder(found);
          lifecycleInitiatedRef.current = true;
          return;
        }
      }

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

  useEffect(() => {
    if (!config || lifecycleInitiatedRef.current) return;
    lifecycleInitiatedRef.current = true;

    const assignedId = `POOL-${config.orderType}-${Date.now().toString(36).toUpperCase()}`;

    const newRecord: PoolOrderRecord = {
      id: assignedId,
      orderType: config.orderType,
      tradingPair: "ETH/USDC",
      sellAsset: "ETH",
      buyAsset: "USDC",
      sellAmount: config.sellAmount,
      targetPrice: config.targetPrice,
      estimatedOutput: config.estimatedOutput,
      feeAmount: config.feeAmount,
      network: config.network,
      sourceAddress: config.sourceAddress,
      destinationAddress: config.destinationAddress,
      status: "preparing",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSimulation: true,
    };

    setOrder(newRecord);
    savePoolOrder(newRecord);

    const timer1 = setTimeout(() => {
      newRecord.status = "awaiting_signature";
      newRecord.updatedAt = new Date().toISOString();
      setOrder({ ...newRecord });
      savePoolOrder(newRecord);

      const timer2 = setTimeout(() => {
        newRecord.status = "submitted";
        newRecord.updatedAt = new Date().toISOString();
        setOrder({ ...newRecord });
        savePoolOrder(newRecord);

        if (config.orderType === "MARKET") {
          const timer3 = setTimeout(() => {
            newRecord.status = "processing";
            newRecord.updatedAt = new Date().toISOString();
            setOrder({ ...newRecord });
            savePoolOrder(newRecord);

            const timer4 = setTimeout(() => {
              newRecord.status = "completed";
              newRecord.completedAt = new Date().toISOString();
              newRecord.actualOutput = config.estimatedOutput;
              newRecord.updatedAt = new Date().toISOString();
              newRecord.txHash = null;
              setOrder({ ...newRecord });
              savePoolOrder(newRecord);
            }, 2500);

            return () => clearTimeout(timer4);
          }, 1500);

          return () => clearTimeout(timer3);
        } else {
          const timerLimit = setTimeout(() => {
            newRecord.status = "active_waiting";
            newRecord.updatedAt = new Date().toISOString();
            setOrder({ ...newRecord });
            savePoolOrder(newRecord);
          }, 1500);

          return () => clearTimeout(timerLimit);
        }
      }, 1800);

      return () => clearTimeout(timer2);
    }, 1200);

    return () => clearTimeout(timer1);
  }, [config]);

  const handleConfirmAddFunds = (additionalEth: string) => {
    if (!order) return;
    const updated = addFundsToPoolOrder(order.id, additionalEth);
    if (updated) {
      setOrder({ ...updated });
    }
  };

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
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <PoolExecutionParamsSync onParams={handleSyncParams} />
      </Suspense>

      <PoolHeader backHref="/pool" backLabel="TRADE" />

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8 font-mono">
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
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C222B] border border-[#232B36] text-[11px] text-[#3B82F6] tracking-wider uppercase font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6] animate-pulse" />
                <span>CONFIDENTIAL ORDER STATUS & MANAGEMENT</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8] uppercase">
                ORDER MONITORING & MANAGEMENT
              </h1>
              <p className="text-xs sm:text-sm text-[#94A3B8] max-w-lg mx-auto leading-relaxed">
                Real-time tracking of committed assets, execution lifecycle status, fund modification, and unconditional cancellation.
              </p>
            </div>

            {!account && (
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-amber-300">
                  <Wallet size={15} className="text-amber-400 shrink-0" />
                  <span>Wallet Disconnected: Connect your Web3 wallet to authorize allocations or manage funds.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setWalletModalOpen(true)}
                  className="py-1.5 px-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold whitespace-nowrap transition-colors shadow-lg cursor-pointer"
                >
                  Connect Wallet
                </button>
              </div>
            )}

            <OrderOverviewCard order={order} />
            <OrderProgressTimeline orderType={order.orderType} status={order.status} />
            <OrderFinancialBreakdown order={order} availableEthBalance={liveEthBalance} />
            <OrderActionControls
              order={order}
              onOpenAddFunds={() => setIsAddFundsOpen(true)}
              onOpenCancel={() => setIsCancelOpen(true)}
              onSimulateTargetHit={handleSimulateTargetHit}
              onProceedToSuccess={handleProceedToSuccess}
            />
            <WalletNavigationBanner />
          </>
        ) : null}
      </main>

      {order && (
        <AddFundsModal
          isOpen={isAddFundsOpen}
          order={order}
          availableEthBalance={liveEthBalance}
          onClose={() => setIsAddFundsOpen(false)}
          onConfirmAddFunds={handleConfirmAddFunds}
        />
      )}

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

      <WalletModal
        isOpen={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
      />

      <footer className="border-t border-[#232B36] py-6 px-4 text-center text-xs text-[#505D6E] font-mono bg-[#12161D]">
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <span>NONY PROTOCOL • ENCLAVE POOL ENGINE</span>
          <span>ORDER STATUS & MANAGEMENT PIPELINE</span>
        </div>
      </footer>
    </div>
  );
}
