import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0a0b',
          900: '#0f0f11',
          850: '#131316',
          800: '#18181c',
          750: '#1d1d22',
          700: '#24242a',
          600: '#2e2e36',
          500: '#3d3d47',
        },
        fg: {
          DEFAULT: '#ededf0',
          muted: '#a1a1aa',
          subtle: '#71717a',
          faint: '#52525b',
        },
        accent: {
          DEFAULT: '#5cc8f0',
          strong: '#38b4e6',
          soft: 'rgba(92, 200, 240, 0.12)',
        },
        ok: '#4ade80',
        warn: '#fbbf24',
        bad: '#f87171',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Inter', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { shimmer: 'shimmer 1.6s infinite' },
    },
  },
  plugins: [],
};

export default config;
