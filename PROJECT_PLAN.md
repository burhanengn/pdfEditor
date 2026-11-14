# PROJECT_PLAN.md — Wasm-Powered Client-Side Desktop PDF Editor

## 1. Executive Summary & Architectural Mandate
This project is a 100% client-side, zero-backend, desktop-class **Web-Based PDF Editor** engineered for privacy, 60fps UI responsiveness on 100+ page documents, and authentic low-level PDF manipulation.

### Core Architectural Pillars
1. **100% Client-Side Wasm & Worker Isolation:**
   - **UI Thread (React 18+ / TypeScript / Tailwind CSS):** Strictly dedicated to layout, virtualized viewport orchestration, pointer/keyboard interactions, SVG/Canvas interactive selection overlays, and property inspection. Zero synchronous PDF binary parsing or Wasm heap work on the main thread.
   - **Render Engine (`pdfjs-dist` Worker):** WebWorker-backed progressive high-DPI canvas rendering (`devicePixelRatio`-aware), text-run metric extraction (position, transform, font metrics, color), and PDF operator-list inspection (`OPS`) to discover embedded raster `XObject` images and their exact CTM transforms.
   - **Wasm PDF Manipulation Worker (`mupdf` Wasm + `pdf-lib` + `@pdf-lib/fontkit`):**
     - Dedicated Web Worker isolating all `mupdf` WebAssembly heap allocations (`Document`, `Page`, `Pixmap`, `Buffer`) and `pdf-lib` stream rewrites.
     - Explicit `try / finally` `.destroy()` lifecycle management for every Wasm object to prevent Wasm memory leaks across large editing sessions.
     - Supports encrypted/password-protected PDF authentication & decryption via `mupdf` Wasm, true PDF content-stream operator removal (for edited text and moved/deleted image XObjects), vector/font/image embedding, page tree operations (merge, split, rotate, reorder, duplicate, delete), and compressed garbage-collected serialization.
   - **State & Undo/Redo Command Architecture (Zustand + Temporal History):**
     - Normalized document & per-page element model (`PageMeta`, `DetectedTextBlock`, `TextEditElement`, `AddedTextElement`, `ImageObjectElement`, `SignatureElement`, `StrokeAnnotationElement`, `HighlightRectElement`).
     - Custom temporal Undo/Redo stack with transaction coalescing (drag/resize gestures produce a single undoable step on pointer-up, not hundreds of intermediate frames) and clean memory cleanup for revoked blob URLs.

2. **PDF Coordinate Space Synchronization:**
   - **PDF Space:** Bottom-left origin `(0, 0)` in PDF points (`1 pt = 1/72 inch`), accounting for page `MediaBox`/`CropBox` offsets (`[x0, y0, x1, y1]`) and intrinsic page `/Rotate` (`0 | 90 | 180 | 270`).
   - **Viewport DOM Space:** Top-left origin `(0, 0)` in CSS pixels scaled by `zoom * renderScale`.
   - Centralized pure coordinate transform module (`src/engine/coordinates.ts`) converting seamlessly between PDF user space and DOM/Canvas space for hit-testing, bounding boxes, resize handles, rotation pivots, snap guides, and final PDF serialization.

---

## 2. Directory Structure & Module Blueprint

