# gullacpdf — Client-Side PDF Viewer & Editor

A 100% client-side, zero-backend PDF viewer and editor built for web (React, TypeScript, Tailwind CSS, Rust/WebAssembly, PDFium) and mobile (Flutter + Rust).

Every PDF parsing, rendering, text search, font embedding, redaction, and export step runs locally on-device with no server uploads.

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

## Static Hosting

- [vite.config.ts](vite.config.ts) supports root (`/`) hosting (Cloudflare Pages) as well as subpath hosting (`VITE_BASE_PATH` / GitHub Pages).
- [public/.nojekyll](public/.nojekyll) prevents Jekyll from ignoring underscore-prefixed bundle assets.
