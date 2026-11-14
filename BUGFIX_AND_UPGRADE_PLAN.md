# AetherPDF Refactoring & Upgrade Blueprint (`BUGFIX_AND_UPGRADE_PLAN.md`)

This document captures the Principal-level codebase audit and architectural fix plan for all 12 critical bugs and feature upgrades. Every change preserves 100% client-side Wasm execution (`mupdf` + `pdf-lib` + `pdfjs-dist`) and maintains Undo/Redo transaction integrity.

---

## Architecture & Root-Cause Matrix (12 Items)

### 1. Font Detection & Fallback Preservation + Proactive Warning Banner
- **Root Cause:**
  - `src/engine/textExtractor.ts` and `src/engine/pdfjsService.ts` only pass simplified `FontFamilyOption`, `bold`, `italic`, and `rawFontName`. Font descriptors (`BaseFont`, serif/sans/mono flags, horizontal glyph width scaling `horizontalScale`, `letterSpacing`, and custom-font fallback status) are dropped when instantiating `TextEditElement`.
  - Clicking an embedded proprietary/subsetted font (e.g., `ABCDEF+Frutiger-Roman`, `ABCDEF+Montserrat-SemiBold`) silently replaces its metrics with standard sans/serif defaults without informing the user or matching horizontal scaling.
- **Solution:**
  - Add `parsePdfFontMetadata(rawFontName, flags)` in `src/engine/fonts.ts` stripping `^[A-Z]{6}\+` subset prefixes, detecting weight (`Bold`, `SemiBold`, `Heavy`, `Black`), style (`Italic`, `Oblique`), monospace/serif/sans classification, and returning `{ fontFamily, bold, italic, cleanFontName, isCustomFont, fallbackLabel }`.
  - Compute `horizontalScale` (clamped `[0.65..1.45]`) and optional `letterSpacing` by comparing extracted MuPDF line bbox width vs estimated glyph advance width and PDF.js `tx`/font descriptor metadata (`styles[fontName]`, `commonObjs`).
  - Persist `rawFontName`, `originalFontName`, `isCustomFont`, `horizontalScale`, and `letterSpacing` on `DetectedTextBlock`, `TextEditElement`, and `TextAddElement`.
  - Apply `horizontalScale` and `letterSpacing` consistently in `InlineTextEditor.tsx`, `PageCanvas.tsx` overlays, and `pdfCompiler.ts` (`drawTextElementOnPage` using PDF text operators / scaling).
  - **Proactive UI Badge:** Display a non-intrusive inline badge in `InlineTextEditor.tsx` (on selection/before typing) and `RightInspector.tsx`: `"Embedded custom font (FontName) detected — using closest visual match [MatchedFont]"`.

---

### 2. Z-Index / Hit-Testing Trap on Header & Background Images
- **Root Cause:**
  - `src/store/useEditorStore.ts` (`promoteDetectedImage`) promotes clicked detected images (`!behindContent`) with `getNextZIndex()`, putting them in `zIndex: 20 + el.zIndex` inside `PageCanvas.tsx`, permanently trapping overlapping detected/edited text underneath.
  - `PageCanvas.tsx` and `SelectionOverlay.tsx` lack `Alt/Option + Click` depth cycling and couple selection state with visual stacking priority.
- **Solution:**
  - Define deterministic Z-order tiers (`getElementLayerTier(el)` in `src/types/elements.ts` & `src/engine/coordinates.ts`):
    - **Tier 1 (`100..199`)**: Background / Header Images (`behindContent === true` on `image` / `image-replacement`, plus auto-detected full-width header/watermark images).
    - **Tier 2 (`200..299`)**: Standard Images (`image`, `image-replacement` with `!behindContent`).
    - **Tier 3 (`300..399`)**: Text Blocks (`detected-text` hover layer + `text-edit`, `text-add`).
    - **Tier 4 (`400..499`)**: Annotations & Signatures (`highlight`, `stroke`, `signature`).
  - Clicking/selecting an element **never** alters its `layerTier` or `zIndex`.
  - Explicit Inspector controls (`Front`, `Bring Forward`, `Send Backward`, `Send to Back`) adjust `zIndex` and allow deliberate tier override (`layerOverride`) when desired.
  - Support **`Alt/Option + Click`** (delegating through both `PageCanvas` and `SelectionOverlay`) to perform hit-testing at `(baseX, baseY)` across all rotated element/detected bounding boxes and cycle cleanly to overlapping elements underneath.

