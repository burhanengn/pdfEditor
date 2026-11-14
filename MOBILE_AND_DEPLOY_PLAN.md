# gullacpdf — Mobile-Responsive, PWA & GitHub Pages Deployment Plan

## 1. Current Baseline & Repository Inspection
- **Remote Repository:** `origin https://github.com/burhanengn/pdfEditor.git` (`main` branch).
- **Wasm Threading:** `mupdf` (`^1.28.6`) and `pdfjs-dist` (`^5.4.149`) run cleanly in Web Workers without requiring `SharedArrayBuffer` / COOP / COEP headers (`crossOriginIsolated === false` verified), so GitHub Pages subpath hosting works natively without `coi-serviceworker` reloads.
- **PWA Asset Sizing Note:** `dist/assets/mupdf-wasm-*.wasm` is ~10.4 MB and `pdf.worker-*.mjs` is ~2.16 MB. Workbox default `maximumFileSizeToCacheInBytes` (2 MB) must be raised to `16 * 1024 * 1024` so offline precaching succeeds across all Wasm/worker/font assets.
- **Layout Gaps on Mobile (`< 768px`):**
  - `ThumbnailSidebar` currently has `flex w-56` without `hidden md:flex`, consuming half the screen on phones.
  - `RightInspector` has `hidden lg:flex`, leaving mobile and tablet users without object/page/font/layer controls.
  - `TopToolbar` renders desktop buttons that overflow or wrap on `375px` viewports.
  - Viewport lacks multi-touch pinch-to-zoom / two-finger pan, enlarged coarse-pointer handles, tap-to-place signature banner, `100dvh` safe areas, and `visualViewport` keyboard avoidance.

## 2. Branding Integration (`gullacpdf` / GüllaçPdf)
- Implement `src/components/BrandLogo.tsx` with all bespoke vector variants provided by the user:
  - `mark` (128×128 geometric layered Güllaç page mark with folded corner and `G` cursor dot)
  - `horizontal-light` / `horizontal-dark` / `horizontal-auto` (amblem + bespoke geometric vector wordmark `gullacpdf`)
  - `stacked` (centered amblem + wordmark for welcome/empty state)
  - `mono` (64×64 compact monochrome/two-tone mark)
  - Use `React.useId()` to scope `<linearGradient>` IDs safely when multiple logos mount simultaneously.
- Generate static public assets:
  - `public/favicon.svg` (scalable `mark` SVG)
  - `public/icons/icon-192.png` (192×192 PNG rasterized from user brand PNG/mark for PWA)
  - `public/icons/icon-512.png` (512×512 PNG rasterized for PWA splash & maskable icon)
  - `public/icons/apple-touch-icon.png` (180×180 iOS Home Screen icon)
- Update `index.html` title (`gullacpdf — Wasm Client-Side PDF Studio`), `viewport-fit=cover`, theme-color meta, Apple web-app meta, favicon, and manifest metadata.
- Compact header branding on `< 768px` (`mark` only) and full horizontal logo (`horizontal-auto`) on `>= 768px`.

## 3. Native-App-Grade Mobile Architecture (`< 768px` & Tablet)
1. **App Shell & Safe Areas:**
   - Replace `h-screen` with `h-dvh` (`100dvh` in CSS) and enforce `overscroll-behavior: none` on `html, body, #root` and app container.
   - Apply `env(safe-area-inset-top)` on top header and `env(safe-area-inset-bottom)` on mobile Bottom Action Dock.
   - Set `touch-action: pan-x pan-y` on the PDF viewport container (switching dynamically to `touch-action: none` during active 2-finger pinch or freehand drawing/highlighting).
2. **Header Adaptation (`TopToolbar.tsx`):**
   - Preserve all desktop workstation controls (`>= 768px` / `lg`) untouched with existing `data-testid`s.
   - On `< 768px`, display compact brand `mark`, Open PDF button, Undo/Redo, Theme toggle, and Export/Share trigger—no wrapping or horizontal overflow on `375×812`.
3. **Bottom Action Dock (`MobileBottomDock.tsx`, `md:hidden`):**
   - Fixed bottom bar (`44×44px`+ touch targets) with 4 primary tabs + active indicators:
     - **Sayfalar (Pages):** Opens `MobilePagesSheet` bottom/full sheet with virtualized/grid thumbnails, tap-to-jump, selection checkboxes, move up/down & reorder controls, rotate CW/CCW, delete, split, merge.
     - **Araçlar (Tools):** Opens `MobileToolsSheet` bottom drawer with categorized tools (Seç / Düzenle, Metin Ekle, Görsel Ekle, Çizim, Vurgula, İmza & Paraf, Sayfa Numaraları, Sayfa Düzenle, Yakınlaştırma).
     - **Özellikler (Inspector):** Auto-opens when an element is selected on `< lg` screens as `MobileInspectorSheet` with two snap states (`collapsed` compact quick bar vs `half` expanded drawer) sharing `InspectorContent` controls cleanly (only mounted when open on mobile so `data-testid` selectors remain unique on desktop).
     - **Dışa Aktar / Paylaş (Export / Share):** Opens `MobileExportSheet` offering direct PDF download AND Web Share API (`navigator.share` with `File` attachment when `navigator.canShare` supports files).
   - Add tablet support (`768px–1023px`, between `md` and `lg`): keep floating "Özellikler" drawer button in tablet view when `RightInspector` is hidden (`hidden lg:flex`) so iPad `768×1024` also has full inspector access!

