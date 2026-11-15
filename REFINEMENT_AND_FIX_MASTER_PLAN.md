# GullacPDF — Refinement & Fix Master Architectural Blueprint
**Author:** Antigravity Orchestrator (Argon) — Lead Software Architect & Systems Orchestrator  
**Target Executor:** Gemini Hydrogen (Autonomous Implementation Engine)  
**Repository:** `gullacpdf` (Wasm-Powered Client-Side PDF Studio)  
**Status:** Execution-Ready Specification  

---

## 1. Executive Root-Cause Summary

A full-repository forensic audit of the viewport engine, pointer/touch gesture state machines, PDF.js + MuPDF Wasm extraction pipelines, inline DOM typography overlay, and `pdf-lib` + `fontkit` export compiler revealed the exact architectural root causes below.

| Symptom / Area | Primary Files & Exact Line Ranges | Root Cause Identification |
| :--- | :--- | :--- |
| **1A. Left/Right Edge Clipping When Zoomed (`> 100%`)** | `src/components/viewport/DocumentViewport.tsx` (`L393–L420`) | The virtualizer outer container (`L396`) sets `width: '100%'` and each virtualized page row (`L404–L418`) sets `width: '100%'` with `className="flex justify-center py-5"`. When `displayDims.width > container.clientWidth` (e.g., mobile pinch-zoom > `100%`), CSS `justify-content: center` overflows the `PageCanvas` symmetrically to negative X (`-(scaledWidth - clientWidth) / 2`). In CSS scroll containers (`overflow-auto`), `scrollLeft` cannot be `< 0`, permanently clipping the left side of the zoomed page. |
| **1B. Pinch-to-Zoom Focal Point Drift & Race Condition** | `src/components/viewport/DocumentViewport.tsx` (`L131–L186`)<br>`src/store/useEditorStore.ts` (`L461–L465`) | 1) `applyPinchGeometry` (`L150–L161`) computes `relX = midX - rect.left` using the *current* frame's midpoint rather than the previous frame's midpoint, scales the entire `el.scrollLeft + relX` (including unscaled inter-page `44px` gaps and viewport margins) by `scaleChange`, and then subtracts `panDx` a second time.<br>2) `el.scrollLeft` and `el.scrollTop` are mutated asynchronously inside `requestAnimationFrame` (`L157–L160`), while rapid `pointermove` events read stale `el.scrollLeft` synchronously, causing cumulative focal-point drift.<br>3) `setZoom` (`useEditorStore.ts:L463`) clamps max zoom at `4` (`400%`) instead of `5` (`500%`). |
| **1C. Insufficient 4-Edge Overscroll Panning Bounds** | `src/components/viewport/DocumentViewport.tsx` (`L85–L91`, `L383–L420`)<br>`src/components/mobile/MobileInspectorSheet.tsx` (`L31–L45`) | Vertical padding is hardcoded to `py-5` (`20px`) with `0px` horizontal overscroll margin. At `300%–500%` zoom on mobile, floating UI (`MobileBottomDock`, collapsed `MobileInspectorSheet` bar, and safe-area insets) obscures the bottom/edges of the page because there is no dynamic overscroll margin (`viewportMarginX`, `viewportMarginY`). |
| **1D. Single-Finger Drag Commits When Second Finger Touches Down** | `src/components/viewport/SelectionOverlay.tsx` (`L68–L244`)<br>`src/components/viewport/PageCanvas.tsx` (`L546–L649`) | When a second finger touches down mid-drag (`activeTouchCount >= 2` / `isPinching === true`), `onMove` in `SelectionOverlay.tsx` (`L95`, `L158`, `L218`) and `PageCanvas.tsx` (`L553`, `L608`) returns early without calling `abortTransaction()`, clearing `snapGuides` / `draftPoints`, releasing pointer capture, or detaching window listeners. When the user lifts their fingers after pinching, `onUp` fires `commitTransaction()`, committing an accidental element move/resize or stray freehand stroke. |
| **2A. Incomplete Background/Cover Image Detection** | `src/engine/pdfjsService.ts` (`L674`, `L910–L931`)<br>`src/components/viewport/PageCanvas.tsx` (`L290–L334`) | 1) `pdfjsService.ts:L674` records a tiny `18pt × 14pt` stub (`vx - 2` to `vx + 16`) for `showText` in `drawnRegions`, missing overlap with the rest of the text line.<br>2) `pdfjsService.ts:L918` requires `areaRatio >= 0.72` (instead of `>= 0.65`) or `coversFullWidth && coversTallSlice`.<br>3) In `PageCanvas.tsx:L290–L334`, `pdfjsService.extractPageObjects` runs *before* MuPDF `extractPageText`, so detected images are never cross-checked against actual `DetectedTextBlock` bounding boxes (`textBlocks`). |
| **2B. Background Image Single-Tap Promotion & Z-Index 500 Lockout** | `src/components/viewport/PageCanvas.tsx` (`L951–L995`, `L1295–L1322`)<br>`src/components/viewport/SelectionOverlay.tsx` (`L287–L302`) | 1) Every `detected-image` overlay renders an interactive `<div onPointerDown={promoteDetectedImage}>` (`PageCanvas.tsx:L977`). Tapping even `1px` outside a tight text box over a full-page scan or background photo promotes and selects the background image.<br>2) Once selected, `SelectionOverlay` mounts at `zIndex: 500` (`SelectionOverlay.tsx:L296`) covering the entire image bounds *above* `detected-text` (`zIndex: 305`) and `text-edit` (`zIndex: 300–389`), calling `e.stopPropagation()` on `pointerdown` (`L71`)—blocking all clicks on foreground text until deselected.<br>3) No UI toggle exists for `"Select Background / Layers" (Arka Planı Seç)` or element `locked` state in `RightInspector` / `MobileInspectorSheet`. |
| **3A. Click-to-Edit Visual Font Jump (Size, Baseline & Width Shift)** | `src/engine/textExtractor.ts` (`L456`, `L535–L568`, `L1264–L1266`)<br>`src/store/useEditorStore.ts` (`L1294–L1330`)<br>`src/components/viewport/InlineTextEditor.tsx` (`L243–L286`, `L367–L391`)<br>`src/components/viewport/PageCanvas.tsx` (`L686–L772`) | 1) **Font-Size Snapping:** `textExtractor.ts:L1265` snaps `rawBodySize` to `0.5pt` increments (`Math.round(rawBodySize * 2) / 2` within `0.16pt`) and `L550` rounds to `toFixed(1)`.<br>2) **Ignored `baselineOffset`:** `textExtractor.ts:L456` sets `minY = Math.min(first.baselineY - first.fontSize * 0.88, ...)` and computes `baselineOffset: first.baselineY - minY` (`L567`), but `TextEditElement`, `PageCanvas`, and `InlineTextEditor` ignore `baselineOffset`. CSS places the first baseline at `((lineHeight - 1) * 0.5 + ascentRatio) * fontSize`, shifting text vertically by `1px–3px` on click.<br>3) **Uncalibrated Horizontal Glyph Width:** `letterSpacing` defaults to `0` (`L560`) and `horizontalScale` only checks font-name keywords (`0.85 | 1 | 1.15`) via CSS `fontStretch` (which has no effect on standard web fonts without condensed faces). Browser font advance widths differ from embedded PDF glyph widths by `1%–4%`. |
| **3B. Rare Premature Line-Wrapping on PDF Export** | `src/store/useEditorStore.ts` (`L1308`)<br>`src/components/viewport/InlineTextEditor.tsx` (`L94–L124`, `L281`)<br>`src/engine/richText.ts` (`L126–L278`)<br>`src/engine/pdfCompiler.ts` (`L592–L708`) | 1) `startEditDetectedText` (`useEditorStore.ts:L1308`) sets `width = (block.paragraphWidth ?? block.width) + 2` (`+2pt` is only `0.6%` on a `300pt` line), and `InlineTextEditor.tsx:L281` floors width at `40px` (`40 / zoom` pt) while `syncLayoutMetrics` (`L118`) only updates height (`width` is never synced unless manually resized).<br>2) In `pdfCompiler.ts:L603`, `buildWrappedRichLines` wraps strictly at `safeMaxWidth + 0.01` (`richText.ts:L208`). When `pdf-lib`'s embedded font metrics (`widthOfTextAtSize`) are `1%–2.5%` wider than browser DOM metrics, a single-line text block wraps onto a second line on export.<br>3) `pdfCompiler.ts` does not track editor `renderedLineCount` or emit the PDF `Tz` horizontal scaling operator when a single line slightly exceeds `el.width`. |
| **4. Proactive Audit Findings (Turkish Encoding, Retina Canvas Cap, Mobile Sheet Collision, History Desync)** | `src/engine/fonts.ts` (`L523–L604`)<br>`src/engine/pdfjsService.ts` (`L105–L128`)<br>`src/app/App.tsx` (`L44–L67`)<br>`src/store/useEditorStore.ts` (`L847–L877`, `L1697–L1747`) | 1) **Turkish Combining Dot (`I\u0307`):** macOS/LaTeX PDFs often encode `İ` as `I + \u0307`. `.normalize('NFC')` in `fonts.ts:L524` does not recompose `I\u0307` into `\u0130` (`İ`), so `supportedCodePoints.has(0x0307)` fails and strips the dot.<br>2) **iOS/Mobile WebKit Canvas Memory Limit:** At `300%–500%` zoom with `dpr = 2`, `pixelViewport.width * pixelViewport.height` exceeds `16,777,216` pixels (`4096 × 4096`), causing blank canvas renders on mobile Safari.<br>3) **Mobile Inspector Sheet vs. Keyboard:** Opening inline text edit on mobile leaves the collapsed `MobileInspectorSheet` bar mounted over the reduced `visualViewport`.<br>4) **Undo/Redo During Active Inline Edit:** Calling `undo()`/`redo()` while `InlineTextEditor` has an open `transactionBaseline` clears `transactionBaseline: null` (`useEditorStore.ts:L1704`), causing `finishEditing()` on blur to lose state or desync history. |

