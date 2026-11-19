# NATIVE_KOTLIN_PLAN.md — gullacpdf Native Android (Kotlin) Rewrite Plan

## 1. Executive Summary & Architectural Vision

**gullacpdf** will be rewritten as a 100% pure **Native Android** application in **Kotlin** using **Jetpack Compose**, **Material 3**, and a **Hardware-Accelerated Canvas / Custom Viewport**, while keeping our existing battle-tested **Rust + PDFium core engine** (`core/crates/*`) completely intact.

### Why Native Kotlin + Preserved Rust Core (`gp-jni`)
- **Zero Framework Overhead:** Replaces the Flutter/Dart isolate + Flutter Rust Bridge (`gp-frb`) + Skia/Impeller abstraction with direct **Kotlin -> JNI (`libgp_jni.so`) -> Single-Thread Priority PDFium Actor -> `ByteBuffer` -> `android.graphics.Bitmap` (`Canvas`)**.
- **True 60–120fps Hardware-Accelerated Interactions:** Raw Android `MotionEvent` / Compose pointer velocity handling drives pan, inertia, pinch-to-zoom, Adobe-style one-handed zoom, shape creation, polyline vertex chaining, and resize/rotation handle dragging directly without Riverpod/widget-tree rebuild storms.
- **Core PDF Engine Preserved 100%:** Reuses `gp-model`, `gp-geom`, `gp-text`, `gp-pdf`, `gp-engine`, `gp-redact`, and `gp-pdf-pdfium` intact — preserving lossless content-stream text replacement, D3 verified redaction, DejaVu Turkish UTF-8 (`ğ, ü, ş, ı, İ, ö, ç`) embedding, vector shapes/paths, signatures, image crop/flip, page numbering, and atomic verified PDF saving.
- **Zero-AGPL & Scoped Storage Compliance:** Zero MuPDF dependencies; zero `READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE` / `MANAGE_EXTERNAL_STORAGE` / `INTERNET` permissions. All file workflows use Android SAF (`ACTION_OPEN_DOCUMENT`, `ACTION_CREATE_DOCUMENT`), `FileProvider`, and Android `PrintManager`.

---

## 2. Target Repository & Module Structure

