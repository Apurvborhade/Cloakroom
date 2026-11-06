import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "#0C0C0C",
          secondary: "#141418",
          surface: "#18181D",
          elevated: "#1E1E26",
        },
        foreground: {
          DEFAULT: "#F5F5F7",
          secondary: "#92929B",
          muted: "#666670",
        },
        border: {
          DEFAULT: "#292930",
          subtle: "#1C1C22",
          focus: "#A6DCF8",
        },
        accent: {
          DEFAULT: "#A6DCF8",
          hover: "#BDDEFF",
          muted: "rgba(166, 220, 248, 0.15)",
          glow: "rgba(166, 220, 248, 0.25)",
        },
        cloak: {
          dark: "#08080A",
          charcoal: "#0C0C0C",
          panel: "#141418",
          border: "#292930",
          cyan: "#A6DCF8",
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
        "fade-in": "fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        "pulse-subtle": "pulseSubtle 4s ease-in-out infinite",
        "glow-slow": "glowSlow 6s ease-in-out infinite",
        "float-slow": "floatSlow 8s ease-in-out infinite",
        "spin-very-slow": "spin 40s linear infinite",
        "spin-reverse-slow": "spinReverse 50s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSubtle: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.8" },
        },
        glowSlow: {
          "0%, 100%": {
            filter: "drop-shadow(0 0 16px rgba(166, 220, 248, 0.15))",
          },
          "50%": {
            filter: "drop-shadow(0 0 28px rgba(166, 220, 248, 0.35))",
          },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-6px)" },
        },
        spinReverse: {
          "0%": { transform: "rotate(360deg)" },
          "100%": { transform: "rotate(0deg)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;

