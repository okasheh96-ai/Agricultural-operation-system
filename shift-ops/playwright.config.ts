import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: 'http://localhost:8788', trace: 'off', launchOptions: { executablePath } },
  webServer: { command: 'bash scripts/e2e-server.sh', url: 'http://localhost:8788/api/health', timeout: 120_000, reuseExistingServer: false },
  projects: [
    { name: 'iphone-ar', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions: { executablePath } }, testMatch: /iphone\.spec\.ts/ },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } }, testIgnore: /iphone\.spec\.ts/ },
  ],
});
