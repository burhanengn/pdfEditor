# FLUTTER_PARITY_AND_ADB_PLAN.md

## 1. Executive Audit: gullacpdf Web & Rust Core vs. Flutter Mobile

| Area | Gold-Standard Web (`src/` + `core/`) | Current Flutter Mobile (`mobile/`) | Root Cause & Severity |
| :--- | :--- | :--- | :--- |
| **File Import, Picker & Intents** | Multi-PDF open/merge, image insert (PNG/JPG/WebP), signature photo upload, custom `.ttf`/`.otf` upload, drag-drop, OS file open, browser print. | `FileBridgePlugin.kt` only exposes PDF picker (`type = "application/pdf"`), missing image/font pickers, forces `.pdf` suffix in `sanitizeFileName`, `AndroidManifest.xml` has broken `.*\\.pdf` pattern, `onMergePdf` calls `_openFromPicker` (replaces doc!), `onReopenRecent` ignores `content://`, `printPdf` unimplemented on Android. | **CRITICAL** — Users cannot insert images/upload signatures/print or merge PDFs; malformed path pattern breaks third-party "Open with" intents. |
| **Viewer Performance & Gestures** | GPU CSS/canvas pan & pinch transform (`pendingGpuTransform`), quantized render scaling, rapid scroll throttle, fit-width auto-zoom, double-tap zoom, crisp visible tile scheduling, clickable PDF links, text selection/copy, thumbnail previews. | `_syncActivePage()` mutates Riverpod `gpSessionProvider` on every `onPointerMove` frame (rebuilding entire widget tree at 60Hz+); pinch zoom emits unquantized `scaleBucket` (`1.01`, `1.02`...) with zero `cancelRenderScope`; `_scheduleVisibleTiles` never runs on drag/inertia; `fitWidthZoom` computed in `LayoutBuilder` is never applied on load. | **CRITICAL** — Severe scroll/pinch stutter, UI rebuild storm, single-thread actor queue congestion, wrong initial zoom on phone screens. |
| **Native Rust Engine (`gp-frb` / `gp-pdf-pdfium`)** | Full Web `pdfCompiler.ts` + `gp-redact` + `gp-text` + `gp-geom`: `text-edit` content-stream stripping, `image-replacement`, `shape-replacement`, full shapes (`rect`/`ellipse`/`triangle`/`diamond`/`arrow`/radius/dash), `VectorPath` (`pen`/`line`), `ImageAdd` (crop/flip/rotate/opacity), `Signature` (SVG & PNG), `LayerTier` ordering, `PageNumberingConfig`, `DejaVu` UTF-8 TTF fonts (`ğüşıİöç`). | `compile_native_pdf` in `core/crates/gp-pdf-pdfium/src/lib.rs` ignores `ImageAdd`, `ImageReplacement`, `ShapeReplacement`, `VectorPath`, `Signature`, non-rect shapes, stroke dash, `LayerTier`, `PageNumberingConfig`, text stripping, align/bold/italic/lineHeight, and `FrbSessionBridge` passes `customTtfBytes: null`. `prepare_clean_page_preview_with_lopdf` and `extractLinks` are not exposed over FRB. | **CRITICAL** — Edits fail to serialize natively; shapes/images/signatures/page-numbers vanish on export; Turkish UTF-8 breaks; edited original text duplicates on export. |
| **Edit Mode: Canvas Interaction** | Full move drag + snapping (`computeSnapGuidePosition`), 8 corner/edge `36px` touch handles (`computeRotatedResizeRect`), rotation stem handle, lock toggle, Z-order (`LayerTier` + `zIndex`), copy/paste/duplicate, delete. | `_OverlayLayerPainter` paints selection handles visually, but `PdfViewport` has **zero** pointer drag handling for moving, resizing, or rotating elements. | **CRITICAL** — Elements are frozen once placed; mobile handles are non-functional. |
| **Edit Mode: In-Place Text & Adding Text** | `analyzePageObjectsJson` extracts PDF `textBlocks`/`images`/`shapes`; tapping text enters inline edit with clean stream-stripped preview (`prepare_clean_page_preview`), full font/size/bold/italic/align/lineHeight/color/bg inspector, custom TTF fonts. | Never calls `analyzePageObjectsJson`; only spawns `textAdd` at cramped bottom bar with zero keyboard avoidance or rich font/alignment controls. | **CRITICAL** — Existing PDF text cannot be edited in place; new text lacks styling and Turkish font export. |
| **Edit Mode: Shapes, Vector Paths & Images** | Interactive drag-to-create bounds for `rect`, `ellipse`, `triangle`, `diamond`, `arrow`, `line`, `pen` (freehand), `highlight`, `redact`; image insert/crop/flip/rotate/opacity & Repeat Across Pages (All / Odd / Even / Exclude Cover / Range). | Tapping `shape` spawns fixed `90x50` rect only; no `ellipse`/`triangle`/`diamond`/`arrow`/`line`; no `highlight` opacity/style; no image insertion or header/footer repeat. | **CRITICAL** — Broken shape creation; missing vector tools and image editing. |
| **Signature & Paraf Studio + Vault** | Draw (with velocity-sensitive **"Orijinal Görünümlü"** wet ink) / Type (cursive styles) / Upload photo (auto background removal); **Signature vs Paraf** toggle; local Vault persistence; **Tap-to-Place** interactive banner; **Apply to All Pages**. | Draw-only single-color pad that spawns a centered ink element with no Paraf mode, no realistic ink, no type/upload tabs, no Vault, no Tap-to-Place, no Apply-to-All. | **HIGH** — Major UX regression vs. Web SignatureModal. |
| **Page Organization & Undo/Redo** | Unified `GpCommand` stack (`Command` undo/redo), multi-select pages, drag reorder, rotate CW/CCW/180°, duplicate, insert blank, delete, merge external PDF preserving unsaved edits, split/extract PDF, dynamic page numbering, Share/Save/Print. | Partial undo stack without rich element mutations; organizer sheet lacks thumbnails, multi-select, CCW/180°, duplicate, blank page, split/extract, page numbering; merge replaces open document. | **HIGH** — Missing essential PDF workflow actions. |

