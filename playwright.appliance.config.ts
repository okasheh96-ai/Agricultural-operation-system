import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// End-to-end against a packhouse-server instance (scripts/packhouse.sh) holding the DEMO farm, installed separately from any real
// instance: PH_HOME=/path/ph-demo PH_HTTP_PORT=8090 PH_PG_PORT=54340 PH_REST_PORT=3021 scripts/packhouse.sh install --demo
const executablePath = process.env.PW_CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: 'tests/e2e/appliance',
  timeout: 120_000,
  workers: 1,
  use: { launchOptions: { executablePath }, baseURL: process.env.PH_URL ?? 'http://127.0.0.1:8090', trace: 'retain-on-failure', locale: 'ar' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