---

## 2. Mathematical & Algorithmic Specifications

### 2.1 Focal-Point Pinch-to-Zoom & 4-Edge Overscroll Panning Math

#### A. Dynamic Overscroll Margin & Scrollable Canvas Bounds
Let the viewport scroll container (`containerRef.current` in `DocumentViewport.tsx`) have client dimensions $(V_w, V_h) = (\text{clientWidth}, \text{clientHeight})$, and let the maximum scaled page dimensions across the document at zoom $Z$ be $(P_w(Z), P_h(Z))$.

To guarantee smooth panning past all 4 page edges (`top`, `bottom`, `left`, `right`) at up to `500%` zoom (`Z = 5.0`) without floating toolbars or safe-area insets blocking content:

1. **Zoom Range Clamp:** Expand zoom domain in `useEditorStore.ts` and `DocumentViewport.tsx` to:
   $$Z \in [0.25, 5.00]$$
2. **Dynamic Overscroll Margins:**
   $$\text{marginX}(Z) = \begin{cases} \max\left(48, \text{round}(0.35 \cdot V_w)\right) & \text{if } P_w(Z) + 32 > V_w \text{ or } Z > 1.05 \\ \max\left(16, \text{round}\left(\frac{V_w - P_w(Z)}{2}\right)\right) & \text{otherwise} \end{cases}$$
   $$\text{marginY}(Z) = \max\left(64, \text{round}(0.35 \cdot V_h), \text{mobileBottomClearance}\right)$$
   where $\text{mobileBottomClearance} = 140\text{px}$ on mobile viewports (`< 768px`) to clear `MobileBottomDock` (`68px`) + collapsed `MobileInspectorSheet` (`48px`) + `env(safe-area-inset-bottom)`.
3. **Scroll Content Box Dimensions (Eliminating Flex-Center Negative Overflow):**
   Never use `width: '100%'` with `justify-content: center` when $P_w(Z) + 2 \cdot \text{marginX}(Z) > V_w$. Instead, define the scrollable inner surface width:
   $$W_{\text{surface}}(Z) = \max\left(V_w,\; P_w(Z) + 2 \cdot \text{marginX}(Z)\right)$$
   For any page $i$ with scaled width $w_i(Z) = w_{i,0} \cdot Z$, its exact horizontal offset inside the scroll surface is strictly non-negative:
   $$\text{pageOffsetLeft}_i(Z) = \text{round}\left(\frac{W_{\text{surface}}(Z) - w_i(Z)}{2}\right) \ge \text{marginX}(Z) > 0$$
   And the total virtualizer scroll height is:
   $$H_{\text{surface}}(Z) = \text{rowVirtualizer.getTotalSize()} + 2 \cdot \text{marginY}(Z)$$
   Each virtual row at index $i$ with virtual start $y_{\text{virt}, i}$ is positioned at:
   $$\text{pageOffsetTop}_i(Z) = \text{marginY}(Z) + y_{\text{virt}, i} + \frac{\text{PAGE\_GAP}}{2}$$

#### B. Exact Focal-Point Pinch-to-Zoom Invariant
Let two active touch pointers $p_1 = (x_1, y_1)$ and $p_2 = (x_2, y_2)$ in client coordinates have midpoint and Euclidean distance at frame $t$:
$$M^{(t)} = \left(\frac{x_1^{(t)} + x_2^{(t)}}{2},\; \frac{y_1^{(t)} + y_2^{(t)}}{2}\right), \qquad D^{(t)} = \hypot\left(x_2^{(t)} - x_1^{(t)},\; y_2^{(t)} - y_1^{(t)}\right)$$

Let the container bounding client rect be $(R_{\text{left}}, R_{\text{top}})$, so the focal point relative to the scroll container's visible viewport is:
$$r_x^{(t)} = M_x^{(t)} - R_{\text{left}}, \qquad r_y^{(t)} = M_y^{(t)} - R_{\text{top}}$$

Maintain synchronous floating-point scroll coordinates $(S_x, S_y)$ in a mutable ref (`pinchScrollRef`) initialized at pinch start (`activePointers.size === 2`) from `(el.scrollLeft, el.scrollTop)` so multiple `pointermove` events within a single animation frame never read stale DOM `scrollLeft`/`scrollTop`.

At pinch start ($t = 0$), identify the anchor page $k$ under $M^{(0)}$ (defaulting to `currentPage - 1`), and record its unscaled page-local PDF focal coordinates $(u_x, u_y)$:
$$u_x = \frac{S_x^{(0)} + r_x^{(0)} - \text{pageOffsetLeft}_k(Z^{(0)})}{Z^{(0)}}, \qquad u_y = \frac{S_y^{(0)} + r_y^{(0)} - \text{pageOffsetTop}_k(Z^{(0)})}{Z^{(0)}}$$

At any subsequent pinch frame $t$ with new clamped zoom $Z^{(t)} = \text{clamp}\left(Z^{(0)} \cdot \frac{D^{(t)}}{D^{(0)}},\; 0.25,\; 5.0\right)$:
1. Compute the updated page offsets $\text{pageOffsetLeft}_k(Z^{(t)})$ and $\text{pageOffsetTop}_k(Z^{(t)})$ using the deterministic formula above (where virtual start scales linearly on the page dimensions while fixed `PAGE_GAP` $= 44\text{px}$ and `marginY` remain unscaled: $\text{pageOffsetTop}_k(Z^{(t)}) = \text{marginY}(Z^{(t)}) + k \cdot \text{PAGE\_GAP} + \frac{\text{PAGE\_GAP}}{2} + Z^{(t)} \sum_{j=0}^{k-1} h_{j,0}$).
2. Pin the exact PDF point $(u_x, u_y)$ directly beneath the current finger midpoint $(r_x^{(t)}, r_y^{(t)})$:
   $$S_x^{(t)} = \text{pageOffsetLeft}_k(Z^{(t)}) + u_x \cdot Z^{(t)} - r_x^{(t)}$$
   $$S_y^{(t)} = \text{pageOffsetTop}_k(Z^{(t)}) + u_y \cdot Z^{(t)} - r_y^{(t)}$$
3. Apply `el.scrollLeft = S_x^{(t)}` and `el.scrollTop = S_y^{(t)}` inside `useLayoutEffect` (or synchronous `flushSync` / layout pass immediately following the zoom state update) so the DOM container resizes and scrolls in the **same browser paint frame** with zero visual jitter.

#### C. Multi-Touch Drag Cancellation State Machine
Whenever a second touch pointer goes down (`activeTouchCount >= 2` or `e.isPrimary === false` on touch):
- Dispatch a custom window event `window.dispatchEvent(new CustomEvent('gullac:multitouch-start'))` from `DocumentViewport.tsx` (`onTouchStart` when `e.touches.length >= 2` and `onPointerDown` when `activePointers.current.size >= 2`).
- Any active single-finger interaction in `SelectionOverlay.tsx` (move, resize, rotate) or `PageCanvas.tsx` (freehand drawing, shape creation) must listen for `gullac:multitouch-start` (as well as checking `useEditorStore.getState().isPinching || activeTouchCount >= 2` inside `onMove`), and immediately execute a **Clean Abort Procedure**:
  1. Call `abortTransaction()` on `useEditorStore` (restoring the pre-drag `transactionBaseline` snapshot so any partial 1-finger move/resize is reverted).
  2. Clear transient local state (`setSnapGuides([])`, `setDraftPoints([])`, `setShapeDraft(null)`).
  3. Release pointer capture (`target.releasePointerCapture(pointerId)` inside `try/catch`).
  4. Remove the `pointermove`, `pointerup`, `pointercancel`, and `gullac:multitouch-start` window listeners so `onUp` never calls `commitTransaction()`.