---

## 2. Multi-Phase Engineering & Autonomous Verification Plan

### Compliance Guardrails (Must Remain Green Every Phase)
- Zero AGPL dependencies (`mupdf` forbidden in `mobile/pubspec.yaml` and `core/Cargo.toml` per `os_integration_audit_test.dart`).
- Zero legacy storage / internet permissions in `mobile/android/app/src/main/AndroidManifest.xml` (`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE`, `INTERNET` forbidden; Scoped Storage + SAF + `FileProvider` only).
- Web codebase (`src/`) TypeScript & Vitest checks remain green; shared strings synchronized via `design-tokens/i18n.json` + `node design-tokens/generate.mjs`.

### Phase 1: File Import, Scoped Storage, Intents & Print Bridge
1. **AndroidManifest.xml**: Fix `android:pathPattern=".*\\.pdf"` -> `.*\.pdf` and `.*\.PDF`, add `BROWSABLE` category where appropriate, and support `file` scheme safely alongside `content`.
2. **FileBridgePlugin.kt & FileBridge.swift & `file_bridge.dart`**:
   - Preserve exact extensions in `sanitizeFileName` for images (`.png`, `.jpg`, `.jpeg`, `.webp`) and fonts (`.ttf`, `.otf`), enforcing `.pdf` only for PDF documents.
   - Add `openImagePicker()` (`image/*` via `ACTION_OPEN_DOCUMENT` with `ACTION_GET_CONTENT` fallback & `ActivityNotFoundException` handling), `openFontPicker()` (`.ttf`/`.otf`), and `allowMultiple` PDF pickers for Merge.
   - Harden `copyUriToWorkFileAsync` with buffered streaming, `ParcelFileDescriptor` / safe `file://` readable fallback, accurate size/name resolution, and descriptive error propagation.
   - Implement real Android printing via `PrintManager` + `PdfPrintDocumentAdapter` streaming from app-private PDF work/export file.
   - Fix `onReopenRecent` in `gullacpdf_app.dart` to reopen `content://` persisted URIs via `copyToWorkFile` fallback cleanly, and wire `try/catch` snackbars on picker/intent errors.
3. **Phase 1 Verification**: `flutter analyze`, `flutter test`, `flutter build apk --debug`, ADB install + `am start -a android.intent.action.VIEW` with pushed PDF + logcat verification.

