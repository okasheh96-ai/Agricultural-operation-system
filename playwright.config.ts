import { defineConfig, devices } from '@playwright/test';

// Phone (390×844) and desktop (1440×900), Arabic RTL default (Master Prompt §8.1).
export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'stack/**',
  use: { baseURL: 'http://127.0.0.1:4173' },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // Points at an unreachable backend on purpose: these smoke tests cover the shell, not data.
    command: 'VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=smoke npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