```
src/
├── main.tsx                        # React entry point & root stylesheet mount
├── app/
│   └── App.tsx                     # Root desktop workbench shell & keyboard shortcut controller
├── types/
│   ├── pdf.ts                      # Core PDF document, page, transform, font, color types
│   ├── elements.ts                 # Discriminated union of all editable/overlay elements
│   └── worker.ts                   # Typed RPC protocol for PDF Wasm Worker
├── store/
│   ├── useEditorStore.ts           # Zustand store: document, pages, elements, tools, viewport, theme, modal states
│   └── history.ts                  # Undo/Redo temporal history manager helpers & snapshot cloning
├── engine/
│   ├── coordinates.ts              # Bidirectional PDF <-> Viewport coordinate & rotation math
│   ├── pdfjsService.ts             # pdfjs-dist worker setup, progressive page render, image XObject & rule extraction
│   ├── textExtractor.ts            # MuPDF StructuredText text-block extractor with soft-wrap reflow & true RGB ink
│   ├── pdfCompiler.ts              # MuPDF Wasm + pdf-lib + fontkit + JSZip assembly, redaction, clean-page preview & compilation
│   ├── documentController.ts       # Main-thread orchestration for open, merge, split ZIP, image/WebP normalization & export
│   ├── pageRange.ts                # 1-based page range parser (ranges, individual pages, split groups)
│   ├── samplePdf.ts                # Multi-page synthetic sample PDF generator with embedded XObject raster
│   ├── wasmWorkerClient.ts         # Promise-based typed RPC client to the PDF Wasm Worker + cleanup
│   ├── unicodeFonts.ts             # Lazy worker loader for bundled DejaVu Sans / Serif / Mono TTF font suites
│   └── fonts.ts                    # Standard/DejaVu Unicode PDF fonts, font family category mapping & glyph filtering
├── workers/
│   └── pdfWasm.worker.ts           # Isolated Web Worker running mupdf Wasm + pdf-lib + fontkit + JSZip
├── utils/
│   ├── id.ts                       # Monotonic unique element/page ID generator
│   ├── blobRegistry.ts             # Reference-counted URL.createObjectURL tracker, scope revoker & GC
│   ├── snapGuides.ts               # Alignment guide detection (page center, margins, sibling edges)
│   └── signatureStorage.ts         # localStorage signature vault (Bezier paths, typed PNGs, WebP/JPG white-bg removal)
└── components/
    ├── toolbar/
    │   └── TopToolbar.tsx          # Modes (Select/Edit, Add Text, Add Image, Draw, Annotate, Sign, Organize), Undo/Redo, Zoom, Export
    ├── sidebar/
    │   ├── ThumbnailSidebar.tsx    # Virtualized left sidebar with drag-and-drop reordering & multi-select
    │   └── ThumbnailItem.tsx       # Lazy rendered page thumbnail + quick rotate/duplicate/delete actions
    ├── viewport/
    │   ├── DocumentViewport.tsx    # Virtualized multi-page scroll container, Ctrl+Scroll zoom, file dropzone
    │   ├── PageCanvas.tsx          # High-DPI pdfjs canvas + interactive overlay layer + inline text editor
    │   ├── SelectionOverlay.tsx    # Interactive bounding-box handles (8-point resize, rotate handle, snap guides)
    │   └── InlineTextEditor.tsx    # Seamless WYSIWYG inline editing for existing PDF text & new text blocks
    ├── inspector/
    │   └── RightInspector.tsx      # Contextual property panel (font, size, color, bold/italic, opacity, X/Y/W/H, rotation, z-order)
    └── modals/
        ├── SignatureModal.tsx      # 3-tab Signature Studio (Draw Bezier, Type Script, Upload w/ white-bg removal) + Saved Vault
        ├── SplitExtractModal.tsx   # Page range selector, individual/batch split, ZIP export via JSZip
        ├── PasswordModal.tsx       # Encrypted PDF password prompt & unlock flow
        └── PageOrganizeModal.tsx   # Full-grid page organizer view (merge, reorder, rotate, duplicate, split, delete)
```

---

## 3. Phased Execution Plan & Backlog

### Phase 1: Foundation & Architecture Setup
- [x] **1.1** Initialize Vite + React 18+ + TypeScript + Tailwind CSS project configuration (`package.json`, `tsconfig.json`, `vite.config.ts`, `postcss.config.js`, `tailwind.config.js`).
- [x] **1.2** Configure `vite.config.ts` for WebAssembly (`optimizeDeps.exclude: ['mupdf']`, proper `.wasm` asset handling, worker ES format, COOP/COEP headers for dev/preview).
- [x] **1.3** Install core dependencies (`pdfjs-dist`, `mupdf`, `pdf-lib`, `@pdf-lib/fontkit`, `jszip`, `zustand`, `@tanstack/react-virtual`, `lucide-react`) and dev/test dependencies (`vitest`, `jsdom`, `@playwright/test`, `@types/...`).
- [x] **1.4** Define strict TypeScript domain types (`src/types/pdf.ts`, `src/types/elements.ts`, `src/types/worker.ts`).
- [x] **1.5** Implement centralized `BlobRegistry` (`src/utils/blobRegistry.ts`) for leak-free `URL.createObjectURL` management and snapshot-scoped garbage collection.
- [x] **1.6** Implement Zustand editor store + custom Undo/Redo history stack (`src/store/useEditorStore.ts`, `src/store/history.ts`) with transaction coalescing and keyboard shortcuts.
- [x] **1.7** Implement `src/workers/pdfWasm.worker.ts` + `src/engine/wasmWorkerClient.ts` RPC bridge and verify `mupdf` Wasm initialization inside Web Worker.
- [x] **1.8** Phase 1 Verification: `tsc --noEmit`, `npm run build`, unit tests for store/undo-redo & coordinate math.