```
pdfEditor/
├── core/
│   ├── Cargo.toml                     # Add bindings/jni workspace member
│   ├── crates/                        # Existing core crates (preserved intact)
│   └── bindings/
│       └── jni/                       # NEW: Pure Rust JNI bridge (libgp_jni.so)
│           ├── Cargo.toml             # Zero new crates.io dependencies (uses standard JNI C-ABI)
│           └── src/
│               ├── lib.rs             # JNI entrypoints for NativePdfBridge
│               ├── jni_sys.rs         # Minimal safe JNIEnv/JavaVM/DirectBuffer bindings
│               └── actor.rs           # Reused priority PDFium actor (VisibleTile preempts all)
├── design-tokens/
│   ├── tokens.json                    # Source of truth (Light / Dark / Sepia / Spacing / Typography)
│   ├── i18n.json                      # Source of truth (EN / TR)
│   └── generate.mjs                   # Extended to also generate GpTokens.kt & GpStrings.kt
├── android/                           # NEW: Standalone Native Kotlin + Jetpack Compose Gradle project
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   ├── gradle.properties
│   ├── gradle/wrapper/                # Gradle 8.5 wrapper
│   └── app/
│       ├── build.gradle.kts           # minSdk=26, targetSdk=35, Compose + Material3 + Splashscreen
│       └── src/main/
│           ├── AndroidManifest.xml    # VIEW / SEND / SEND_MULTIPLE PDF intents, FileProvider
│           ├── assets/fonts/          # Bundled DejaVuSans*.ttf, DejaVuSerif.ttf, DejaVuSansMono.ttf
│           ├── jniLibs/               # arm64-v8a, armeabi-v7a, x86_64 (libgp_jni.so + libpdfium.so)
│           ├── res/
│           │   ├── drawable/          # ic_launcher_foreground/background/monochrome + ic_brand_splash + UI vectors
│           │   ├── mipmap-anydpi-v26/ # ic_launcher.xml + ic_launcher_round.xml
│           │   ├── mipmap-*/          # Fallback PNG launcher icons generated from public/favicon.svg
│           │   ├── values/            # themes.xml, strings.xml
│           │   └── xml/file_paths.xml # FileProvider cache/exports paths
│           └── kotlin/dev/gullacpdf/android/
│               ├── GullacApplication.kt
│               ├── MainActivity.kt
│               ├── data/              # FileBridge, PreferencesStore, RecentDocs, SignatureVault
│               ├── engine/            # NativePdfBridge (JNI), PdfEngineRepository, TileBitmapCache
│               ├── model/             # GpModels, GpCommands (Undo/Redo), GpPageAnalysis, GpTokens/Strings
│               ├── ui/
│               │   ├── theme/         # Compose Material3 theme + GpTheme (Light, Dark, Sepia)
│               │   ├── components/    # GullacBrandMark, GpColorPicker (HSV + Swatches + Transparent)
│               │   ├── library/       # LibraryScreen (Recent docs, Open, Blank PDF, Default App hint)
│               │   ├── viewport/      # Clipped PdfViewport, GestureEngine, OverlayCanvasPainter
│               │   ├── viewer/        # ViewerTopBar, SearchStrip, NavigatorSheet, PageTextSheet, SaveSheet
│               │   ├── editor/        # EditorTopBar, ToolDock (+ToolLock), ShapeStrip, CollapsibleTextBar, InspectorSheet
│               │   ├── signature/     # SignatureStudioSheet (Draw/WetInk, Type, Upload+BgRemoval, Vault, GhostPlace)
│               │   └── organizer/     # PageOrganizerSheet, PageNumberingSheet
│               └── viewmodel/         # PdfSessionViewModel (StateFlow + Undo/Redo + Autosave + Search)
└── scripts/
    └── build-android-native.ps1       # Builds libgp_jni.so for ABIs + generates icons + runs Gradle build
```

---

## 3. Branding, Adaptive App Icon & Splash Screen

1. **Exact SVG Emblem Fidelity:**
   - Port `public/favicon.svg` and `src/components/BrandLogo.tsx` (`mark` & `mono` variants) into Android Vector Drawables:
     - `drawable/ic_launcher_background.xml`: Deep midnight-blue radial/linear backdrop (`#0F172A` -> `#1E293B`) so the translucent layered pages pop cleanly on light and dark home screens.
     - `drawable/ic_launcher_foreground.xml`: All 3 rotated page layers (`gullac_back`, `gullac_mid`, `gullac_front`), top-right dog-ear fold (`gullac_fold`), white negative-space `"G"` editing stroke, and cyan bounding-box selection handle dot (`#38BDF8`), precisely centered inside Android's `66dp` adaptive icon safe-zone within the `108dp` viewport.
     - `drawable/ic_launcher_monochrome.xml`: Android 13+ themed icon silhouette from `BrandLogo` `mono` SVG.
     - `mipmap-anydpi-v26/ic_launcher.xml` & `ic_launcher_round.xml`.
     - Raster PNG fallbacks in `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}`.
2. **Splash Screen (`androidx.core:core-splashscreen`):**
   - `Theme.GullacPdf.Splash` using `windowSplashScreenAnimatedIcon = @drawable/ic_brand_splash` and matching dark/light surface background, transitioning seamlessly into `MainActivity`.
3. **In-App Brand Mark:**
   - `GullacBrandMark` Jetpack Compose Canvas/Vector component rendering the exact 3-layer SVG emblem in `LibraryScreen` TopAppBar and about/empty states.

---

## 4. Mandatory Bug Fixes & Interaction Upgrades (Exact Engineering Solutions)

