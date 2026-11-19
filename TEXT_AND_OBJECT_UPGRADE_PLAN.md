# gullacpdf Native Kotlin — Text Fidelity, Embedded Font Extraction & PDF Object Detection Upgrade Plan

## Root-Cause Audit

1. **Embedded Boxes & Images Not Selectable (`analysis.images` / `analysis.shapes` ignored on tap)**
   - `gp-pdf-pdfium/src/objects.rs` (`analyze_page_objects_with_pdfium`) populates `images` and `shapes`, and Android `GpPageAnalysis` parses them, but `PdfViewport.kt` (`handleSingleTapAt`) only hit-tests `analysis.textBlocks`.
   - `objects.rs` did not recurse into `PdfPageObject::XObjectForm`, dropped Bezier control points on curved shapes, and returned `rgba: None` on `DetectedImageObject` without an on-demand JNI bitmap extractor for creating editable `imageReplacement` overlays.

2. **Wrong/Inflated Extracted Font Size & Missing Embedded Font Extraction + Warning**
   - `gp-pdf-pdfium/src/objects.rs` called `ch.unscaled_font_size()` instead of `ch.scaled_font_size()` (ignoring PDF `Tm` / `CTM` transform matrices), causing scaled PDFs (`24 Tf` * `0.4 scale` -> visually `9.6pt`) to extract at huge point sizes.
   - `extract_embedded_fonts_with_lopdf` already exists in `gp-redact/src/pdf_ops.rs` (`ttf-parser` inspection + `/FontFile2` extraction + `unicode_usable` subset validation), but was not wired through `gp-jni` to Android's font cache, `Typeface` loader, or missing/subset warning UI.
   - Android `OverlayCanvasPainter` mapped `"DejaVuSans"` to system `Roboto` instead of bundled `assets/fonts/DejaVu*.ttf` / extracted PDF TTFs and left `StaticLayout` `includeFontPadding = true`.

3. **Clicked Text Flickering / Disappearing & Reappearing During Zoom**
   - When `rebuildCleanPreviewForPage` swaps `cleanPreviewDocIds[page.id]` to a new doc ID, cached preview/bucket tiles for the previous ID were cleared before the new clean doc rendered tiles, while pinch-zoom canceled in-flight buckets.
   - `OverlayCanvasPainter` rebuilt `StaticLayout` synchronously on every zoom frame using changing fractional `textPaint.textSize = fontSize * scalePxPerPt`, causing Skia/HWUI glyph cache churn at deep zoom.

4. **Clicked Text Shifting & Losing Alignment (Justify / Right / Center) While Zooming**
   - `PdfSessionViewModel.editPdfTextBlock` omitted `align`, `letterSpacing`, `horizontalScale`, and rich `runs`, resetting aligned/justified paragraphs back to `"left"`.
   - `GpDetectedTextBlock` did not parse `align`, `rawFontName`, `originalFontName`, `fallbackFontFamily`, `fontSource`, `isCustomFont`, `horizontalScale`, `letterSpacing`, or `runs` from `analyze_page_objects_with_pdfium`.
   - `objects.rs` left `max_word_space = None` so `gp-text`'s `detect_paragraph_alignment` missed justified lines with wide word spacing.
   - `OverlayCanvasPainter` laid out `StaticLayout` with truncated integer `widthPx = rect.width().toInt()` without `LINEAR_TEXT_FLAG | SUBPIXEL_TEXT_FLAG` or `JUSTIFICATION_MODE_INTER_WORD`, causing continuous word-wrap reflow across zoom levels.
   - Rendering text once in constant reference PDF-point space (`REF_TEXT_SCALE = 8f` with `LINEAR_TEXT_FLAG | SUBPIXEL_TEXT_FLAG`, cached in LRU, drawn via `nc.scale(scalePxPerPt / 8f, scalePxPerPt / 8f)`) guarantees zero layout shift across all zoom levels.

5. **Primitive Quick Text Controls & Missing Rich Text / Export Support**
   - `CollapsibleBottomTextPanel` (opened when tapping the collapsed `^ Text` pill) lacks immediate Alignment (`Left`, `Center`, `Right`, `Justify`), Rich Style (`Underline`, `Strikethrough`, `Subscript x_2`, `Superscript x^2`), Font family/warning status, fine `0.5pt` size steps, Line Height, and Letter Spacing.
   - `gp-model` + `gp-pdf-pdfium/src/compile.rs` need full fidelity support for `underline`, `strikethrough`, inline/block `Sub`/`Super` script runs, `TextAlign::Justify` word spacing, `letter_spacing`, `horizontal_scale`, and extracted per-font TTF embedding.