---

### 3. Rotated Bounding Box Cursor & Resize Handle Inversion
- **Root Cause:**
  - `src/components/viewport/SelectionOverlay.tsx` assigns static CSS cursors (`nwse-resize`, `ns-resize`, etc.) inside `HANDLE_LIST`. At `90°`, `180°`, or arbitrary $\theta$, the handle positions visually rotate while cursors do not.
  - Resize pointer projections do not isolate `userRotation` vs `element.rotation` consistently when page rotation is active, and corner/edge aspect clamping can jump if projected through mixed page transforms.
- **Solution:**
  - Implement pure geometry helpers `computeRotatedResizeCursor(handle, totalRotationDeg)` and `computeRotatedResizeRect(params)` in `src/engine/coordinates.ts`:
    - **Cursor Angle Snap:** Add `totalRotationDeg` to handle base compass angle (`n: 0°, ne: 45°, e: 90°, se: 135°, s: 180°, sw: 225°, w: 270°, nw: 315°`), normalize modulo `360°`, snap to nearest `45°`:
      $$k = \left\lfloor \frac{((\alpha_{\text{base}} + \theta) \bmod 360) + 22.5}{45} \right\rfloor \bmod 8$$
      mapping to `['n-resize', 'ne-resize', 'e-resize', 'se-resize', 's-resize', 'sw-resize', 'w-resize', 'nw-resize']`.
    - **Inverse Rotation Matrix Resize Math:**
      Given display pointer delta $(\Delta x_{\text{px}}, \Delta y_{\text{px}})$ and box CSS angle $\theta$:
      $$\begin{bmatrix} \Delta x_{\text{loc}} \\ \Delta y_{\text{loc}} \end{bmatrix} = \frac{1}{\text{zoom}} R(-\theta) \begin{bmatrix} \Delta x_{\text{px}} \\ \Delta y_{\text{px}} \end{bmatrix} = \frac{1}{\text{zoom}} \begin{bmatrix} \cos\theta & \sin\theta \\ -\sin\theta & \cos\theta \end{bmatrix} \begin{bmatrix} \Delta x_{\text{px}} \\ \Delta y_{\text{px}} \end{bmatrix}$$
      Compute $\Delta w = d_x \Delta x_{\text{loc}}$ and $\Delta h = d_y \Delta y_{\text{loc}}$ in local box axes (correctly honoring `userRotation` swap), apply aspect lock/min-size clamping, and rotate the resulting center shift $\left(\frac{d_x \Delta w_{\text{act}}}{2}, \frac{d_y \Delta h_{\text{act}}}{2}\right)$ back via $R(\theta)$ before transforming into base page coordinates so the opposite edge/corner stays strictly anchored at any $\theta \in (-180°, 180°]$ and any `userRotation`.

---

### 4. Shift-Click Range Selection in "Organize Pages" & Thumbnail Sidebar
- **Root Cause:**
  - `ThumbnailItem.tsx` only passes `e.ctrlKey || e.metaKey`; `e.shiftKey` is ignored, and `useEditorStore.ts` lacks `lastSelectedPageId` anchor tracking.
- **Solution:**
  - Add `lastSelectedPageId: string | null` and `selectPageWithModifiers(pageId, { shiftKey, ctrlOrMetaKey })` to `useEditorStore.ts`:
    - `Click`: `[pageId]`, sets `lastSelectedPageId = pageId`.
    - `Shift + Click`: contiguous slice `[anchorIndex .. targetIndex]` in current `pages` order (preserving `lastSelectedPageId` anchor).
    - `Ctrl/Cmd + Click`: toggles `pageId` in `selectedPageIds`, updates `lastSelectedPageId = pageId`.
  - Wire modifiers cleanly in `ThumbnailItem.tsx`, `ThumbnailSidebar.tsx`, and `PageOrganizeModal.tsx`.

---

### 5. Signature Vault & Multi-Signature Placement Bug
- **Root Cause:**
  - Placed signatures always land on exact center `(w - dw)/2, (h - dh)/2`, visually overlapping identically, and lacked explicit immutable `templateId` separation vs element instance `id` plus deep cloning of `svgPaths` and `pngBytes`.