### Fix 1: Strict Header / Viewport Clipping
- **Problem:** In the previous app, scrolled PDF pages painted outside their layout bounds over the top AppBar, document title, and search bar.
- **Native Kotlin Guarantee:**
  - Root workspace uses `Column(modifier = Modifier.fillMaxSize())`:
    - Top bar (`ViewerTopBar` / `EditorTopBar`) and `AnimatedVisibility` `SearchStrip` occupy fixed top slots with `zIndex(10f)` and solid `surfaceRaised` backgrounds.
    - Viewport occupies `Box(modifier = Modifier.weight(1f).fillMaxWidth().clipToBounds())`.
    - Inside the Canvas `drawBehind` / `Canvas`, wrap all tile & overlay draw calls inside `clipRect(left = 0f, top = 0f, right = size.width, bottom = size.height) { ... }`.
  - **Result:** It is physically impossible for PDF tiles, page shadows, or selected element handles to paint over the AppBar, document title, or search bar.

### Fix 2: Sharp High-DPI Zoom & Focal-Point Stability
- **Problem:**
  1. High zoom appeared blurry because `frb` clamped render scale at `8.0` (`dpr=3.0` capped crisp zoom at ~2.66x!) and failed to schedule/invalidate high-res tiles promptly on zoom changes.
  2. Pinch zoom shifted/jumped downward because `scrollOffset * ratio` assumed fixed `16dp` page gaps and centered page margins scaled linearly with zoom, then clamped inconsistently.
- **Native Kotlin Solution:**
  - **Zero-Drift Page-Anchored Focal Math (`ViewportLayoutEngine`):**
    - On gesture start (pinch or double-tap-drag), capture the focal screen point `F0 = (fx0, fy0)` and resolve the anchor `(anchorPageIndex, anchorPdfPt)` in the focal page's unscaled PDF point space (using the nearest page if tapping in a gap).
    - On every frame as zoom updates to `nextZoom` (clamped `[minZoom, maxZoom]` where `maxZoom = 8.0f`) and midpoint shifts to `F = (fx, fy)`:
      - Recompute `newPageRect = computePageRect(anchorPageIndex, nextZoom, viewportWidth)`.
      - Compute `targetScrollX = newPageRect.left + anchorPdfPt.x * nextZoom - fx` and `targetScrollY = newPageRect.top + anchorPdfPt.y * nextZoom - fy`.
      - Clamp cleanly to `[0f, maxScrollX]` and `[0f, maxScrollY]` where `maxScrollX = max(0f, maxPageRight + pad - viewportWidth)` and `maxScrollY = max(0f, totalContentHeight - viewportHeight)`.
    - Because `targetScroll` is derived directly from the true `newPageRect` position at `nextZoom` (including fixed gaps and centering transitions), **there is zero downward jump and 0.0px focal drift at all zoom levels**.
  - **Sharp High-DPI Progressive Tiling (`TileScheduler` + `NativePdfBridge`):**
    - Allow `gp_jni` tile render `scale` up to `24.0` (physical pixels per PDF point, supporting `8.0x` zoom at `3.0x` screen density!).
    - Quantize tile render buckets smoothly (e.g. `fitWidth`, `1.0`, `1.25`, `1.5`, `2.0`, `2.5`, `3.0`, `4.0`, `5.0`, `6.0`, `8.0` physical-DPI aware) into `384x384` (or `512x512`) physical pixel tiles.
    - While actively pinching/dragging: draw cached tiles scaled cleanly with bilinear filtering at 60–120fps.
    - Immediately when zoom bucket shifts during slow zoom OR within `40ms` of gesture settle (`ACTION_UP` / inertia idle): cancel stale zoom scopes (`nativeCancelRenderScope`), compute ONLY visible viewport tile coordinates at the high-DPI `tileZoom * density` scale, render via `NativePdfBridge` into pooled direct `ByteBuffer` -> `Bitmap`, store in LRU `TileBitmapCache` (with `preview` + active sharp bucket), and swap onto the Canvas so text and vectors stay razor sharp at `800%` zoom.

