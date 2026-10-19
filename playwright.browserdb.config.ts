import { defineConfig, devices } from '@playwright/test';

// The in-browser demo (scripts/build-browser-demo.mjs): app + PostgreSQL in the browser, demo farm only. Served the way the
// artifact host serves it (page wrapped in a document, files beside it) with a Content-Security-Policy like the host's,
// at iPhone size. Build first: node scripts/build-browser-demo.mjs
export default defineConfig({
  testDir: 'tests/e2e/browserdb',
  timeout: 240_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4176', trace: 'retain-on-failure', locale: 'ar' },
  projects: [{ name: 'iphone-size', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
  webServer: {
    command: 'BROWSER_DEMO_CSP=artifact-wasm node scripts/serve-browser-demo.mjs 4176',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
  },
});
