/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

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
        navigateFallback: 'index.html',
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Visible app version (§3.14).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
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