---

### 2.2 Smart Hit-Testing & Background Image Isolation Architecture

#### A. Automatic Background / Cover Image Classification (`isBackgroundLayer`)
An image object $I$ on page $P$ (with page area $A_P = W_P \cdot H_P$ in PDF points and bounding box $B_I = [x_I, y_I, x_I + w_I, y_I + h_I]$) is classified with `isBackgroundLayer: boolean` using a two-stage detector:

1. **Stage 1 — Operator Stream & Area Heuristic (`pdfjsService.ts`):**
   $$A_I = w_I \cdot h_I, \qquad \text{areaRatio} = \frac{A_I}{A_P}$$
   Flag `isBackgroundCandidate = true` if:
   - $\text{areaRatio} \ge 0.65$, OR
   - $w_I \ge 0.85 \cdot W_P \land h_I \ge 0.12 \cdot H_P$, OR
   - `hasTextDrawnOver === true` (where `drawnRegions` in `pdfjsService.ts:L674` is fixed to record the full text run width $\max(18, \text{glyphCount} \cdot \text{estFontSize} \cdot 0.55)$ instead of a `16pt` stub).

2. **Stage 2 — Post-Extraction Text-Block Cross-Check (`useEditorStore.ts:setPageExtraction` / `PageCanvas.tsx`):**
   Once both `textBlocks` (`DetectedTextBlock[]`) and `images` (`DetectedImageObject[]`) are available for page $P$:
   For each image $I$, compute the set of overlapping text blocks:
   $$\mathcal{T}_{\text{overlap}}(I) = \left\{ T \in \text{textBlocks} \;\middle|\; \frac{\text{Area}(B_I \cap B_T)}{\text{Area}(B_T)} \ge 0.20 \right\}$$
   Set:
   $$I.\text{isBackgroundLayer} = \left(\text{areaRatio} \ge 0.65\right) \lor I.\text{isHeaderOrBackground} \lor \left(|\mathcal{T}_{\text{overlap}}(I)| \ge 1 \land \text{areaRatio} \ge 0.15\right)$$

When a `DetectedImageObject` with `isBackgroundLayer === true` is promoted via `promoteDetectedImage`, the resulting `ImageReplacementElement` (and any user-added `ImageAddElement` marked as background) inherits `isBackgroundLayer: true`.

#### B. Multi-Tier Hit-Testing Priority & Coarse-Pointer Expansion
Define pointer tolerance radii based on input modality (`isCoarse = window.matchMedia('(pointer: coarse)').matches` or `e.pointerType === 'touch'`):
- **Text Hit-Box Expansion ($\varepsilon_{\text{text}}$):**
  $$\varepsilon_{\text{text}} = \begin{cases} 6\text{px} \text{ (in display space)} = \frac{6}{Z}\text{pt} & \text{if coarse pointer (touch)} \\ 2\text{px} \text{ (in display space)} = \frac{2}{Z}\text{pt} & \text{if fine pointer (mouse/pen)} \end{cases}$$
- **Background Isolation Guard Radius ($\varepsilon_{\text{bgGuard}}$):**
  $$\varepsilon_{\text{bgGuard}} = \begin{cases} 8\text{px} \text{ (in display space)} = \frac{8}{Z}\text{pt} & \text{if coarse pointer (touch)} \\ 4\text{px} \text{ (in display space)} = \frac{4}{Z}\text{pt} & \text{if fine pointer (mouse/pen)} \end{cases}$$

For any pointer event at page-local PDF coordinates $(p_x, p_y)$, define the expanded bounding box test $\text{Hit}(B, p, \varepsilon)$:
$$\text{Hit}(B, p, \varepsilon) \iff p_x \in [B_x - \varepsilon,\; B_x + B_w + \varepsilon] \;\land\; p_y \in [B_y - \varepsilon,\; B_y + B_h + \varepsilon]$$

**Strict Hit-Evaluation Order (`resolveSmartHitAtPoint` in `src/engine/coordinates.ts`):**
When `selectBackgroundMode === false` (default editing mode):
1. **Tier 1 (Active Inline Editor):** If `editingTextElementId` is active and $\text{Hit}(B_{\text{editor}}, p, \varepsilon_{\text{text}})$, keep focus in inline editor.
2. **Tier 2 (Foreground User Elements & Promoted Text):** Evaluate unlocked elements where `!el.locked && !el.isBackgroundLayer` (including `text-edit`, `text-add`, `shape`, `freehand`, `signature`, `form-field`, and foreground `image`/`image-replacement`), expanding `text-edit` and `text-add` boxes by $\varepsilon_{\text{text}}$, ordered by descending `zIndex`. If multiple text boxes match, pick the one with minimum Euclidean distance from $p$ to its unexpanded box center.
3. **Tier 3 (Unpromoted Detected PDF Text Blocks):** Evaluate `detectedTextBlocks` (excluding replaced `sourceBlockId`s) expanded by $\varepsilon_{\text{text}}$. If matched, return `{ kind: 'detected-text', block }`.
4. **Tier 4 (Foreground Detected Images):** Evaluate `detectedImages` where `!img.isBackgroundLayer` and not yet replaced. If matched, return `{ kind: 'detected-image', image: img }`.
5. **Tier 5 (Background Images — Guarded Fallback):**
   First check the **Proximity Guard**: Does *any* Tier 2 or Tier 3 foreground/text element satisfy $\text{Hit}(B_{\text{fg}}, p, \varepsilon_{\text{bgGuard}})$?
   - If **YES**: Reject background image selection completely (return the nearest Tier 2/Tier 3 element).
   - If **NO** (zero foreground/text elements within $8\text{px}$):
     - Background images are selectable if:
       (a) `selectBackgroundMode === true` (`"Arka Planı Seç"` toggle is active), OR
       (b) The gesture is `Alt + Click` (`e.altKey === true`) or a `500ms` Touch Long-Press ("Select Layer Underneath"), OR
       (c) The pointer is in an open area with zero foreground/text hit-boxes within $\varepsilon_{\text{bgGuard}}$ AND the user clicks/taps a background element that is not `locked`.

#### C. Fixing the `SelectionOverlay` `zIndex: 500` Trap
In `SelectionOverlay.tsx`:
- When the currently selected element is a background layer (`selectedElements.every(el => el.isBackgroundLayer)` and `!selectBackgroundMode`), `SelectionOverlay`'s main body `onPointerDown` (`SelectionOverlay.tsx:L68`) MUST first call `resolveSmartHitAtPoint(pageCoords, ...)`:
  - If a Tier 2 or Tier 3 foreground/text item is under the pointer (within $\varepsilon_{\text{text}}$) and the user did NOT click one of the 8 resize/rotate handles, `SelectionOverlay` must immediately switch selection/editing to that foreground text element (calling `startEditDetectedText(hit.block.id)` or `setSelectedElements([hit.element.id])`) instead of starting a background image drag!

---

### 2.3 Pixel-Exact DOM-to-PDF Overlay Calibration (Root Cause 3A)

#### A. Preserving Sub-Pixel PDF Font Size
In `src/engine/textExtractor.ts`:
- Remove the `0.5pt` snapping logic at `L1264–L1266`:
  ```ts
  // REMOVE:
  // const nearestHalf = Math.round(rawBodySize * 2) / 2
  // const bodySize = Math.abs(rawBodySize - nearestHalf) <= 0.16 ? nearestHalf : Number(rawBodySize.toFixed(2))
  ```
  Replace with exact 3-decimal precision derived from the PDF transformation matrix norm $\sqrt{a^2 + b^2}$:
  $$S_{\text{pdf}} = \text{round}_3\left(\sqrt{a^2 + b^2}\right) = \text{Number}(\text{rawBodySize.toFixed}(3))$$
- At `textExtractor.ts:L550`, preserve `Number(first.fontSize.toFixed(3))` instead of `toFixed(1)`.

#### B. Baseline-to-CSS-Line-Box Vertical Alignment
In a PDF page, a text line's vertical position is anchored at its typographic baseline $Y_{\text{baseline}}$ (measured in top-left page points). In `textExtractor.ts:L456 & L567`, the block top is `y = minY` and the distance from the block top to the first line's baseline is stored as:
$$\Delta_{\text{pdfBaseline}} = Y_{\text{baseline}, 0} - y_{\text{block}} = \text{block.baselineOffset}$$

When rendered in the DOM (`PageCanvas.tsx` and `InlineTextEditor.tsx`) with CSS `font-size` $= S \cdot Z$ and unitless CSS `line-height` $= L$:
Let $\alpha_{\text{font}}$ be the font's normalized ascent ratio $\frac{\text{Ascent}}{\text{Ascent} + |\text{Descent}|}$ measured once per `(fontFamily, fontWeight, fontStyle)` via `CanvasRenderingContext2D.measureText('HgÁğŞİp')` (`fontBoundingBoxAscent / (fontBoundingBoxAscent + fontBoundingBoxDescent)`, with fallback: `0.815` for `sans-serif`, `0.825` for `serif`, `0.800` for `monospace`).

