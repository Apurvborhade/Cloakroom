import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './hooks/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#131313',
          900: '#171717',
          850: '#1b1b1b',
          800: '#222222',
          750: '#2a2a2a',
          700: '#2f2f2f',
          600: '#3a3a3a',
          500: '#4a4a4a',
        },
        fg: {
          DEFAULT: '#ffffff',
          muted: '#c4c4c4',
          subtle: '#9b9b9b',
          faint: '#6b6b6b',
        },
        accent: {
          DEFAULT: '#8b9bff',
          strong: '#a9b5ff',
          soft: 'rgba(139, 155, 255, 0.12)',
        },
        ok: '#40b66b',
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