- **Solution:**
  - Ensure `SavedSignature` generates unique immutable `templateId` (`id`) and `SignatureElement` stores both `templateId` (source template reference) and a freshly generated unique element `id` (`createId('sigel')` with UUID entropy), deep-cloning `svgPaths` and `pngBytes` buffers on every placement.
  - Multiple placements (via Vault or interactive cursor) remain 100% independent in position, scale, rotation, and opacity.

---

### 6. Initials (Paraf) Support + "Apply to All Pages"
- **Root Cause:**
  - `SignatureModal.tsx` and `signatureStorage.ts` only model full signatures with no Initials (`Paraf`) distinction, and no multi-page batch cloning action exists.
- **Solution:**
  - Add `variant: 'signature' | 'initials'` to `SavedSignature` and `SignatureElement`.
  - Update `SignatureModal.tsx` with **Signature (`İmza`)** vs **Initials (`Paraf`)** mode toggle (separate default presets/dimensions and dedicated vault tabs/sections).
  - Implement store action `applySignatureToPages(sourceElementId | payload, scope)` supporting:
    - All pages (`all`),
    - Exclude cover/first page (`except-first`),
    - Custom range expression (`range`, parsed with `parsePageRangeExpression`),
    normalizing relative `(x / w, y / h, width / w, height / h)` per page so signatures align proportionally even across mixed page sizes.
  - Expose `"Apply to All Pages" (Tüm Sayfalara Ekle)` in both `SignatureModal.tsx` and `RightInspector.tsx` (when a signature/initials element is selected).

---

### 7. Interactive Cursor-Following Placement + Realistic Ink ("Orijinal Görünümlü")
- **Root Cause:**
  - Clicking `"Use & Place"` immediately dumps the signature at page center instead of letting the user position it interactively with a ghost cursor.
  - Drawn signatures render flat constant-width vector paths lacking nib pressure, pooling, organic jitter, or natural pen ink hues.
- **Solution:**
  - **Interactive Ghost Cursor (`pendingPlacement`):**
    - Store `pendingPlacement` state in `useEditorStore.ts`. Clicking `"Use & Place"` or Vault `"Place"` closes `SignatureModal` and enters cursor-placement mode.
    - Moving over `PageCanvas` shows a translucent cursor-following preview box (`opacity: 0.68`, exact scaled width/height) snapped to cursor coordinates; left-clicking drops a new independent `SignatureElement` at the chosen position; `Esc` cancels cleanly.
  - **Realistic Ink Engine (`src/utils/realisticInk.ts`):**
    - Add `"Orijinal Görünümlü" (Realistic Ink)` toggle in `SignatureModal.tsx` (Draw, Type, Upload) + default realistic ink palette (`#0f2b5b`, `#1a1a2e`, `#7f1d1d`).
    - For drawn strokes with timestamps `(x, y, t)`:
      - Instantaneous velocity $v_i = \frac{\|\mathbf{p}_i - \mathbf{p}_{i-1}\|}{\max(4, t_i - t_{i-1})}$, EMA-smoothed; width modulates inversely: $w(v) = w_0 \cdot \text{clamp}(1.42 - 0.55 \cdot \min(v, 1.5), 0.52, 1.42)$.
      - Ink pooling blobs at pen-down (`i = 0`) and lift (`i = n - 1`).
      - Deterministic micro-jitter displacement ($\pm 0.35\text{px}$) + outer feathering pass (`alpha ≈ 0.16`) around core dense stroke (`alpha ≈ 0.90–0.96`) with natural blue-black pigment shift (`#0f2b5b` / `#1a1a2e`).
      - Output crisp high-DPI PNG + closed variable-width outline polygons/paths so both canvas display and vector/raster PDF export retain authentic hand-signed look.

---

### 8. Image Z-Order / Flip & Stacking Anomalies
- **Root Cause:**
  - `pdfjsService.ts` CTM extraction for `OPS.paintImageXObject` ignores negative-determinant mirrors (`flipX` / `flipY`), causing vertically or horizontally reflected PDF images to extract or rotate unexpectedly.
  - Deterministic Z-order stacking must synchronize between `PageCanvas` UI preview and `pdfCompiler.ts` PDF stream emission.
