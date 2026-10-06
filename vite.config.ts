/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Local stack only (scripts/dev-stack.sh): the dev and preview servers also pass API calls to the local gateway. An app
// built with its own address as VITE_SUPABASE_URL (scripts/codespaces.sh) then signs in through that one address, which is
// all a browser reaches in GitHub Codespaces. A production build talks to the hosted project; these settings do not apply.
const localApi = { '/auth/v1': 'http://127.0.0.1:54321', '/rest/v1': 'http://127.0.0.1:54321' };
const codespacesHosts = ['.app.github.dev'];
// scripts/codespaces.sh only (PWA_NETWORK_SHELL=1): open pages over the network while online and fall back to the device
// copy only when the network fails. Codespaces' private-port login expires after 3 hours and an idle Codespace stops; a
// cache-first shell would hide both behind a failed sign-in. Production keeps the cache-first shell (fast start on weak links).
const networkShell = process.env.PWA_NETWORK_SHELL === '1';

export default defineConfig({
  plugins: [
    react(),
    // Field app must start with no signal (§3.7): precache the shell and every route chunk. API data is not
    // cached here — it lives in IndexedDB (device cache + outbox). New versions wait for the user (prompt),
    // so an update never interrupts queued work; the outbox format is versioned with the sync API.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'نظام إدارة العمليات الزراعية',
        short_name: 'العمليات الزراعية',
        lang: 'ar',
        dir: 'rtl',
        display: 'standalone',
        start_url: '/',
        theme_color: '#1f6f43',
        background_color: '#fafaf9',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: networkShell ? null : 'index.html',
        runtimeCaching: networkShell
          ? [{ urlPattern: ({ request }) => request.mode === 'navigate', handler: 'NetworkOnly', options: { precacheFallback: { fallbackURL: 'index.html' } } }]
          : [],
        // The network-shell build must also send `/` (the address people open) to the network: by default the precache
        // answers `/` as index.html before any other route. A new version there takes over at once instead of waiting.
        ...(networkShell ? { directoryIndex: null, skipWaiting: true } : {}),
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Visible app version (§3.14).
  // Demo-stack builds only (scripts/codespaces.sh sets VITE_DEMO_SIGNIN=1): one-tap sign-in for the demo farm's users. A
  // compile-time constant, so every other build drops that code and the demo password entirely.
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __DEMO_SIGNIN__: JSON.stringify(process.env.VITE_DEMO_SIGNIN === '1') },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: localApi, allowedHosts: codespacesHosts },
  preview: { proxy: localApi, allowedHosts: codespacesHosts },
  build: {
    // Field shell must load on throttled 3G (§3.14): keep vendor code in its own long-cached chunk.
    rollupOptions: { output: { manualChunks: { vendor: ['react', 'react-dom', 'react-router-dom'], data: ['@supabase/supabase-js', '@tanstack/react-query', 'dexie'] } } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