### Fix 3: One-Handed Adobe-Style Zoom (Double-Tap + Hold & Drag Vertically)
- **Gesture State Machine (`PdfGestureController`):**
  - Track tap timing/position across single-finger pointer events:
    - When `ACTION_DOWN` occurs within `300ms` and `28dp` of the previous `ACTION_UP` tap: enter `PENDING_DOUBLE_TAP`.
    - If `pointerCount >= 2` arrives -> immediately transition to two-finger `PINCH_PAN`.
    - If finger moves `> touchSlop` vertically -> enter **`ADOBE_ONE_HANDED_ZOOM`** anchored at the initial double-tap focal point `anchorPos` (`anchorPageIndex`, `anchorPdfPt`):
      - Dragging **down** (`dy > 0`) increases zoom smoothly via exponential sensitivity: `nextZoom = startZoom * exp(dy / 220dp)`.
      - Dragging **up** (`dy < 0`) decreases zoom smoothly.
      - Display a subtle live zoom badge (`240%`) near the status pill; on finger lift, snap/schedule crisp high-DPI tiles!
    - If finger lifts *without* dragging past `touchSlop` -> trigger smooth animated Double-Tap Zoom toggle (`fitWidthZoom <-> clamp(fitWidthZoom * 2.4, 2.0, 3.5)`) centered at `tapPos`.

### Fix 4: Intentional Shape Drawing & Smooth 60–120fps Handle Dragging
- **Multi-Touch Shape Cancellation:**
  - Any time `pointerCount >= 2` (`ACTION_POINTER_DOWN`) occurs during `CREATE_SHAPE`, `DRAW_INK`, `HIGHLIGHT`, `REDACT`, or `MANIPULATE`:
    - Immediately cancel and discard the in-progress draft shape/stroke (never committing a partial shape or tap-fallback!).
    - Mark `gestureHadMultiTouch = true` and apply a `180ms` post-pinch cooldown on `ACTION_UP` so lifting fingers asynchronously never triggers a tap-created shape.
    - Transition immediately to two-finger `PINCH_PAN`.
- **Auto-Return to Select Mode + Tool-Lock Toggle:**
  - When a shape (rect, ellipse, triangle, diamond, arrow) is intentionally created (dragged `>= 10dp` OR deliberate isolated single-finger tap with `!gestureHadMultiTouch`):
    - Add the `OverlayElement` and mark it **selected** immediately so its 8 resize handles and top rotation stem handle appear right away.
    - If `toolLocked == false` (default), **automatically switch active tool back to `EditorTool.SELECT`**.
    - Include a visible **Tool Lock** toggle button in the Editor tool dock / shape strip so users who want to stamp multiple shapes consecutively can lock the active tool.
- **60–120fps Handle Dragging:**
  - Maintain transient `activeInteractionElement: OverlayElement?` inside the viewport's fast draw/pointer state (`mutableStateOf` read only inside `Canvas` draw scope — NOT triggering full `Scaffold` / `BottomBar` recomposition on every `ACTION_MOVE`!).
  - Generous `44dp` (`22dp` radius) touch hit zones for NW/N/NE/E/SE/S/SW resize handles, top rotation handle (with `±4°` snap to `0°/90°/180°/270°`), and selected element body move (with Rust `computeSnapGuidePosition` alignment guides).
  - Commit final geometry to `UndoStack` once on `ACTION_UP`.

### Fix 5: Point-to-Point Polyline & Vertex Chaining
- **Step-by-Step Vertex Placement in `Line` Mode:**
  - When `EditorTool.LINE` is active:
    - **Tap 1 (`P0`):** Places the starting vertex anchor dot (`P0`) on the page and displays a compact floating polyline HUD (`"1 pt — Tap next point"` with `Undo Pt`, `Close`, `Done`, `Cancel`).
    - **Tap 2 (`P1`):** Creates/commits the `VectorPath` (`kind = "path"`, `smooth = false`) with vertices `[P0, P1]`, drawing the first crisp segment on the PDF.
    - **Tap 3+ (`P2, P3, ...`):** Appends connected vertices `[P0, P1, P2, ...]` to the active polyline in real time!
    - Also supports direct **Tap-and-Drag** on `Tap 1` if the user prefers dragging a single segment (`P0 -> P_up`), while still letting them tap additional points or tap `Done` to finish.
    - Tapping near the start vertex `P0` when `vertices.size >= 3` snaps magnetically (`18dp` radius) to close the polygon cleanly if confirmed or auto-closed!
