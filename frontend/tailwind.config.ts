import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#0F1318",
        surface: {
          DEFAULT: "#161B22",
          elevated: "#1C222B",
          subtle: "#12161D",
        },
        border: {
          DEFAULT: "#232B36",
          active: "#3A4759",
          subtle: "#1B222C",
        },
        content: {
          DEFAULT: "#F0F4F8",
          secondary: "#94A3B8",
          muted: "#64748B",
        },
        accent: {
          DEFAULT: "#3B82F6",
          hover: "#2563EB",
          soft: "#1A2738",
        },
        brand: {
          DEFAULT: "#3B82F6",
          dark: "#0F1318",
          slate: "#161B22",
          border: "#232B36",
        },
        semantic: {
          success: "#10B981",
          "success-soft": "#132E24",
          warning: "#F59E0B",
          "warning-soft": "#2E2211",
          error: "#EF4444",
          "error-soft": "#2D1618",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      maxWidth: {
        "screen-1440": "1440px",
      },
      animation: {
        "fade-in": "fadeIn 0.4s ease-out forwards",
        "pulse-subtle": "pulseSubtle 3s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "0.9" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