## 4. Touch Gesture Engine & Mobile Canvas Ergonomics
1. **Multi-Touch Pinch-to-Zoom & Two-Finger Pan (`DocumentViewport.tsx`):**
   - Maintain a `Map<number, { x: number; y: number }>` of active touch pointers inside the viewport.
   - When `activePointers.size === 2`, compute frame-to-frame distance ratio and midpoint delta:
     - Scale zoom smoothly (`0.25` to `4.0`) via `setZoom(nextZoom, 'custom')` and compensate `scrollLeft`/`scrollTop` around the pinch midpoint.
     - Also handle `pointerdown` / `pointermove` guards so multi-touch never fires accidental clicks, selections, or draw strokes (`PageCanvas.tsx`).
2. **Coarse-Pointer Enlarged Selection Handles (`SelectionOverlay.tsx`):**
   - Add `pointer: coarse` styling and `36px×36px` transparent hit-area padding around all 8 corner/edge resize squares and the rotation knob (`touch-action: none`) while preserving crisp `10px` visual squares.
3. **Mobile Tap-to-Place Signature Banner (`PageCanvas.tsx` + `SignatureModal.tsx`):**
   - When `pendingSignaturePlacement` is set, display a clear floating top banner: `"İmzayı yerleştirmek istediğiniz yere dokunun"` alongside `"İptal"` button (`cancel-signature-placement-btn`), working identically on both touchscreens (single tap drops signature cleanly at tapped PDF coordinates) and desktop hover+click.
4. **Virtual Keyboard Avoidance (`InlineTextEditor.tsx`):**
   - Subscribe to `window.visualViewport?.addEventListener('resize', ...)` while editing text inline. Compute whether the active element is occluded below `visualViewport.height + visualViewport.offsetTop` and scroll the editor smoothly into view above the keyboard.

## 5. Progressive Web App (`vite-plugin-pwa`)
- Install `vite-plugin-pwa` as a dev dependency.
- Configure `VitePWA` in `vite.config.ts`:
  - `registerType: 'autoUpdate'`
  - Manifest: `name: 'gullacpdf — Wasm PDF Studio'`, `short_name: 'gullacpdf'`, `display: 'standalone'`, `theme_color: '#2563EB'`, `background_color: '#0F172A'`, icons (`192x192`, `512x512`, maskable `512x512`).
  - Workbox: `maximumFileSizeToCacheInBytes: 16 * 1024 * 1024`, `globPatterns: ['**/*.{js,css,html,ico,svg,png,wasm,ttf,mjs,webmanifest}']`, clean outdated caches.
- Add non-intrusive install prompt / offline readiness support where appropriate without blocking workspace UI.

## 6. GitHub Pages Sub-Path Routing & CI/CD
- Configure `vite.config.ts`:
  - `base: process.env.GITHUB_ACTIONS ? '/pdfEditor/' : (process.env.VITE_BASE_PATH || './')`
- Audit and update `.github/workflows/deploy.yml`:
  - Trigger on `push` to `main` and `workflow_dispatch`.
  - Ensure `permissions: { contents: read, pages: write, id-token: write }`, Node 20, `npm ci`, `npm run typecheck`, `npm run build`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4`.
- Ensure static public paths use relative `./` or `import.meta.env.BASE_URL` so everything resolves cleanly under `/pdfEditor/` as well as local root `/`.

## 7. Verification Plan
- `npx tsc --noEmit` — 0 TypeScript errors.
- `npx vitest run` — all unit tests passing.
- `npm run build` — verify clean `dist/`, `manifest.webmanifest`, `sw.js`, `.wasm`, and `icon-*.png`.
- `npx playwright test` — run full desktop suite (ensuring 0 regressions) AND dedicated mobile/PWA/branding tests across `375×812` (iPhone), `390×844` (Modern phone), and `768×1024` (iPad):
  - Branding (`gullacpdf`, SVG mark, manifest + icons).
  - Zero horizontal overflow (`scrollWidth <= innerWidth`), single-row non-wrapping header, `>= 44px` dock buttons.
  - Bottom Dock tabs opening Pages / Tools / Inspector / Export sheets cleanly.
  - Pinch-to-zoom simulation / zoom update, touch tap-to-place signature banner `"İmzayı yerleştirmek istediğiniz yere dokunun"` + placement, mobile text editing & export.
- Commit all verified changes and execute `git push origin main`.
