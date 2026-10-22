/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Metriq design tokens. Every colour is a CSS variable (index.css), so the whole app
      // follows one palette and can switch themes. Neutrals are a calm grey (Linear style),
      // and the slate scale used across screens maps to the same greys.
      colors: {
        primary: {
          DEFAULT: v('primary'), // main actions, focus, selection
          50: v('primary-50'),
          100: v('primary-100'),
          600: v('primary'),
          700: v('primary-700'),
        },
        accent: v('accent'),
        success: v('success'),
        warning: v('warning'),
        danger: v('danger'),
        bg: v('bg'), // app canvas
        card: v('card'), // surfaces
        sidebar: v('sidebar'), // navigation rail
        ink: {
          DEFAULT: v('ink'), // primary text
          muted: v('ink-muted'), // secondary text
          faint: v('ink-faint'), // hints, placeholders, icons at rest
        },
        line: { DEFAULT: v('line'), strong: v('line-strong') }, // borders
        slate: Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, v(`slate-${n}`)])),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      borderRadius: {
        card: '10px',
        btn: '7px',
      },
      boxShadow: {
        // Quiet depth: borders do most of the work, shadows only lift what floats.
        xs: '0 1px 1px 0 rgb(var(--shadow) / 0.05)',
        card: '0 1px 2px 0 rgb(var(--shadow) / 0.04), 0 0 0 0 transparent',
        raised: '0 1px 2px 0 rgb(var(--shadow) / 0.05), 0 4px 12px -2px rgb(var(--shadow) / 0.06)',
        overlay: '0 0 0 1px rgb(var(--shadow) / 0.04), 0 8px 24px -4px rgb(var(--shadow) / 0.14), 0 2px 6px -1px rgb(var(--shadow) / 0.06)',
      },
      // Type scale from design-reference DESIGN.md
      fontSize: {
        'display-lg': ['34px', { lineHeight: '40px', letterSpacing: '-0.025em', fontWeight: '650' }],
        'headline-lg': ['22px', { lineHeight: '28px', letterSpacing: '-0.018em', fontWeight: '600' }],
        'headline-md': ['17px', { lineHeight: '24px', letterSpacing: '-0.012em', fontWeight: '600' }],
        'body-lg': ['15px', { lineHeight: '22px', letterSpacing: '-0.006em' }],
        'body-md': ['13.5px', { lineHeight: '20px', letterSpacing: '-0.003em' }],
        'body-sm': ['12px', { lineHeight: '16px' }],
        'label-md': ['11px', { lineHeight: '16px', letterSpacing: '0.04em', fontWeight: '600' }],
        'metric-lg': ['28px', { lineHeight: '34px', letterSpacing: '-0.025em', fontWeight: '600' }],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(12px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'scale-in': 'scale-in 150ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        'rise-in': 'rise-in 180ms cubic-bezier(0.2, 0.9, 0.3, 1)',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
}
