"use client";

import React, { useState } from "react";
import { Copy, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface TransactionHashProps {
  txHash: string;
  explorerUrl?: string | null;
  className?: string;
}

export function TransactionHash({
  txHash,
  explorerUrl,
  className,
}: TransactionHashProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(txHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shortened =
    txHash.length > 16 ? `${txHash.slice(0, 8)}...${txHash.slice(-6)}` : txHash;

  return (
    <div className={cn("flex items-center gap-2 font-mono text-xs", className)}>
      <span className="text-[#F0F4F8] font-semibold" title={txHash}>
        {shortened}
      </span>

      <button
        type="button"
        onClick={handleCopy}
        className="p-1 rounded hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors focus:outline-none"
        title="Copy full transaction hash"
      >
        {copied ? (
          <Check size={12} className="text-[#10B981]" />
        ) : (
          <Copy size={12} />
        )}
      </button>

      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1 rounded hover:bg-[#232B36] text-[#3B82F6] hover:text-[#60A5FA] transition-colors focus:outline-none flex items-center gap-1 text-[11px]"
          title="View on block explorer"
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}