In CSS inline formatting context, the distance (in PDF points) from the top of the first line box to its alphabetic baseline is:
$$\Delta_{\text{cssBaseline}}(S, L) = S \cdot \left(\frac{L - 1}{2} + \alpha_{\text{font}}\right)$$

Therefore, without calibration, switching from the PDF canvas render to the DOM overlay shifts the text vertically by:
$$\delta_Y = \Delta_{\text{pdfBaseline}} - \Delta_{\text{cssBaseline}}(S, L)$$

**Exact Vertical Calibration Rule:**
Store `baselineOffset?: number` on `TextEditElement` (copied from `DetectedTextBlock.baselineOffset` in `startEditDetectedText`). When rendering the `text-edit` overlay in `PageCanvas.tsx` and the editable surface in `InlineTextEditor.tsx`, apply the vertical top offset in display pixels:
$$\text{topOffsetPx} = \begin{cases} \left(\text{el.baselineOffset} - \Delta_{\text{cssBaseline}}(S, L)\right) \cdot Z & \text{if } \text{el.baselineOffset} \text{ is defined} \\ -\max(0, (L - 1) \cdot 0.35) \cdot S \cdot Z & \text{fallback for newly created text} \end{cases}$$
And strip all default browser spacing on the editable node:
```css
padding: 0;
border: 0;
margin: 0;
box-sizing: border-box;
font-kerning: normal;
```

#### C. Horizontal Glyph Width & `measureText` Calibration
When a `DetectedTextBlock` is extracted or promoted to a `TextEditElement`:
Let line $0$ (or the widest non-empty line $k^*$ in the block) have text string $s_{k^*}$ and exact PDF bounding width $W_{\text{pdf}} = x_{1, k^*} - x_{0, k^*}$ (in PDF points).
Measure the unscaled DOM advance width $W_{\text{dom}}$ (in PDF points) using an offscreen `CanvasRenderingContext2D`:
$$\text{ctx.font} = \text{`}\$\{\text{fontStyle}\}\text{ }\$\{\text{fontWeight}\}\text{ }100\text{px }\$\{\text{cssFontFamily}\}\text{`}$$
$$W_{\text{dom}} = \frac{\text{ctx.measureText}(s_{k^*}).\text{width}}{100} \cdot S_{\text{pdf}}$$

When $W_{\text{dom}} > 0$ and $W_{\text{pdf}} > 0$, the horizontal width discrepancy is $\Delta_W = W_{\text{pdf}} - W_{\text{dom}}$ and the ratio is $r_W = \frac{W_{\text{pdf}}}{W_{\text{dom}}}$.
To match the rasterized PDF text with sub-pixel horizontal accuracy without distorting glyph shapes:
1. If $|r_W - 1| \le 0.06$ and $|s_{k^*}| > 1$, absorb the delta via calibrated `letterSpacing` (in PDF points):
   $$\text{calibratedLetterSpacing} = \text{clamp}\left(\frac{W_{\text{pdf}} - W_{\text{dom}}}{|s_{k^*}| - 1},\; -0.45,\; +1.20\right)$$
2. If $|r_W - 1| > 0.06$ (e.g., condensed/expanded PDF fonts or non-standard `Tz` scaling in the source PDF), store exact numeric `horizontalScale = clamp(Number(r_W.toFixed(4)), 0.70, 1.35)` on `DetectedTextBlock` and `TextEditElement` (widening the type from `0.85 | 1 | 1.15` to `number`), and apply it in both `PageCanvas.tsx` and `InlineTextEditor.tsx` via CSS `transform: scaleX(${horizontalScale})` with `transformOrigin: 'left top'` and compensated layout width `width: (frame.width / horizontalScale)px`.

---

### 2.4 Export Width & Line-Break Parity Fix (Root Cause 3B)

#### A. Preserving Editor Line Structure & Width Parity
1. **Unclamped Initial Width & Safety Buffer in `startEditDetectedText` (`useEditorStore.ts:L1308`):**
   - Replace `width: Math.max((block.paragraphWidth ?? block.width) + 2, 40)` with:
     $$W_{\text{init}} = \max\left(\text{block.paragraphWidth} ?? \text{block.width},\; \text{block.width}\right) + \max\left(4,\; \text{block.fontSize} \cdot 0.25\right)$$
   - Do **not** artificially force a `40px` minimum width when `block.width < 40` unless the text is empty; in `InlineTextEditor.tsx:L281`, use `Math.max(16, frame.width)` instead of `Math.max(40, frame.width)`.
2. **Tracking Rendered Line Count (`renderedLineCount`) & Explicit Width Resize (`widthResizedByUser`):**
   - Add optional fields to `TextEditElement` and `TextAddElement` in `src/types/elements.ts`:
     - `renderedLineCount?: number` — the exact visual line count rendered in the DOM editor.
     - `widthResizedByUser?: boolean` — set to `true` only when the user drags an `e` / `w` / `ne` / `nw` / `se` / `sw` resize handle in `SelectionOverlay.tsx` or edits width in `RightInspector.tsx`.
   - In `InlineTextEditor.tsx` (`syncLayoutMetrics` and `finishEditing`), compute `renderedLineCount` from the DOM editor element `el`:
     $$\text{renderedLineCount} = \max\left(1,\; \text{round}\left(\frac{\text{el.scrollHeight}}{\text{el.fontSize} \cdot \text{zoom} \cdot \text{el.lineHeight}}\right)\right)$$
     and persist `renderedLineCount` alongside `content`, `richText`, and `height`.

#### B. Export Line-Break Parity & Dynamic PDF `Tz` Horizontal Scaling (`pdfCompiler.ts` & `richText.ts`)
During PDF compilation in `drawTextElementOnPage` (`src/engine/pdfCompiler.ts:L592–L708`):
1. **Single-Line Preservation Rule:**
   Determine if the element is a single-line block:
   $$\text{isSingleLine} = !\text{el.content.includes}(\text{'\textbackslash n'}) \;\land\; \left(\text{el.renderedLineCount} === 1 \;\lor\; \left(\text{el.renderedLineCount} === \text{undefined} \;\land\; !\text{el.widthResizedByUser} \;\land\; \text{el.height} < \text{el.fontSize} \cdot \text{el.lineHeight} \cdot 1.65\right)\right)$$
   - If $\text{isSingleLine} === \text{true}$, pass `maxWidth = Infinity` to `buildWrappedRichLines` so `pdf-lib` **never** wraps a single-line editor text block onto a second line.
2. **Multi-Line Epsilon Safety Buffer:**
   - If $\text{isSingleLine} === \text{false}$, apply a calibrated width tolerance buffer to compensate for the `1%–2.5%` advance-width difference between browser TrueType hinting and `pdf-lib` / `fontkit` `widthOfTextAtSize`:
     $$W_{\text{exportMax}} = \text{el.width} \cdot 1.025 + 2.0\text{pt}$$
   - Also strip trailing whitespace width when testing line-wrap overflow in `buildWrappedRichLines` (`src/engine/richText.ts:L208`).
3. **Dynamic PDF `Tz` (Horizontal Text Scaling) When Embedded Font Exceeds Box Width:**
   For each laid-out line $L_j$ in `drawTextElementOnPage`:
   Let $W_{\text{line}}$ be the line's measured width in `pdf-lib` points (`line.width`) and $W_{\text{box}} = \text{el.width}$.
   Let $h_{\text{base}} = \text{el.horizontalScale} ?? 1$.
   If $W_{\text{line}} > W_{\text{box}} + 0.5\text{pt}$ (for example, on a single-line block or a tight word where the embedded PDF font is wider than the browser font):
   Compute the required horizontal fit factor:
   $$f_{\text{fit}} = \text{clamp}\left(\frac{W_{\text{box}}}{W_{\text{line}}},\; 0.88,\; 1.0\right)$$
   Combine with the element's horizontal scale:
   $$\text{tzPercent} = \text{Number}\left((h_{\text{base}} \cdot f_{\text{fit}} \cdot 100).\text{toFixed}(2)\right)$$
   Wrap the `page.drawText(...)` calls for that line inside PDF graphics state operators using `pdf-lib`'s `PDFOperator` and `PDFNumber`:
   ```ts
   page.pushOperators(
     pushGraphicsState(),
     PDFOperator.of('Tz' as any, [PDFNumber.of(tzPercent)]),
   )
   // ... draw line segments with segment x offsets scaled by f_fit ...
   page.pushOperators(popGraphicsState())
   ```
   This guarantees that even when an export font's glyph metrics are slightly wider than the browser's, the text fits cleanly on one line within the exact PDF bounding box width without wrapping or overflowing.

