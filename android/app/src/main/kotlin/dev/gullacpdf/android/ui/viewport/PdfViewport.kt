package dev.gullacpdf.android.ui.viewport

import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.os.SystemClock
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerType
import androidx.compose.ui.input.pointer.changedToDownIgnoreConsumed
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.gullacpdf.android.engine.DirectBufferPool
import dev.gullacpdf.android.engine.NativePdfBridge
import dev.gullacpdf.android.engine.TileBitmapCache
import dev.gullacpdf.android.engine.TileKey
import dev.gullacpdf.android.model.GpAppMode
import dev.gullacpdf.android.model.GpDetectedImageObj
import dev.gullacpdf.android.model.GpDetectedShapeObj
import dev.gullacpdf.android.model.CropMath
import dev.gullacpdf.android.model.GpDetectedTextBlock
import dev.gullacpdf.android.model.GpEditorTool
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpPageAnalysis
import dev.gullacpdf.android.model.GpPageLink
import dev.gullacpdf.android.model.GpPageMeta
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpRectF
import dev.gullacpdf.android.theme.GpReadingTheme
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.text.GpTextEngine
import dev.gullacpdf.android.viewmodel.GpAppState
import dev.gullacpdf.android.viewmodel.GpContextMenuRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

const val TILE_SIZE_PX = 384

data class RenderedBucketMeta(
    val scaleBucket: String,
    val tileZoom: Float,
    val totalPageWpx: Int,
    val totalPageHpx: Int,
)

@Stable
class PdfViewportController {
    var zoom by mutableFloatStateOf(1f)
    var fitWidthZoom by mutableFloatStateOf(1f)
    var scrollX by mutableFloatStateOf(0f)
    var scrollY by mutableFloatStateOf(0f)
    var activePageIndex by mutableIntStateOf(0)
    var isZoomingGesture by mutableStateOf(false)
    var isAdobeZoomActive by mutableStateOf(false)

    var viewportWidthPx by mutableFloatStateOf(0f)
    var viewportHeightPx by mutableFloatStateOf(0f)
    var fittedDocId: String? = null
    var activeRenderBucket: String? = null

    var tilePaintTick by mutableIntStateOf(0)
    var transientElement by mutableStateOf<GpOverlayElement?>(null)
    var transientElements by mutableStateOf<Map<String, GpOverlayElement>>(emptyMap())
    var draftShapePreview by mutableStateOf<DraftShapePreview?>(null)
    var draftMarqueePreview by mutableStateOf<DraftMarqueePreview?>(null)
    var snapGuides by mutableStateOf<SnapGuideLines?>(null)
    var liveStrokeScreenPts by mutableStateOf<List<GpPoint>>(emptyList())
    var liveStrokeColor by mutableIntStateOf(0xFF1D4ED8.toInt())
    var liveStrokeWidthPx by mutableFloatStateOf(5f)

    /** Caret/selection of the on-page text editor (indices into the element text). */
    var inlineSelStart by mutableIntStateOf(0)
    var inlineSelEnd by mutableIntStateOf(0)
    var caretBlinkOn by mutableStateOf(true)
    /** Caret placement requested by a tap; consumed by the hidden keyboard text field. */
    var inlineCaretRequest by mutableStateOf<Pair<Int, Long>?>(null)

    /** Per page: the document whose sharp tiles were last fully on screen (doc id, page idx, transparent). */
    val lastCompleteDocByPage = HashMap<String, Triple<String, Int, Boolean>>()
    /** Per page: the document actually painted in the last frame. */
    val displayedDocByPage = HashMap<String, String>()

    fun requestInlineCaret(index: Int) {
        inlineSelStart = index
        inlineSelEnd = index
        caretBlinkOn = true
        inlineCaretRequest = index to System.nanoTime()
    }

    val readyBucketsByPage = ConcurrentHashMap<String, List<RenderedBucketMeta>>()

    private var cachedLayoutPages: List<GpPageMeta>? = null
    private var cachedLayoutZoom: Float = -1f
    private var cachedLayoutVw: Float = -1f
    private var cachedLayoutVh: Float = -1f
    private var cachedLayoutDensity: Float = -1f
    private var cachedLayouts: List<PageLayoutRect> = emptyList()
    private var cachedBounds: ScrollBounds = ScrollBounds(0f, 0f)

    fun getLayouts(
        pages: List<GpPageMeta>,
        density: Float,
        z: Float = zoom,
        vw: Float = viewportWidthPx,
    ): List<PageLayoutRect> {
        if (cachedLayoutPages === pages && cachedLayoutZoom == z && cachedLayoutVw == vw && cachedLayoutDensity == density) {
            return cachedLayouts
        }
        cachedLayouts = ViewportLayoutMath.computePageRects(pages, z, vw, density)
        cachedLayoutPages = pages
        cachedLayoutZoom = z
        cachedLayoutVw = vw
        cachedLayoutDensity = density
        cachedLayoutVh = -1f
        return cachedLayouts
    }

    fun getBounds(
        pages: List<GpPageMeta>,
        density: Float,
        z: Float = zoom,
        vw: Float = viewportWidthPx,
        vh: Float = viewportHeightPx,
    ): ScrollBounds {
        val layouts = getLayouts(pages, density, z, vw)
        if (cachedLayoutVh == vh) return cachedBounds
        cachedBounds = ViewportLayoutMath.computeScrollBounds(layouts, vw, vh, density)
        cachedLayoutVh = vh
        return cachedBounds
    }

    fun recordReadyBucket(pageBucketKey: String, meta: RenderedBucketMeta) {
        val prev = readyBucketsByPage[pageBucketKey].orEmpty()
        // Keep base/fit buckets pinned alongside the most recent 4 high-DPI zoom buckets so zooming
        // across multiple thresholds never loses coarse base fallback tiles.
        val baseBuckets = prev.filter { it.scaleBucket != meta.scaleBucket && it.tileZoom <= fitWidthZoom * 1.2f }
        val nonBase = prev.filter { it.scaleBucket != meta.scaleBucket && it.tileZoom > fitWidthZoom * 1.2f }
        val updated = (listOf(meta) + nonBase.take(3) + baseBuckets.take(2)).distinctBy { it.scaleBucket }
        readyBucketsByPage[pageBucketKey] = updated
        tilePaintTick++
    }

    fun scrollToPage(pageIndex: Int, pages: List<GpPageMeta>, density: Float) {
        if (pages.isEmpty() || viewportWidthPx <= 0f) return
        val idx = pageIndex.coerceIn(0, pages.lastIndex)
        val layouts = getLayouts(pages, density)
        val bounds = getBounds(pages, density)
        val gapPx = ViewportLayoutMath.PAGE_GAP_DP * density
        scrollY = (layouts[idx].rectSurface.top - gapPx).coerceIn(0f, bounds.maxScrollY)
        activePageIndex = idx
    }

    fun captureAnchor(pages: List<GpPageMeta>, density: Float): FocalAnchor? {
        if (pages.isEmpty() || viewportWidthPx <= 0f) return null
        return ViewportLayoutMath.captureFocalAnchor(
            pages = pages,
            zoom = zoom,
            scrollX = scrollX,
            scrollY = scrollY,
            viewportWidthPx = viewportWidthPx,
            density = density,
            screenX = viewportWidthPx * 0.5f,
            screenY = viewportHeightPx * 0.35f,
        )
    }

    fun restoreAnchor(anchor: FocalAnchor, pages: List<GpPageMeta>, density: Float) {
        if (pages.isEmpty() || viewportWidthPx <= 0f) return
        val (sx, sy) = ViewportLayoutMath.computeFocalPreservingScroll(
            pages = pages,
            anchor = anchor,
            nextZoom = zoom,
            focalScreenX = viewportWidthPx * 0.5f,
            focalScreenY = viewportHeightPx * 0.35f,
            viewportWidthPx = viewportWidthPx,
            viewportHeightPx = viewportHeightPx,
            density = density,
        )
        scrollX = sx
        scrollY = sy
    }
}

private enum class ManipKind { NONE, MOVE, MOVE_GROUP, RESIZE, ROTATE, VERTEX, CREATE_SHAPE, CREATE_LINE_DRAG, MARQUEE_OBJECTS, MARQUEE_VERTICES, CROP }
private enum class GesturePhase { IDLE, PENDING_DOUBLE_TAP, ADOBE_ZOOM, PAN, PINCH, DRAW_STROKE, MANIP, LONG_PRESSED }

private const val LONG_PRESS_MS = 480L

private fun pageNeedsTransparentPdf(
    pageId: String,
    elements: List<GpOverlayElement>,
    analysis: GpPageAnalysis?,
): Boolean = elements.any { el ->
    !el.deleted && el.pageId == pageId && el.behindContent && !el.staysInPdfRaster(analysis) && !el.movesInPlace()
}