- **Vertex Chaining from Existing Line Endpoints / Corners:**
  - While in `Line` mode (with no active draft in progress), all endpoints and corner vertices of existing `VectorPath` lines on visible pages render subtle snap rings.
  - Tapping within `22dp` of an existing open line's **end vertex (`last`)** resumes chaining directly by appending new vertices onto that existing line!
  - Tapping within `22dp` of an existing open line's **start vertex (`first`)** reverses internal vertex ordering seamlessly and appends new vertices from that start endpoint!
  - Tapping within `22dp` of an **interior corner vertex** (or closed shape vertex) snaps onto that exact vertex coordinate and starts a connected branch segment from that vertex!
  - Selecting any polyline in `Select` mode also displays draggable vertex handles so any corner/endpoint can be repositioned smoothly at 60–120fps.

### Fix 6: Collapsible Bottom Text Panel
- **Collapsed by Default:**
  - When a `TextAdd` or `TextEdit` element is created or selected, the large text input drawer is **hidden by default**.
  - Instead, only a compact, unobtrusive **upward-pointing chevron/arrow tab (`^`)** (with subtle pill styling matching the current theme) sits cleanly at the bottom above the editor dock (leaving >90% of the PDF visible).
  - **Expand on Tap:** Tapping the `^` pill smoothly animates open the full bottom text input & quick-formatting drawer (`OutlinedTextField` with full IME / Turkish keyboard support, font family chip row, font size `-/+`, Bold/Italic/Align, Text Color, **Background Color** picker, `"More Style"` inspector button, and downward collapse chevron `v`).
  - Double-tapping a text box directly on the canvas also expands the text editor drawer immediately for rapid inline editing.

---

## 5. Polished Mobile UI & Full Feature Scope

1. **Glitch-Free Color Pickers (Foreground, Stroke, Fill, Background, Highlight, Signature, Page Numbers):**
   - Reusable `GpColorPickerRow` + expandable `GpColorPickerDialog` / sheet panel:
     - **"None / Transparent"** option (crossed circle / checkerboard swatch) for Text Background Color and Shape Fill Color.
     - Curated high-contrast swatches (Slate, Navy, Royal Blue, Sky, Emerald, Amber, Crimson, Violet, Yellow, White).
     - **Interactive HSV Saturation-Value Square + Hue Bar + Alpha Slider + Hex `#RRGGBB` input**, built with isolated `pointerInput` so dragging never fights bottom-sheet scroll gestures or flickers!
2. **Complete App Flows:**
   - **Library Screen:** Official `GullacBrandMark`, `Open PDF`, `Start Blank PDF`, `Set as Default PDF App` shortcut, `Recent Documents` list, Language switcher (`EN` / `TR`), Theme switcher (`Light` / `Dark` / `Sepia`), Autosave recovery banner.
   - **Viewer Mode:** Clipped high-DPI tiled viewport, floating `Page/Zoom` status pill (tap to reset to Fit-Width), `Edit` FAB, TopBar with Back, Navigator (Thumbnails + Outline/Bookmarks bottom sheet), Streaming Turkish-folded Search bar (`prev`/`next`/match highlights), Copy Page Text sheet, Share (`FileProvider`), Print (`PrintManager`), Save Workflow (`Save as Copy` / `Overwrite Original` with confirmation), Settings sheet (Language, Theme, Invert White PDF Pages in Dark mode, Left-Handed layout), Password prompt dialog, Clickable PDF URI & GoTo links.
   - **Editor Mode:**
     - **Tools:** Select, Text (in-place PDF text block detection via `analyzePageObjects` + clean stream-stripped preview via `prepareCleanPagePreview` + new text box), Draw (freehand ink), Eraser, Highlight, Signature/Paraf Studio (Draw with **"Orijinal Görünümlü"** velocity-sensitive wet ink / Type / Upload photo with automatic white-paper background removal / Local Vault / Tap-to-Place ghost preview), Shape (`rect`, `ellipse`, `triangle`, `diamond`, `arrow`), Line (point-to-point polyline + vertex chaining), Image (insert PNG/JPG/WebP, crop, flip H/V, opacity, behind-content, repeat across pages), Redact (verified content-stream redaction), and Pages Organizer (thumbnails grid, multi-select batch rotate/delete/split-extract, single rotate CW/CCW/180, move/reorder, duplicate, insert blank, merge external PDF preserving edits, dynamic Page Numbering).
     - **Tool-Lock toggle** right in the Editor dock, plus Undo / Redo history (`GpCommand` stack) and Save.