- **Solution:**
  - Add `decomposeImageCtm(ctm)` in `src/engine/coordinates.ts` inspecting basis vectors $\mathbf{e}_x = T(1,1) - T(0,1)$ and $\mathbf{e}_y = T(0,0) - T(0,1)$: extract bounding box, clockwise `rotation`, `flipX`, and `flipY`.
  - Add `flipX?: boolean; flipY?: boolean;` to `DetectedImageObject`, `ImageAddElement`, and `ImageReplacementElement`.
  - Render `scaleX(${flipX ? -1 : 1}) scaleY(${flipY ? -1 : 1})` in `PageCanvas.tsx` and preserve mirrored CTM placement in `pdfCompiler.ts`.
  - Sort elements strictly by `(layerTier, zIndex, index)` in both canvas rendering and `pdfCompiler.ts` compilation.

---

### 9. Intelligent Paragraph Grouping & Line-Height / Formatting Preservation
- **Root Cause:**
  - Paragraph detection needs stricter vertical baseline grouping (`Δy ≤ 1.45 × fontSize`), preserved `lineHeight`, `letterSpacing`, `textAlign` (`left`, `center`, `right`, `justify`), and explicit `paragraphWidth` so editing inside multi-line justified or formatted paragraphs flows smoothly without collapsing alignment or overlapping subsequent lines.
- **Solution:**
  - Refine `buildDetectedTextBlocksFromMuLines` in `src/engine/textExtractor.ts` with `1.45 * avgFontSize` max baseline delta, consistent font/alignment checks, computed exact `lineHeight` & `letterSpacing`, and preserve justification/alignment CSS & PDF rendering across `InlineTextEditor.tsx`, `PageCanvas.tsx`, and `pdfCompiler.ts`.

---

### 10. Table & Multi-Column Boundary Detection
- **Root Cause:**
  - `pdfjsService.ts` currently collects only `horizontalRules`. Vertical grid lines, table borders, and cell rectangles (`OPS.constructPath`, `OPS.stroke`, `OPS.fill`, `OPS.rectangle`) are discarded, and `textExtractor.ts` uses an overly permissive horizontal gap threshold (`Math.max(22, fs * 3.55)`), merging adjacent table cells and newspaper/report columns into a single block.
- **Solution:**
  - Extend `extractImagesAndRulesFromOperatorList` in `src/engine/pdfjsService.ts` to extract `verticalRules: VerticalRule[]` and `cellRects: RectBox[]` from vector paths (strokes, rectangles, and thin horizontal/vertical filled divider bars).
  - Pass `{ horizontalRules, verticalRules, cellRects }` through `PageCanvas.tsx` -> `wasmWorkerClient` -> `pdfWasm.worker.ts` -> `extractTextBlocksFromMuPdfPage`.
  - Enforce grid-line intersection & cell-boundary splits + strict horizontal gap threshold ($\Delta x > 1.8 \times \text{spaceWidth}$) in `textExtractor.ts` (handling word-spacing estimation per font size and separating justified prose gaps cleanly when bordered or column-aligned) so adjacent table cells and columns NEVER merge horizontally.

---

### 11. Repeating Watermarks / Headers / Footers for Images ("Her Sayfaya Ekle")
- **Root Cause:**
  - Added or promoted images exist on a single page only; repeating logos/headers/footers/watermarks across pages requires manual duplication.
- **Solution:**
  - Add `repeatGroupId?: string` and `repeatScope?: 'all' | 'odd' | 'even'` on `ImageAddElement`.
  - Add `"Her Sayfaya Ekle" / "Apply to All Pages"` section in `RightInspector.tsx` for images with scope selection (`All Pages`, `Odd Pages`, `Even Pages`), behind-content watermark toggle (`Background / Watermark` Tier 1), live transform/opacity sync across siblings in the group, and `Unlink` option.

---

### 12. Dynamic Page Numbering Tool ("Sayfa Numarası Ekle")
- **Root Cause:**
  - No page-numbering mechanism or dynamic numbering overlay/export pipeline exists.