---

## 3. Phased Execution Backlog for Gemini Hydrogen

Execute the following 5 phases sequentially. Every file path, interface modification, and algorithm is specified below.

---

### PHASE 1: Viewport, Pinch-to-Zoom Focal Math & 4-Edge Overscroll Engine — [x] COMPLETED
- **Verification Status:** `npx tsc --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `npm run build`, and `npm test` (8 files, 58 tests including mobile 300%/500% 4-edge overscroll and multi-page pinch focal-point invariance in `coordinates.test.ts`) all passed.

#### Step 1.1 — Expand Zoom Domain in `src/store/useEditorStore.ts` [x]
- **Target:** `setZoom` (`L461–L465`).
- **Action:** Update the maximum zoom clamp from `4` (`400%`) to `5` (`500%`):
  ```ts
  setZoom: (zoom) => {
    const clamped = Math.min(5, Math.max(0.25, Math.round(zoom * 100) / 100))
    set({ zoom: clamped, fitMode: 'custom' })
  },
  ```

#### Step 1.2 — Synchronous Pinch Focal Math & 4-Edge Overscroll Surface in `src/components/viewport/DocumentViewport.tsx` [x]
- **Target:** `DocumentViewport.tsx` (`L12–L431`).
- **Actions:**
  1. [x] **Constants:** Update `MAX_ZOOM = 5.0` (`L13`).
  2. [x] **Compute Maximum Scaled Page Width & Overscroll Margins:**
     Compute `maxPageScaledWidth` across `pages` (or fallback to `currentPageMeta.width * zoom`), and compute dynamic overscroll margins:
     ```ts
     const containerWidth = containerRef.current?.clientWidth || window.innerWidth
     const containerHeight = containerRef.current?.clientHeight || window.innerHeight
     const isZoomedHorizontally = maxPageScaledWidth + 32 > containerWidth || zoom > 1.05
     const viewportMarginX = isZoomedHorizontally
       ? Math.max(48, Math.round(containerWidth * 0.35))
       : Math.max(16, Math.round((containerWidth - maxPageScaledWidth) / 2))
     const viewportMarginY = Math.max(64, Math.round(containerHeight * 0.35), isMobile ? 140 : 64)
     const surfaceWidth = Math.max(containerWidth, Math.ceil(maxPageScaledWidth + viewportMarginX * 2))
     ```
  3. [x] **Fix Negative Flexbox Overflow (`L393–L420`):**
     - On the virtualizer outer container (`L394–L400`), set:
       - `width: `${surfaceWidth}px`` (instead of `'100%'`)
       - `height: `${rowVirtualizer.getTotalSize() + viewportMarginY * 2}px``
     - On each virtual row (`L404–L418`), set:
       - `transform: `translateY(${virtualRow.start + viewportMarginY}px)``
       - Calculate exact horizontal offset `const rowLeft = Math.max(viewportMarginX, Math.round((surfaceWidth - pageScaledWidth) / 2))` and apply `paddingLeft: `${rowLeft}px`` with `justify-start` instead of `justify-center` with `width: '100%'`. This guarantees no page ever overflows into negative X (`< 0`), enabling full left-edge and right-edge panning at `300%–500%` zoom.
  4. [x] **Pinch Anchor State & Synchronous Layout Scroll (`L71–L186`):**
     - Replace `lastPinchDist` / `lastPinchMid` with a unified `pinchSessionRef`:
       ```ts
       interface PinchSession {
         startZoom: number
         startDist: number
         anchorPageIndex: number
         pdfLocalX: number // unscaled PDF point X on anchor page
         pdfLocalY: number // unscaled PDF point Y on anchor page
       }
       const pinchSessionRef = useRef<PinchSession | null>(null)
       const pendingScrollRef = useRef<{ left: number; top: number } | null>(null)
       ```
     - Create helper `getPageOffsetInSurface(pageIndex: number, targetZoom: number)` that deterministically computes `{ left, top }` for `pageIndex` using `pages` dimensions, `PAGE_GAP` (`44`), `viewportMarginX`, and `viewportMarginY`.
     - When `activePointers.current.size === 2` starts (in `onPointerDown` or `onTouchStart`), initialize `pinchSessionRef.current` using the current midpoint `(midX, midY)` relative to `containerRef.current.getBoundingClientRect()`, current `el.scrollLeft` / `el.scrollTop`, and `getPageOffsetInSurface(anchorPageIndex, zoom)`:
       ```ts
       const offset = getPageOffsetInSurface(anchorPageIndex, currentZoom)
       const pdfLocalX = (el.scrollLeft + relX - offset.left) / currentZoom
       const pdfLocalY = (el.scrollTop + relY - offset.top) / currentZoom
       ```
     - Also dispatch `window.dispatchEvent(new CustomEvent('gullac:multitouch-start'))` as soon as `activePointers.current.size >= 2` or `e.touches.length >= 2`.
     - In `applyPinchGeometry(midX, midY, dist)`:
       Compute `nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(session.startZoom * (dist / session.startDist) * 100) / 100))`.
       Compute `nextOffset = getPageOffsetInSurface(session.anchorPageIndex, nextZoom)`.
       Compute target scroll:
       ```ts
       const nextScrollLeft = Math.max(0, nextOffset.left + session.pdfLocalX * nextZoom - relX)
       const nextScrollTop = Math.max(0, nextOffset.top + session.pdfLocalY * nextZoom - relY)
       pendingScrollRef.current = { left: nextScrollLeft, top: nextScrollTop }
       setZoom(nextZoom)
       ```
     - Add a `useLayoutEffect` watching `[zoom]` that immediately applies `pendingScrollRef.current` to `containerRef.current.scrollLeft` and `scrollTop` before the browser paints, and also applies `pendingScrollRef` synchronously when `nextZoom === currentZoom` (pure two-finger pan without scale change).

#### Step 1.3 — Multi-Touch Drag Abort in `src/components/viewport/SelectionOverlay.tsx` & `src/components/viewport/PageCanvas.tsx` [x]
- **Target 1:** `SelectionOverlay.tsx` (`handleDragStart` `L68–L118`, `handleResizeStart` `L120–L192`, `handleRotateStart` `L194–L244`).
- **Action 1:** [x] In all three handlers, define an `abortGesture()` function:
  ```ts
  let aborted = false
  const abortGesture = () => {
    if (aborted) return
    aborted = true
    setSnapGuides([])
    abortTransaction()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('gullac:multitouch-start', abortGesture)
  }
  ```
  Register `window.addEventListener('gullac:multitouch-start', abortGesture)` and call `abortGesture()` inside `onMove` if `useEditorStore.getState().isPinching || useEditorStore.getState().activeTouchCount >= 2`.
- **Target 2:** `PageCanvas.tsx` (`handlePointerDown` `L546–L649` for freehand and shape creation).
- **Action 2:** [x] Listen for `gullac:multitouch-start` and `pointercancel`; when triggered or when `isPinching || activeTouchCount >= 2` is detected inside `onMove`, clear `setDraftPoints([])` / `setShapeDraft(null)`, release pointer capture, and remove `onMove`/`onUp` listeners without calling `addElement`.

---

### PHASE 2: Smart Hit-Testing & Background Image Isolation Architecture — [x] COMPLETED
- **Verification Status:** `npx tsc --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `npm run build`, and `npm test` (8 files, 60 tests including Stage 2 background text-overlap classification/promotion guard in `store.test.ts` and 5-tier coarse/fine `resolveSmartHitAtPoint` priority + `bgGuardPt` tests in `coordinates.test.ts`) all passed.

#### Step 2.1 — Model & Store Extensions for Background Layers and Layer Locking [x]
- **Target 1:** `src/types/pdf.ts` (`DetectedImageObject` at `L65–L78`).
  - [x] Add `isBackgroundLayer?: boolean` to `DetectedImageObject`.
- **Target 2:** `src/types/elements.ts` (`BaseElement` at `L34–L46`).
  - [x] Add `isBackgroundLayer?: boolean` to `BaseElement` (alongside existing `locked?: boolean`).
