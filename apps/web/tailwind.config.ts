import type { Config } from 'tailwindcss';

// Mesma paleta do zapin
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        dark: {
          bg: '#080A0F',
          sidebar: '#0B0E14',
          card: '#10141D',
          border: '#202633',
          hover: '#171D2B',
        },
        content: {
          primary: '#F5F7FA',
          secondary: '#8993A4',
          muted: '#525C6E',
        },
        brand: {
          cyan: '#22D3EE',
          success: '#22C55E',
          error: '#EF4444',
          warning: '#F59E0B',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
