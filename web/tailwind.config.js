/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: { DEFAULT: '#0f1720', soft: '#41505e', muted: '#6b7b8a' },
        paper: { DEFAULT: '#f7f8f7', card: '#ffffff', rule: '#e2e7e5' },
        brand: { DEFAULT: '#0e6b5b', soft: '#dcece7', dark: '#0a5245' },
        // Fit bands. Three discrete hues, not a red-to-green gradient:
        // gradients are unreadable at card size and fail for colour-blind
        // viewers. Nothing here is red -- "missing Docker" is a next step,
        // not a failure.
        band: {
          strong: '#0e6b5b', good: '#2f6fb0', fair: '#8a6410', weak: '#6b7b8a',
        },
      },
      // Six sizes, no exceptions.
      fontSize: {
        xs: ['0.75rem', '1rem'], sm: ['0.875rem', '1.25rem'],
        base: ['1rem', '1.5rem'], lg: ['1.25rem', '1.75rem'],
        xl: ['1.75rem', '2.125rem'], '2xl': ['2.5rem', '2.75rem'],
      },
      borderRadius: { card: '10px', chip: '4px' },
    },
  },
  plugins: [],
};