- **Target 3:** `src/store/useEditorStore.ts`.
  - [x] Add `selectBackgroundMode: boolean` (default `false`) and action `setSelectBackgroundMode: (enabled: boolean) => void` to `EditorStore`.
  - [x] In `promoteDetectedImage` (`L1372–L1416`):
    - Block promotion if `target.isBackgroundLayer && !state.selectBackgroundMode` UNLESS an explicit `forcePromote?: boolean` parameter is passed (`promoteDetectedImage: (img: DetectedImageObject, forcePromote?: boolean) => ImageReplacementElement | null`).
    - Copy `isBackgroundLayer: Boolean(target.isBackgroundLayer || target.isHeaderOrBackground)` onto the newly created `ImageReplacementElement`.
  - [x] In `setPageExtraction` (`L714–L779`):
    - Run the **Stage 2 Post-Extraction Background Classifier** across `extraction.images` and `extraction.textBlocks`:
      Compute `pageArea = Math.max(1, pageWidth * pageHeight)` (look up page dimensions from `state.pages.find(p => p.pageNumber === pageNumber)`).
      For each image `img`, compute `areaRatio = (img.width * img.height) / pageArea` and check if any `tb` in `extraction.textBlocks` has intersection area `>= 0.20 * (tb.width * tb.height)`.
      Set `img.isBackgroundLayer = Boolean(areaRatio >= 0.65 || img.isHeaderOrBackground || (hasOverlappingTextBlock && areaRatio >= 0.15))`.

#### Step 2.2 — Fix Operator-Stream Text Overlap Stub in `src/engine/pdfjsService.ts` [x]
- **Target:** `pdfjsService.ts` (`L668–L678` and `L910–L931`).
- **Actions:**
  1. [x] At `L672–L674`, compute the actual estimated width of the text run in `OPS.showText` / `OPS.showSpacedText` from the argument array glyph count and current text matrix scale, recording `{ x0: vx - 2, y0: vy - 10, x1: vx + Math.max(18, glyphCount * estFontSize * 0.52), y1: vy + 6 }` in `drawnRegions`.
  2. [x] At `L918`, lower the full-page area threshold from `areaRatio >= 0.72` to `areaRatio >= 0.65` and set `isBackgroundLayer: isHeaderOrBackground || areaRatio >= 0.65`.

#### Step 2.3 — Implement `resolveSmartHitAtPoint` in `src/engine/coordinates.ts` [x]
- **Target:** `src/engine/coordinates.ts` (append after `hitTestElements` at `L342`).
- **Action:** [x] Export a unified, deterministic hit-testing function:
  ```ts
  export interface SmartHitOptions {
    point: Point // Page-local PDF coordinates (points)
    zoom: number
    isCoarsePointer: boolean
    selectBackgroundMode: boolean
    altKey?: boolean
    elements: EditorElement[]
    detectedTextBlocks: DetectedTextBlock[]
    detectedImages: DetectedImageObject[]
    replacedBlockIds: Set<string>
    replacedImageIds: Set<string>
  }

  export type SmartHitResult =
    | { tier: 2; kind: 'element'; element: EditorElement }
    | { tier: 3; kind: 'detected-text'; block: DetectedTextBlock }
    | { tier: 4; kind: 'detected-image'; image: DetectedImageObject }
    | { tier: 5; kind: 'background-element'; element: EditorElement }
    | { tier: 5; kind: 'background-detected-image'; image: DetectedImageObject }
    | null

  export function resolveSmartHitAtPoint(opts: SmartHitOptions): SmartHitResult
  ```
  Implement the exact 5-tier priority algorithm from Section 2.2.B:
  - `textPadPt = (opts.isCoarsePointer ? 6 : 2) / Math.max(0.25, opts.zoom)`
  - `bgGuardPt = (opts.isCoarsePointer ? 8 : 4) / Math.max(0.25, opts.zoom)`
  - When `opts.selectBackgroundMode === true` or `opts.altKey === true`, evaluate background elements and background detected images first so the user can intentionally select/manipulate background layers.
  - When `opts.selectBackgroundMode === false` and `!opts.altKey`:
    1. Evaluate unlocked foreground elements (`!el.locked && !el.isBackgroundLayer`), expanding `text-edit` and `text-add` hit boxes by `textPadPt`.
    2. Evaluate unreplaced `detectedTextBlocks` expanded by `textPadPt` (if multiple overlap, select the block whose unexpanded center is closest to `opts.point`).
    3. Evaluate unreplaced foreground `detectedImages` (`!img.isBackgroundLayer`).
    4. Check the `bgGuardPt` proximity guard: if ANY foreground element or `detectedTextBlock` is within `bgGuardPt` of `opts.point`, return that nearest foreground/text target instead of any background image.
    5. Only when zero foreground/text boxes are within `bgGuardPt` of `opts.point`, allow hitting an unlocked `background-element` or `background-detected-image`.

#### Step 2.4 — Wire Smart Hit-Testing, Long-Press & Background Isolation in `PageCanvas.tsx` and `SelectionOverlay.tsx` [x]
- **Target 1:** `src/components/viewport/PageCanvas.tsx` (`L951–L995`, `L1014–L1077`, `L1295–L1322`).
- **Actions in `PageCanvas.tsx`:** [x]
  1. For `detected-image` overlays (`L951–L995`):
     - When `img.isBackgroundLayer && !selectBackgroundMode`:
       - Set `style={{ ...rect, zIndex: 10, pointerEvents: 'none' }}` on the `detected-image` div so it **never** intercepts pointer events directly over the page!
       - Instead, handle background image selection centrally in `PageCanvas`'s surface `handlePointerDown` (`L546`) via `resolveSmartHitAtPoint(...)` (when `activeTool === 'select'`):
         - If `resolveSmartHitAtPoint` returns `tier: 3` (`detected-text` within `+6px` coarse expansion), call `startEditDetectedText(hit.block.id)`.
         - If `resolveSmartHitAtPoint` returns `tier: 5` (`background-detected-image`, meaning zero text/foreground elements are within `8px`), promote and select only if `selectBackgroundMode || e.altKey` OR via a **500ms Long-Press context badge** (`"Arka Planı Seç / Select Background Layer"`) or direct click on an empty non-text region of the background image.
  2. For promoted `image-replacement` and `image` elements (`L1295–L1322` and `L791–L809`):
     - When `el.isBackgroundLayer && !selectBackgroundMode`, render the element at `zIndex: Math.min(el.zIndex, 50)` (below all text blocks at `zIndex >= 300`).
     - In its `onPointerDown`, run `resolveSmartHitAtPoint`: if a foreground text block (`detected-text` or `text-edit`/`text-add`) is within `bgGuardPt` (`8px` on touch, `4px` on mouse) and `!e.altKey`, forward the interaction immediately to that text block (`startEditDetectedText` or `setSelectedElements`) instead of selecting the background image!
     - If `el.locked === true`, do not start drag on click; show a small lock indicator pill allowing unlock from the inspector.
- **Target 2:** `src/components/viewport/SelectionOverlay.tsx` (`L68–L118`, `L287–L302`).
- **Actions in `SelectionOverlay.tsx`:** [x]
  1. If the selected element has `el.locked === true`, hide resize/rotate handles, render a subtle dashed amber lock border with a `"Kilitli / Locked"` badge + quick `"Kilidi Aç"` button, and block drag/resize/rotate.
  2. If the selected element has `el.isBackgroundLayer === true` and `!selectBackgroundMode`:
     - Lower the `SelectionOverlay` body container `zIndex` from `500` to `290` (while keeping the 8 resize/rotate handles at `zIndex: 510` with `pointerEvents: 'auto'`), OR inside `handleDragStart` (`L68`), run `resolveSmartHitAtPoint`: if the pointer is over any `detected-text` or foreground element (within `textPadPt`), call `startEditDetectedText` / `setSelectedElements` and return immediately without starting a background drag.

#### Step 2.5 — Add `"Arka Planı Seç" (Select Background)` & `"Katmanı Kilitle" (Lock Layer)` UI Controls [x]
- **Target 1:** `src/components/toolbar/TopToolbar.tsx` (`L280–L360`).
  - [x] Add a compact toggle button next to the Select/Hand tools (with `Layers` icon from `lucide-react`):
    - Label/Tooltip: `"Arka Planı Seç (Arka Plan Görsellerini Düzenle)"`
    - Bound to `selectBackgroundMode` / `setSelectBackgroundMode(!selectBackgroundMode)`.
    - Active styling: `bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50`.
- **Target 2:** `src/components/inspector/RightInspector.tsx` (in Image Inspector section `L760–L860` and Page/Layer section) & `src/components/mobile/MobileInspectorSheet.tsx` (`L95–L170`).
  - [x] Add two one-tap action buttons for any selected element (especially `image` and `image-replacement`):
    1. **Layer Lock Toggle (`locked`):** Button with `Lock` / `Unlock` icon (`"Katmanı Kilitle"` / `"Kilidi Aç"`), calling `updateElement(el.id, { locked: !el.locked })`.
    2. **Background Layer Toggle (`isBackgroundLayer`):** Button (`"Arka Plan Katmanı"`), calling `updateElement(el.id, { isBackgroundLayer: !el.isBackgroundLayer })`.
  - [x] In `MobileToolsSheet.tsx`, add the `"Arka Plan Görsellerini Seç"` toggle switch so mobile users can toggle `selectBackgroundMode` with one tap.

---

