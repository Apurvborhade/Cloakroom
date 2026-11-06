"use client";

import React, { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface HeroVisualProps {
  className?: string;
  isBackground?: boolean;
  showCallout?: boolean;
}

export function HeroVisual({
  className = "",
  isBackground = false,
  showCallout = false,
}: HeroVisualProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Smooth window-level pointer tracking for 3D perspective even when pointer-events: none
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (mediaQuery.matches) return;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let animId: number;

    const handlePointerMove = (e: MouseEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      targetX = (e.clientX / w - 0.5) * 2;
      targetY = (e.clientY / h - 0.5) * 2;
    };

    const updateTilt = () => {
      currentX += (targetX - currentX) * 0.05;
      currentY += (targetY - currentY) * 0.05;
      setMousePos({ x: currentX, y: currentY });
      animId = requestAnimationFrame(updateTilt);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    animId = requestAnimationFrame(updateTilt);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      cancelAnimationFrame(animId);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let width = 0;
    let height = 0;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const prefersReducedMotion = mediaQuery.matches;

    const resize = () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener("resize", resize);

    // Atomic Orbital Ring Specification
    interface OrbitConfig {
      baseAngle: number;       // Initial inclination angle in radians
      precessionSpeed: number; // Angular speed of orbit rotation
      radius: number;          // Base radius before scale
      aspectRatio: number;     // Minor/Major axis ratio (ellipse flatness)
      strokeColor: string;     // Line color
      lineWidth: number;       // Stroke weight
      dash?: number[];         // Line dash pattern
      particles: {
        phase: number;         // Initial position on ellipse (0 to 2*PI)
        speed: number;         // Orbital velocity along path
        size: number;          // Radius of particle
        color: string;         // Particle highlight color
        opacity: number;       // Base opacity
        trail: { x: number; y: number; alpha: number }[];
      }[];
    }

    const orbits: OrbitConfig[] = [
      {
        baseAngle: 0,
        precessionSpeed: 0.0006,
        radius: 225,
        aspectRatio: 0.33,
        strokeColor: "rgba(50, 50, 62, 0.75)",
        lineWidth: 0.85,
        particles: [
          { phase: 0, speed: 0.0075, size: 1.3, color: "#A6DCF8", opacity: 0.85, trail: [] },
          { phase: Math.PI, speed: 0.0075, size: 1.1, color: "#8EA2B0", opacity: 0.6, trail: [] },
        ],
      },
      {
        baseAngle: (Math.PI * 1) / 5,
        precessionSpeed: -0.00075,
        radius: 205,
        aspectRatio: 0.38,
        strokeColor: "rgba(166, 220, 248, 0.22)",
        lineWidth: 0.85,
        particles: [
          { phase: Math.PI * 0.4, speed: -0.0085, size: 1.4, color: "#A6DCF8", opacity: 0.9, trail: [] },
          { phase: Math.PI * 1.4, speed: -0.0085, size: 1.1, color: "#95B0C2", opacity: 0.65, trail: [] },
        ],
      },
      {
        baseAngle: (Math.PI * 2) / 5,
        precessionSpeed: 0.0005,
        radius: 240,
        aspectRatio: 0.31,
        strokeColor: "rgba(45, 45, 56, 0.7)",
        lineWidth: 0.8,
        particles: [
          { phase: Math.PI * 0.7, speed: 0.0065, size: 1.2, color: "#A6DCF8", opacity: 0.8, trail: [] },
          { phase: Math.PI * 1.7, speed: 0.0065, size: 1.0, color: "#8EA2B0", opacity: 0.55, trail: [] },
        ],
      },
      {
        baseAngle: (Math.PI * 3) / 5,
        precessionSpeed: -0.00065,
        radius: 215,
        aspectRatio: 0.36,
        strokeColor: "rgba(166, 220, 248, 0.25)",
        lineWidth: 0.9,
        particles: [
          { phase: Math.PI * 0.2, speed: -0.009, size: 1.3, color: "#A6DCF8", opacity: 0.85, trail: [] },
          { phase: Math.PI * 1.2, speed: -0.009, size: 1.1, color: "#A6DCF8", opacity: 0.65, trail: [] },
        ],
      },
      {
        baseAngle: (Math.PI * 4) / 5,
        precessionSpeed: 0.0008,
        radius: 230,
        aspectRatio: 0.29,
        strokeColor: "rgba(55, 55, 68, 0.7)",
        lineWidth: 0.85,
        particles: [
          { phase: Math.PI * 0.9, speed: 0.008, size: 1.3, color: "#A6DCF8", opacity: 0.8, trail: [] },
          { phase: Math.PI * 1.9, speed: 0.008, size: 1.0, color: "#8EA2B0", opacity: 0.5, trail: [] },
        ],
      },
      {
        baseAngle: Math.PI / 2,
        precessionSpeed: 0.00035,
        radius: 175,
        aspectRatio: 0.44,
        strokeColor: "rgba(166, 220, 248, 0.16)",
        lineWidth: 0.8,
        dash: [2, 6],
        particles: [
          { phase: Math.PI * 0.5, speed: 0.007, size: 1.2, color: "#A6DCF8", opacity: 0.75, trail: [] },
        ],
      },
    ];

    let time = 0;

    const render = () => {
      time += 1;
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;

      // Scaling factor according to viewport
      const scale = isBackground
        ? Math.min(width, height) / 540
        : Math.min(width, height) / 500;

      // Subtle ambient gradient matching titanium slate
      const radialGlow = ctx.createRadialGradient(
        centerX,
        centerY,
        10 * scale,
        centerX,
        centerY,
        280 * scale
      );
      radialGlow.addColorStop(0, "rgba(59, 130, 246, 0.03)");
      radialGlow.addColorStop(0.35, "rgba(22, 27, 34, 0.2)");
      radialGlow.addColorStop(0.7, "rgba(15, 19, 24, 0.85)");
      radialGlow.addColorStop(1, "rgba(15, 19, 24, 0)");
      ctx.fillStyle = radialGlow;
      ctx.fillRect(0, 0, width, height);

      // Outer Settlement & Telemetry Rings (Preserved for technical context)
      const outerRingR1 = 280 * scale;
      const outerRingR2 = 220 * scale;

      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRingR1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(41, 41, 48, 0.4)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(centerX, centerY, outerRingR2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(41, 41, 48, 0.3)";
      ctx.setLineDash([3, 7]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Rotating telemetry ticks along outer ring
      const tickCount = 28;
      for (let i = 0; i < tickCount; i++) {
        const theta =
          (i * Math.PI * 2) / tickCount +
          (prefersReducedMotion ? 0 : time * 0.0008);
        const x1 = centerX + Math.cos(theta) * (outerRingR2 - 2);
        const y1 = centerY + Math.sin(theta) * (outerRingR2 - 2);
        const tickLen = i % 7 === 0 ? 8 * scale : 4 * scale;
        const x2 = centerX + Math.cos(theta) * (outerRingR2 + tickLen);
        const y2 = centerY + Math.sin(theta) * (outerRingR2 + tickLen);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle =
          i % 7 === 0
            ? "rgba(166, 220, 248, 0.3)"
            : "rgba(55, 55, 68, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Render Atomic Orbital Rings
      orbits.forEach((orbit) => {
        const currentAngle =
          orbit.baseAngle +
          (prefersReducedMotion ? 0 : time * orbit.precessionSpeed);
        const a = orbit.radius * scale;
        const b = a * orbit.aspectRatio;

        // Draw Elliptical Orbit Path
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(currentAngle);

        ctx.beginPath();
        // Draw ellipse centered at (0, 0)
        ctx.ellipse(0, 0, a, b, 0, 0, Math.PI * 2);
        ctx.strokeStyle = orbit.strokeColor;
        ctx.lineWidth = orbit.lineWidth;
        if (orbit.dash) ctx.setLineDash(orbit.dash);
        ctx.stroke();
        ctx.restore();

        // Animate and Draw Particles Moving along this Orbit
        orbit.particles.forEach((p) => {
          if (!prefersReducedMotion) {
            p.phase += p.speed;
          }

          // Compute particle position in unrotated ellipse frame
          const lx = a * Math.cos(p.phase);
          const ly = b * Math.sin(p.phase);

          // Rotate into world frame
          const cosA = Math.cos(currentAngle);
          const sinA = Math.sin(currentAngle);
          const worldX = centerX + lx * cosA - ly * sinA;
          const worldY = centerY + lx * sinA + ly * cosA;

          // Track micro trail
          if (!prefersReducedMotion) {
            p.trail.push({ x: worldX, y: worldY, alpha: p.opacity });
            if (p.trail.length > 5) p.trail.shift();
          }

          // Draw trail
          if (p.trail.length > 1) {
            ctx.beginPath();
            for (let i = 0; i < p.trail.length - 1; i++) {
              const pt1 = p.trail[i];
              const pt2 = p.trail[i + 1];
              if (!pt1 || !pt2) continue;
              ctx.moveTo(pt1.x, pt1.y);
              ctx.lineTo(pt2.x, pt2.y);
            }
            ctx.strokeStyle = `rgba(166, 220, 248, ${p.opacity * 0.35})`;
            ctx.lineWidth = 0.75;
            ctx.stroke();
          }

          // Subtle variation in brightness based on orbital phase (depth cueing)
          const depthMultiplier = 0.75 + 0.25 * Math.sin(p.phase);
          const finalOpacity = p.opacity * depthMultiplier;

          // Draw Particle Point
          ctx.beginPath();
          ctx.arc(worldX, worldY, p.size * scale, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = finalOpacity;
          ctx.fill();

          // Delicate micro-glow on prominent particles
          if (p.size >= 1.3) {
            ctx.beginPath();
            ctx.arc(worldX, worldY, (p.size + 1.2) * scale, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(166, 220, 248, 0.2)";
            ctx.fill();
          }
          ctx.globalAlpha = 1.0;
        });
      });

      // Quiet Central Core: Only a tiny, understated point of light (No solid mass)
      ctx.beginPath();
      ctx.arc(centerX, centerY, 1.8 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "#A6DCF8";
      ctx.shadowColor = "#A6DCF8";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0; // reset

      // Faint central ringlet (whisper thin, empty interior)
      ctx.beginPath();
      ctx.arc(centerX, centerY, 9 * scale, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(166, 220, 248, 0.2)";
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Technical HUD micro labels around perimeter
      ctx.font = `${Math.max(8, Math.round(9 * scale))}px 'JetBrains Mono', 'SF Mono', monospace`;
      ctx.fillStyle = "rgba(146, 146, 155, 0.35)";

      // Top-left sector tag
      ctx.fillText(
        "[01: PUBLIC SETTLEMENT]",
        centerX - 245 * scale,
        centerY - 240 * scale
      );

      // Top-right encryption status
      ctx.fillText(
        "[HPKE_SEAL :: SECURE]",
        centerX + 115 * scale,
        centerY - 240 * scale
      );

      // Bottom-left protocol mode
      ctx.fillText(
        "[NITRO_ENCLAVE :: ATTESTED]",
        centerX - 245 * scale,
        centerY + 255 * scale
      );

      // Bottom-right mempool exposure
      ctx.fillStyle = "rgba(166, 220, 248, 0.45)";
      ctx.fillText(
        "[MEMPOOL LEAK :: 0.00%]",
        centerX + 105 * scale,
        centerY + 255 * scale
      );

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    render();

    return () => {
      window.removeEventListener("resize", resize);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [isBackground]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex items-center justify-center select-none pointer-events-none",
        isBackground
          ? "w-[720px] h-[540px] sm:w-[880px] sm:h-[660px] md:w-[1020px] md:h-[750px] lg:w-[1180px] lg:h-[840px] max-w-none"
          : "w-full max-w-[620px] aspect-[4/3] sm:aspect-[16/11] mx-auto",
        className
      )}
      style={{
        maskImage:
          "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 36%, rgba(0,0,0,0.75) 64%, rgba(0,0,0,0) 86%)",
        WebkitMaskImage:
          "radial-gradient(circle at 50% 50%, rgba(0,0,0,1) 36%, rgba(0,0,0,0.75) 64%, rgba(0,0,0,0) 86%)",
      }}
    >
      {/* Interactive 3D Perspective Tilt Wrapper */}
      <div
        className="w-full h-full relative flex items-center justify-center transition-transform duration-700 ease-out"
        style={{
          transform: `perspective(1000px) rotateX(${-mousePos.y * 4}deg) rotateY(${mousePos.x * 4}deg)`,
        }}
      >
        {/* Crisp HTML5 Canvas */}
        <canvas
          ref={canvasRef}
          className="w-full h-full block relative z-0"
          style={{ width: "100%", height: "100%" }}
        />

        {showCallout && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#141418]/90 border border-[#292930] backdrop-blur-md text-[10px] font-mono text-[#92929B] shadow-lg">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A6DCF8] animate-pulse" />
              <span>CONFIDENTIAL EXECUTION ENVIRONMENT</span>
              <span className="text-[#555560]">::</span>
              <span className="text-[#F5F5F7]">ATOMIC ORBITAL MATRIX</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