---

## Execution Phases

- **Phase 1 (Rust Core & `gp-jni`):**
  1. Extend `gp-model` (`underline`, `strikethrough`, `script`, embedded font metadata) and `gp-pdf` / `gp-pdf-pdfium`:
     - Accurate `ch.scaled_font_size()` + CTM matrix scale + `max_word_space` + PDFium embedded/subset check (`FPDFFont_GetIsEmbedded`) + recursive `XObjectForm` object/image/shape detection + curved SVG paths (`C` bezier).
     - `compile.rs`: support embedded TTF map, `TextAlign::Justify`, mixed inline `TextRun`s (`sub`/`super`/bold/italic), `underline`, `strikethrough`, `letter_spacing`, `horizontal_scale`.
  2. Extend `core/bindings/jni/src/lib.rs`:
     - `nativeExtractEmbeddedFonts(docId)` -> returns font metadata JSON + raw TTF binary array per font ID.
     - `nativeExtractPageImagePng(docId, pageIndex, imageId)` -> returns decoded RGBA dimensions + bytes for any embedded PDF image object.
     - Extend `nativeCompileAndSaveVerified` to accept extracted embedded font byte payloads (`fontKeys`, `fontBytesArray`).

- **Phase 2 (Android Models, Bridge & Engine State):**
  1. Update `GpModels.kt`: rich `GpTextRun`, `underline`, `strikethrough`, `scriptMode`, `letterSpacing`, `horizontalScale`, `embeddedFontId`, `fontWarning`, full `GpDetectedTextBlock` parsing (`align`, `runs`, font provenance, warning state), and `GpExtractedFont`.
  2. Update `NativePdfBridge.kt` & `PdfSessionViewModel.kt`: extract & cache embedded fonts on document open, preserve alignment/scale/spacing/font provenance/warnings on `editPdfTextBlock`, pre-seed clean preview tiles before swapping `cleanPreviewDocIds`, add `editPdfImageObject` & `editPdfShapeObject`, and pass extracted TTF bytes during compile/export.

- **Phase 3 (Viewport Hit-Testing & Zoom-Invariant Rich Canvas Renderer):**
  1. `PdfViewport.kt`: smart smallest-box/foreground tap hit-testing for `analysis.textBlocks`, `analysis.images`, and `analysis.shapes`; support box/image replacement in Edit mode.
  2. `OverlayCanvasPainter.kt`: `TypefaceCache` (loading extracted TTFs + bundled `assets/fonts/DejaVu*.ttf`), cached fixed-scale (`REF_TEXT_SCALE = 8f`) `StaticLayout` with `LINEAR_TEXT_FLAG | SUBPIXEL_TEXT_FLAG`, `JUSTIFICATION_MODE_INTER_WORD`, `SpannableStringBuilder` (`sub`/`super`/`underline`/`strike`/inline bold/italic runs), `letterSpacing`, and `horizontalScale`.

- **Phase 4 (Comprehensive Quick Text Drawer & Inspector UI):**
  1. Upgrade EN/TR i18n tokens (`design-tokens/i18n.json` -> `generate.mjs`) with alignment, subscript, superscript, underline, strikethrough, letter spacing, horizontal scale, and embedded font warning/status copy.
  2. Upgrade `CollapsibleBottomTextPanel` (still defaulting collapsed to compact `^ Text` pill!) so when expanded, the first small panel provides Alignment (`L/C/R/J`), `B/I/U/S/Sub/Sup`, selection-aware inline run toggling, Font chips + Embedded Warning indicator, `-0.5/+0.5pt` precision size stepper, Text/Background Color pickers, and quick Line Height / Letter Spacing sliders.
  3. Upgrade `ElementInspectorSheet` for full typography + `shapeReplacement` / `imageReplacement` editing.

- **Phase 5 (JNI Build, Unit Tests, APK Build & Live Emulator Verification):**
  1. Run Rust tests (`cargo test --manifest-path core/Cargo.toml`), rebuild Android `.so`s (`scripts/build-android-jni.ps1`).
  2. Expand Kotlin JVM unit tests and run `./gradlew.bat testDebugUnitTest assembleDebug assembleRelease`.
  3. Verify live on `Medium_Phone_API_35` emulator with a PDF containing scaled fonts, justified text, an embedded box/shape, and an embedded image.
