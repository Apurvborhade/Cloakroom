"use client";

import React, { useRef, useEffect } from "react";
import { Check, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

// --- Visual A: Lightweight MIX Atomic Orbital Canvas (Light Theme) ---
function MixOrbitalVisual({ isSelected }: { isSelected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let angle = 0;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const rings = [
      { rx: 54, ry: 22, tilt: -32 * (Math.PI / 180), speed: 0.016, particleCount: 2 },
      { rx: 54, ry: 22, tilt: 32 * (Math.PI / 180), speed: -0.014, particleCount: 2 },
      { rx: 50, ry: 20, tilt: 88 * (Math.PI / 180), speed: 0.019, particleCount: 1 },
    ];

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      if (!prefersReducedMotion) {
        angle += 0.015;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? "#377FA5" : "#9299A3";
      ctx.fill();

      rings.forEach((ring, rIdx) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(ring.tilt);

        ctx.beginPath();
        ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = isSelected
          ? "rgba(55, 127, 165, 0.45)"
          : "rgba(209, 213, 219, 0.75)";
        ctx.lineWidth = 1;
        ctx.stroke();

        for (let p = 0; p < ring.particleCount; p++) {
          const pAngle = angle * (ring.speed * 60) + (p * Math.PI * 2) / ring.particleCount + rIdx * 1.2;
          const px = ring.rx * Math.cos(pAngle);
          const py = ring.ry * Math.sin(pAngle);

          ctx.beginPath();
          ctx.arc(px, py, 2, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "#377FA5" : "#626A75";
          ctx.fill();
        }

        ctx.restore();
      });

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isSelected]);

  return (
    <div className="relative w-full h-[120px] flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

// --- Visual B: Geometric POOL Exchange Canvas (Light Theme) ---
function PoolExchangeVisual({ isSelected }: { isSelected: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let offset = 0;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      if (!prefersReducedMotion) {
        offset = (offset + 0.6) % 100;
      }

      const nodeLeftX = w * 0.22;
      const nodeRightX = w * 0.78;
      const nodeWidth = 56;
      const nodeHeight = 28;

      ctx.beginPath();
      ctx.moveTo(nodeLeftX + nodeWidth / 2, cy);
      ctx.lineTo(nodeRightX - nodeWidth / 2, cy);
      ctx.strokeStyle = isSelected
        ? "rgba(55, 127, 165, 0.4)"
        : "rgba(209, 213, 219, 0.8)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      const trackStart = nodeLeftX + nodeWidth / 2 + 8;
      const trackEnd = nodeRightX - nodeWidth / 2 - 8;
      const trackLen = trackEnd - trackStart;

      for (let i = 0; i < 3; i++) {
        const progress = ((offset * 1.5 + i * 33.3) % 100) / 100;
        const px = trackStart + trackLen * progress;

        ctx.beginPath();
        ctx.arc(px, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? "#377FA5" : "#626A75";
        ctx.fill();
      }

      const midX = (nodeLeftX + nodeRightX) / 2;
      ctx.save();
      ctx.translate(midX, cy);
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.rect(-6, -6, 12, 12);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = isSelected ? "#377FA5" : "#E3E6EB";
      ctx.lineWidth = 1.25;
      ctx.stroke();
      ctx.restore();

      drawNode(
        ctx,
        nodeLeftX - nodeWidth / 2,
        cy - nodeHeight / 2,
        nodeWidth,
        nodeHeight,
        "ETH",
        isSelected
      );

      drawNode(
        ctx,
        nodeRightX - nodeWidth / 2,
        cy - nodeHeight / 2,
        nodeWidth,
        nodeHeight,
        "USDC",
        isSelected
      );

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    function drawNode(
      c: CanvasRenderingContext2D,
      x: number,
      y: number,
      w: number,
      h: number,
      label: string,
      selected: boolean
    ) {
      c.save();
      c.beginPath();
      c.roundRect(x, y, w, h, 6);
      c.fillStyle = "#FFFFFF";
      c.fill();
      c.strokeStyle = selected ? "#377FA5" : "#E3E6EB";
      c.lineWidth = 1;
      c.stroke();

      c.font = "bold 10px monospace";
      c.fillStyle = selected ? "#17191D" : "#626A75";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(label, x + w / 2, y + h / 2);
      c.restore();
    }

    render();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [isSelected]);

  return (
    <div className="relative w-full h-[120px] flex items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}

export interface ExecutionModeCardProps {
  mode: "MIX" | "POOL";
  badge: string;
  title: string;
  description: string;
  supportingText: string;
  features: string[];
  isSelected: boolean;
  onSelect: () => void;
}

export function ExecutionModeCard({
  mode,
  badge,
  title,
  description,
  supportingText,
  features,
  isSelected,
  onSelect,
}: ExecutionModeCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group relative flex flex-col justify-between w-full rounded-2xl p-6 sm:p-7 text-left transition-all duration-200 cursor-pointer select-none border outline-none bg-white",
        isSelected
          ? "border-[#377FA5] ring-2 ring-[#377FA5]/20 shadow-elevated"
          : "border-[#E3E6EB] hover:border-[#377FA5] shadow-card hover:shadow-elevated"
      )}
    >
      <div>
        <div className="flex items-center justify-between mb-4">
          <span
            className={cn(
              "px-2.5 py-1 rounded-full text-[10px] font-mono tracking-wider uppercase border font-bold transition-colors",
              isSelected
                ? "bg-[#E7F3FA] text-[#377FA5] border-[#D2E8F5]"
                : "bg-[#F0F2F5] text-[#626A75] border-[#E3E6EB]"
            )}
          >
            {badge}
          </span>

          <div
            className={cn(
              "w-5 h-5 rounded-full border flex items-center justify-center transition-all duration-200",
              isSelected
                ? "border-[#377FA5] bg-[#377FA5] text-white"
                : "border-[#CBD5E1] bg-[#F7F8FA]"
            )}
          >
            {isSelected && <Check size={12} strokeWidth={3} />}
          </div>
        </div>

        <div className="mb-4 rounded-xl bg-[#F7F8FA] border border-[#E3E6EB] overflow-hidden">
          {mode === "MIX" ? (
            <MixOrbitalVisual isSelected={isSelected} />
          ) : (
            <PoolExchangeVisual isSelected={isSelected} />
          )}
        </div>

        <div className="space-y-1.5 mb-5">
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#17191D] font-sans">
            {title}
          </h2>
          <p className="text-sm text-[#17191D] font-semibold leading-relaxed font-sans">
            {description}
          </p>
          <p className="text-xs text-[#626A75] leading-relaxed font-sans">
            {supportingText}
          </p>
        </div>

        <div className="pt-4 border-t border-[#E3E6EB] space-y-2 mb-6">
          <div className="text-[10px] font-mono uppercase tracking-wider text-[#9299A3] font-bold">
            Capabilities
          </div>
          {features.map((feature, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2.5 text-xs text-[#626A75]"
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-colors",
                  isSelected ? "bg-[#377FA5]" : "bg-[#CBD5E1]"
                )}
              />
              <span className="font-sans">{feature}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className={cn(
            "w-full py-2.5 px-4 rounded-xl text-xs font-mono font-bold tracking-wide flex items-center justify-between transition-all duration-200 border uppercase",
            isSelected
              ? "bg-[#17191D] text-white border-[#17191D] shadow-xs"
              : "bg-[#F7F8FA] text-[#17191D] border-[#E3E6EB] hover:border-[#377FA5] hover:bg-white"
          )}
        >
          <span>{isSelected ? `${title} SELECTED` : `SELECT ${title}`}</span>
          {isSelected ? (
            <Check size={14} strokeWidth={2.5} />
          ) : (
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          )}
        </button>
      </div>
    </div>
  );
}
