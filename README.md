# AetherPDF Studio — Wasm Client-Side PDF Editor

A 100% client-side, zero-backend PDF editor built with React, TypeScript, Tailwind CSS, `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit`, and `mupdf` (WebAssembly inside Web Workers).

Because every PDF parsing, rendering, font embedding, and export step runs purely inside the browser, the entire app builds to static files (`dist/`) and can be hosted directly on **GitHub Pages** or any static web host.

## Local Development

```bash
npm install
npm run dev
```

## Verification & Production Build

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Static Hosting & GitHub Pages Deployment

- [vite.config.ts](vite.config.ts) uses `base: process.env.VITE_BASE_PATH || './'` so bundled scripts, CSS, bundled fonts, PDF.js worker, and MuPDF Wasm load properly whether hosted at root (`/`) or under a GitHub Pages repository subpath (`/<repo-name>/`).
- [public/.nojekyll](public/.nojekyll) prevents Jekyll from ignoring underscore-prefixed bundle assets.
- [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds `dist/` via Node 22 (`npm ci && npm run build`) and deploys automatically to GitHub Pages whenever you push to `main` or `master`.
