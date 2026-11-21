/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'] },
      fontSize: { base: ['1rem', '1.5rem'] },
      minHeight: { touch: '48px' },
      minWidth: { touch: '48px' },
      colors: {
        brand: { DEFAULT: '#1f6f43', dark: '#174f31', light: '#e7f3ec' },
        qa: { DEFAULT: '#5b3fa6', light: '#efeaf9' },
        ops: {
          bg: 'var(--ops-bg)', surface: 'var(--ops-surface)', ink: 'var(--ops-ink)', muted: 'var(--ops-muted)', line: 'var(--ops-line)',
          accent: 'var(--ops-accent)', accent2: 'var(--ops-accent-2)', soft: 'var(--ops-accent-soft)',
          amber: 'var(--ops-amber)', amberbg: 'var(--ops-amber-bg)', red: 'var(--ops-red)', redbg: 'var(--ops-red-bg)',
          green: 'var(--ops-green)', greenbg: 'var(--ops-green-bg)', grey: 'var(--ops-grey-bg)',
        },
      },
      borderRadius: { ops: 'var(--ops-radius)', 'ops-sm': 'var(--ops-radius-sm)' },
      boxShadow: { ops: 'var(--ops-shadow)' },
    },
  },
  plugins: [],
};