---

## 6. Execution Phases & Verification Gates

1. **Phase 1 — Rust Core JNI Bridge (`core/bindings/jni`) & Token Codegen**
   - Implement `core/bindings/jni` (`jni_sys.rs`, `actor.rs`, `lib.rs`), register in `core/Cargo.toml`, run `cargo test --manifest-path core/Cargo.toml`.
   - Cross-compile `libgp_jni.so` for `arm64-v8a`, `armeabi-v7a`, and `x86_64` using Android NDK clang into `android/app/src/main/jniLibs/<abi>/` alongside `libpdfium.so`.
   - Update `design-tokens/generate.mjs` to generate `GpTokens.kt` and `GpStrings.kt`.
2. **Phase 2 — Native Android Gradle Project, Branding, Adaptive Icon & Splash**
   - Scaffold `android/` (Gradle Kotlin DSL, Jetpack Compose, Material 3, Coroutines, Core Splashscreen).
   - Generate `ic_launcher` adaptive icons (`foreground`, `background`, `monochrome`, `mipmap-*` PNG fallbacks), `ic_brand_splash`, `AndroidManifest.xml` (zero AGPL/storage/internet permissions), `FileProvider`, and `assets/fonts/DejaVu*.ttf`.
3. **Phase 3 — JNI Bridge, Scoped Storage FileBridge & Session ViewModel**
   - Implement `NativePdfBridge.kt`, `PdfEngineRepository.kt`, `TileBitmapCache.kt`, `AndroidFileBridge.kt` (`VIEW`/`SEND`/`SEND_MULTIPLE`, SAF picker/save, `PrintManager`, `FileProvider` share), `PreferencesStore.kt`, and `PdfSessionViewModel.kt` (full `Undo/Redo`, autosave, multi-page commands).
4. **Phase 4 — Hardware-Accelerated Clipped Viewport & Gesture Engine**
   - Implement `PdfViewport.kt` with strict `clipToBounds` + `clipRect`, exact page-anchored focal math, `512x512` progressive high-DPI tile scheduling, Adobe one-handed vertical zoom (`Double-Tap + Hold & Drag`), multi-touch shape/stroke cancellation + cooldown, auto-return to Select (with Tool-Lock), 60–120fps handle dragging + snap guides, and point-to-point Polyline + Vertex Chaining.
5. **Phase 5 — Polished Compose UI, Collapsible Text Panel, Color Pickers & Modals**
   - Implement `LibraryScreen`, `ViewerScreen`, `EditorChrome` (with default-collapsed `^` Bottom Text Panel + expandable editor), `GpColorPicker` (swatches + transparent + HSV + hex), `ElementInspectorSheet`, `SignatureStudioSheet`, `PageOrganizerSheet`, `PageNumberingSheet`, `SearchStrip`, `NavigatorSheet`, and `SaveWorkflowSheet`.
6. **Phase 6 — Verification, Automated Tests & APK Build + Live ADB Diagnostics**
   - Run Rust `cargo test`, JVM unit tests (`./gradlew testDebugUnitTest`), build `./gradlew assembleDebug` (and verify APK path & contents), run lint/static audits, and if an emulator/device is available (launch `Medium_Phone_API_35` if headless/ready), deploy & verify live via `adb` (`am start`, `logcat` zero crash check, `dumpsys gfxinfo`).