### Phase 2: 60fps Virtualized Viewport, GPU Pinch Scaling & Viewer Parity
1. **Eliminate UI Isolate Rebuild Storms**: Decouple viewport pan/zoom state in `GpViewportController` (`ValueNotifier`s for zoom/activePage/loadingTiles) and throttle Riverpod `updateViewportPosition` syncing to ~160ms idle / gesture-end so `MaterialApp`/`Scaffold` never rebuild during scroll/pinch.
2. **Smooth Auto Fit-Width, Quantized Zoom & GPU Transform**:
   - Auto-apply `fitWidthZoom` on first valid layout of an opened document.
   - During active pinch gesture (`onScaleUpdate`), scale existing rendered page tiles smoothly on the Skia/Impeller GPU (`Canvas.scale`) instead of queueing tile renders per `0.01` zoom delta; quantize tile render scales (`0.25` steps) and call `cancelRenderScope` on zoom bucket switches or fast velocity flings.
   - Schedule visible + 1-screen predictive tiles during drag/inertia/scroll jumps with throttled debouncing (`32ms`), plus prioritize `preempt_low` vs `preempt_all` cleanly in `core/bindings/frb/src/actor.rs`.
3. **Viewer UX Parity**:
   - Double-tap zoom (`fitWidth` <-> `2.0x` centered on tap focal point), floating page/zoom pill, selectable/copyable page text dialog/drawer (`extractPageText`), clickable PDF links (`extractPageLinks` in Rust + FRB), and real cached thumbnail rendering in `GpNavigatorSheet`.
4. **Phase 2 Verification**: `flutter analyze`, `flutter test`, `flutter build apk --debug`, ADB install + `dumpsys gfxinfo dev.gullacpdf.gullacpdf_mobile` frame-timing verification during programmatic scroll/swipe.

### Phase 3: Rust `gp-pdf-pdfium` + FRB Native Engine Parity & Bundled Turkish Fonts
1. **Bundled Unicode TTF Assets**: Copy `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`, `DejaVuSans-Oblique.ttf`, `DejaVuSerif.ttf`, `DejaVuSansMono.ttf` from `node_modules/dejavu-fonts-ttf/ttf/` to `mobile/assets/fonts/` and register in `mobile/pubspec.yaml` so Turkish `ğ, ü, ş, ı, İ, ö, ç` always embed natively offline.
2. **Extend FRB API (`core/bindings/frb/src/api/session.rs` + codegen)**:
   - Add `prepare_clean_page_preview(doc_id, page_index, page_id, snapshot_json)` wrapping `gp_redact::prepare_clean_page_preview_with_lopdf` (for edited text/replaced images/replaced shapes clean canvas previews).
   - Add `extract_page_links(doc_id, page_index)` returning URI/internal page jump rects.
   - Accept bundled font family bytes map (`regular`, `bold`, `italic`, `mono`, `serif`) + optional `page_numbering_json` + element `VectorShape` / `VectorPath` / `ImageAdd` / `ImageReplacement` / `ShapeReplacement` / `Signature` / `TextEdit` / `Highlight` in `compile_and_save_verified`.
3. **Overhaul `PdfiumBackend::compile_native_pdf` (`core/crates/gp-pdf-pdfium/src/lib.rs`)**:
   - Pre-pass through `gp_redact::redact_pdf_bytes_with_lopdf` to strip deleted/replaced original PDF text blocks, images, shapes, and burn redactions before reopening in PDFium for lossless addition.
   - Render elements sorted by `effective_layer_tier()` + `z_index`:
     - `TextAdd` / `TextEdit`: full multiline wrap (`gp-text`), font lookup (custom TTF > DejaVu variant), align, lineHeight, opacity, optional background fill rect, rotation.
     - `VectorShape`: `Rect` (with border radius), `Ellipse`, `Triangle`, `Diamond`, `Arrow`, stroke dash array, fill + stroke + opacity + rotation.
     - `VectorPath` & `Stroke`: multi-point path (open/closed/Catmull-Rom smooth/dash/lineWidth/opacity).
     - `ImageAdd` & `ImageReplacement`: PNG/JPEG decode via `image` crate (`RGBA8` -> PDFium `FPDFImageObj`), crop rect, horizontal/vertical flip, opacity, rotation.
     - `Signature`: vector `svg_paths` (cubic/quadratic/line path emission) OR raster PNG data, opacity, rotation.
     - `Highlight`: `redact` (opaque fill), `rect`, `underline`, `strike`.
     - `PageNumberingConfig`: dynamic numbering placement via `gp_text::compute_page_number_layout`.
