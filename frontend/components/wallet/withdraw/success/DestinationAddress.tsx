"use client";

import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface DestinationAddressProps {
  address: string;
  className?: string;
}

export function DestinationAddress({ address, className }: DestinationAddressProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shortened =
    address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

  return (
    <div className={cn("flex items-center gap-2 font-mono text-xs", className)}>
      <span
        className="text-[#F0F4F8] font-semibold"
        title={address}
      >
        {shortened}
      </span>

      <button
        type="button"
        onClick={handleCopy}
        className="p-1 rounded hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] transition-colors focus:outline-none"
        title="Copy full address"
      >
        {copied ? (
          <Check size={12} className="text-[#10B981]" />
        ) : (
          <Copy size={12} />
        )}
      </button>
    </div>
  );
}
