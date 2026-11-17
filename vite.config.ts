import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'pdfEditor';
const resolvedBase = process.env.GITHUB_ACTIONS
  ? `/${repoName}/`
  : (process.env.VITE_BASE_PATH || './');

export default defineConfig({
  base: resolvedBase,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [
        'favicon.svg',
        '.nojekyll',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
      ],
      manifest: {
        name: 'gullacpdf — Client-Side PDF Studio',
        short_name: 'gullacpdf',
        description:
          'gullacpdf — Zero-backend client-side PDF viewer and editor for text, images, signatures, and page management.',
        theme_color: '#2563EB',
        background_color: '#0F172A',
        display: 'standalone',
        orientation: 'any',
        start_url: '.',
        scope: '.',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'application/pdf': ['.pdf'],
            },
          },
        ],
        share_target: {
          action: './?share-target=1',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [
              {
                name: 'file',
                accept: ['application/pdf', '.pdf'],
              },
            ],
          },
        },
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,svg,png,wasm,ttf,mjs,webmanifest}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        importScripts: ['sw-share-target.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@pdfium-wasm': path.resolve(__dirname, 'node_modules/@embedpdf/pdfium/dist/pdfium.wasm'),
    },
  },
  optimizeDeps: {
    exclude: ['@embedpdf/pdfium'],
    esbuildOptions: {
      target: 'esnext',
    },
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'zustand'],
          'ui-vendor': ['lucide-react', '@tanstack/react-virtual'],
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
