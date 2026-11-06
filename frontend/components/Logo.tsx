"use client";

import React from "react";

interface LogoProps {
  size?: number;
  className?: string;
}

export function Logo({ size = 24, className = "" }: LogoProps) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="transition-transform duration-300 ease-out group-hover:scale-105"
      >
        {/* Outer Shield Hexagon */}
        <polygon
          points="16,2 29,9.5 29,22.5 16,30 3,22.5 3,9.5"
          stroke="#232B36"
          strokeWidth="1.5"
          fill="#161B22"
        />
        {/* Inner Attestation Wireframe */}
        <path
          d="M16 6L25 11.2V20.8L16 26L7 20.8V11.2L16 6Z"
          stroke="#3A4759"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />
        {/* Center Enclave Nucleus */}
        <polygon
          points="16,10 21,13.5 21,18.5 16,22 11,18.5 11,13.5"
          stroke="#3B82F6"
          strokeWidth="1.2"
          fill="#0F1318"
        />
        <circle cx="16" cy="16" r="2.2" fill="#3B82F6" />
      </svg>
    </div>
  );
}
