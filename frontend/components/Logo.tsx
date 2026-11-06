import React from "react";

interface LogoProps {
  className?: string;
  size?: number;
}

export function Logo({ className = "", size = 26 }: LogoProps) {
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
        {/* Outer subtle shield border */}
        <polygon
          points="16,2 29,9.5 29,22.5 16,30 3,22.5 3,9.5"
          stroke="#292930"
          strokeWidth="1.25"
          fill="#141418"
          fillOpacity="0.8"
        />

        {/* Intermediate cryptographic veil geometry */}
        <path
          d="M16 6L25 11.2V20.8L16 26L7 20.8V11.2L16 6Z"
          stroke="#383844"
          strokeWidth="1"
          strokeDasharray="2 2"
          fill="none"
        />

        {/* Inner protected confidential core */}
        <polygon
          points="16,10 21,13.5 21,18.5 16,22 11,18.5 11,13.5"
          stroke="#A6DCF8"
          strokeWidth="1.2"
          fill="#0C0C0C"
        />

        {/* Central shielded node */}
        <circle cx="16" cy="16" r="2" fill="#A6DCF8" />
      </svg>
    </div>
  );
}

