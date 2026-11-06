"use client";

import React, { useState, useEffect, Suspense, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MixHeader } from "@/components/mix/MixHeader";
import { MixProgress } from "@/components/mix/MixProgress";
import { MixExecutionStatus } from "@/components/mix/MixExecutionStatus";
import { MixEmptyState } from "@/components/mix/MixEmptyState";
import {
  MixConfig,
  MixExecutionState,
  MixExecutionRecord,
  MixAssetSymbol,
} from "@/lib/mix/types";
import { loadMixConfig, saveMixExecution } from "@/lib/mix/state";
import { calculateMixQuote } from "@/lib/mix/calculations";
import { useWallet } from "@/hooks/useWallet";

function MixExecutionParamsSync({
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

export default function MixExecutionPage() {
  const router = useRouter();
  const { account } = useWallet();

  const [config, setConfig] = useState<MixConfig | null>(null);
  const [isReady, setIsReady] = useState(false);

  const [status, setStatus] = useState<MixExecutionState>("preparing");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSimulation, setIsSimulation] = useState<boolean>(true);

  const executionStartedRef = useRef(false);

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
      if (!config) {
        const quote = calculateMixQuote(params.asset, params.amount);
        const derived: MixConfig = {
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
        setConfig(derived);
      }
    },
    [config]
  );

  const runExecutionSequence = useCallback(
    async (cfg: MixConfig) => {
      setStatus("preparing");
      setErrorMessage(null);

      const assignedBatch = `ENCLAVE-MIX-${Date.now().toString(36).toUpperCase()}`;
      setBatchId(assignedBatch);

      await new Promise((r) => setTimeout(r, 1200));

      setStatus("awaiting_signature");

      if (typeof window !== "undefined" && (window as any).ethereum && account) {
        try {
          const ethereum = (window as any).ethereum;
          const msg = `NONY Mix Intent:\nBatch: ${assignedBatch}\nAsset: ${cfg.inputAmount} ${cfg.inputAsset}\nDestination: ${cfg.destinationAddress}\nTimestamp: ${new Date().toISOString()}`;
          const hexMsg = `0x${Buffer.from(msg, "utf8").toString("hex")}`;

          await ethereum.request({
            method: "personal_sign",
            params: [hexMsg, account],
          });

          setIsSimulation(false);
        } catch (err: any) {
          if (err?.code === 4001) {
            setStatus("cancelled");
            setErrorMessage("Authorization cancelled by user in wallet.");
            return;
          }
          setIsSimulation(true);
        }
      } else {
        setIsSimulation(true);
        await new Promise((r) => setTimeout(r, 1500));
      }

      setStatus("submitted");
      await new Promise((r) => setTimeout(r, 1400));

      setStatus("processing");
      await new Promise((r) => setTimeout(r, 2600));

      setStatus("completed");

      const completedRecord: MixExecutionRecord = {
        id: assignedBatch,
        config: cfg,
        status: "completed",
        txHash: null,
        batchId: assignedBatch,
        startedAt: new Date(Date.now() - 5000).toISOString(),
        completedAt: new Date().toISOString(),
        errorMessage: null,
        isSimulation,
      };

      saveMixExecution(completedRecord);
    },
    [account, isSimulation]
  );

  useEffect(() => {
    if (config && !executionStartedRef.current) {
      executionStartedRef.current = true;
      runExecutionSequence(config);
    }
  }, [config, runExecutionSequence]);

  const handleRetry = () => {
    if (config) {
      runExecutionSequence(config);
    }
  };

  const handleProceedToSuccess = () => {
    router.push("/mix/success");
  };

  const handleCancel = () => {
    setStatus("cancelled");
    setErrorMessage("Operation aborted by user.");
  };

  return (
    <div className="min-h-screen bg-[#0F1318] text-[#F0F4F8] flex flex-col selection:bg-[#3B82F6]/20 selection:text-[#F0F4F8]">
      <Suspense fallback={null}>
        <MixExecutionParamsSync onParams={handleSyncParams} />
      </Suspense>

      <MixHeader backHref="/mix/review" backLabel="REVIEW" />
      <MixProgress currentStep={3} />

      <main className="flex-1 max-w-xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-14 animate-fade-in flex flex-col items-center">
        {/* Intro */}
        <div className="w-full text-center max-w-md mb-8">
          <div className="font-mono text-[11px] font-medium tracking-[0.2em] text-[#3B82F6] uppercase mb-1.5">
            06 / PIPELINE DISPATCH
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#F0F4F8] mb-2">
            Confidential Execution
          </h1>
          <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
            Live lifecycle monitor tracking enclave ingestion, randomized custody hops,
            and settlement.
          </p>
        </div>

        {isReady && !config ? (
          <MixEmptyState
            title="No Pending Execution Found"
            description="No active configuration is awaiting execution."
            primaryHref="/mix"
            primaryLabel="START MIX SETUP"
          />
        ) : config ? (
          <MixExecutionStatus
            status={status}
            config={config}
            batchId={batchId}
            txHash={txHash}
            errorMessage={errorMessage}
            isSimulation={isSimulation}
            onRetry={handleRetry}
            onProceedToSuccess={handleProceedToSuccess}
            onCancel={
              status === "preparing" || status === "awaiting_signature"
                ? handleCancel
                : undefined
            }
          />
        ) : null}
      </main>
    </div>
  );
}