- **Solution:**
  - Add `PageNumberingConfig` in `src/types/pdf.ts` (`enabled`, `position`, `format`: `'number' | 'number-of-total' | 'page-number' | 'page-number-of-total' | 'roman-lower' | 'roman-upper'`, `fontFamily`, `fontSize`, `color`, `marginX`, `marginY`, `startPage` cover-page skip offset, `startNumber`, `opacity`) stored on `EditorState` and tracked inside `DocumentSnapshot` (full Undo/Redo + reactive updates when pages reorder/delete/merge).
  - Add `src/engine/pageNumbers.ts` formatter (Arabic & Roman numerals, localized templates `1`, `1 / N`, `Sayfa 1`, `Sayfa 1 / N`) and bounding box layout helper.
  - Add `"Page Numbers"` toolbar button in `TopToolbar.tsx` + `PageNumberingModal.tsx` UI (`App.tsx`).
  - Render dynamic live previews on `PageCanvas.tsx` and burn into exported PDFs inside `pdfCompiler.ts` (`compilePdfDocument` & `splitPdfToZip`) with full Turkish Unicode glyph support.

---

## Execution & Verification Status

### Batches (All Completed & Verified)
1. **Batch A (Issues #2, #3, #8):** Deterministic Z-order tiers, `Alt+Click` under-layer selection, dynamic 45° cursors + inverse rotation matrix resize math, image CTM flip decomposition (`flipX`/`flipY`), and export stacking order sync. — **Done**
2. **Batch B (Issues #1, #9, #10):** Font descriptor & `horizontalScale` / `letterSpacing` detection, custom-font warning banner, full vector vertical+horizontal rule/cell extraction, column & bordered-table splitting, uniform justified prose preservation, and `1.45 * fontSize` paragraph clustering + alignment preservation. — **Done**
3. **Batch C (Issues #5, #6, #7):** Independent `templateId` + unique signature instances, Signature (`İmza`) & Initials (`Paraf`) tabs/vaults, `"Orijinal Görünümlü Ink"` realistic velocity/ink-pooling engine, interactive ghost cursor placement, and `"Apply to All Pages"`. — **Done**
4. **Batch D (Issues #4, #11, #12):** `Click` / `Shift+Click` / `Ctrl+Cmd+Click` range selection in Organize Pages & Sidebar, Repeating Image Header/Footer/Watermark sync (`all`/`odd`/`even`), and Dynamic Page Numbering tool + live preview + PDF/ZIP export. — **Done**
5. **Batch E (Tests & Continuous Loop):** Comprehensive Vitest unit suites (8 files, 52 tests) + Playwright E2E scenarios (5 full-stack flows including synthetic multi-column/table/header-heavy/rotated-box/UTF-8 PDFs). — **Done**

---

## Discovered Regressions & Fix Log
- **Justified Prose Over-Splitting vs. Table Column Gutters (`src/engine/textExtractor.ts`):** Initial character-by-character gap thresholding split stretched inter-word spaces (~33–35pt at 11pt font) inside justified paragraphs into separate single-word blocks. Fixed by adding line-level `splitLineCharsAtBarriersAndColumns` plus `mergeSameBaselineSegments` justified-row chain pre-coalescing: vector borders (`verticalRules`, `cellRects`), non-justified tight+wide gutter jumps, and sparse column gaps continue to split cleanly while uniform 4+ gap justified prose lines remain intact.
- **Image CTM Flip Test Matrix Sign (`src/engine/__tests__/coordinates.test.ts`):** Clarified PDF.js viewport Y-down matrix orientation (`[w, 0, 0, -h, x, bottom]` upright vs `[w, 0, 0, +h, ...]` vertical mirror and `[-w, 0, 0, -h, ...]` horizontal mirror) matching `decomposeImageCtm` and `pdfCompiler.ts` `drawPlacedImage`.
- **TopToolbar Flexbox Button Overlap at 1280px (`src/components/toolbar/TopToolbar.tsx`):** `toolbar-page-numbers-btn` could be overlapped by the center tool group when `min-w-0` shrank the left action cluster at 1280px width. Added `shrink-0` on action/tool groups, compact responsive labels (`2xl:inline` for Merge/Split/Page # and `lg:inline` for tools), and `overflow-x-auto` so every toolbar control remains clickable without overlap.
- **E2E Interactive Ghost Cursor Timing & Multi-Step Assertions (`e2e/pdf-editor.spec.ts`):** Updated legacy immediate-drop signature test steps to wait for async realistic-ink modal closure and click on-page via the interactive ghost cursor flow, used keyboard `Alt` modifiers for `Alt+Click` cycling verification, and kept drop targets inside viewport bounds.
