import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      // Eigener Service Worker (Push, Teilen-Ziel) – Precache-Liste wird von Workbox eingesetzt
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/*-cyrillic*', '**/*-greek*', '**/*-vietnamese*'],
      },
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'TE-Digital Zentrale',
        short_name: 'TE-Zentrale',
        description: 'Unternehmenszentrale von TE-Digital: KI-Mitarbeiter, Projekte, Aufgaben und Freigaben.',
        lang: 'de',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#FBFAF7',
        background_color: '#FBFAF7',
        categories: ['business', 'productivity'],
        // Android: „Teilen“ aus ChatGPT/Gemini/Grok direkt an die Zentrale (iOS unterstützt das für PWAs nicht)
        share_target: {
          action: '/teilen',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        shortcuts: [
          { name: 'Neuer Auftrag', short_name: 'Auftrag', url: '/aufgaben/neu', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          { name: 'Freigaben', short_name: 'Freigaben', url: '/freigaben', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
        ],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
