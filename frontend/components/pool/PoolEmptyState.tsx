"use client";

import React from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

interface PoolEmptyStateProps {
  title?: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
}

export function PoolEmptyState({
  title = "No Active POOL Configuration",
  description = "No active order parameters were found for this step. Please configure your trade order to continue.",
  primaryHref = "/pool",
  primaryLabel = "START POOL ORDER",
}: PoolEmptyStateProps) {
  return (
    <div className="w-full max-w-md mx-auto p-8 rounded-2xl bg-[#161B22] border border-[#232B36] text-center space-y-4 my-12 font-mono shadow-xl">
      <div className="w-12 h-12 rounded-full bg-[#1C222B] border border-[#232B36] flex items-center justify-center text-[#3B82F6] mx-auto">
        <AlertCircle size={22} />
      </div>

      <div className="space-y-1.5">
        <h3 className="text-lg font-bold text-[#F0F4F8] tracking-tight">{title}</h3>
        <p className="text-xs text-[#94A3B8] leading-relaxed">{description}</p>
      </div>

      <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
        <Link
          href={primaryHref}
          className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#3B82F6] text-white hover:bg-[#2563EB] font-bold text-xs uppercase tracking-wider transition-all text-center shadow-[0_0_15px_rgba(59,130,246,0.25)]"
        >
          {primaryLabel}
        </Link>
        <Link
          href="/execution"
          className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-[#1C222B] border border-[#232B36] hover:bg-[#232B36] text-[#94A3B8] hover:text-[#F0F4F8] text-xs uppercase tracking-wider transition-colors text-center"
        >
          EXECUTION SELECTION
        </Link>
      </div>
    </div>
  );
}
