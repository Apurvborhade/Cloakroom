"use client";

import React from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type MixStepNumber = 1 | 2 | 3 | 4;

interface MixProgressProps {
  currentStep: MixStepNumber;
  setupHref?: string;
  reviewHref?: string;
}

export function MixProgress({
  currentStep,
  setupHref = "/mix",
  reviewHref = "/mix/review",
}: MixProgressProps) {
  const steps = [
    { num: 1, label: "1. SETUP", href: setupHref },
    { num: 2, label: "2. REVIEW", href: reviewHref },
    { num: 3, label: "3. EXECUTION", href: undefined },
    { num: 4, label: "4. COMPLETION", href: undefined },
  ];

  return (
    <div className="border-b border-[#232B36] bg-[#12161D]">
      <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between text-xs font-mono">
        {steps.map((step, idx) => {
          const isCompleted = step.num < currentStep;
          const isActive = step.num === currentStep;
          const isPending = step.num > currentStep;

          return (
            <React.Fragment key={step.num}>
              {idx > 0 && (
                <div
                  className={cn(
                    "h-[1px] flex-1 mx-2 sm:mx-4 transition-colors",
                    isCompleted ? "bg-emerald-500/60" : "bg-[#232B36]"
                  )}
                />
              )}

              <div className="flex items-center gap-2">
                {isCompleted ? (
                  step.href ? (
                    <Link
                      href={step.href}
                      className="flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 transition-colors group"
                    >
                      <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px] font-bold">
                        ✓
                      </span>
                      <span className="hidden sm:inline group-hover:underline underline-offset-4 font-medium">
                        {step.label}
                      </span>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                      <span className="w-5 h-5 rounded-full bg-emerald-950/60 border border-emerald-800/60 flex items-center justify-center text-[10px] font-bold">
                        ✓
                      </span>
                      <span className="hidden sm:inline">{step.label}</span>
                    </div>
                  )
                ) : isActive ? (
                  <div className="flex items-center gap-2 text-[#3B82F6] font-bold">
                    <span className="w-5 h-5 rounded-full bg-[#1C222B] border border-[#3B82F6] flex items-center justify-center text-[10px] shadow-[0_0_8px_rgba(59,130,246,0.3)]">
                      {step.num}
                    </span>
                    <span className="tracking-wider">{step.label}</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[#505D6E]">
                    <span className="w-5 h-5 rounded-full bg-[#161B22] border border-[#232B36] flex items-center justify-center text-[10px]">
                      {step.num}
                    </span>
                    <span className="hidden sm:inline">{step.label}</span>
                  </div>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