### Phase 2: High-Performance Viewer & Page Manager
- [x] **2.1** Implement `src/engine/coordinates.ts` (PDF <-> Viewport conversion supporting CropBox, MediaBox, and 0/90/180/270 rotation).
- [x] **2.2** Implement `src/engine/pdfjsService.ts` with `pdfjs-dist` worker, progressive cancellation-safe high-DPI page rendering, and thumbnail rendering queue.
- [x] **2.3** Build desktop-class application shell (`TopToolbar`, `ThumbnailSidebar`, `DocumentViewport`, `RightInspector`, dark/light mode toggle, empty/welcome dropzone with instant sample PDF generator button).
- [x] **2.4** Implement virtualized `DocumentViewport` (`@tanstack/react-virtual`) supporting 100+ pages smoothly, Fit Width / Fit Page / custom % zoom, `Ctrl+Scroll` cursor-centered zoom, and smooth page navigation.
- [x] **2.5** Implement virtualized `ThumbnailSidebar` with drag-and-drop page reordering, multi-page selection, quick rotate (90° CW/CCW, 180°), duplicate, and delete.
- [x] **2.6** Implement PDF **Merge** (drop additional PDF(s) onto viewport or sidebar to merge pages seamlessly in worker), **Split / Extract** modal (range parsing like `1-3, 5, 8-10`, export single PDF or split-to-individual-PDFs bundled via `JSZip`), and **Page Organize** full-grid mode.
- [x] **2.7** Implement **Password-Protected / Encrypted PDF** detection & `PasswordModal` unlock flow via `mupdf` Wasm (`authenticatePassword` + `encrypt=none` decrypted buffer handoff).
- [x] **2.8** Phase 2 Verification: Build, unit tests for page range parser & worker merge/split/rotate, headless browser test loading a 105-page synthetic PDF & checking virtualized scrolling + zero console errors.

### Phase 3: Interactive Canvas Overlay & Object Engine
- [x] **3.1** Implement `src/utils/snapGuides.ts` for smart alignment snapping (page margins, horizontal/vertical centerlines, sibling element edges & centers) with live visual guide lines.
- [x] **3.2** Implement `SelectionOverlay.tsx` with accurate bounding box projection, 8-point aspect/free resize handles, top rotation handle with angle readout & 15° Shift-snap, drag move, and cursor feedback.
- [x] **3.3** Implement **Annotate & Draw** tools:
  - Freehand smooth Bezier pen drawing tool (stroke width, color, opacity, quadratic midpoint smoothing).
  - Highlight rectangle / shape / permanent MuPDF redaction annotation tools.
- [x] **3.4** Implement layer ordering (`Bring to Front`, `Send to Back`, `Forward`, `Backward`), nudge via Arrow keys (1pt / 10pt with Shift), `Delete`/`Backspace` removal, copy/paste (`Ctrl+C` / `Ctrl+V`), and Undo/Redo integration for gestures.
- [x] **3.5** Phase 3 Verification: Unit tests for coordinate transforms, snap guide geometry, and rotation math; headless browser interaction test for dragging, resizing, rotating, snapping, `Delete` + `Ctrl+Z`, and undo/redo.