@Composable
fun PdfViewport(
    state: GpAppState,
    tileCache: TileBitmapCache,
    controller: PdfViewportController,
    onPositionChanged: (activePage: Int, zoom: Float) -> Unit,
    onToggleImmersive: () -> Unit,
    onAddElement: (GpOverlayElement, Boolean) -> Unit,
    onUpdateElement: (GpOverlayElement, Boolean) -> Unit,
    onSelectElement: (String?, Boolean) -> Unit,
    onEraseAt: (GpPoint, Int) -> Unit,
    onEditPdfTextBlock: (Int, GpDetectedTextBlock) -> Unit,
    onLineModeTap: (Int, GpPoint, Float) -> Unit,
    onLineModeDragSegment: (Int, GpPoint, GpPoint) -> Unit,
    onPlaceGhostAt: (Int, GpPoint) -> Unit,
    onTapLink: (GpPageLink) -> Unit,
    onEditPdfImageObject: (Int, GpDetectedImageObj) -> Unit = { _, _ -> },
    onEditPdfShapeObject: (Int, GpDetectedShapeObj) -> Unit = { _, _ -> },
    onBeginInlineEdit: (String) -> Unit = {},
    onSelectElementsInRect: (Int, GpRectF, Boolean) -> Unit = { _, _, _ -> },
    onSetSelectedPathVertexIndices: (Set<Int>) -> Unit = {},
    onTogglePathVertexIndex: (Int) -> Unit = {},
    onMoveSelectedElementsBy: (String, Set<String>, Double, Double) -> Unit = { _, _, _, _ -> },
    onLongPress: (GpContextMenuRequest) -> Unit = {},
    onCropUpdate: (GpOverlayElement) -> Unit = {},
    onCropFinish: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val palette = LocalGpPalette.current
    val context = LocalContext.current
    val density = LocalDensity.current.density
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val cropChrome = remember { CropChromePainter() }

    val currentState by rememberUpdatedState(state)
    val bufferPool = remember { DirectBufferPool() }
    val elementBitmapCache = remember { ElementBitmapCache(onDecoded = { controller.tilePaintTick++ }) }
    val overlayPainter = remember(context) {
        OverlayCanvasPainter(elementBitmapCache, context.assets, context.cacheDir)
    }
    val inFlightTiles = remember { ConcurrentHashMap.newKeySet<TileKey>() }

    var tileDebounceJob by remember { mutableStateOf<Job?>(null) }
    var positionSyncJob by remember { mutableStateOf<Job?>(null) }
    var inertiaJob by remember { mutableStateOf<Job?>(null) }
    var zoomAnimJob by remember { mutableStateOf<Job?>(null) }
    var lastPanTileMs = 0L

    DisposableEffect(Unit) {
        onDispose {
            tileDebounceJob?.cancel()
            positionSyncJob?.cancel()
            inertiaJob?.cancel()
            zoomAnimJob?.cancel()
            elementBitmapCache.clear()
        }
    }

    fun syncActivePageAndNotify(immediate: Boolean = false) {
        val st = currentState
        if (st.pages.isEmpty() || controller.viewportWidthPx <= 0f) return
        val layouts = controller.getLayouts(st.pages, density)
        val centerY = controller.scrollY + controller.viewportHeightPx * 0.4f
        var bestIdx = 0
        var bestDist = Float.POSITIVE_INFINITY
        for (l in layouts) {
            val d = abs(l.rectSurface.centerY - centerY)
            if (d < bestDist) {
                bestDist = d
                bestIdx = l.pageIndex
            }
        }
        controller.activePageIndex = bestIdx
        if (immediate) {
            positionSyncJob?.cancel()
            onPositionChanged(bestIdx, controller.zoom)
        } else {
            positionSyncJob?.cancel()
            positionSyncJob = scope.launch {
                delay(140L)
                onPositionChanged(controller.activePageIndex, controller.zoom)
            }
        }
    }

    fun scheduleVisibleTiles(immediate: Boolean = false) {
        tileDebounceJob?.cancel()
        tileDebounceJob = scope.launch {
            if (!immediate) delay(40L)
            val st = currentState
            val docId = st.docId ?: return@launch
            if (st.pages.isEmpty() || controller.viewportWidthPx <= 0f || controller.viewportHeightPx <= 0f) return@launch

            val z = controller.zoom
            val tileZoom = ViewportLayoutMath.quantizeTileZoom(z, controller.fitWidthZoom)
            val scaleBucket = ViewportLayoutMath.bucketKey(tileZoom)
            val themeKey = st.theme.engineKey
            val layouts = controller.getLayouts(st.pages, density, z, controller.viewportWidthPx)
            val visibleSurf = GpRectF.fromLTWH(
                controller.scrollX,
                controller.scrollY,
                controller.viewportWidthPx,
                controller.viewportHeightPx,
            )

            if (controller.activeRenderBucket != null &&
                controller.activeRenderBucket != scaleBucket
            ) {
                NativePdfBridge.cancelRenderScope("zoom:${controller.activeRenderBucket}")
            }
            controller.activeRenderBucket = scaleBucket

            var firstVisIdx: Int? = null
            var lastVisIdx: Int? = null

            for (layout in layouts) {
                if (!layout.rectSurface.overlaps(visibleSurf)) continue
                if (firstVisIdx == null) firstVisIdx = layout.pageIndex
                lastVisIdx = layout.pageIndex

                val page = layout.page
                val cleanDocId = st.cleanPreviewDocIds[page.id]
                val effectiveDocId = cleanDocId ?: page.sourceDocId
                val effectivePageIdx = if (cleanDocId != null) 0 else page.sourcePageIndex
                if (effectiveDocId == "blank") continue
                val transparentPageBg = pageNeedsTransparentPdf(
                    page.id,
                    st.elements,
                    st.pageAnalyses[page.id],
                )

                // 1) Ensure quick low-res page preview exists
                val previewKey = TileKey(
                    docId = effectiveDocId,
                    pageIndex = effectivePageIdx,
                    tileX = 0,
                    tileY = 0,
                    scaleBucket = "preview",
                    rotation = page.userRotation,
                    themeKey = themeKey,
                    isPreview = true,
                    transparentBg = transparentPageBg,
                )
                if (!tileCache.contains(previewKey) && inFlightTiles.add(previewKey)) {
                    val previewScale = 0.45 * density
                    val pw = (page.displayWidth * previewScale).roundToInt().coerceIn(140, 600)
                    val ph = (page.displayHeight * previewScale).roundToInt().coerceIn(160, 840)
                    val actualScale = pw.toDouble() / page.displayWidth
                    scope.launch {
                        try {
                            val bmp = NativePdfBridge.renderTileBitmap(
                                docId = effectiveDocId,
                                pageIndex = effectivePageIdx,
                                tileX = 0,
                                tileY = 0,
                                tileWidthPx = pw,
                                tileHeightPx = ph,
                                scale = actualScale,
                                userRotation = page.userRotation,
                                theme = themeKey,
                                darkPaperInvert = st.darkPaperInvert,
                                priorityTier = 1,
                                scope = "preview:$docId",
                                bufferPool = bufferPool,
                                transparentBg = transparentPageBg,
                            )
                            if (bmp != null) {
                                tileCache.put(previewKey, bmp)
                                controller.tilePaintTick++
                            }
                        } finally {
                            inFlightTiles.remove(previewKey)
                        }
                    }
                }

                // 2) Sharp High-DPI visible tiles at exact physical DPI scale
                val (totalWpx, totalHpx) = ViewportLayoutMath.computeTotalPagePixels(page, tileZoom, density)
                val renderScale = totalWpx.toDouble() / page.displayWidth
                val bucketMeta = RenderedBucketMeta(scaleBucket, tileZoom, totalWpx, totalHpx)
                val pageBucketKey = "$effectiveDocId:$effectivePageIdx:${page.userRotation}:$themeKey:$transparentPageBg"

                val visLeftR = ((visibleSurf.left - layout.rectSurface.left) / max(1f, layout.rectSurface.width)).coerceIn(0f, 1f)
                val visTopR = ((visibleSurf.top - layout.rectSurface.top) / max(1f, layout.rectSurface.height)).coerceIn(0f, 1f)
                val visRightR = ((visibleSurf.right - layout.rectSurface.left) / max(1f, layout.rectSurface.width)).coerceIn(0f, 1f)
                val visBottomR = ((visibleSurf.bottom - layout.rectSurface.top) / max(1f, layout.rectSurface.height)).coerceIn(0f, 1f)

                val colStart = floor((visLeftR * totalWpx) / TILE_SIZE_PX).toInt()
                val colEnd = max(colStart, floor((visRightR * totalWpx) / TILE_SIZE_PX).toInt())
                val rowStart = floor((visTopR * totalHpx) / TILE_SIZE_PX).toInt()
                val rowEnd = max(rowStart, floor((visBottomR * totalHpx) / TILE_SIZE_PX).toInt())

                for (r in rowStart..rowEnd) {
                    for (c in colStart..colEnd) {
                        val tx = c * TILE_SIZE_PX
                        val ty = r * TILE_SIZE_PX
                        val tw = min(TILE_SIZE_PX, totalWpx - tx)
                        val th = min(TILE_SIZE_PX, totalHpx - ty)
                        if (tw <= 0 || th <= 0) continue

                        val key = TileKey(
                            docId = effectiveDocId,
                            pageIndex = effectivePageIdx,
                            tileX = tx,
                            tileY = ty,
                            scaleBucket = scaleBucket,
                            rotation = page.userRotation,
                            themeKey = themeKey,
                            transparentBg = transparentPageBg,
                        )
                        if (tileCache.contains(key)) {
                            controller.recordReadyBucket(pageBucketKey, bucketMeta)
                        } else if (inFlightTiles.add(key)) {
                            scope.launch {
                                try {
                                    val bmp = NativePdfBridge.renderTileBitmap(
                                        docId = effectiveDocId,
                                        pageIndex = effectivePageIdx,
                                        tileX = tx,
                                        tileY = ty,
                                        tileWidthPx = tw,
                                        tileHeightPx = th,
                                        scale = renderScale,
                                        userRotation = page.userRotation,
                                        theme = themeKey,
                                        darkPaperInvert = st.darkPaperInvert,
                                        priorityTier = 0,
                                        scope = "zoom:$scaleBucket",
                                        bufferPool = bufferPool,
                                        transparentBg = transparentPageBg,
                                    )
                                    if (bmp != null) {
                                        tileCache.put(key, bmp)
                                        controller.recordReadyBucket(pageBucketKey, bucketMeta)
                                    }
                                } finally {
                                    inFlightTiles.remove(key)
                                }
                            }
                        }
                    }
                }
            }

            // 3) Prefetch +-1 adjacent pages preview
            if (!controller.isZoomingGesture && firstVisIdx != null && lastVisIdx != null) {
                for (adjIdx in listOf(firstVisIdx - 1, lastVisIdx + 1)) {
                    if (adjIdx !in st.pages.indices) continue
                    val page = st.pages[adjIdx]
                    val cleanAdjId = st.cleanPreviewDocIds[page.id]
                    val effAdjId = cleanAdjId ?: page.sourceDocId
                    val effAdjIdx = if (cleanAdjId != null) 0 else page.sourcePageIndex
                    if (effAdjId == "blank") continue
                    val adjTransBg = pageNeedsTransparentPdf(
                        page.id,
                        st.elements,
                        st.pageAnalyses[page.id],
                    )
                    val pk = TileKey(
                        docId = effAdjId,
                        pageIndex = effAdjIdx,
                        tileX = 0,
                        tileY = 0,
                        scaleBucket = "preview",
                        rotation = page.userRotation,
                        themeKey = themeKey,
                        isPreview = true,
                        transparentBg = adjTransBg,
                    )
                    if (!tileCache.contains(pk) && inFlightTiles.add(pk)) {
                        val previewScale = 0.45 * density
                        val pw = (page.displayWidth * previewScale).roundToInt().coerceIn(140, 600)
                        val ph = (page.displayHeight * previewScale).roundToInt().coerceIn(160, 840)
                        val actualScale = pw.toDouble() / page.displayWidth
                        scope.launch {
                            try {
                                val bmp = NativePdfBridge.renderTileBitmap(
                                    docId = effAdjId,
                                    pageIndex = effAdjIdx,
                                    tileX = 0,
                                    tileY = 0,
                                    tileWidthPx = pw,
                                    tileHeightPx = ph,
                                    scale = actualScale,
                                    userRotation = page.userRotation,
                                    theme = themeKey,
                                    darkPaperInvert = st.darkPaperInvert,
                                    priorityTier = 2,
                                    scope = "prefetch:$docId",
                                    bufferPool = bufferPool,
                                    transparentBg = adjTransBg,
                                )
                                if (bmp != null) {
                                    tileCache.put(pk, bmp)
                                    controller.tilePaintTick++
                                }
                            } finally {
                                inFlightTiles.remove(pk)
                            }
                        }
                    }
                }
            }
        }
    }

    // On-page text editing: blink the caret and keep it visible above the keyboard.
    LaunchedEffect(state.inlineEditElementId) {
        if (state.inlineEditElementId == null) return@LaunchedEffect
        while (true) {
            delay(530L)
            controller.caretBlinkOn = !controller.caretBlinkOn
        }
    }
    LaunchedEffect(state.inlineEditElementId, controller.inlineSelEnd, controller.viewportHeightPx, state.elements) {
        val id = state.inlineEditElementId ?: return@LaunchedEffect
        val el = state.elements.firstOrNull { it.id == id && !it.deleted } ?: return@LaunchedEffect
        val pageIdx = state.pages.indexOfFirst { it.id == el.pageId }
        if (pageIdx < 0 || controller.viewportHeightPx <= 0f) return@LaunchedEffect
        val layouts = controller.getLayouts(state.pages, density)
        val l = layouts.getOrNull(pageIdx) ?: return@LaunchedEffect
        val scale = controller.zoom * density
        val caretY = if (GpTextEngine.handles(el)) {
            GpTextEngine.caretPosition(
                GpTextEngine.layout(el, overlayPainter.fontLookup(state.extractedFonts)),
                controller.inlineSelEnd,
            )?.second ?: (el.y + el.height)
        } else {
            el.y + el.height
        }
        val caretSurfY = l.rectSurface.top + (caretY * scale).toFloat()
        val topLimit = controller.scrollY + controller.viewportHeightPx * 0.12f
        val bottomLimit = controller.scrollY + controller.viewportHeightPx * 0.82f
        val bounds = controller.getBounds(state.pages, density)
        if (caretSurfY > bottomLimit || caretSurfY < topLimit) {
            controller.scrollY = (caretSurfY - controller.viewportHeightPx * 0.4f).coerceIn(0f, bounds.maxScrollY)
            scheduleVisibleTiles(immediate = true)
        }
    }

    // Respond to jumpToPage events & doc/theme/cleanPreview changes
    LaunchedEffect(state.jumpToPageEvent) {
        val evt = state.jumpToPageEvent ?: return@LaunchedEffect
        controller.scrollToPage(evt.first, state.pages, density)
        syncActivePageAndNotify(immediate = true)
        scheduleVisibleTiles(immediate = true)
    }

    LaunchedEffect(state.docId, state.theme, state.darkPaperInvert, state.pages, state.cleanPreviewDocIds) {
        scheduleVisibleTiles(immediate = true)
    }

    fun animateDoubleTapZoom(screenPos: GpPoint) {
        val st = currentState
        if (st.pages.isEmpty() || controller.viewportWidthPx <= 0f) return
        val fit = controller.fitWidthZoom
        val isZoomedIn = controller.zoom > fit * 1.15f
        val targetZoom = if (isZoomedIn) fit else (fit * 2.4f).coerceIn(1.8f, 3.5f)
        val anchor = ViewportLayoutMath.captureFocalAnchor(
            st.pages, controller.zoom, controller.scrollX, controller.scrollY,
            controller.viewportWidthPx, density, screenPos.x, screenPos.y,
        ) ?: return

        zoomAnimJob?.cancel()
        inertiaJob?.cancel()
        zoomAnimJob = scope.launch {
            val anim = Animatable(controller.zoom)
            controller.isZoomingGesture = true
            anim.animateTo(targetZoom, tween(220, easing = FastOutSlowInEasing)) {
                val (sx, sy) = ViewportLayoutMath.computeFocalPreservingScroll(
                    st.pages, anchor, value, screenPos.x, screenPos.y,
                    controller.viewportWidthPx, controller.viewportHeightPx, density,
                )
                controller.zoom = value
                controller.scrollX = sx
                controller.scrollY = sy
            }
            controller.isZoomingGesture = false
            syncActivePageAndNotify(immediate = true)
            scheduleVisibleTiles(immediate = true)
        }
    }

    fun hitPagePdfPoint(screenPos: GpPoint): Pair<Int, GpPoint>? {
        val st = currentState
        val layouts = controller.getLayouts(st.pages, density)
        val surfX = screenPos.x + controller.scrollX
        val surfY = screenPos.y + controller.scrollY
        val scale = (controller.zoom * density).coerceAtLeast(0.01f)
        for (l in layouts) {
            if (l.rectSurface.contains(surfX, surfY)) {
                return l.pageIndex to GpPoint((surfX - l.rectSurface.left) / scale, (surfY - l.rectSurface.top) / scale)
            }
        }
        return null
    }

    /** Caret index for a page-point tap inside a text element. */
    fun caretIndexAt(el: GpOverlayElement, pdfPt: GpPoint): Int {
        val st = currentState
        return if (GpTextEngine.handles(el)) {
            GpTextEngine.hitIndex(
                GpTextEngine.layout(el, overlayPainter.fontLookup(st.extractedFonts)),
                pdfPt.x.toDouble(),
                pdfPt.y.toDouble(),
            )
        } else {
            overlayPainter.hitTextBox(el, pdfPt.x.toDouble(), pdfPt.y.toDouble()) ?: el.text.length
        }.coerceIn(0, el.text.length)
    }

    /**
     * Tap on a text element: first tap selects it, a tap on the already selected element puts the
     * caret exactly there and opens the keyboard for editing directly on the page.
     */
    fun tapTextElement(el: GpOverlayElement, pdfPt: GpPoint): Boolean {
        val st = currentState
        if (!el.isTextKind) return false
        if (st.inlineEditElementId == el.id || st.selectedElementId == el.id) {
            controller.requestInlineCaret(caretIndexAt(el, pdfPt))
            if (st.inlineEditElementId != el.id) onBeginInlineEdit(el.id)
            return true
        }
        return false
    }

    fun handleSingleTapAt(screenPos: GpPoint, forMenu: Boolean = false) {
        val st = currentState
        if (st.cropElementId != null) {
            // Tapping outside the crop handles while cropping applies the crop.
            if (!forMenu) onCropFinish()
            return
        }
        val tool = if (forMenu) GpEditorTool.SELECT else st.tool
        val hit = hitPagePdfPoint(screenPos)
        if (hit == null) {
            if (st.mode == GpAppMode.EDIT) onSelectElement(null, false)
            else onToggleImmersive()
            return
        }
        val (pageIdx, pdfPt) = hit
        val page = st.pages[pageIdx]

        if (st.mode == GpAppMode.VIEW) {
            val links = st.pageLinks[page.sourcePageIndex].orEmpty()
            for (link in links) {
                if (link.rect.inflate(6f).contains(pdfPt.x, pdfPt.y)) {
                    onTapLink(link)
                    return
                }
            }
            onToggleImmersive()
            return
        }

        if (st.ghostSignature != null) {
            onPlaceGhostAt(pageIdx, pdfPt)
            return
        }

        if (tool == GpEditorTool.LINE) {
            val snapRadiusPdf = 20f / controller.zoom.coerceAtLeast(0.25f)
            onLineModeTap(pageIdx, pdfPt, snapRadiusPdf)
            return
        }

        if (tool == GpEditorTool.TEXT) {
            val existingText = st.elements.lastOrNull { e ->
                e.pageId == page.id && !e.deleted && e.isTextKind &&
                    GpRectF.fromLTWH(e.x.toFloat(), e.y.toFloat(), e.width.toFloat(), e.height.toFloat())
                        .inflate(8f).contains(pdfPt.x, pdfPt.y)
            }
            if (existingText != null) {
                if (tapTextElement(existingText, pdfPt)) return
                onSelectElement(existingText.id, false)
                return
            }

            val analysis = st.pageAnalyses[page.id]
            if (analysis != null) {
                val hitBlk = analysis.textBlocks
                    .filter { it.rect.inflate(3f).contains(pdfPt.x, pdfPt.y) }
                    .minByOrNull { it.width * it.height }
                if (hitBlk != null) {
                    onEditPdfTextBlock(pageIdx, hitBlk)
                    return
                }
            }

            onAddElement(
                GpOverlayElement(
                    id = "el_${System.nanoTime()}",
                    pageId = page.id,
                    kind = "textAdd",
                    x = pdfPt.x.toDouble(),
                    y = pdfPt.y.toDouble(),
                    width = 180.0,
                    height = 30.0,
                    text = "Text",
                    fontSize = 14.0,
                    colorValue = st.activeTextColorValue,
                    backgroundColorValue = st.activeTextBgColorValue,
                ),
                true, // Return to select unless toolLocked, keeping text drawer collapsed!
            )
            return
        }

        if (tool == GpEditorTool.SHAPE) {
            onAddElement(
                GpOverlayElement(
                    id = "shp_${System.nanoTime()}",
                    pageId = page.id,
                    kind = "shape",
                    shapeType = st.activeShapeType,
                    x = pdfPt.x.toDouble() - 55.0,
                    y = pdfPt.y.toDouble() - 35.0,
                    width = 110.0,
                    height = 70.0,
                    colorValue = st.activeStrokeColorValue,
                    fillColorValue = st.activeFillColorValue,
                    strokeWidth = st.activeStrokeWidth,
                ),
                true, // Auto-return to Select unless toolLocked!
            )
            return
        }

        // Multi-tier priority hit resolution matching visual Z-order:
        // Tier 1: foreground user overlays
        // Tier 2: detected PDF text blocks (ignoring promoted/deleted items)
        // Tier 3: foreground PDF images & vector shapes
        // Tier 4: behind-content / background layers (overlays -> PDF images -> PDF shapes)
        val hitTolPdf = 10f / controller.zoom.coerceAtLeast(0.25f)
        val pageEls = st.elements.filter { it.pageId == page.id }
        val promotedOrDeletedIds = pageEls.mapNotNullTo(HashSet()) {
            it.sourceBlockId.takeIf { sid -> sid.isNotEmpty() }
        }
        val activePageEls = pageEls.filter { !it.deleted }

        fun GpOverlayElement.containsHit(tol: Float): Boolean =
            GpRectF.fromLTWH(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
                .inflate(tol).contains(pdfPt.x, pdfPt.y)

        val fgHitEl = activePageEls
            .filter { !it.behindContent && !it.isBackgroundLayer && it.containsHit(hitTolPdf) }
            .minByOrNull { (it.width * it.height).coerceAtLeast(1.0) }
        if (fgHitEl != null) {
            if (!forMenu && tapTextElement(fgHitEl, pdfPt)) return
            onSelectElement(fgHitEl.id, false)
            return
        }

        val analysis = st.pageAnalyses[page.id]
        if (tool == GpEditorTool.SELECT && analysis != null) {
            val hitBlk = analysis.textBlocks
                .filter { it.id !in promotedOrDeletedIds && it.rect.inflate(3f).contains(pdfPt.x, pdfPt.y) }
                .minByOrNull { it.width * it.height }
            if (hitBlk != null) {
                onEditPdfTextBlock(pageIdx, hitBlk)
                return
            }

            val fgImg = analysis.images
                .filter { it.id !in promotedOrDeletedIds && !it.behindContent && !it.isBackgroundLayer && it.rect.inflate(4f).contains(pdfPt.x, pdfPt.y) }
                .minByOrNull { it.width * it.height }
            if (fgImg != null) {
                onEditPdfImageObject(pageIdx, fgImg)
                return
            }

            val pageArea = max(1.0, page.displayWidth * page.displayHeight)
            fun GpDetectedShapeObj.matchesHit(): Boolean {
                if (id in promotedOrDeletedIds) return false
                val r = rect
                if (!r.inflate(6f).contains(pdfPt.x, pdfPt.y)) return false
                val areaRatio = (width * height) / pageArea
                return if (areaRatio >= 0.85) {
                    abs(pdfPt.x - r.left) <= 14f ||
                        abs(pdfPt.x - r.right) <= 14f ||
                        abs(pdfPt.y - r.top) <= 14f ||
                        abs(pdfPt.y - r.bottom) <= 14f
                } else {
                    true
                }
            }

            val fgShape = analysis.shapes
                .filter { !it.behindContent && !it.isBackgroundLayer && it.matchesHit() }
                .minByOrNull { it.width * it.height }
            if (fgShape != null) {
                onEditPdfShapeObject(pageIdx, fgShape)
                return
            }

            // Tier 4a: already-promoted behind-content overlays
            val bgHitEl = activePageEls
                .filter { (it.behindContent || it.isBackgroundLayer) && it.containsHit(hitTolPdf) }
                .minByOrNull { (it.width * it.height).coerceAtLeast(1.0) }
            if (bgHitEl != null) {
                val expand = bgHitEl.isTextKind && bgHitEl.id == st.selectedElementId
                onSelectElement(bgHitEl.id, expand)
                return
            }

            // Tier 4b: behind-content / background PDF images & shapes
            val bgImg = analysis.images
                .filter { it.id !in promotedOrDeletedIds && (it.behindContent || it.isBackgroundLayer) && it.rect.inflate(4f).contains(pdfPt.x, pdfPt.y) }
                .minByOrNull { it.width * it.height }
            if (bgImg != null) {
                onEditPdfImageObject(pageIdx, bgImg)
                return
            }

            val bgShape = analysis.shapes
                .filter { (it.behindContent || it.isBackgroundLayer) && it.matchesHit() }
                .minByOrNull { it.width * it.height }
            if (bgShape != null) {
                onEditPdfShapeObject(pageIdx, bgShape)
                return
            }
        } else {
            val bgHitEl = activePageEls
                .filter { it.containsHit(hitTolPdf) }
                .minByOrNull { (it.width * it.height).coerceAtLeast(1.0) }
            if (bgHitEl != null) {
                val expand = bgHitEl.isTextKind && bgHitEl.id == st.selectedElementId
                onSelectElement(bgHitEl.id, expand)
                return
            }
        }

        onSelectElement(null, false)
    }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxSize()
            .background(palette.paperBackdrop)
            .clipToBounds(),
    ) {
        val vw = constraints.maxWidth.toFloat()
        val vh = constraints.maxHeight.toFloat()
        val docId = state.docId
        val sizeChanged = controller.viewportWidthPx != vw || controller.viewportHeightPx != vh
        val needsInitialFit = docId != null && state.pages.isNotEmpty() && controller.fittedDocId != docId

        controller.viewportWidthPx = vw
        controller.viewportHeightPx = vh

        if ((sizeChanged || needsInitialFit) && state.pages.isNotEmpty() && vw > 0f) {
            val fit = ViewportLayoutMath.computeFitWidthZoom(state.pages, vw, density)
            controller.fitWidthZoom = fit
            if (needsInitialFit) {
                controller.fittedDocId = docId
                controller.zoom = fit
                controller.scrollX = 0f
                controller.scrollY = 0f
                controller.activePageIndex = 0
                LaunchedEffect(docId) {
                    syncActivePageAndNotify(immediate = true)
                    scheduleVisibleTiles(immediate = true)
                }
            } else if (sizeChanged) {
                LaunchedEffect(vw, vh) {
                    scheduleVisibleTiles(immediate = true)
                }
            }
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .clipToBounds()
                .pointerInput(state.docId) {
                    awaitPointerEventScope {
                        val touchSlopPx = 8f * density
                        var phase = GesturePhase.IDLE
                        var activePointerIds = linkedMapOf<PointerId, GpPoint>()
                        var primaryId: PointerId? = null
                        var downPos = GpPoint(0f, 0f)
                        var lastPos = GpPoint(0f, 0f)
                        var gestureHadMultiTouch = false
                        var lastPinchEndMs = 0L

                        // Double-tap & Adobe one-handed zoom state
                        var lastTapUpMs = 0L
                        var lastTapUpPos = GpPoint(0f, 0f)
                        var adobeAnchor: FocalAnchor? = null
                        var adobeStartZoom = 1f

                        // Pinch state
                        var pinchAnchor: FocalAnchor? = null
                        var pinchStartDist = 1f
                        var pinchStartZoom = 1f
                        var lastBucketRenderMs = 0L

                        // Velocity tracking for smooth inertia
                        val velSamples = ArrayList<Pair<Long, GpPoint>>(12)

                        // Drawing stroke state
                        val draftStrokePdf = mutableListOf<GpPoint>()
                        var draftStrokePageIdx = -1

                        // Shape / Handle manipulation state
                        var manipKind = ManipKind.NONE
                        var manipHandle = ""
                        var manipVertexIdx = -1
                        var manipVertexIndices = emptySet<Int>()
                        var manipPageIdx = -1
                        var manipStartPdf = GpPoint(0f, 0f)
                        var manipOriginEl: GpOverlayElement? = null
                        var manipLatestEl: GpOverlayElement? = null
                        var manipOriginGroup = emptyList<GpOverlayElement>()
                        var manipGroupPageId = ""
                        var manipGroupDxPdf = 0.0
                        var manipGroupDyPdf = 0.0
                        var manipSiblings = emptyList<GpRectF>()
                        var manipDragged = false

                        // Long-press (context menu) state
                        var longPressArmed = false
                        var downTimeMs = 0L

                        fun cancelAllSingleFingerWork() {
                            draftStrokePdf.clear()
                            draftStrokePageIdx = -1
                            controller.liveStrokeScreenPts = emptyList()
                            controller.transientElement = null
                            controller.transientElements = emptyMap()
                            controller.draftShapePreview = null
                            controller.draftMarqueePreview = null
                            controller.snapGuides = null
                            manipKind = ManipKind.NONE
                            manipOriginEl = null
                            manipLatestEl = null
                            manipOriginGroup = emptyList()
                            manipGroupPageId = ""
                            manipGroupDxPdf = 0.0
                            manipGroupDyPdf = 0.0
                            manipVertexIndices = emptySet()
                            manipSiblings = emptyList()
                            manipDragged = false
                            controller.isAdobeZoomActive = false
                        }

                        fun tryBeginManip(pos: GpPoint): Boolean {
                            val st = currentState
                            if (st.mode != GpAppMode.EDIT || st.ghostSignature != null) return false
                            val scalePxPerPt = controller.zoom * density
                            val layouts = ViewportLayoutMath.computePageRects(st.pages, controller.zoom, controller.viewportWidthPx, density)

                            // Interactive crop: handles resize the window, inside drags it, outside pans.
                            val cropId = st.cropElementId
                            if (cropId != null) {
                                val cel = st.elements.firstOrNull { it.id == cropId && !it.deleted } ?: return false
                                val pl = layouts.firstOrNull { it.page.id == cel.pageId } ?: return false
                                val handle = cropHandleAt(
                                    cel,
                                    pl.rectSurface.left - controller.scrollX,
                                    pl.rectSurface.top - controller.scrollY,
                                    scalePxPerPt,
                                    density,
                                    pos,
                                ) ?: return false
                                manipKind = ManipKind.CROP
                                manipHandle = handle
                                manipPageIdx = pl.pageIndex
                                manipOriginEl = cel
                                manipLatestEl = cel
                                manipDragged = false
                                return true
                            }

                            // Multi-select drag group (when not in box-select mode)
                            if (st.selectedElementIds.size > 1 && st.tool == GpEditorTool.SELECT && !st.marqueeSelectMode) {
                                for (layout in layouts) {
                                    val pageLeft = layout.rectSurface.left - controller.scrollX
                                    val pageTop = layout.rectSurface.top - controller.scrollY
                                    val groupEls = st.elements.filter {
                                        it.pageId == layout.page.id && it.id in st.selectedElementIds && !it.deleted && !it.locked
                                    }
                                    if (groupEls.isEmpty()) continue
                                    val pdfX = (pos.x - pageLeft) / scalePxPerPt
                                    val pdfY = (pos.y - pageTop) / scalePxPerPt
                                    val bounds = groupEls.map { dev.gullacpdf.android.viewmodel.computeElementVisualBounds(it) }
                                    val unionRect = GpRectF(
                                        bounds.minOf { it.left },
                                        bounds.minOf { it.top },
                                        bounds.maxOf { it.right },
                                        bounds.maxOf { it.bottom },
                                    )
                                    val tol = 10f / controller.zoom.coerceAtLeast(0.25f)
                                    if (unionRect.inflate(tol).contains(pdfX, pdfY)) {
                                        manipKind = ManipKind.MOVE_GROUP
                                        manipPageIdx = layout.pageIndex
                                        manipGroupPageId = layout.page.id
                                        manipOriginGroup = groupEls
                                        manipGroupDxPdf = 0.0
                                        manipGroupDyPdf = 0.0
                                        manipDragged = false
                                        return true
                                    }
                                }
                            }

                            // Marquee box-select mode (drag-select path vertices if a path is selected, else objects)
                            val sel = st.selectedElement
                            if (st.tool == GpEditorTool.SELECT && st.marqueeSelectMode) {
                                val hit = hitPagePdfPoint(pos)
                                if (hit != null) {
                                    val isVertexBox = sel != null && !sel.locked && sel.kind == "path" &&
                                        st.selectedElementIds.size <= 1 &&
                                        sel.pageId == st.pages[hit.first].id
                                    manipKind = if (isVertexBox) ManipKind.MARQUEE_VERTICES else ManipKind.MARQUEE_OBJECTS
                                    manipPageIdx = hit.first
                                    manipStartPdf = hit.second
                                    manipOriginEl = if (isVertexBox) sel else null
                                    manipLatestEl = null
                                    manipDragged = false
                                    return true
                                }
                            }

                            if (sel != null && !sel.locked && st.selectedElementIds.size <= 1) {
                                val pageLayout = layouts.firstOrNull { it.page.id == sel.pageId }
                                if (pageLayout != null) {
                                    val pageLeft = pageLayout.rectSurface.left - controller.scrollX
                                    val pageTop = pageLayout.rectSurface.top - controller.scrollY
                                    val rect = RectF(
                                        pageLeft + (sel.x * scalePxPerPt).toFloat(),
                                        pageTop + (sel.y * scalePxPerPt).toFloat(),
                                        pageLeft + ((sel.x + sel.width) * scalePxPerPt).toFloat(),
                                        pageTop + ((sel.y + sel.height) * scalePxPerPt).toFloat(),
                                    )
                                    val cx = rect.centerX()
                                    val cy = rect.centerY()
                                    val rad = Math.toRadians(-sel.rotationDeg)
                                    val dx = pos.x - cx
                                    val dy = pos.y - cy
                                    val unrotX = if (abs(sel.rotationDeg) > 0.01) (cx + dx * cos(rad) - dy * sin(rad)).toFloat() else pos.x
                                    val unrotY = if (abs(sel.rotationDeg) > 0.01) (cy + dx * sin(rad) + dy * cos(rad)).toFloat() else pos.y

                                    // 1) Top rotation stem handle
                                    val rotY = rect.top - 26f * density
                                    if (hypot(unrotX - cx, unrotY - rotY) <= 24f * density) {
                                        manipKind = ManipKind.ROTATE
                                        manipPageIdx = pageLayout.pageIndex
                                        manipOriginEl = sel
                                        manipLatestEl = sel
                                        manipDragged = false
                                        return true
                                    }

                                    // 2) Vertex node handles for selected path (when in SELECT mode)
                                    if (sel.kind == "path" && sel.points.size >= 2 && st.tool == GpEditorTool.SELECT) {
                                        for ((idx, pt) in sel.points.withIndex()) {
                                            val vx = pageLeft + pt.x * scalePxPerPt
                                            val vy = pageTop + pt.y * scalePxPerPt
                                            if (hypot(pos.x - vx, pos.y - vy) <= 20f * density) {
                                                manipKind = ManipKind.VERTEX
                                                manipVertexIdx = idx
                                                manipVertexIndices = if (idx in st.selectedPathVertexIndices) {
                                                    st.selectedPathVertexIndices
                                                } else {
                                                    setOf(idx)
                                                }
                                                manipPageIdx = pageLayout.pageIndex
                                                manipOriginEl = sel
                                                manipLatestEl = sel
                                                manipDragged = false
                                                return true
                                            }
                                        }
                                    }

                                    // 3) Corner/edge resize handles. Small boxes only expose corners and a
                                    //    tighter touch zone so taps on the content still move / place the caret.
                                    val showMidX = rect.width() >= SELECTION_MID_HANDLE_MIN_DP * density
                                    val showMidY = rect.height() >= SELECTION_MID_HANDLE_MIN_DP * density
                                    val handleTol = (min(rect.width(), rect.height()) * 0.5f)
                                        .coerceIn(12f * density, 22f * density)
                                    val handleMap = buildList {
                                        add("nw" to (rect.left to rect.top))
                                        add("ne" to (rect.right to rect.top))
                                        add("se" to (rect.right to rect.bottom))
                                        add("sw" to (rect.left to rect.bottom))
                                        if (showMidX) {
                                            add("n" to (cx to rect.top))
                                            add("s" to (cx to rect.bottom))
                                        }
                                        if (showMidY) {
                                            add("e" to (rect.right to cy))
                                            add("w" to (rect.left to cy))
                                        }
                                    }
                                    for ((hName, hPt) in handleMap) {
                                        if (hypot(unrotX - hPt.first, unrotY - hPt.second) <= handleTol) {
                                            manipKind = ManipKind.RESIZE
                                            manipHandle = hName
                                            manipPageIdx = pageLayout.pageIndex
                                            manipOriginEl = sel
                                            manipLatestEl = sel
                                            manipDragged = false
                                            return true
                                        }
                                    }

                                    // 4) Selected body move
                                    if (st.tool != GpEditorTool.DRAW &&
                                        st.tool != GpEditorTool.ERASER &&
                                        st.tool != GpEditorTool.HIGHLIGHT &&
                                        st.tool != GpEditorTool.REDACT &&
                                        st.tool != GpEditorTool.LINE
                                    ) {
                                        val hitBox = RectF(rect).apply { inset(-8f * density, -8f * density) }
                                        if (sel.id != st.inlineEditElementId && hitBox.contains(unrotX, unrotY)) {
                                            manipKind = ManipKind.MOVE
                                            manipPageIdx = pageLayout.pageIndex
                                            manipOriginEl = sel
                                            manipLatestEl = sel
                                            manipSiblings = st.elements
                                                .filter { it.pageId == pageLayout.page.id && it.id != sel.id && !it.deleted }
                                                .map { GpRectF.fromLTWH(it.x.toFloat(), it.y.toFloat(), it.width.toFloat(), it.height.toFloat()) }
                                            manipDragged = false
                                            return true
                                        }
                                    }
                                }
                            }

                            // Drag-to-create Shape or Line
                            if (st.tool == GpEditorTool.SHAPE || st.tool == GpEditorTool.LINE) {
                                val hit = hitPagePdfPoint(pos)
                                if (hit != null) {
                                    manipKind = if (st.tool == GpEditorTool.LINE) ManipKind.CREATE_LINE_DRAG else ManipKind.CREATE_SHAPE
                                    manipPageIdx = hit.first
                                    manipStartPdf = hit.second
                                    manipDragged = false
                                    return true
                                }
                            }
                            return false
                        }

                        while (true) {
                            val event = if (longPressArmed) {
                                val remaining = LONG_PRESS_MS - (SystemClock.uptimeMillis() - downTimeMs)
                                if (remaining > 0L) withTimeoutOrNull(remaining) { awaitPointerEvent(PointerEventPass.Main) } else null
                            } else {
                                awaitPointerEvent(PointerEventPass.Main)
                            }
                            if (event == null) {
                                // Finger held still: open the context menu for whatever is under it.
                                longPressArmed = false
                                cancelAllSingleFingerWork()
                                phase = GesturePhase.LONG_PRESSED
                                val hit = hitPagePdfPoint(downPos)
                                if (hit != null) {
                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                    handleSingleTapAt(downPos, forMenu = true)
                                    onLongPress(
                                        GpContextMenuRequest(
                                            screenX = downPos.x,
                                            screenY = downPos.y,
                                            pageIndex = hit.first,
                                            pdfX = hit.second.x,
                                            pdfY = hit.second.y,
                                            elementId = null,
                                        ),
                                    )
                                }
                                continue
                            }
                            val now = SystemClock.uptimeMillis()

                            for (c in event.changes) {
                                if (c.pressed) {
                                    activePointerIds[c.id] = GpPoint(c.position.x, c.position.y)
                                } else {
                                    activePointerIds.remove(c.id)
                                }
                            }

                            val pressedList = event.changes.filter { it.pressed }
                            if (pressedList.size != 1) longPressArmed = false
                            if (pressedList.size >= 2) {
                                // MANDATORY FIX 4: 2+ fingers IMMEDIATELY cancels shape/stroke/manip/double-tap and enters PINCH!
                                if (phase != GesturePhase.PINCH) {
                                    cancelAllSingleFingerWork()
                                    gestureHadMultiTouch = true
                                    inertiaJob?.cancel()
                                    zoomAnimJob?.cancel()
                                    val p0 = pressedList[0].position
                                    val p1 = pressedList[1].position
                                    val midX = (p0.x + p1.x) * 0.5f
                                    val midY = (p0.y + p1.y) * 0.5f
                                    pinchStartDist = max(12f, hypot(p1.x - p0.x, p1.y - p0.y))
                                    pinchStartZoom = controller.zoom
                                    pinchAnchor = ViewportLayoutMath.captureFocalAnchor(
                                        currentState.pages, controller.zoom, controller.scrollX, controller.scrollY,
                                        controller.viewportWidthPx, density, midX, midY,
                                    )
                                    phase = GesturePhase.PINCH
                                    controller.isZoomingGesture = true
                                    controller.activeRenderBucket?.let {
                                        NativePdfBridge.cancelRenderScope("zoom:$it")
                                    }
                                } else {
                                    val p0 = pressedList[0].position
                                    val p1 = pressedList[1].position
                                    val dist = max(12f, hypot(p1.x - p0.x, p1.y - p0.y))
                                    val midX = (p0.x + p1.x) * 0.5f
                                    val midY = (p0.y + p1.y) * 0.5f
                                    val nextZoom = (pinchStartZoom * (dist / pinchStartDist))
                                        .coerceIn(ViewportLayoutMath.MIN_ZOOM, ViewportLayoutMath.MAX_ZOOM)
                                    val anchor = pinchAnchor
                                    if (anchor != null && currentState.pages.isNotEmpty()) {
                                        val (sx, sy) = ViewportLayoutMath.computeFocalPreservingScroll(
                                            currentState.pages, anchor, nextZoom, midX, midY,
                                            controller.viewportWidthPx, controller.viewportHeightPx, density,
                                        )
                                        controller.zoom = nextZoom
                                        controller.scrollX = sx
                                        controller.scrollY = sy
                                        syncActivePageAndNotify(immediate = false)
                                        if (now - lastBucketRenderMs > 120L) {
                                            lastBucketRenderMs = now
                                            scheduleVisibleTiles(immediate = false)
                                        }
                                    }
                                }
                                pressedList.forEach { it.consume() }
                                continue
                            }

                            // 0 or 1 pointer active
                            if (pressedList.size == 1) {
                                val ch = pressedList.first()
                                val pos = GpPoint(ch.position.x, ch.position.y)

                                // Transition from 2-finger PINCH -> 1-finger PAN cleanly without anchor jump
                                if (phase == GesturePhase.PINCH) {
                                    primaryId = ch.id
                                    downPos = pos
                                    lastPos = pos
                                    phase = GesturePhase.PAN
                                    controller.isZoomingGesture = false
                                    velSamples.clear()
                                    velSamples.add(now to pos)
                                    scheduleVisibleTiles(immediate = true)
                                    ch.consume()
                                    continue
                                }

                                // Fresh single-finger DOWN
                                if (ch.changedToDownIgnoreConsumed()) {
                                    inertiaJob?.cancel()
                                    zoomAnimJob?.cancel()
                                    primaryId = ch.id
                                    downPos = pos
                                    lastPos = pos
                                    gestureHadMultiTouch = false
                                    velSamples.clear()
                                    velSamples.add(now to pos)

                                    val st = currentState
                                    val isWithinCooldown = (now - lastPinchEndMs) < 180L
                                    val isDoubleTapCandidate = !isWithinCooldown &&
                                        (now - lastTapUpMs) <= 300L &&
                                        hypot(pos.x - lastTapUpPos.x, pos.y - lastTapUpPos.y) <= 32f * density

                                    val drawingActive = st.mode == GpAppMode.EDIT &&
                                        (st.tool == GpEditorTool.DRAW ||
                                            st.tool == GpEditorTool.ERASER ||
                                            st.tool == GpEditorTool.HIGHLIGHT ||
                                            st.tool == GpEditorTool.REDACT)

                                    downTimeMs = now
                                    val canLongPress = st.mode == GpAppMode.EDIT &&
                                        st.ghostSignature == null &&
                                        st.cropElementId == null &&
                                        st.inlineEditElementId == null &&
                                        !isDoubleTapCandidate &&
                                        (st.tool == GpEditorTool.SELECT || st.tool == GpEditorTool.TEXT) &&
                                        !st.marqueeSelectMode
                                    longPressArmed = false

                                    // Check Manip (handles, drag shape/line) FIRST when not drawing ink and not double-tapping for zoom
                                    if (!isWithinCooldown && !isDoubleTapCandidate && tryBeginManip(pos)) {
                                        phase = GesturePhase.MANIP
                                        longPressArmed = canLongPress && (manipKind == ManipKind.MOVE || manipKind == ManipKind.MOVE_GROUP)
                                        ch.consume()
                                        continue
                                    }

                                    // Check Double-Tap candidate for Adobe One-Handed Zoom (in View or Select/non-draw tools)
                                    if (isDoubleTapCandidate && !drawingActive) {
                                        phase = GesturePhase.PENDING_DOUBLE_TAP
                                        adobeStartZoom = controller.zoom
                                        adobeAnchor = ViewportLayoutMath.captureFocalAnchor(
                                            st.pages, controller.zoom, controller.scrollX, controller.scrollY,
                                            controller.viewportWidthPx, density, pos.x, pos.y,
                                        )
                                        ch.consume()
                                        continue
                                    }

                                    // Freehand / Eraser / Highlight / Redact stroke
                                    if (drawingActive && !isWithinCooldown && ch.type != PointerType.Unknown) {
                                        val hit = hitPagePdfPoint(pos)
                                        if (hit != null) {
                                            val (hitPageIdx, hitPdfPt) = hit
                                            if (st.tool == GpEditorTool.ERASER) {
                                                phase = GesturePhase.DRAW_STROKE
                                                onEraseAt(hitPdfPt, hitPageIdx)
                                            } else {
                                                phase = GesturePhase.DRAW_STROKE
                                                draftStrokePageIdx = hitPageIdx
                                                draftStrokePdf.clear()
                                                draftStrokePdf.add(hitPdfPt)
                                                controller.liveStrokeColor = when (st.tool) {
                                                    GpEditorTool.REDACT -> 0xFF000000.toInt()
                                                    GpEditorTool.HIGHLIGHT -> 0x66FACC15
                                                    else -> st.activeStrokeColorValue
                                                }
                                                controller.liveStrokeWidthPx = if (st.tool == GpEditorTool.DRAW) {
                                                    (st.activeStrokeWidth.toFloat() * controller.zoom * density).coerceAtLeast(2f)
                                                } else {
                                                    14f * controller.zoom * density
                                                }
                                                controller.liveStrokeScreenPts = listOf(pos)
                                            }
                                            ch.consume()
                                            continue
                                        }
                                    }

                                    phase = GesturePhase.IDLE
                                    longPressArmed = canLongPress && !isWithinCooldown
                                    ch.consume()
                                    continue
                                }

                                // Single-finger MOVE
                                if (ch.id == primaryId) {
                                    val st = currentState
                                    if (longPressArmed && hypot(pos.x - downPos.x, pos.y - downPos.y) >= touchSlopPx) {
                                        longPressArmed = false
                                    }
                                    when (phase) {
                                        GesturePhase.LONG_PRESSED -> {}
                                        GesturePhase.PENDING_DOUBLE_TAP -> {
                                            if (hypot(pos.x - downPos.x, pos.y - downPos.y) >= touchSlopPx) {
                                                phase = GesturePhase.ADOBE_ZOOM
                                                controller.isZoomingGesture = true
                                                controller.isAdobeZoomActive = true
                                            }
                                        }
                                        GesturePhase.ADOBE_ZOOM -> {
                                            // MANDATORY FIX 3: Drag DOWN zooms IN, Drag UP zooms OUT, anchored at double-tap focal point!
                                            val dy = pos.y - downPos.y
                                            val nextZoom = (adobeStartZoom * exp(dy / (190f * density)))
                                                .coerceIn(ViewportLayoutMath.MIN_ZOOM, ViewportLayoutMath.MAX_ZOOM)
                                            val anchor = adobeAnchor
                                            if (anchor != null && st.pages.isNotEmpty()) {
                                                val (sx, sy) = ViewportLayoutMath.computeFocalPreservingScroll(
                                                    st.pages, anchor, nextZoom, downPos.x, downPos.y,
                                                    controller.viewportWidthPx, controller.viewportHeightPx, density,
                                                )
                                                controller.zoom = nextZoom
                                                controller.scrollX = sx
                                                controller.scrollY = sy
                                                syncActivePageAndNotify(immediate = false)
                                                if (now - lastBucketRenderMs > 120L) {
                                                    lastBucketRenderMs = now
                                                    scheduleVisibleTiles(immediate = false)
                                                }
                                            }
                                        }
                                        GesturePhase.DRAW_STROKE -> {
                                            val hit = hitPagePdfPoint(pos)
                                            if (hit != null) {
                                                val (hitPageIdx, hitPdfPt) = hit
                                                if (st.tool == GpEditorTool.ERASER) {
                                                    onEraseAt(hitPdfPt, hitPageIdx)
                                                } else if (hitPageIdx == draftStrokePageIdx) {
                                                    draftStrokePdf.add(hitPdfPt)
                                                    controller.liveStrokeScreenPts = controller.liveStrokeScreenPts + pos
                                                }
                                            }
                                        }
                                        GesturePhase.MANIP -> {
                                            if (!manipDragged && hypot(pos.x - downPos.x, pos.y - downPos.y) >= touchSlopPx) {
                                                manipDragged = true
                                            }
                                            if (manipDragged) {
                                                val scale = (controller.zoom * density).coerceAtLeast(0.01f)
                                                if (manipKind == ManipKind.MARQUEE_OBJECTS || manipKind == ManipKind.MARQUEE_VERTICES) {
                                                    val layouts = ViewportLayoutMath.computePageRects(st.pages, controller.zoom, controller.viewportWidthPx, density)
                                                    if (manipPageIdx in layouts.indices) {
                                                        val l = layouts[manipPageIdx]
                                                        val rawX = (pos.x + controller.scrollX - l.rectSurface.left) / scale
                                                        val rawY = (pos.y + controller.scrollY - l.rectSurface.top) / scale
                                                        val endPdf = GpPoint(
                                                            rawX.coerceIn(0f, l.page.displayWidth.toFloat()),
                                                            rawY.coerceIn(0f, l.page.displayHeight.toFloat()),
                                                        )
                                                        controller.draftMarqueePreview = DraftMarqueePreview(
                                                            pageIndex = manipPageIdx,
                                                            rectPdf = GpRectF(
                                                                min(manipStartPdf.x, endPdf.x),
                                                                min(manipStartPdf.y, endPdf.y),
                                                                max(manipStartPdf.x, endPdf.x),
                                                                max(manipStartPdf.y, endPdf.y),
                                                            ),
                                                            isVertexMode = manipKind == ManipKind.MARQUEE_VERTICES,
                                                        )
                                                    }
                                                } else if (manipKind == ManipKind.MOVE_GROUP) {
                                                    val dxPdf = (pos.x - downPos.x).toDouble() / scale
                                                    val dyPdf = (pos.y - downPos.y).toDouble() / scale
                                                    manipGroupDxPdf = dxPdf
                                                    manipGroupDyPdf = dyPdf
                                                    controller.transientElements = manipOriginGroup.associate { el ->
                                                        val movedPts = if (el.points.isNotEmpty()) {
                                                            el.points.map { p -> p.copy(x = p.x + dxPdf.toFloat(), y = p.y + dyPdf.toFloat()) }
                                                        } else el.points
                                                        el.id to el.copy(x = el.x + dxPdf, y = el.y + dyPdf, points = movedPts)
                                                    }
                                                } else if (manipKind == ManipKind.CREATE_SHAPE || manipKind == ManipKind.CREATE_LINE_DRAG) {
                                                    val layouts = ViewportLayoutMath.computePageRects(st.pages, controller.zoom, controller.viewportWidthPx, density)
                                                    if (manipPageIdx in layouts.indices) {
                                                        val l = layouts[manipPageIdx]
                                                        val endPdf = GpPoint(
                                                            (pos.x + controller.scrollX - l.rectSurface.left) / scale,
                                                            (pos.y + controller.scrollY - l.rectSurface.top) / scale,
                                                        )
                                                        val minX = min(manipStartPdf.x, endPdf.x)
                                                        val minY = min(manipStartPdf.y, endPdf.y)
                                                        val maxX = max(manipStartPdf.x, endPdf.x)
                                                        val maxY = max(manipStartPdf.y, endPdf.y)
                                                        controller.draftShapePreview = DraftShapePreview(
                                                            pageIndex = manipPageIdx,
                                                            rectPdf = GpRectF(minX, minY, maxX, maxY),
                                                            shapeType = st.activeShapeType,
                                                            isLine = manipKind == ManipKind.CREATE_LINE_DRAG,
                                                            startPdf = manipStartPdf,
                                                            endPdf = endPdf,
                                                            strokeColorValue = st.activeStrokeColorValue,
                                                            fillColorValue = st.activeFillColorValue,
                                                            strokeWidth = st.activeStrokeWidth.toFloat(),
                                                        )
                                                    }
                                                } else {
                                                    val origin = manipOriginEl
                                                    if (origin != null) {
                                                        val dxPdf = (pos.x - downPos.x).toDouble() / scale
                                                        val dyPdf = (pos.y - downPos.y).toDouble() / scale
                                                        when (manipKind) {
                                                            ManipKind.MOVE -> {
                                                                var nx = origin.x + dxPdf
                                                                var ny = origin.y + dyPdf
                                                                if (manipPageIdx in st.pages.indices) {
                                                                    val page = st.pages[manipPageIdx]
                                                                    val snapped = ViewportLayoutMath.computeSnapPosition(
                                                                        nx, ny, origin.width, origin.height,
                                                                        page.displayWidth, page.displayHeight, manipSiblings,
                                                                    )
                                                                    nx = snapped.x
                                                                    ny = snapped.y
                                                                    controller.snapGuides = if (snapped.vertGuideX != null || snapped.horizGuideY != null) {
                                                                        SnapGuideLines(manipPageIdx, snapped.vertGuideX, snapped.horizGuideY)
                                                                    } else null
                                                                }
                                                                val movedPts = if (origin.points.isNotEmpty()) {
                                                                    val ddx = (nx - origin.x).toFloat()
                                                                    val ddy = (ny - origin.y).toFloat()
                                                                    origin.points.map { it.copy(x = it.x + ddx, y = it.y + ddy) }
                                                                } else origin.points
                                                                val next = origin.copy(x = nx, y = ny, points = movedPts)
                                                                manipLatestEl = next
                                                                controller.transientElement = next
                                                            }
                                                            ManipKind.RESIZE -> {
                                                                val lockAspect = origin.kind == "image" || origin.kind == "imageReplacement" || origin.kind == "signature"
                                                                val r = ViewportLayoutMath.computeRotatedResizeRect(
                                                                    origin.x, origin.y, origin.width, origin.height,
                                                                    origin.rotationDeg, manipHandle, dxPdf, dyPdf, lockAspect,
                                                                )
                                                                val sx = r[2] / origin.width.coerceAtLeast(1.0)
                                                                val sy = r[3] / origin.height.coerceAtLeast(1.0)
                                                                val scaledPts = if (origin.points.isNotEmpty()) {
                                                                    origin.points.map {
                                                                        it.copy(x = (r[0] + (it.x - origin.x) * sx).toFloat(), y = (r[1] + (it.y - origin.y) * sy).toFloat())
                                                                    }
                                                                } else origin.points
                                                                val next = origin.copy(x = r[0], y = r[1], width = r[2], height = r[3], points = scaledPts)
                                                                manipLatestEl = next
                                                                controller.transientElement = next
                                                            }
                                                            ManipKind.ROTATE -> {
                                                                val layouts = controller.getLayouts(st.pages, density)
                                                                if (manipPageIdx in layouts.indices) {
                                                                    val l = layouts[manipPageIdx]
                                                                    val cx = l.rectSurface.left - controller.scrollX + ((origin.x + origin.width * 0.5) * scale).toFloat()
                                                                    val cy = l.rectSurface.top - controller.scrollY + ((origin.y + origin.height * 0.5) * scale).toFloat()
                                                                    var deg = Math.toDegrees(atan2((pos.x - cx).toDouble(), -(pos.y - cy).toDouble()))
                                                                    for (snap in doubleArrayOf(0.0, 90.0, 180.0, 270.0, -90.0, -180.0)) {
                                                                        if (abs(deg - snap) < 4.0) {
                                                                            deg = snap
                                                                            break
                                                                        }
                                                                    }
                                                                    val next = origin.copy(rotationDeg = deg)
                                                                    manipLatestEl = next
                                                                    controller.transientElement = next
                                                                }
                                                            }
                                                            ManipKind.CROP -> {
                                                                val rad = Math.toRadians(-origin.rotationDeg)
                                                                val sdx = (pos.x - downPos.x).toDouble()
                                                                val sdy = (pos.y - downPos.y).toDouble()
                                                                val ldx = (sdx * cos(rad) - sdy * sin(rad)) / scale
                                                                val ldy = (sdx * sin(rad) + sdy * cos(rad)) / scale
                                                                val ff = CropMath.fullFrameLocal(origin)
                                                                val d1 = CropMath.dragDisplayCrop(
                                                                    CropMath.displayCropOf(origin),
                                                                    manipHandle,
                                                                    (ldx / ff.width.coerceAtLeast(1.0)).toFloat(),
                                                                    (ldy / ff.height.coerceAtLeast(1.0)).toFloat(),
                                                                )
                                                                val next = CropMath.withDisplayCrop(origin, d1)
                                                                manipLatestEl = next
                                                                controller.transientElement = next
                                                            }
                                                            ManipKind.VERTEX -> {
                                                                val moveSet = if (manipVertexIdx in manipVertexIndices) manipVertexIndices else setOf(manipVertexIdx)
                                                                val anyValid = moveSet.any { it in origin.points.indices }
                                                                if (anyValid) {
                                                                    val newPts = origin.points.mapIndexed { idx, op ->
                                                                        if (idx in moveSet) {
                                                                            op.copy(x = (op.x + dxPdf).toFloat(), y = (op.y + dyPdf).toFloat())
                                                                        } else {
                                                                            op
                                                                        }
                                                                    }
                                                                    val next = origin.withUpdatedPoints(newPts)
                                                                    manipLatestEl = next
                                                                    controller.transientElement = next
                                                                }
                                                            }
                                                            else -> {}
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        GesturePhase.IDLE, GesturePhase.PAN -> {
                                            if (phase == GesturePhase.IDLE && hypot(pos.x - downPos.x, pos.y - downPos.y) >= touchSlopPx) {
                                                phase = GesturePhase.PAN
                                            }
                                            if (phase == GesturePhase.PAN) {
                                                val dx = pos.x - lastPos.x
                                                val dy = pos.y - lastPos.y
                                                lastPos = pos
                                                velSamples.add(now to pos)
                                                if (velSamples.size > 10) velSamples.removeAt(0)

                                                val bounds = controller.getBounds(st.pages, density)
                                                controller.scrollX = (controller.scrollX - dx).coerceIn(0f, bounds.maxScrollX)
                                                controller.scrollY = (controller.scrollY - dy).coerceIn(0f, bounds.maxScrollY)
                                                syncActivePageAndNotify(immediate = false)
                                                if (now - lastPanTileMs >= 90L) {
                                                    lastPanTileMs = now
                                                    scheduleVisibleTiles(immediate = true)
                                                }
                                            }
                                        }
                                        GesturePhase.PINCH -> {}
                                    }
                                    ch.consume()
                                }
                                continue
                            }

                            // All pointers lifted (0 pressed)
                            if (pressedList.isEmpty()) {
                                val upPos = event.changes.lastOrNull()?.position?.let { GpPoint(it.x, it.y) } ?: lastPos
                                val st = currentState

                                longPressArmed = false
                                when (phase) {
                                    GesturePhase.LONG_PRESSED -> {}
                                    GesturePhase.PINCH -> {
                                        lastPinchEndMs = now
                                        controller.isZoomingGesture = false
                                        val fit = controller.fitWidthZoom
                                        if (fit > 0f && abs(controller.zoom - fit) / fit <= 0.04f) {
                                            controller.zoom = fit
                                        }
                                        syncActivePageAndNotify(immediate = true)
                                        scheduleVisibleTiles(immediate = true)
                                    }
                                    GesturePhase.ADOBE_ZOOM -> {
                                        controller.isZoomingGesture = false
                                        controller.isAdobeZoomActive = false
                                        syncActivePageAndNotify(immediate = true)
                                        scheduleVisibleTiles(immediate = true)
                                    }
                                    GesturePhase.PENDING_DOUBLE_TAP -> {
                                        lastTapUpMs = 0L
                                        animateDoubleTapZoom(upPos)
                                    }
                                    GesturePhase.DRAW_STROKE -> {
                                        val pts = draftStrokePdf.toList()
                                        val pIdx = draftStrokePageIdx
                                        controller.liveStrokeScreenPts = emptyList()
                                        draftStrokePdf.clear()
                                        draftStrokePageIdx = -1
                                        if (!gestureHadMultiTouch && pIdx in st.pages.indices && pts.isNotEmpty()) {
                                            val page = st.pages[pIdx]
                                            var minX = Float.POSITIVE_INFINITY
                                            var minY = Float.POSITIVE_INFINITY
                                            var maxX = Float.NEGATIVE_INFINITY
                                            var maxY = Float.NEGATIVE_INFINITY
                                            for (p in pts) {
                                                if (p.x < minX) minX = p.x
                                                if (p.y < minY) minY = p.y
                                                if (p.x > maxX) maxX = p.x
                                                if (p.y > maxY) maxY = p.y
                                            }
                                            val w = max(12.0, (maxX - minX).toDouble())
                                            val h = max(12.0, (maxY - minY).toDouble())
                                            when (st.tool) {
                                                GpEditorTool.REDACT -> onAddElement(
                                                    GpOverlayElement(
                                                        id = "red_${System.nanoTime()}",
                                                        pageId = page.id,
                                                        kind = "highlight",
                                                        x = minX.toDouble(),
                                                        y = minY.toDouble(),
                                                        width = w,
                                                        height = h,
                                                        colorValue = 0xFF000000.toInt(),
                                                        fillColorValue = 0xFF000000.toInt(),
                                                        isRedact = true,
                                                    ),
                                                    false,
                                                )
                                                GpEditorTool.HIGHLIGHT -> onAddElement(
                                                    GpOverlayElement(
                                                        id = "hl_${System.nanoTime()}",
                                                        pageId = page.id,
                                                        kind = "highlight",
                                                        x = minX.toDouble(),
                                                        y = minY.toDouble(),
                                                        width = w,
                                                        height = max(14.0, h),
                                                        fillColorValue = 0xFFFACC15.toInt(),
                                                        opacity = 0.42,
                                                    ),
                                                    false,
                                                )
                                                GpEditorTool.DRAW -> onAddElement(
                                                    GpOverlayElement(
                                                        id = "ink_${System.nanoTime()}",
                                                        pageId = page.id,
                                                        kind = "ink",
                                                        x = minX.toDouble(),
                                                        y = minY.toDouble(),
                                                        width = w,
                                                        height = h,
                                                        colorValue = st.activeStrokeColorValue,
                                                        strokeWidth = st.activeStrokeWidth,
                                                        points = pts,
                                                    ),
                                                    false,
                                                )
                                                else -> {}
                                            }
                                        }
                                    }
                                    GesturePhase.MANIP -> {
                                        val preview = controller.draftShapePreview
                                        val marqueePreview = controller.draftMarqueePreview
                                        val latest = manipLatestEl
                                        val origin = manipOriginEl
                                        val wasDragged = manipDragged
                                        val mKind = manipKind
                                        val mPageIdx = manipPageIdx
                                        val mStartPdf = manipStartPdf
                                        val mVertexIdx = manipVertexIdx
                                        val mGroupPageId = manipGroupPageId
                                        val mGroupIds = manipOriginGroup.map { it.id }.toSet()
                                        val mGroupDx = manipGroupDxPdf
                                        val mGroupDy = manipGroupDyPdf
                                        cancelAllSingleFingerWork()

                                        if (!gestureHadMultiTouch) {
                                            if (mKind == ManipKind.CROP) {
                                                if (wasDragged && latest != null) onCropUpdate(latest)
                                            } else if (mKind == ManipKind.MARQUEE_OBJECTS && wasDragged && marqueePreview != null && mPageIdx in st.pages.indices) {
                                                val r = marqueePreview.rectPdf
                                                if (r.width >= 4f || r.height >= 4f) {
                                                    onSelectElementsInRect(mPageIdx, r, false)
                                                }
                                            } else if (mKind == ManipKind.MARQUEE_VERTICES && wasDragged && marqueePreview != null && origin != null) {
                                                val r = marqueePreview.rectPdf
                                                if (r.width >= 4f || r.height >= 4f) {
                                                    val inflated = r.inflate(4f)
                                                    val hitIndices = origin.points.indices.filterTo(LinkedHashSet()) { idx ->
                                                        val p = origin.points[idx]
                                                        inflated.contains(p.x, p.y)
                                                    }
                                                    onSetSelectedPathVertexIndices(hitIndices)
                                                }
                                            } else if (mKind == ManipKind.MOVE_GROUP && wasDragged && mGroupPageId.isNotEmpty() && mGroupIds.isNotEmpty()) {
                                                onMoveSelectedElementsBy(mGroupPageId, mGroupIds, mGroupDx, mGroupDy)
                                            } else if (mKind == ManipKind.CREATE_SHAPE && wasDragged && preview != null && mPageIdx in st.pages.indices) {
                                                val page = st.pages[mPageIdx]
                                                val r = preview.rectPdf
                                                if (r.width >= 10f && r.height >= 10f) {
                                                    onAddElement(
                                                        GpOverlayElement(
                                                            id = "shp_${System.nanoTime()}",
                                                            pageId = page.id,
                                                            kind = "shape",
                                                            shapeType = st.activeShapeType,
                                                            x = r.left.toDouble(),
                                                            y = r.top.toDouble(),
                                                            width = r.width.toDouble(),
                                                            height = r.height.toDouble(),
                                                            colorValue = st.activeStrokeColorValue,
                                                            fillColorValue = st.activeFillColorValue,
                                                            strokeWidth = st.activeStrokeWidth,
                                                        ),
                                                        true, // Auto-return to Select unless toolLocked!
                                                    )
                                                }
                                            } else if (mKind == ManipKind.CREATE_LINE_DRAG && wasDragged && preview != null && mPageIdx in st.pages.indices) {
                                                onLineModeDragSegment(mPageIdx, mStartPdf, preview.endPdf)
                                            } else if (!wasDragged) {
                                                if (mKind == ManipKind.VERTEX && mVertexIdx >= 0) {
                                                    onTogglePathVertexIndex(mVertexIdx)
                                                } else if (mKind == ManipKind.MARQUEE_VERTICES && origin != null) {
                                                    val layouts = controller.getLayouts(st.pages, density)
                                                    val pageLayout = layouts.getOrNull(mPageIdx)
                                                    val scale = controller.zoom * density
                                                    val pLeft = (pageLayout?.rectSurface?.left ?: 0f) - controller.scrollX
                                                    val pTop = (pageLayout?.rectSurface?.top ?: 0f) - controller.scrollY
                                                    val tappedVIdx = if (pageLayout != null) {
                                                        origin.points.indexOfFirst { pt ->
                                                            hypot(upPos.x - (pLeft + pt.x * scale), upPos.y - (pTop + pt.y * scale)) <= 20f * density
                                                        }
                                                    } else -1
                                                    if (tappedVIdx >= 0) {
                                                        onTogglePathVertexIndex(tappedVIdx)
                                                    } else {
                                                        handleSingleTapAt(upPos)
                                                    }
                                                } else {
                                                    handleSingleTapAt(upPos)
                                                }
                                            } else if (latest != null) {
                                                onUpdateElement(latest, true)
                                            }
                                        }
                                    }
                                    GesturePhase.PAN -> {
                                        if (gestureHadMultiTouch) lastPinchEndMs = now
                                        // Smooth exponential inertial fling
                                        if (velSamples.size >= 2) {
                                            val lastS = velSamples.last()
                                            if (now - lastS.first <= 45L) {
                                                val firstS = velSamples.first()
                                                val dtSec = (lastS.first - firstS.first) / 1000f
                                                if (dtSec > 0.006f) {
                                                    var vx = -(lastS.second.x - firstS.second.x) / dtSec
                                                    var vy = -(lastS.second.y - firstS.second.y) / dtSec
                                                    if (hypot(vx, vy) > 120f) {
                                                        inertiaJob?.cancel()
                                                        inertiaJob = scope.launch {
                                                            var prevNs = withFrameNanos { it }
                                                            var lastFlingTileNs = prevNs
                                                            while (isActive && hypot(vx, vy) > 20f) {
                                                                val curNs = withFrameNanos { it }
                                                                val dtMs = ((curNs - prevNs) / 1_000_000f).coerceIn(1f, 48f)
                                                                prevNs = curNs
                                                                val decay = exp(-dtMs / 325f)
                                                                vx *= decay
                                                                vy *= decay
                                                                val dtS = dtMs / 1000f
                                                                val curSt = currentState
                                                                val bounds = controller.getBounds(curSt.pages, density)
                                                                controller.scrollX = (controller.scrollX + vx * dtS).coerceIn(0f, bounds.maxScrollX)
                                                                controller.scrollY = (controller.scrollY + vy * dtS).coerceIn(0f, bounds.maxScrollY)
                                                                syncActivePageAndNotify(immediate = false)
                                                                if (curNs - lastFlingTileNs >= 110_000_000L) {
                                                                    lastFlingTileNs = curNs
                                                                    scheduleVisibleTiles(immediate = true)
                                                                }
                                                            }
                                                            syncActivePageAndNotify(immediate = true)
                                                            scheduleVisibleTiles(immediate = true)
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        scheduleVisibleTiles(immediate = true)
                                    }
                                    GesturePhase.IDLE -> {
                                        if (!gestureHadMultiTouch && (now - lastPinchEndMs) >= 180L) {
                                            lastTapUpMs = now
                                            lastTapUpPos = upPos
                                            handleSingleTapAt(upPos)
                                        }
                                    }
                                }

                                phase = GesturePhase.IDLE
                                primaryId = null
                                gestureHadMultiTouch = false
                                velSamples.clear()
                            }
                        }
                    }
                },
        ) {
            val tilePaint = remember { Paint().apply { isFilterBitmap = true } }
            val paperPaint = remember { Paint() }
            val shadowPaint = remember { Paint().apply { color = 0x33000000 } }
            val hlPaint = remember { Paint() }

            Canvas(modifier = Modifier.fillMaxSize().clipToBounds()) {
                // Read reactive ticks/state inside Canvas draw scope ONLY
                @Suppress("UNUSED_VARIABLE")
                val tick = controller.tilePaintTick
                val curZoom = controller.zoom
                val curScrollX = controller.scrollX
                val curScrollY = controller.scrollY
                val scalePxPerPt = curZoom * density

                // MANDATORY FIX 1: Strict viewport clipping on native Canvas
                clipRect(left = 0f, top = 0f, right = size.width, bottom = size.height) {
                    val layouts = controller.getLayouts(state.pages, density, curZoom, size.width)
                    val tileZoom = ViewportLayoutMath.quantizeTileZoom(curZoom, controller.fitWidthZoom)
                    val scaleBucket = ViewportLayoutMath.bucketKey(tileZoom)
                    val themeKey = state.theme.engineKey
                    val nc = drawContext.canvas.nativeCanvas

                    paperPaint.color = when {
                        state.theme == GpReadingTheme.DARK && state.darkPaperInvert -> 0xFF1E293B.toInt()
                        state.theme == GpReadingTheme.SEPIA -> 0xFFF6ECD9.toInt()
                        else -> 0xFFFFFFFF.toInt()
                    }

                    for (layout in layouts) {
                        val destLeft = layout.rectSurface.left - curScrollX
                        val destTop = layout.rectSurface.top - curScrollY
                        val destRight = destLeft + layout.rectSurface.width
                        val destBottom = destTop + layout.rectSurface.height
                        if (destBottom < -40f || destTop > size.height + 40f ||
                            destRight < -40f || destLeft > size.width + 40f
                        ) {
                            continue
                        }

                        val destPage = RectF(destLeft, destTop, destRight, destBottom)
                        nc.drawRoundRect(
                            RectF(destLeft, destTop + 3f * density, destRight, destBottom + 3f * density),
                            3f * density, 3f * density, shadowPaint,
                        )
                        nc.drawRect(destPage, paperPaint)

                        val analysis = state.pageAnalyses[layout.page.id]
                        val pageTransBg = pageNeedsTransparentPdf(layout.page.id, state.elements, analysis)
                        if (pageTransBg) {
                            nc.save()
                            nc.clipRect(destPage)
                            overlayPainter.drawOverlays(
                                canvas = drawContext.canvas,
                                layouts = listOf(layout),
                                elements = state.elements,
                                transientOverride = controller.transientElement,
                                selectedElementId = if (state.cropElementId != null) null else state.selectedElementId,
                                isEditMode = state.mode == GpAppMode.EDIT,
                                activeTool = state.tool,
                                activePolylineId = state.activePolylineId,
                                pendingPolylinePageIndex = state.pendingPolylinePageIndex,
                                pendingPolylineAnchor = state.pendingPolylineAnchor,
                                draftShapePreview = controller.draftShapePreview,
                                liveStrokeScreenPts = controller.liveStrokeScreenPts,
                                liveStrokeColor = controller.liveStrokeColor,
                                liveStrokeWidthPx = controller.liveStrokeWidthPx,
                                snapGuides = controller.snapGuides,
                                ghostSignature = state.ghostSignature,
                                activePageIndex = state.activePageIndex,
                                pageNumbering = state.pageNumbering,
                                totalPages = state.pages.size,
                                scrollX = curScrollX,
                                scrollY = curScrollY,
                                scalePxPerPt = scalePxPerPt,
                                density = density,
                                extractedFonts = state.extractedFonts,
                                customTtfBytes = state.customTtfBytes,
                                pageAnalyses = state.pageAnalyses,
                                renderPass = OverlayRenderPass.BEHIND_ONLY,
                                selectedElementIds = if (state.cropElementId != null) emptySet() else state.selectedElementIds,
                                selectedPathVertexIndices = state.selectedPathVertexIndices,
                                draftMarqueePreview = controller.draftMarqueePreview,
                                transientOverrides = controller.transientElements,
                                cleanMetaForPage = { pid ->
                                    controller.displayedDocByPage[pid]?.let { state.cleanPreviewMeta[it] }
                                },
                            )
                            nc.restore()
                        }

                        val hasDeletedReplacements = state.elements.any {
                            it.deleted && it.pageId == layout.page.id &&
                                (it.kind == "textEdit" || it.kind == "imageReplacement" || it.kind == "shapeReplacement")
                        }
                        val cleanDocId = state.cleanPreviewDocIds[layout.page.id]
                        val effectiveDocId = cleanDocId ?: layout.page.sourceDocId
                        val effectivePageIdx = if (cleanDocId != null) 0 else layout.page.sourcePageIndex
                        if (effectiveDocId != "blank") {
                            val (targetWpx, targetHpx) = ViewportLayoutMath.computeTotalPagePixels(layout.page, tileZoom, density)
                            // When every visible tile of the sharp target bucket is ready, skip the
                            // full-page preview + stale-bucket underlays entirely (they were being
                            // overdrawn every frame, costing several full-screen bitmap blits).
                            val targetComplete = bucketTilesCoverVisible(
                                tileCache = tileCache,
                                docId = effectiveDocId,
                                pageIndex = effectivePageIdx,
                                userRotation = layout.page.userRotation,
                                themeKey = themeKey,
                                scaleBucket = scaleBucket,
                                totalPageWpx = targetWpx,
                                totalPageHpx = targetHpx,
                                destPage = destPage,
                                viewW = size.width,
                                viewH = size.height,
                                transparentBg = pageTransBg,
                            )
                            var drewStaleDoc = false
                            if (targetComplete) {
                                controller.lastCompleteDocByPage[layout.page.id] =
                                    Triple(effectiveDocId, effectivePageIdx, pageTransBg)
                                controller.displayedDocByPage[layout.page.id] = effectiveDocId
                            } else {
                                // A freshly swapped clean preview is still rendering: keep showing the
                                // last fully sharp document instead of flashing the blurry preview.
                                val last = controller.lastCompleteDocByPage[layout.page.id]
                                if (last != null && last.first != effectiveDocId) {
                                    val (lastTw, lastTh) = ViewportLayoutMath.computeTotalPagePixels(layout.page, tileZoom, density)
                                    if (bucketTilesCoverVisible(
                                            tileCache, last.first, last.second, layout.page.userRotation, themeKey,
                                            scaleBucket, lastTw, lastTh, destPage, size.width, size.height, last.third,
                                        )
                                    ) {
                                        paintBucketTiles(
                                            nc = nc,
                                            tileCache = tileCache,
                                            docId = last.first,
                                            pageIndex = last.second,
                                            userRotation = layout.page.userRotation,
                                            themeKey = themeKey,
                                            scaleBucket = scaleBucket,
                                            totalPageWpx = lastTw,
                                            totalPageHpx = lastTh,
                                            destPage = destPage,
                                            viewW = size.width,
                                            viewH = size.height,
                                            paint = tilePaint,
                                            transparentBg = last.third,
                                        )
                                        drewStaleDoc = true
                                        controller.displayedDocByPage[layout.page.id] = last.first
                                    }
                                }
                                if (!drewStaleDoc) controller.displayedDocByPage[layout.page.id] = effectiveDocId
                            }
                            if (!targetComplete && !drewStaleDoc) {
                                // Layer 1: Preview fallback (preserve clean preview or fallback to source preview when nothing is deleted)
                                val prevKey = TileKey(
                                    docId = effectiveDocId,
                                    pageIndex = effectivePageIdx,
                                    tileX = 0,
                                    tileY = 0,
                                    scaleBucket = "preview",
                                    rotation = layout.page.userRotation,
                                    themeKey = themeKey,
                                    isPreview = true,
                                    transparentBg = pageTransBg,
                                )
                                val cachedPreview = tileCache.get(prevKey)
                                if (cachedPreview != null && !cachedPreview.bitmap.isRecycled) {
                                    nc.drawBitmap(cachedPreview.bitmap, Rect(0, 0, cachedPreview.width, cachedPreview.height), destPage, tilePaint)
                                } else if (cleanDocId != null && !hasDeletedReplacements && !pageTransBg) {
                                    val srcPrevKey = prevKey.copy(
                                        docId = layout.page.sourceDocId,
                                        pageIndex = layout.page.sourcePageIndex,
                                    )
                                    tileCache.get(srcPrevKey)?.let { srcPrev ->
                                        if (!srcPrev.bitmap.isRecycled) {
                                            nc.drawBitmap(srcPrev.bitmap, Rect(0, 0, srcPrev.width, srcPrev.height), destPage, tilePaint)
                                        }
                                    }
                                }

                                // Layer 2: Recent sharp bucket fallback during pinch/zoom transitions
                                val pageBucketKey = "$effectiveDocId:$effectivePageIdx:${layout.page.userRotation}:$themeKey:$pageTransBg"
                                val recentBuckets = controller.readyBucketsByPage[pageBucketKey].orEmpty()
                                for (fb in recentBuckets.asReversed()) {
                                    if (fb.scaleBucket == scaleBucket) continue
                                    paintBucketTiles(
                                        nc = nc,
                                        tileCache = tileCache,
                                        docId = effectiveDocId,
                                        pageIndex = effectivePageIdx,
                                        userRotation = layout.page.userRotation,
                                        themeKey = themeKey,
                                        scaleBucket = fb.scaleBucket,
                                        totalPageWpx = fb.totalPageWpx,
                                        totalPageHpx = fb.totalPageHpx,
                                        destPage = destPage,
                                        viewW = size.width,
                                        viewH = size.height,
                                        paint = tilePaint,
                                        transparentBg = pageTransBg,
                                    )
                                }
                            }

                            // Layer 3: Target sharp high-DPI bucket
                            if (!drewStaleDoc) paintBucketTiles(
                                nc = nc,
                                tileCache = tileCache,
                                docId = effectiveDocId,
                                pageIndex = effectivePageIdx,
                                userRotation = layout.page.userRotation,
                                themeKey = themeKey,
                                scaleBucket = scaleBucket,
                                totalPageWpx = targetWpx,
                                totalPageHpx = targetHpx,
                                destPage = destPage,
                                viewW = size.width,
                                viewH = size.height,
                                paint = tilePaint,
                                transparentBg = pageTransBg,
                            )
                        }

                        // Search match highlights
                        if (state.searchHits.isNotEmpty()) {
                            for (i in state.searchHits.indices) {
                                val hit = state.searchHits[i]
                                if (hit.pageIndex != layout.pageIndex) continue
                                hlPaint.color = if (i == state.activeSearchIdx) 0x882563EB.toInt() else 0x66FACC15
                                for (r in hit.rects) {
                                    nc.drawRect(
                                        destLeft + r.left * scalePxPerPt,
                                        destTop + r.top * scalePxPerPt,
                                        destLeft + r.right * scalePxPerPt,
                                        destTop + r.bottom * scalePxPerPt,
                                        hlPaint,
                                    )
                                }
                            }
                        }
                    }

                    // Overlay foreground vector/text/shape/polyline/signature elements + selection chrome
                    overlayPainter.drawOverlays(
                        canvas = drawContext.canvas,
                        layouts = layouts,
                        elements = state.elements,
                        transientOverride = controller.transientElement,
                        selectedElementId = if (state.cropElementId != null) null else state.selectedElementId,
                        isEditMode = state.mode == GpAppMode.EDIT,
                        activeTool = state.tool,
                        activePolylineId = state.activePolylineId,
                        pendingPolylinePageIndex = state.pendingPolylinePageIndex,
                        pendingPolylineAnchor = state.pendingPolylineAnchor,
                        draftShapePreview = controller.draftShapePreview,
                        liveStrokeScreenPts = controller.liveStrokeScreenPts,
                        liveStrokeColor = controller.liveStrokeColor,
                        liveStrokeWidthPx = controller.liveStrokeWidthPx,
                        snapGuides = controller.snapGuides,
                        ghostSignature = state.ghostSignature,
                        activePageIndex = state.activePageIndex,
                        pageNumbering = state.pageNumbering,
                        totalPages = state.pages.size,
                        scrollX = curScrollX,
                        scrollY = curScrollY,
                        scalePxPerPt = scalePxPerPt,
                        density = density,
                        extractedFonts = state.extractedFonts,
                        customTtfBytes = state.customTtfBytes,
                        pageAnalyses = state.pageAnalyses,
                        renderPass = OverlayRenderPass.FOREGROUND_AND_CHROME,
                        selectedElementIds = if (state.cropElementId != null) emptySet() else state.selectedElementIds,
                        selectedPathVertexIndices = state.selectedPathVertexIndices,
                        draftMarqueePreview = controller.draftMarqueePreview,
                        transientOverrides = controller.transientElements,
                        cleanMetaForPage = { pid ->
                            controller.displayedDocByPage[pid]?.let { state.cleanPreviewMeta[it] }
                        },
                        caret = state.inlineEditElementId?.let { id ->
                            GpCaretSpec(id, controller.inlineSelStart, controller.inlineSelEnd, controller.caretBlinkOn)
                        },
                    )

                    val cropId = state.cropElementId
                    if (cropId != null) {
                        val tr = controller.transientElement
                        val cel = if (tr != null && tr.id == cropId) tr else state.elements.firstOrNull { it.id == cropId && !it.deleted }
                        val pl = cel?.let { c -> layouts.firstOrNull { it.page.id == c.pageId } }
                        if (cel != null && pl != null) {
                            cropChrome.draw(
                                nc = nc,
                                el = cel,
                                pageLeft = pl.rectSurface.left - curScrollX,
                                pageTop = pl.rectSurface.top - curScrollY,
                                scale = scalePxPerPt,
                                density = density,
                                bitmap = elementBitmapCache.getOrDecode(cel),
                            )
                        }
                    }
                }
            }

            // Isolated composable so zoom/page changes never recompose the enclosing viewport box.
            ViewportPageZoomPill(
                controller = controller,
                totalPages = state.pages.size,
                leftHanded = state.leftHanded,
                avoidNavBar = state.mode == GpAppMode.VIEW,
                onResetFit = {
                    animateDoubleTapZoom(GpPoint(controller.viewportWidthPx * 0.5f, controller.viewportHeightPx * 0.4f))
                },
            )

            // Subtle Adobe One-Handed Zoom HUD badge while dragging vertically
            AnimatedVisibility(
                visible = controller.isAdobeZoomActive,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp),
            ) {
                Surface(
                    color = palette.accent.copy(alpha = 0.92f),
                    shape = RoundedCornerShape(16.dp),
                    shadowElevation = 4.dp,
                ) {
                    Text(
                        text = "${(controller.zoom * 100f).roundToInt()}%",
                        style = GpTypography.numeric,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun BoxScope.ViewportPageZoomPill(
    controller: PdfViewportController,
    totalPages: Int,
    leftHanded: Boolean,
    avoidNavBar: Boolean,
    onResetFit: () -> Unit,
) {
    if (totalPages <= 0) return
    val palette = LocalGpPalette.current
    val fit = controller.fitWidthZoom.coerceAtLeast(0.1f)
    val z = controller.zoom
    val isFit = abs(z - fit) <= 0.04f
    val pct = (z * 100f).roundToInt()

    Surface(
        color = palette.surfaceOverlay.copy(alpha = 0.92f),
        shape = RoundedCornerShape(20.dp),
        shadowElevation = 3.dp,
        modifier = Modifier
            .align(if (leftHanded) Alignment.BottomEnd else Alignment.BottomStart)
            .then(if (avoidNavBar) Modifier.navigationBarsPadding() else Modifier)
            .padding(14.dp)
            .clickable(enabled = !isFit) { onResetFit() },
    ) {
        Text(
            text = "${controller.activePageIndex + 1}/$totalPages  •  ${if (isFit) "Fit" else "$pct%"}",
            style = GpTypography.numeric,
            color = palette.textPrimary,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
        )
    }
}

private val scratchSrcRect = Rect()
private val scratchDstRect = RectF()

/**
 * Visits the visible tile grid cells of one page bucket. Only called from the UI draw pass.
 */
private inline fun forEachVisibleTile(
    totalPageWpx: Int,
    totalPageHpx: Int,
    destPage: RectF,
    viewW: Float,
    viewH: Float,
    block: (tx: Int, ty: Int, scaleX: Float, scaleY: Float) -> Unit,
) {
    if (totalPageWpx <= 0 || totalPageHpx <= 0) return
    val cols = ceil(totalPageWpx.toDouble() / TILE_SIZE_PX).toInt()
    val rows = ceil(totalPageHpx.toDouble() / TILE_SIZE_PX).toInt()
    val scaleX = destPage.width() / totalPageWpx.toFloat()
    val scaleY = destPage.height() / totalPageHpx.toFloat()
    val tileStepY = TILE_SIZE_PX * scaleY
    val tileStepX = TILE_SIZE_PX * scaleX
    val rowStart = floor(((0f - destPage.top) / tileStepY).toDouble()).toInt().coerceIn(0, rows)
    val rowEnd = ceil(((viewH - destPage.top) / tileStepY).toDouble()).toInt().coerceIn(0, rows)
    val colStart = floor(((0f - destPage.left) / tileStepX).toDouble()).toInt().coerceIn(0, cols)
    val colEnd = ceil(((viewW - destPage.left) / tileStepX).toDouble()).toInt().coerceIn(0, cols)
    for (r in rowStart until rowEnd) {
        for (c in colStart until colEnd) {
            block(c * TILE_SIZE_PX, r * TILE_SIZE_PX, scaleX, scaleY)
        }
    }
}

private fun bucketTilesCoverVisible(
    tileCache: TileBitmapCache,
    docId: String,
    pageIndex: Int,
    userRotation: Int,
    themeKey: String,
    scaleBucket: String,
    totalPageWpx: Int,
    totalPageHpx: Int,
    destPage: RectF,
    viewW: Float,
    viewH: Float,
    transparentBg: Boolean,
): Boolean {
    var complete = true
    var any = false
    forEachVisibleTile(totalPageWpx, totalPageHpx, destPage, viewW, viewH) { tx, ty, _, _ ->
        if (!complete) return@forEachVisibleTile
        any = true
        val cached = tileCache.get(
            TileKey(
                docId = docId,
                pageIndex = pageIndex,
                tileX = tx,
                tileY = ty,
                scaleBucket = scaleBucket,
                rotation = userRotation,
                themeKey = themeKey,
                transparentBg = transparentBg,
            )
        )
        if (cached == null || cached.bitmap.isRecycled) complete = false
    }
    return any && complete
}

private fun paintBucketTiles(
    nc: android.graphics.Canvas,
    tileCache: TileBitmapCache,
    docId: String,
    pageIndex: Int,
    userRotation: Int,
    themeKey: String,
    scaleBucket: String,
    totalPageWpx: Int,
    totalPageHpx: Int,
    destPage: RectF,
    viewW: Float,
    viewH: Float,
    paint: Paint,
    transparentBg: Boolean = false,
) {
    forEachVisibleTile(totalPageWpx, totalPageHpx, destPage, viewW, viewH) { tx, ty, scaleX, scaleY ->
        val cached = tileCache.get(
            TileKey(
                docId = docId,
                pageIndex = pageIndex,
                tileX = tx,
                tileY = ty,
                scaleBucket = scaleBucket,
                rotation = userRotation,
                themeKey = themeKey,
                transparentBg = transparentBg,
            )
        ) ?: return@forEachVisibleTile
        if (cached.bitmap.isRecycled) return@forEachVisibleTile
        scratchSrcRect.set(0, 0, cached.width, cached.height)
        // Snap to whole device pixels: neighbouring tiles then share identical edges, so no
        // partially covered (lighter) seam rows/columns appear between tiles.
        scratchDstRect.set(
            (destPage.left + tx * scaleX).roundToInt().toFloat(),
            (destPage.top + ty * scaleY).roundToInt().toFloat(),
            (destPage.left + (tx + cached.width) * scaleX).roundToInt().toFloat(),
            (destPage.top + (ty + cached.height) * scaleY).roundToInt().toFloat(),
        )
        nc.drawBitmap(cached.bitmap, scratchSrcRect, scratchDstRect, paint)
    }
}


/** Hit-tests the crop window of [el]: a handle name, "move" inside, or null outside. */
private fun cropHandleAt(
    el: GpOverlayElement,
    pageLeft: Float,
    pageTop: Float,
    scale: Float,
    density: Float,
    pos: GpPoint,
): String? {
    val cx = pageLeft + ((el.x + el.width / 2.0) * scale).toFloat()
    val cy = pageTop + ((el.y + el.height / 2.0) * scale).toFloat()
    val rad = Math.toRadians(-el.rotationDeg)
    val dx = (pos.x - cx).toDouble()
    val dy = (pos.y - cy).toDouble()
    val lx = (dx * cos(rad) - dy * sin(rad)).toFloat()
    val ly = (dx * sin(rad) + dy * cos(rad)).toFloat()
    val hw = (el.width * scale / 2.0).toFloat()
    val hh = (el.height * scale / 2.0).toFloat()
    val tol = 24f * density
    val nearL = abs(lx + hw) <= tol
    val nearR = abs(lx - hw) <= tol
    val nearT = abs(ly + hh) <= tol
    val nearB = abs(ly - hh) <= tol
    val inX = lx >= -hw - tol && lx <= hw + tol
    val inY = ly >= -hh - tol && ly <= hh + tol
    if (!inX || !inY) return null
    return when {
        nearT && nearL -> "nw"
        nearT && nearR -> "ne"
        nearB && nearL -> "sw"
        nearB && nearR -> "se"
        nearT && abs(lx) <= hw -> "n"
        nearB && abs(lx) <= hw -> "s"
        nearL && abs(ly) <= hh -> "w"
        nearR && abs(ly) <= hh -> "e"
        abs(lx) <= hw && abs(ly) <= hh -> "move"
        else -> null
    }
}

/** Paints the full (dimmed) image, the crop window, thirds grid and handles while cropping. */
private class CropChromePainter {
    private val bmpPaint = Paint().apply { isFilterBitmap = true; alpha = 110 }
    private val scrimPaint = Paint().apply { color = 0x8C000000.toInt() }
    private val framePaint = Paint().apply {
        style = Paint.Style.STROKE
        color = 0xFFFFFFFF.toInt()
        isAntiAlias = true
    }
    private val outlinePaint = Paint().apply {
        style = Paint.Style.STROKE
        color = 0x99000000.toInt()
        isAntiAlias = true
    }
    private val gridPaint = Paint().apply {
        style = Paint.Style.STROKE
        color = 0x80FFFFFF.toInt()
        isAntiAlias = true
    }
    private val handlePaint = Paint().apply {
        style = Paint.Style.STROKE
        color = 0xFFFFFFFF.toInt()
        strokeCap = Paint.Cap.ROUND
        isAntiAlias = true
    }
    private val fullOutlinePaint = Paint().apply {
        style = Paint.Style.STROKE
        color = 0x993B82F6.toInt()
        isAntiAlias = true
    }

    fun draw(
        nc: android.graphics.Canvas,
        el: GpOverlayElement,
        pageLeft: Float,
        pageTop: Float,
        scale: Float,
        density: Float,
        bitmap: android.graphics.Bitmap?,
    ) {
        val cx = pageLeft + ((el.x + el.width / 2.0) * scale).toFloat()
        val cy = pageTop + ((el.y + el.height / 2.0) * scale).toFloat()
        val ff = CropMath.fullFrameLocal(el)
        val full = RectF(
            cx + (ff.left * scale).toFloat(),
            cy + (ff.top * scale).toFloat(),
            cx + ((ff.left + ff.width) * scale).toFloat(),
            cy + ((ff.top + ff.height) * scale).toFloat(),
        )
        val hw = (el.width * scale / 2.0).toFloat()
        val hh = (el.height * scale / 2.0).toFloat()
        val win = RectF(cx - hw, cy - hh, cx + hw, cy + hh)

        nc.save()
        nc.rotate(el.rotationDeg.toFloat(), cx, cy)
        if (bitmap != null && !bitmap.isRecycled) {
            nc.save()
            if (el.flipX || el.flipY) {
                nc.scale(if (el.flipX) -1f else 1f, if (el.flipY) -1f else 1f, full.centerX(), full.centerY())
            }
            nc.drawBitmap(bitmap, null, full, bmpPaint)
            nc.restore()
        }
        // Darken everything outside the window but inside the full image.
        nc.drawRect(full.left, full.top, full.right, win.top, scrimPaint)
        nc.drawRect(full.left, win.bottom, full.right, full.bottom, scrimPaint)
        nc.drawRect(full.left, win.top, win.left, win.bottom, scrimPaint)
        nc.drawRect(win.right, win.top, full.right, win.bottom, scrimPaint)
        fullOutlinePaint.strokeWidth = 1f * density
        nc.drawRect(full, fullOutlinePaint)

        // Rule-of-thirds grid
        gridPaint.strokeWidth = 0.8f * density
        for (i in 1..2) {
            val gx = win.left + win.width() * i / 3f
            val gy = win.top + win.height() * i / 3f
            nc.drawLine(gx, win.top, gx, win.bottom, gridPaint)
            nc.drawLine(win.left, gy, win.right, gy, gridPaint)
        }
        outlinePaint.strokeWidth = 3f * density
        nc.drawRect(win, outlinePaint)
        framePaint.strokeWidth = 1.5f * density
        nc.drawRect(win, framePaint)

        // L-shaped corner handles + edge bars: a dark halo first so they read on white pages too.
        val len = min(18f * density, min(win.width(), win.height()) / 3f)
        val o = 1.5f * density
        val bar = min(14f * density, min(win.width(), win.height()) / 4f)
        for (pass in 0..1) {
            handlePaint.color = if (pass == 0) 0x99000000.toInt() else 0xFFFFFFFF.toInt()
            handlePaint.strokeWidth = (if (pass == 0) 6.5f else 4f) * density
            fun corner(x: Float, y: Float, sx: Float, sy: Float) {
                nc.drawLine(x - sx * o, y - sy * o, x + sx * len, y - sy * o, handlePaint)
                nc.drawLine(x - sx * o, y - sy * o, x - sx * o, y + sy * len, handlePaint)
            }
            corner(win.left, win.top, 1f, 1f)
            corner(win.right, win.top, -1f, 1f)
            corner(win.left, win.bottom, 1f, -1f)
            corner(win.right, win.bottom, -1f, -1f)
            nc.drawLine(win.centerX() - bar, win.top - o, win.centerX() + bar, win.top - o, handlePaint)
            nc.drawLine(win.centerX() - bar, win.bottom + o, win.centerX() + bar, win.bottom + o, handlePaint)
            nc.drawLine(win.left - o, win.centerY() - bar, win.left - o, win.centerY() + bar, handlePaint)
            nc.drawLine(win.right + o, win.centerY() - bar, win.right + o, win.centerY() + bar, handlePaint)
        }
        nc.restore()
    }
}