### PHASE 3: Pixel-Exact Typography Calibration (Click-to-Edit Visual Parity) — [x] COMPLETED
- **Verification Status:** `npx tsc --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `npm run build`, and `npm test` (8 files, 62 tests including 3-decimal sub-pixel fractional font preservation & `calibrateDomTextMetrics` checks in `textExtractor.test.ts`) all passed.

#### Step 3.1 — Remove Font-Size Snapping & Widen `horizontalScale` Type [x]
- **Target 1:** `src/types/pdf.ts` (`L50`) and `src/types/elements.ts` (`L70`, `L94`).
  - Change `horizontalScale?: 0.85 | 1 | 1.15` to `horizontalScale?: number`.
  - Add `baselineOffset?: number` to `TextEditElement` in `src/types/elements.ts`.
- **Target 2:** `src/engine/textExtractor.ts` (`L550`, `L1260–L1268`).
  - At `L1264–L1266`, remove the `nearestHalf` (`0.5pt`) snapping and set:
    ```ts
    const bodySize = Number(rawBodySize.toFixed(3))
    ```
  - At `L550`, change `fontSize: Number(first.fontSize.toFixed(1))` to `fontSize: Number(first.fontSize.toFixed(3))`.

#### Step 3.2 — Create Font Metrics & Width Calibration Helper in `src/engine/fonts.ts` [x]
- **Target:** `src/engine/fonts.ts`.
- **Action:** Add and export `calibrateDomTextMetrics`:
  ```ts
  export interface DomTextCalibration {
    ascentRatio: number
    cssBaselineFromTopPt: number
    topOffsetPt: number
    letterSpacingPt: number
    horizontalScale: number
  }

  export function calibrateDomTextMetrics(params: {
    sampleText: string
    targetPdfWidthPt: number
    fontSizePt: number
    lineHeight: number
    baselineOffsetPt?: number
    fontFamily: string
    fontWeight: number
    fontStyle: 'normal' | 'italic'
    initialHorizontalScale?: number
  }): DomTextCalibration
  ```
  Implementation details:
  1. Use a cached offscreen `<canvas>` context (`getCalibrationContext()`).
  2. Measure `ascentRatio` for `(cssFontFamily, fontWeight, fontStyle)` at `100px` using `metrics.fontBoundingBoxAscent` and `metrics.fontBoundingBoxDescent` (if supported by the browser, clamped to `[0.74, 0.88]`; otherwise fallback to `0.815` for sans, `0.825` for serif, `0.80` for mono).
  3. Compute `cssBaselineFromTopPt = params.fontSizePt * ((params.lineHeight - 1) * 0.5 + ascentRatio)`.
  4. Compute `topOffsetPt = params.baselineOffsetPt !== undefined ? (params.baselineOffsetPt - cssBaselineFromTopPt) : -Math.max(0, (params.lineHeight - 1) * 0.35) * params.fontSizePt`.
  5. Measure `domWidthPt = (ctx.measureText(params.sampleText).width / 100) * params.fontSizePt`.
  6. If `params.sampleText.length > 1 && domWidthPt > 1 && params.targetPdfWidthPt > 1`:
     - Let `ratio = params.targetPdfWidthPt / domWidthPt`.
     - If `Math.abs(ratio - 1) <= 0.06`:
       - `letterSpacingPt = clamp(Number(((params.targetPdfWidthPt - domWidthPt) / (params.sampleText.length - 1)).toFixed(3)), -0.45, 1.2)`
       - `horizontalScale = params.initialHorizontalScale ?? 1`
     - Else:
       - `letterSpacingPt = 0`
       - `horizontalScale = clamp(Number(ratio.toFixed(4)), 0.70, 1.35)`

#### Step 3.3 — Apply Calibration in `startEditDetectedText`, `PageCanvas.tsx`, and `InlineTextEditor.tsx` [x]
- **Target 1:** `src/store/useEditorStore.ts` (`startEditDetectedText` at `L1294–L1330`).
  - Identify the longest single line in `block.content.split('\n')` and pass it with `block.width` (when single-line) to `calibrateDomTextMetrics`.
  - Populate `baselineOffset: block.baselineOffset`, calibrated `letterSpacing`, calibrated `horizontalScale`, and initial `width: Math.max((block.paragraphWidth ?? block.width), block.width) + Math.max(4, block.fontSize * 0.25)` on the new `TextEditElement`.
  - Initialize `renderedLineCount: block.content.split('\n').length` and `widthResizedByUser: false`.
- **Target 2:** `src/components/viewport/PageCanvas.tsx` (`renderElement` for `text-edit` / `text-add` at `L686–L772`).
  - Replace the hardcoded `topOffsetPx = -Math.max(0, (el.lineHeight - 1) * 0.35) * scaledFontSize` (`L719`) with the exact `topOffsetPt * zoom` computed from `el.baselineOffset` via `calibrateDomTextMetrics`.
  - Replace CSS `fontStretch` (`L702–L706`) with exact CSS `transform: el.horizontalScale && Math.abs(el.horizontalScale - 1) > 0.005 ? `scaleX(${el.horizontalScale})` : undefined`, `transformOrigin: 'left top'`, and `width: el.horizontalScale && Math.abs(el.horizontalScale - 1) > 0.005 ? `${100 / el.horizontalScale}%` : '100%'`.
- **Target 3:** `src/components/viewport/InlineTextEditor.tsx` (`L254–L286` and `L367–L391`).
  - Apply the exact same `topOffsetPx` and `scaleX(el.horizontalScale)` transform on the editable `<div contentEditable>` (`L367–L391`) with `padding: 0`, `border: 0`, `margin: 0`, `boxSizing: 'border-box'`, and `fontKerning: 'normal'` so there is **zero** visual jump when transitioning between static PDF canvas -> `InlineTextEditor` -> rendered `text-edit` DOM layer.

---

### PHASE 4: Export Line-Wrap Prevention & PDF `Tz` Scaling Engine — [x] COMPLETED
- **Verification Status:** `npx tsc --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `npm run build`, and `npm test` (8 files, 64 tests including single-line lock & Turkish `Tz` horizontal scaling operator verification in `richText.test.ts` and `pdfCompiler.test.ts`) all passed.

#### Step 4.1 — Track `renderedLineCount` & `widthResizedByUser` in Editor and Store [x]
- **Target 1:** `src/types/elements.ts` (`TextEditElement` at `L56–L82`, `TextAddElement` at `L84–L105`).
  - Add `renderedLineCount?: number` and `widthResizedByUser?: boolean`.
- **Target 2:** `src/components/viewport/SelectionOverlay.tsx` (`handleResizeStart` at `L120–L192`).
  - When resizing a `text-edit` or `text-add` element via handles containing `'e'` or `'w'`, include `widthResizedByUser: true` in the `updateElement` payload.
- **Target 3:** `src/components/viewport/InlineTextEditor.tsx` (`syncLayoutMetrics` at `L94–L124` and `finishEditing` at `L142–L158`).
  - Compute the actual rendered line count in the DOM editor:
    ```ts
    const lineStepPx = Math.max(1, el.fontSize * zoom * el.lineHeight)
    const contentHeightPx = Math.max(lineStepPx, node.scrollHeight)
    const renderedLineCount = Math.max(1, Math.round(contentHeightPx / lineStepPx))
    ```
  - Pass `renderedLineCount` in `updateElement(el.id, { ..., renderedLineCount }, false)`.

#### Step 4.2 — Export Wrapping Tolerance & Single-Line Lock in `src/engine/richText.ts` and `src/engine/pdfCompiler.ts` [x]
- **Target 1:** `src/engine/richText.ts` (`buildWrappedRichLines` at `L126–L278`).
  - Add an optional parameter `options?: { disableSoftWrap?: boolean; widthToleranceRatio?: number; widthTolerancePt?: number }`.
  - When `options?.disableSoftWrap === true`, only break lines on explicit `\n` newline tokens (never soft-wrap words onto a new line).
  - Otherwise, compute `const safeMaxWidth = Math.max(1, maxWidth * (1 + (options?.widthToleranceRatio ?? 0.025)) + (options?.widthTolerancePt ?? 2.0))` and test line overflow using trimmed trailing-space width (`currentLineWidthWithoutTrailingWhitespace + pieceWidth > safeMaxWidth`).