### Phase 4: In-Place Text & Image Mutation Engine
- [x] **4.1** Implement deep **Text Extraction & Grouping** (`src/engine/pdfjsService.ts`): extract text runs from `pdfjs-dist` (`getTextContent`) + graphics state fill colors (`OPS.setFillRGBColor`/`setFillGray`) and resolved font descriptors (`commonObjs`) from `getOperatorList`, cluster adjacent spans into editable paragraph/line blocks with detected font family (serif/sans/mono), font size, bold/italic weight, line height, and hex color.
- [x] **4.2** Implement **In-Place Text Editing (`InlineTextEditor.tsx` & `PageCanvas.tsx`)**:
  - Hovering/clicking existing text in Select/Edit mode highlights the detected text block bounding box and samples live canvas background fill color for clean visual masking during editing.
  - Clicking existing text opens a calibrated inline editor matching font, size, color, and baseline.
  - Editing or deleting an existing text block registers a stream removal target (original PDF rect/operators) + replacement text render payload.
  - Supports adding brand-new text blocks anywhere on a page with standard PDF fonts + curated font presets (`Helvetica`, `Inter`, `TimesRoman`, `Merriweather`, `Courier`, `JetBrainsMono`, `GreatVibes`, `Caveat`) and optional custom `@pdf-lib/fontkit` font byte embedding in `compilePdfDocument`.
- [x] **4.3** Implement **Embedded Image (`XObject`) Detection & Manipulation**:
  - Parse `pdfjs-dist` operator list (`OPS.save`, `OPS.restore`, `OPS.transform`, `OPS.paintImageXObject`, `OPS.paintInlineImageXObject`) to detect embedded raster images with their exact PDF bounding box, rotation, XObject resource name, and extracted PNG data URL for interactive manipulation.
  - Allow selecting, moving, resizing, rotating, and deleting existing embedded PDF images directly on the canvas (stripping the original image drawing operator on export via MuPDF and re-embedding at the new geometry if not deleted).
  - Support inserting new images (PNG, JPG, WebP — converting WebP/BMP/GIF/SVG cleanly to PNG bytes in-browser before PDF embedding).
- [x] **4.4** Phase 4 Verification: Unit & integration tests verifying original text removal + edited text re-embedding in exported PDF, moved embedded image XObject placement, and deleted embedded image XObject removal verified by re-parsing exported PDF bytes with MuPDF.

### Phase 5: Signature Suite & Contextual Inspector
- [x] **5.1** Build `SignatureModal.tsx` with 3 rich tabs:
  - **Draw:** Smooth quadratic Bezier canvas with stroke thickness, ink color (black, navy, crimson), clear, and vector SVG path + transparent PNG output.
  - **Type:** Live signature preview rendered cleanly onto transparent PNG across 4 script/serif styles (`Classic Script`, `Calligraphy`, `Modern Hand`, `Editorial Serif`) with offline local font rendering.
  - **Upload:** Drag-and-drop/file-picker PNG/JPG/WebP signature image with automatic white-background threshold transparency removal.
- [x] **5.2** Build **Saved Signature Vault (`localStorage`)**: Save, preview, reuse, and delete signatures with one-click placement onto the current PDF page (`signatureStorage.ts`).
- [x] **5.3** Build **Contextual `RightInspector.tsx`**:
  - Dynamically adapts to selection: Text properties (content, font family, size, line height, color, bold, italic, alignment, opacity), Image/Signature properties (opacity, aspect ratio lock, replace image), Stroke/Annotation properties (stroke width, color, opacity), or Page properties when nothing is selected (dimensions, rotation, quick actions, detected text/images list).
  - Numeric X, Y, Width, Height (in pts), and Rotation (°) inputs with live two-way sync and Undo/Redo history tracking.
- [x] **5.4** Phase 5 Verification: Headless test creating Draw/Type/Upload signatures, saving to vault, reloading page to verify persistence, placing & editing via Inspector inputs.

### Phase 6: Serialization, Hardening & Autonomous QA Loop
- [x] **6.1** Implement full **PDF Compilation & Serialization Pipeline** (`src/engine/pdfCompiler.ts` executed in `src/workers/pdfWasm.worker.ts`):
  - Stage 1: Page structural assembly (`pdf-lib`) — apply page order, merged source documents, deletions, duplicates cleanly.
  - Stage 2: Low-level content stream mutations via `mupdf` Wasm in separate passes (`REDACT_TEXT_REMOVE` for edited/deleted text, `REDACT_IMAGE_REMOVE` for moved/deleted image XObjects, both with `black_boxes = false`, plus solid redaction pass for permanent redact boxes) so removed text/images are stripped from the PDF stream rather than covered by white boxes.
  - Stage 3: Vector, font, signature, stroke, highlight, and image embedding (`pdf-lib` + `@pdf-lib/fontkit`, opacity, rotation transforms, and user `/Rotate`).
  - Stage 4: `mupdf` Wasm final pass optimization & garbage collection (`garbage=3,compress`).
