import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';

// End-to-end against the local Supabase-equivalent stack (scripts/dev-stack.sh): real Auth, RLS,
// transition engine and offline sync, in Arabic RTL at phone size (§8.1). Demo farm only.
function anonKey(): string {
  try {
    return /ANON_KEY=(.*)/.exec(readFileSync('.local/secrets.env', 'utf8'))?.[1] ?? '';
  } catch {
    return '';
  }
}

export default defineConfig({
  testDir: 'tests/e2e/stack',
  timeout: 90_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure' },
  projects: [{ name: 'phone-rtl', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } }],
  webServer: [
    {
      command: 'bash scripts/dev-stack.sh up && tail -f /dev/null',
      url: 'http://127.0.0.1:54321/auth/v1/health',
      timeout: 240_000,
      reuseExistingServer: true,
    },
    {
      command: `bash scripts/dev-stack.sh up >/dev/null && VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_ANON_KEY=$(bash scripts/dev-stack.sh env | sed -n 's/^VITE_SUPABASE_ANON_KEY=//p') npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --host 127.0.0.1 --port 4174 --strictPort`,
      url: 'http://127.0.0.1:4174',
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
  metadata: { anonKey: anonKey() },
});