- **Target 2:** `src/engine/pdfCompiler.ts` (`drawTextElementOnPage` at `L592–L708`).
  - Import `PDFNumber`, `PDFOperator`, `pushGraphicsState`, `popGraphicsState` from `'pdf-lib'`.
  - Determine `isSingleLine`:
    ```ts
    const explicitLineCount = el.content.split('\n').length
    const isSingleLine =
      explicitLineCount === 1 &&
      (el.renderedLineCount === 1 ||
        (el.renderedLineCount === undefined &&
          !el.widthResizedByUser &&
          el.height < el.fontSize * el.lineHeight * 1.65))
    ```
  - Call `buildWrappedRichLines` with `{ disableSoftWrap: isSingleLine, widthToleranceRatio: 0.025, widthTolerancePt: 2.0 }`.
  - When drawing each line in `wrappedLines`:
    Let `baseHScale = el.horizontalScale ?? 1`.
    Measure `scaledLineWidth = line.width * baseHScale`.
    Compute `fitScale = scaledLineWidth > el.width + 0.5 ? Math.max(0.88, el.width / scaledLineWidth) : 1`.
    Let `effectiveHScale = baseHScale * fitScale`.
    If `Math.abs(effectiveHScale - 1) > 0.005`:
    Emit `pushGraphicsState()` and `PDFOperator.of('Tz' as any, [PDFNumber.of(Number((effectiveHScale * 100).toFixed(2)))])` before drawing the line's segments, scale each segment's horizontal advance offset by `effectiveHScale`, and emit `popGraphicsState()` after the line completes.

---

### PHASE 5: Proactive Audit Fixes (Turkish Diacritics, High-DPI Canvas Cap, Mobile Sheet Collision & Undo/Redo Integrity) — [x] COMPLETED
- **Verification Status:** `npx tsc --noEmit`, `tsc -p tsconfig.node.json --noEmit`, `npm run build`, and `npm test` (8 files, 67 tests including `I\u0307 -> İ` NFC/export test, `computeCappedCanvasDpr` `<= 12.5M` pixel area test, and mid-edit `undo()`/`redo()` transaction flush test) all passed.

#### Step 5.1 — Fix Turkish Combining Dot (`I\u0307` -> `İ`) in `src/engine/fonts.ts` [x]
- **Target:** `normalizeUnicodeForPdf` (`src/engine/fonts.ts:L523–L535`).
- **Action:** Before `.normalize('NFC')`, explicitly recompose Turkish dotted/dotless combining sequences that standard Unicode `NFC` leaves decomposed or mis-maps:
  ```ts
  export function normalizeUnicodeForPdf(text: string): string {
    return text
      .replace(/I\u0307/g, '\u0130') // Capital I + combining dot above -> Turkish İ
      .replace(/i\u0307/g, 'i')      // Lowercase i + redundant combining dot -> i
      .normalize('NFC')
      // ... existing replacements
  ```

#### Step 5.2 — Guard High-DPI Canvas Pixel Area on Mobile Pinch (`300%–500%`) in `src/engine/pdfjsService.ts` [x]
- **Target:** `renderPageToCanvas` (`src/engine/pdfjsService.ts:L98–L135`).
- **Action:** Add a maximum canvas pixel budget (`MAX_CANVAS_PIXELS = 12_582_912`, safely below iOS WebKit's `16,777,216` limit):
  ```ts
  const rawPixelArea = cssViewport.width * dpr * (cssViewport.height * dpr)
  const safeDpr = rawPixelArea > 12_582_912
    ? Math.max(1, Math.sqrt(12_582_912 / Math.max(1, cssViewport.width * cssViewport.height)))
    : dpr
  const pixelViewport = page.getViewport({ scale: zoom * safeDpr, rotation })
  ```
  And use `Math.round` consistently on both `canvas.width`/`height` and `style.width`/`style.height` to prevent sub-pixel aspect-ratio stretch.

#### Step 5.3 — Hide Mobile Inspector Sheet Bar While Inline Text Editing is Active (`src/components/mobile/MobileInspectorSheet.tsx`) [x]
- **Target:** `MobileInspectorSheet.tsx` (`L20–L45`).
- **Action:** Read `editingTextElementId` from `useEditorStore`. When `editingTextElementId !== null` and `!expanded`, return `null` so the collapsed inspector bar does not stack on top of the mobile virtual keyboard and steal vertical viewport space during inline text editing.

#### Step 5.4 — Flush Active Inline Edit Before `undo()` / `redo()` in `src/store/useEditorStore.ts` [x]
- **Target:** `undo` and `redo` (`src/store/useEditorStore.ts:L1697–L1747`) and `InlineTextEditor.tsx` (`L142–L158`).
- **Action:** In `undo()` and `redo()`, if `state.transactionBaseline` is non-null (meaning an inline edit session was open when the user triggered Undo/Redo), commit the open `transactionBaseline` onto `undoStack` first (when `editingTextElementId !== null`) before popping the undo stack, and always set `editingTextElementId: null` so `InlineTextEditor` cleanly unmounts without overwriting the restored snapshot on blur.

---

## 4. Verification & Acceptance Checklist

Gemini Hydrogen must verify all items below before marking execution complete:

1. **TypeScript & Production Build Verification:**
   - Run `npm run build` (`tsc -b && vite build`) — must pass with **0 TypeScript or Vite errors**.
   - Run `npm run test` (Vitest unit suite) — must pass with **0 failures**.

2. **Requirement 1 — Mobile Pinch-to-Zoom & 4-Edge Panning Acceptance:**
   - At `300%` and `500%` zoom on a mobile viewport (`390×844`), `scrollLeft` can pan all the way to the extreme **left edge** (`pageOffsetLeft >= 48px` visible margin) and **right edge**, and `scrollTop` can pan past both the **top edge** and **bottom edge** above the mobile bottom dock.
   - Pinching around an arbitrary focal point $(M_x, M_y)$ keeps the exact PDF word under the midpoint stationary within `< 2px` drift across continuous zoom-in / zoom-out frames.
   - Placing 1 finger on a selected element and touching down a 2nd finger immediately cancels the 1-finger element drag (`abortTransaction()`), leaves the element at its original coordinates, and transitions smoothly into two-finger pinch/pan.

3. **Requirement 2 — Background Image Isolation & Text-First Selection Acceptance:**
   - On a PDF page containing a full-page background scan/photo (`>= 65%` page area) or decorative header image behind text, single-tapping or clicking any text line (or within `6px` of a text box on coarse touch pointers) selects and opens the text block for editing **100% of the time** without promoting or selecting the background image.
   - Even after a background image has been promoted to an `ImageReplacementElement`, clicking any text over it selects/edits the text rather than getting trapped by `SelectionOverlay` (`zIndex: 500`).
   - Activating the `"Arka Planı Seç"` (`selectBackgroundMode`) toggle or holding `Alt + Click` allows selecting, moving, or locking (`locked: true`) the background image directly.

4. **Requirement 3 — Click-to-Edit Typography Parity & Single-Line Export Acceptance:**
   - Clicking an existing PDF text block to enter `InlineTextEditor` exhibits **zero perceptible font-size jump** (no `0.5pt` rounding snap), **zero vertical baseline jump** (`<= 0.5px` delta via `baselineOffset` calibration), and matches the horizontal line width of the underlying PDF text via `calibrateDomTextMetrics`.
   - Exporting a PDF after editing a single-line text block (`renderedLineCount === 1`, no `\n`) **never** wraps the text onto a second line in the exported PDF, even when the embedded export font has `1%–3%` wider glyph advance widths (`Tz` operator scales horizontal width cleanly inside `el.width`).

5. **Requirement 4 — Turkish Character & High-DPI Canvas Acceptance:**
   - Turkish characters (`ğ, ü, ş, ı, İ, ö, ç`, including decomposed `I\u0307`) render and export cleanly in `pdf-lib` + `fontkit` without missing dots or `.notdef` boxes.
   - Zooming to `500%` on a Retina (`devicePixelRatio: 2` or `3`) viewport dynamically caps canvas pixel area at `<= 12.5M` pixels, preventing blank WebKit canvas crashes.

### Final Acceptance Verification Status [x]
- **`npm run build` (`tsc --noEmit && tsc -p tsconfig.node.json --noEmit && vite build`):** Passed cleanly with 0 TypeScript/Vite errors (65 PWA precache entries, Wasm + worker bundles resolved).
- **`npm test` (`vitest run`):** 8 test files passed, 67/67 unit tests passed (`pageRange.test.ts`, `coordinates.test.ts`, `richText.test.ts`, `store.test.ts`, `snapGuides.test.ts`, `textExtractor.test.ts`, `upgradeFeatures.test.ts`, `pdfCompiler.test.ts`).
- **`npx playwright test`:** 13/13 E2E tests passed across `e2e/mobile-pwa.spec.ts` (4/4 including `375x812`, `390x844`, `768x1024`, and `/pdfEditor/` GitHub Pages subpath), `e2e/pdf-editor.spec.ts` (7/7), and `e2e/refinement-acceptance.spec.ts` (2/2 verifying mobile `390x844` 300%/500% 4-edge panning, `< 2px` pinch focal drift, 2nd-finger drag abort, collapsed inspector auto-hide, background isolation `>= 65%`, layer lock, `10.62pt` sub-pixel parity, and single-line Turkish export `Tz` + `İ`).