- [x] **6.2** Build **Synthetic Complex PDF Test Generator** (`src/engine/samplePdf.ts` + Vitest/Playwright test fixtures covering multi-page, mixed fonts/colors, embedded raster images, rotated pages, and AES-256 encrypted PDFs).
- [x] **6.3** Run full QA Audit Loop (`tsc --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `npm run build`, `npx vitest run`, and Playwright headless Chromium E2E suite across desktop workflows + 105-page document + encrypted unlock + zero console/page/request errors).
- [x] **6.4** Audit `PROJECT_PLAN.md` checklist & harden discovered edge cases:
  - Fixed `mupdf` Wasm worker asset URL bundling (`mupdf-wasm.wasm?url` + `$libmupdf_wasm_Module.locateFile`).
  - Fixed Playwright ARIA strict-mode collision in `ThumbnailItem.tsx` (`role="listbox"` / `role="option"` + uniquely labeled action buttons).
  - Fixed `InlineTextEditor` blur race on creation by triggering text initiation on `onClick` and resetting `toolMode` prior to focusing.
  - Fixed `inferFontFromPdfName` ordering so `"sans-serif"` matches sans-serif rather than serif.
  - Added live background color sampling (`sampleCanvasBackgroundColor`) on dark banner text edits so canvas masking matches dark/colored backgrounds cleanly.
  - Replaced deprecated MuPDF `saveToBuffer('decrypt')` with `encrypt=none`.
  - Replaced opaque white-box UI masking over deleted/moved embedded images and edited text with live MuPDF clean-page preview stripping (`prepareCleanPreviewPagePdf` + `prepareCleanPage` RPC via cached MuPDF worker docs) so underlying table borders and text remain cleanly visible on screen.
  - Upgraded PDF text extraction to MuPDF `StructuredText` (`src/engine/textExtractor.ts`) + horizontal table-divider detection (`extractPageImagesAndRules`) for accurate soft-wrap paragraph merging, live vertical reflow during inline editing (`InlineTextEditor`), and exact RGB fill colors (e.g. `#ffffff` on dark banners).
  - Bundled offline Unicode TrueType suites via `dejavu-fonts-ttf` (`src/engine/unicodeFonts.ts`) with `@pdf-lib/fontkit` subsetting and charset-aware glyph filtering (`filterTextForPdfFont`) so Turkish (`ğ`, `Ğ`, `ş`, `Ş`, `ı`, `İ`, `ö`, `Ö`, `ü`, `Ü`, `ç`, `Ç`) and currency (`₺`) characters export without `?` substitution.
  - Preserved behind-content watermark Z-order (`behindContent` + `opacity` detection in `pdfjsService.ts`, non-blocking base canvas hit-box / `zIndex: 0` / transparent-background canvas underlay + `mixBlendMode: 'multiply'` fallback in `PageCanvas.tsx`, and `/Contents` pre-content stream prepending in `pdfCompiler.ts`) so selecting or moving background emblems never covers dark table borders or text.
  - Bundled metric-matched `@universal-office/font-files` (`Liberation Serif/Sans/Mono`, `Carlito`/`Calibri`, `Caladea`/`Cambria`) across both export (`unicodeFonts.ts`, `pdfCompiler.ts`) and browser `@font-face` (`fontFaces.ts`), with improved PDF subset font name inference (`fonts.ts`), keeping original font metrics and `₺` fallback intact.
  - Added two-side justification detection (`detectParagraphAlignment`) and same-baseline justified-word stitching (`mergeSameBaselineSegments`) in `textExtractor.ts`, `align: 'justify'` support in `RightInspector.tsx` / `InlineTextEditor.tsx`, and soft-wrap inter-word justification in `pdfCompiler.ts` (`richText.ts`).
  - Added rich inline `TextRun[]` (`super`, `sub`, `bold`, `italic`) extraction (`mergeOrphanScriptSegments`, modal baseline detection), WYSIWYG `<div contentEditable>` rich editing (`InlineTextEditor.tsx`), Inspector `Superscript` (`X²`) / `Subscript` (`X₂`) controls, and raised/lowered glyph rendering on PDF export (`pdfCompiler.ts`).
