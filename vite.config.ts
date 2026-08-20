import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Build config.
 *
 * `base: './'` keeps every asset reference relative so the built app runs from
 * any path — a subfolder on a static host, a USB stick on the warehouse laptop —
 * which matters because QR deep links have to resolve wherever it is served.
 */
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      manifest: {
        name: 'SingleTrack Events — Warehouse',
        short_name: 'ST Warehouse',
        description:
          'Packing, packlists, stocktaking and transport for trail running events. Works offline.',
        theme_color: '#16553e',
        background_color: '#f4f6f4',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        categories: ['productivity', 'business'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Scan a crate', short_name: 'Scan', url: './#/scan' },
          { name: 'Stock', short_name: 'Stock', url: './#/stock' },
        ],
      },
      workbox: {
        // Precache the whole app: once installed it must open with no network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // Screens are lazily routed, so keep the warning threshold tight enough to
    // notice if something heavy sneaks into the initial bundle.
    chunkSizeWarningLimit: 700,
  },
});