4. **Phase 3 Verification**: `cargo test --manifest-path core/Cargo.toml`, regenerate FRB bindings, rebuild Windows `gp_frb.dll` & Android `libgp_frb.so` (`arm64-v8a`, `x86_64`), update & run `frb_native_integration_test.dart` (verifying Turkish UTF-8 + shapes + images + signatures + text-edit removal round-trip).

### Phase 4: Full Flutter Editor & Web Feature Parity
1. **Rich Unified Model (`mobile/lib/model/`)**:
   - `gp_canvas_element.dart` mirroring Web `CanvasElement` (`text-edit`, `text-add`, `image`, `image-replacement`, `shape-replacement`, `shape`, `path`, `signature`, `stroke`, `highlight`) + `PageNumberingConfig` + `SavedSignature` + `RepeatRule` (all/odd/even/exclude-cover/range).
   - `gp_commands.dart` clean Undo/Redo command history supporting batch multi-page operations & Z-index changes.
2. **Interactive Viewport Gestures (`mobile/lib/viewport/`)**:
   - Real object drag-to-move with Rust `computeSnapGuidePosition` alignment guides + visual snap lines.
   - `36dp` coarse touch resize handles (corner/edge) using Rust `computeRotatedResizeRect` + top rotation stem handle.
   - Drag-to-create bounding box for Shapes (`rect`, `ellipse`, `triangle`, `diamond`, `arrow`), Vector Lines/Freehand Pens, and Highlight/Redact rects.
   - Tap existing PDF text/image/shape (`analyzePageObjectsJson`) -> clean preview layer (`prepareCleanPagePreview`) -> inline floating edit mode with keyboard `viewInsets` padding + rich Inspector Bottom Sheet (font, bold/italic, align, size, line-height, color, fill/stroke/dash/opacity, crop/flip, lock, duplicate, bring forward/send backward, apply to all pages, delete).
3. **Signature & Paraf Studio + Local Vault (`mobile/lib/features/signature/`)**:
   - Signature vs Paraf selector; 3 tabs: **Draw** (with **"Orijinal Görünümlü"** velocity-sensitive realistic ink smoothing & width modulation), **Type** (stylish signature fonts), **Upload** (camera/gallery image picker with luminance/chroma background removal).
   - Local encrypted/JSON Vault persistence (`SharedPreferences`), **Tap-to-Place** interactive banner on page canvas, and **Apply to All Pages** / range modal.
4. **Page Organization, Merge, Split, Numbering & Export (`mobile/lib/features/organizer/` & `editor/`)**:
   - Real thumbnail grid with long-press drag reorder, multi-select range, rotate CW/CCW/180°, duplicate page, insert blank page, merge external PDF(s) (`mergePdf` appending pages + preserving existing edits!), split/extract selected pages into standalone PDF, dynamic Page Numbering sheet, and Save / Share Sheet / Print export workflow.
   - Update `design-tokens/i18n.json` & re-run `node design-tokens/generate.mjs`.
5. **Phase 4 Verification**: `flutter analyze`, `flutter test`, `npm run typecheck`, `npx vitest run`, `flutter build apk --debug`, live emulator deployment.

### Phase 5: Automated Integration & Live ADB Device Diagnostics
1. Generate deterministic synthetic test assets (`test_sample.pdf` containing multi-line Turkish text `ğüşıİöç`, `test_merge.pdf`, `test_logo.png`) and push to Android `/sdcard/Download/`.
2. Execute `integration_test/` suite + live ADB UI automation (`adb shell input` tap/swipe/drag, `am start` VIEW intent, `adb logcat` zero-exception check, `adb shell dumpsys gfxinfo` frame-rate profiling).
3. Complete full round-trip: open `test_sample.pdf` -> verify viewer scroll/zoom -> edit Turkish text -> add text, shape (`arrow`/`rect`), image (`test_logo.png`), realistic signature -> rotate/merge/number pages -> export PDF -> reopen exported PDF via Rust FRB & verify mutated text/pages/elements match expectations.
4. Verify physical USB device readiness if attached (and report clearly).
