"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import {
  VerificationState,
  VerifiedWithdrawalReceipt,
  verifyOnChainWithdrawal,
} from "@/lib/wallet/verification";
import { PaymentSuccessHeader } from "@/components/wallet/withdraw/success/PaymentSuccessHeader";
import { SuccessAmountCard } from "@/components/wallet/withdraw/success/SuccessAmountCard";
import { TransactionDetailsCard } from "@/components/wallet/withdraw/success/TransactionDetailsCard";
import { TransactionFeeBreakdown } from "@/components/wallet/withdraw/success/TransactionFeeBreakdown";
import { SuccessActions } from "@/components/wallet/withdraw/success/SuccessActions";
import { WithdrawalSuccessStates } from "@/components/wallet/withdraw/success/WithdrawalSuccessStates";
import { Footer } from "@/components/Footer";

function SuccessContent() {
  const searchParams = useSearchParams();
  const { chainId } = useWallet();

  const [verificationState, setVerificationState] = useState<VerificationState>("loading");
  const [receipt, setReceipt] = useState<VerifiedWithdrawalReceipt | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const txHashParam = searchParams.get("txHash");
  const previewParam = searchParams.get("preview") === "true";
  const assetParam = (searchParams.get("asset")?.toUpperCase() as "ETH" | "USDC") || "ETH";

  const runVerification = useCallback(async () => {
    setVerificationState("loading");

    // Determine target hash: either explicit txHash or dev preview flag in development
    const targetHash =
      previewParam && process.env.NODE_ENV !== "production"
        ? "dev_preview"
        : txHashParam;

    const result = await verifyOnChainWithdrawal(
      targetHash,
      chainId,
      assetParam,
      previewParam
    );

    setVerificationState(result.state);
    if (result.receipt) {
      setReceipt(result.receipt);
    }
    if (result.error) {
      setErrorMessage(result.error);
    }
  }, [txHashParam, previewParam, assetParam, chainId]);

  useEffect(() => {
    runVerification();
  }, [runVerification]);

  // Non-success states are handled strictly and cleanly
  if (verificationState !== "verified" || !receipt || receipt.status !== "success") {
    return (
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-12 flex items-center justify-center">
        <WithdrawalSuccessStates
          state={verificationState}
          errorMessage={errorMessage}
          receipt={receipt || undefined}
          onRetry={runVerification}
        />
      </div>
    );
  }

  // --- Verified On-Chain Payment Successful Screen ---
  return (
    <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
      {/* Success Confirmation Hero & Transferred Amount */}
      <SuccessAmountCard
        asset={receipt.asset}
        amount={receipt.amount}
        usdEquivalent={receipt.usdEquivalent}
        isDevPreview={receipt.isDevPreview}
      />

      {/* Detailed Transaction Summary Card */}
      <TransactionDetailsCard receipt={receipt} />

      {/* Fee & Gas Breakdown */}
      <TransactionFeeBreakdown
        gasUsed={receipt.gasUsed}
        effectiveGasPriceGwei={receipt.effectiveGasPriceGwei}
        networkFeeEth={receipt.networkFeeEth}
      />

      {/* Primary & Secondary Completion Actions */}
      <SuccessActions explorerUrl={receipt.explorerUrl} />
    </main>
  );
}

export default function WithdrawalSuccessPage() {
  const { networkName } = useWallet();

  return (
    <div className="min-h-screen bg-[#F7F8FA] text-[#17191D] flex flex-col font-mono selection:bg-[#377FA5] selection:text-white">
      {/* Compact Header */}
      <PaymentSuccessHeader networkName={networkName || "Ethereum"} />

      {/* Suspense boundary for search parameters query reading */}
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center p-8 text-xs text-[#626A75]">
            Initializing transaction verification...
          </div>
        }
      >
        <SuccessContent />
      </Suspense>

      {/* Footer */}
      <Footer />
    </div>
  );
}
