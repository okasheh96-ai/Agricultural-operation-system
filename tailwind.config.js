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
      },
    },
  },
  plugins: [],
};
