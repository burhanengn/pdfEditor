package dev.gullacpdf.android.ui.viewport

import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.os.Build
import android.text.Layout
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.MetricAffectingSpan
import android.text.style.RelativeSizeSpan
import android.text.style.StrikethroughSpan
import android.text.style.SubscriptSpan
import android.text.style.SuperscriptSpan
import android.text.style.UnderlineSpan
import android.util.LruCache
import androidx.compose.ui.graphics.Canvas
import androidx.compose.ui.graphics.nativeCanvas
import dev.gullacpdf.android.model.GpCleanElementMeta
import dev.gullacpdf.android.model.GpEditorTool
import dev.gullacpdf.android.model.GpExtractedFontInfo
import dev.gullacpdf.android.model.GpGhostSignature
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpPageAnalysis
import dev.gullacpdf.android.model.GpPageNumberingConfig
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpTextRun
import dev.gullacpdf.android.model.formatPageNumberText
import dev.gullacpdf.android.model.parseCssColorOrInt
import dev.gullacpdf.android.ui.text.GpTextEngine
import java.io.File
import java.util.LinkedHashMap
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

enum class OverlayRenderPass {
    ALL,
    BEHIND_ONLY,
    FOREGROUND_AND_CHROME,
}

data class DraftShapePreview(
    val pageIndex: Int,
    val rectPdf: dev.gullacpdf.android.model.GpRectF,
    val shapeType: String,
    val isLine: Boolean,
    val startPdf: GpPoint,
    val endPdf: GpPoint,
    val strokeColorValue: Int,
    val fillColorValue: Int,
    val strokeWidth: Float,
)

data class DraftMarqueePreview(
    val pageIndex: Int,
    val rectPdf: dev.gullacpdf.android.model.GpRectF,
    val isVertexMode: Boolean = false,
)

/** Caret/selection of the text element being edited directly on the page. */
data class GpCaretSpec(
    val elementId: String,
    val selStart: Int,
    val selEnd: Int,
    val blinkOn: Boolean,
)

data class SnapGuideLines(
    val pageIndex: Int,
    val verticalPdfX: Float? = null,
    val horizontalPdfY: Float? = null,
)

/** Edge-midpoint resize handles appear only on boxes at least this many dp long. */
internal const val SELECTION_MID_HANDLE_MIN_DP = 44f

/**
 * Decoded overlay image bitmaps. Decoding a large PNG/JPEG on the draw pass caused visible
 * frame drops, so misses are decoded on a background thread and [onDecoded] asks the viewport
 * to repaint; the frame in between shows a light placeholder.
 */
class ElementBitmapCache(private val onDecoded: () -> Unit = {}) {
    private val map = LinkedHashMap<String, Bitmap>(16, 0.75f, true)
    private val pending = HashSet<String>()
    private val lock = Any()
    private val executor = java.util.concurrent.Executors.newSingleThreadExecutor { r ->
        Thread(r, "gp-overlay-decode").apply { priority = Thread.NORM_PRIORITY - 1; isDaemon = true }
    }
    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    private fun keyOf(el: GpOverlayElement, bytes: ByteArray): String {
        val head = if (bytes.size >= 4) {
            (bytes[0].toInt() and 0xFF) xor ((bytes[1].toInt() and 0xFF) shl 8) xor ((bytes[2].toInt() and 0xFF) shl 16)
        } else 0
        return "${el.id}:${bytes.size}:$head"
    }

    /** Cached bitmap, or null while it is being decoded in the background. */
    fun getOrDecode(el: GpOverlayElement): Bitmap? {
        val bytes = el.imageBytes ?: return null
        if (bytes.isEmpty()) return null
        val key = keyOf(el, bytes)
        synchronized(lock) {
            map[key]?.let { if (!it.isRecycled) return it }
            if (!pending.add(key)) return null
        }
        executor.execute {
            val bmp = decode(bytes)
            synchronized(lock) {
                pending.remove(key)
                if (bmp != null) {
                    if (map.size >= 24) {
                        map.keys.firstOrNull()?.let { map.remove(it) }
                    }
                    map[key] = bmp
                }
            }
            if (bmp != null) mainHandler.post(onDecoded)
        }
        return null
    }

    private fun decode(bytes: ByteArray): Bitmap? {
        val boundsOpts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, boundsOpts)
        var sample = 1
        val maxDim = max(boundsOpts.outWidth, boundsOpts.outHeight)
        while (maxDim / sample > 2048) {
            sample *= 2
        }
        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOpts)?.also { it.prepareToDraw() }
    }

    fun clear() {
        synchronized(lock) {
            map.clear()
        }
    }
}

private class GpTypefaceSpan(private val customTf: Typeface) : MetricAffectingSpan() {
    override fun updateDrawState(tp: TextPaint) {
        tp.typeface = customTf
    }

    override fun updateMeasureState(tp: TextPaint) {
        tp.typeface = customTf
    }
}

private data class TextLayoutCacheKey(
    val text: String,
    val runs: List<GpTextRun>,
    val widthRefPx: Int,
    val origWidth: Double?,
    val paragraphWidth: Double?,
    val baselineOffset: Double?,
    val fontSize: Double,
    val fontFamily: String,
    val bold: Boolean,
    val italic: Boolean,
    val underline: Boolean,
    val strikethrough: Boolean,
    val scriptMode: String,
    val align: String,
    val lineHeight: Double,
    val letterSpacing: Double,
    val horizontalScale: Double,
    val embeddedFontId: String?,
    val colorArgb: Int,
    val fontCacheSig: Int,
)

private class CachedTextEntry(
    val layout: StaticLayout,
    val topShiftPt: Float,
)

private data class PdfSvgPathKey(
    val d: String,
    val vbW: Float,
    val vbH: Float,
)

/**
 * Hardware-accelerated native Android Canvas painter for vector overlays, shapes, polylines,
 * vertex chaining snap rings, constant-scale cached typography, images, signatures, and handles.
 */
class OverlayCanvasPainter(
    private val elementBitmapCache: ElementBitmapCache,
    private val assetManager: AssetManager? = null,
    private val cacheDir: File? = null,
) {
    companion object {
        private const val REF_TEXT_SCALE = 8f
    }

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val textPaint = TextPaint(
        Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG
    )
    private val glyphCheckPaint = Paint()
    private val tmpPath = Path()
    private val pathMatrix = Matrix()
    private val typefaceCache = ConcurrentHashMap<String, Typeface>()
    private val textLayoutCache = LruCache<TextLayoutCacheKey, CachedTextEntry>(72)
    private val svgPathCache = LruCache<PdfSvgPathKey, Path>(128)
    @Volatile
    private var cachedCustomSig: Int = 0
    @Volatile
    private var cachedCustomTf: Typeface? = null
    private var lastFontsMapRef: Map<String, List<GpExtractedFontInfo>>? = null
    private var cachedDocFontLookup: Map<String, GpExtractedFontInfo> = emptyMap()

    // Per-page z-sorted element lists, rebuilt only when the elements list instance changes
    // (drawOverlays runs several times per frame while panning/zooming).
    private var sortedCacheSource: List<GpOverlayElement>? = null
    private val sortedByPage = HashMap<String, List<GpOverlayElement>>()

    private fun pageElementsSorted(elements: List<GpOverlayElement>, pageId: String): List<GpOverlayElement> {
        if (sortedCacheSource !== elements) {
            sortedCacheSource = elements
            sortedByPage.clear()
        }
        return sortedByPage.getOrPut(pageId) {
            elements
                .filter { it.pageId == pageId && !it.deleted }
                .sortedWith(compareBy<GpOverlayElement> { if (it.behindContent) 0 else 1 }.thenBy { it.zIndex })
        }
    }

    private val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFF06B6D4.toInt()
        strokeWidth = 2.5f
        style = Paint.Style.STROKE
    }

    fun drawOverlays(
        canvas: Canvas,
        layouts: List<PageLayoutRect>,
        elements: List<GpOverlayElement>,
        transientOverride: GpOverlayElement?,
        selectedElementId: String?,
        isEditMode: Boolean,
        activeTool: GpEditorTool,
        activePolylineId: String?,
        pendingPolylinePageIndex: Int?,
        pendingPolylineAnchor: GpPoint?,
        draftShapePreview: DraftShapePreview?,
        liveStrokeScreenPts: List<GpPoint>,
        liveStrokeColor: Int,
        liveStrokeWidthPx: Float,
        snapGuides: SnapGuideLines?,
        ghostSignature: GpGhostSignature?,
        activePageIndex: Int,
        pageNumbering: GpPageNumberingConfig,
        totalPages: Int,
        scrollX: Float,
        scrollY: Float,
        scalePxPerPt: Float,
        density: Float,
        extractedFonts: Map<String, List<GpExtractedFontInfo>> = emptyMap(),
        customTtfBytes: ByteArray? = null,
        pageAnalyses: Map<String, GpPageAnalysis> = emptyMap(),
        renderPass: OverlayRenderPass = OverlayRenderPass.ALL,
        cleanMetaForPage: (String) -> Map<String, GpCleanElementMeta>? = { null },
        caret: GpCaretSpec? = null,
        selectedElementIds: Set<String> = emptySet(),
        selectedPathVertexIndices: Set<Int> = emptySet(),
        draftMarqueePreview: DraftMarqueePreview? = null,
        transientOverrides: Map<String, GpOverlayElement> = emptyMap(),
    ) {
        val nc = canvas.nativeCanvas
        updateCustomTtfIfNeeded(customTtfBytes)
        GpTextEngine.setCustomTtf(customTtfBytes)
        if (lastFontsMapRef !== extractedFonts) {
            lastFontsMapRef = extractedFonts
            cachedDocFontLookup = if (extractedFonts.isEmpty()) {
                emptyMap()
            } else {
                buildMap {
                    extractedFonts.values.forEach { list ->
                        list.forEach { put(it.id, it) }
                    }
                }
            }
        }
        val docFontLookup = cachedDocFontLookup
        val isMultiSelected = selectedElementIds.size > 1

        for (layout in layouts) {
            val pageLeft = layout.rectSurface.left - scrollX
            val pageTop = layout.rectSurface.top - scrollY
            val pageRight = pageLeft + layout.rectSurface.width
            val pageBottom = pageTop + layout.rectSurface.height

            // Skip offscreen pages for fast 120fps draw
            if (pageBottom < -200f || pageTop > nc.height + 200f) continue

            val analysis = pageAnalyses[layout.page.id]
            val pageMeta = cleanMetaForPage(layout.page.id)
            val sortedEls = pageElementsSorted(elements, layout.page.id)
            val pageEls = if (transientOverride != null || transientOverrides.isNotEmpty()) {
                sortedEls.map { cur ->
                    transientOverrides[cur.id] ?: if (transientOverride?.id == cur.id) transientOverride else cur
                }
            } else {
                sortedEls
            }

            var groupMinX = Float.POSITIVE_INFINITY
            var groupMinY = Float.POSITIVE_INFINITY
            var groupMaxX = Float.NEGATIVE_INFINITY
            var groupMaxY = Float.NEGATIVE_INFINITY
            var groupCount = 0

            for (el in pageEls) {
                // Untouched PDF objects (just selected) stay painted by the original page raster:
                // never redraw them on top, only show their selection chrome.
                val inRaster = el.staysInPdfRaster(analysis)
                // In-place moves are painted by the rewritten PDF content itself (exact layer);
                // the overlay only bridges the moment until that preview is on screen.
                val inPlace = el.movesInPlace()
                val placedByPdf = inPlace && pageMeta?.get(el.id)?.placementSig == el.placementSignature()
                val behindLayer = el.behindContent && !inPlace
                val hasCaret = caret != null && caret.elementId == el.id
                val isSelected = el.id == selectedElementId || el.id in selectedElementIds
                when (renderPass) {
                    OverlayRenderPass.BEHIND_ONLY -> {
                        if (!behindLayer || inRaster) continue
                    }
                    OverlayRenderPass.FOREGROUND_AND_CHROME -> {
                        if ((behindLayer || inRaster || placedByPdf) && !isSelected && !hasCaret) continue
                    }
                    OverlayRenderPass.ALL -> Unit
                }

                val rect = RectF(
                    pageLeft + (el.x * scalePxPerPt).toFloat(),
                    pageTop + (el.y * scalePxPerPt).toFloat(),
                    pageLeft + ((el.x + el.width) * scalePxPerPt).toFloat(),
                    pageTop + ((el.y + el.height) * scalePxPerPt).toFloat(),
                )
                if (renderPass != OverlayRenderPass.BEHIND_ONLY && isEditMode && isSelected && isMultiSelected) {
                    val b = dev.gullacpdf.android.viewmodel.computeElementVisualBounds(el)
                    groupMinX = min(groupMinX, pageLeft + b.left * scalePxPerPt)
                    groupMinY = min(groupMinY, pageTop + b.top * scalePxPerPt)
                    groupMaxX = max(groupMaxX, pageLeft + b.right * scalePxPerPt)
                    groupMaxY = max(groupMaxY, pageTop + b.bottom * scalePxPerPt)
                    groupCount++
                }
                nc.save()
                if (abs(el.rotationDeg) > 0.01) {
                    nc.rotate(el.rotationDeg.toFloat(), rect.centerX(), rect.centerY())
                }

                val shouldDrawBody = when (renderPass) {
                    OverlayRenderPass.BEHIND_ONLY -> true
                    OverlayRenderPass.FOREGROUND_AND_CHROME -> !behindLayer && !inRaster && !placedByPdf
                    OverlayRenderPass.ALL -> !inRaster && !placedByPdf
                }
                if (shouldDrawBody) {
                    if (GpTextEngine.handles(el)) {
                        drawEngineText(nc, el, pageLeft, pageTop, scalePxPerPt, docFontLookup, pageMeta?.get(el.id))
                    } else {
                        drawElement(nc, el, rect, pageLeft, pageTop, scalePxPerPt, docFontLookup)
                    }
                }

                if (renderPass != OverlayRenderPass.BEHIND_ONLY && isEditMode && isSelected) {
                    drawSelectionChrome(
                        nc = nc,
                        el = el,
                        rect = rect,
                        pageLeft = pageLeft,
                        pageTop = pageTop,
                        scalePxPerPt = scalePxPerPt,
                        density = density,
                        showHandles = !isMultiSelected,
                        selectedPathVertexIndices = if (el.id == selectedElementId && !isMultiSelected) {
                            selectedPathVertexIndices
                        } else {
                            emptySet()
                        },
                    )
                }
                if (renderPass != OverlayRenderPass.BEHIND_ONLY && hasCaret) {
                    drawCaret(nc, el, caret!!, rect, pageLeft, pageTop, scalePxPerPt, density, docFontLookup)
                }
                nc.restore()
            }

            if (renderPass == OverlayRenderPass.BEHIND_ONLY) continue

            if (isEditMode && isMultiSelected && groupCount >= 2 && groupMinX < groupMaxX && groupMinY < groupMaxY) {
                strokePaint.color = 0x992563EB.toInt()
                strokePaint.strokeWidth = 1.25f * density
                strokePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(6f * density, 4f * density), 0f)
                nc.drawRect(groupMinX - 3f * density, groupMinY - 3f * density, groupMaxX + 3f * density, groupMaxY + 3f * density, strokePaint)
                strokePaint.pathEffect = null
            }

            // Vertex chaining visual hints in Line mode
            if (isEditMode && activeTool == GpEditorTool.LINE) {
                for (el in pageEls) {
                    if (el.kind != "path" || el.points.isEmpty()) continue
                    val isActivePoly = el.id == activePolylineId
                    for ((vIdx, pt) in el.points.withIndex()) {
                        val sx = pageLeft + pt.x * scalePxPerPt
                        val sy = pageTop + pt.y * scalePxPerPt
                        val isEndpoint = !el.closed && (vIdx == 0 || vIdx == el.points.lastIndex)
                        fillPaint.color = if (isActivePoly && isEndpoint) 0x5506B6D4 else 0x332563EB
                        nc.drawCircle(sx, sy, 9f * density, fillPaint)
                        strokePaint.color = if (isActivePoly && isEndpoint) 0xFF06B6D4.toInt() else 0xFF2563EB.toInt()
                        strokePaint.strokeWidth = 1.6f * density
                        strokePaint.pathEffect = null
                        nc.drawCircle(sx, sy, 6f * density, strokePaint)
                    }
                }
                if (pendingPolylinePageIndex == layout.pageIndex && pendingPolylineAnchor != null) {
                    val ax = pageLeft + pendingPolylineAnchor.x * scalePxPerPt
                    val ay = pageTop + pendingPolylineAnchor.y * scalePxPerPt
                    fillPaint.color = 0x552563EB
                    nc.drawCircle(ax, ay, 11f * density, fillPaint)
                    fillPaint.color = 0xFF2563EB.toInt()
                    nc.drawCircle(ax, ay, 5f * density, fillPaint)
                }
            }

            // Page numbering preview
            if (pageNumbering.enabled && (layout.pageIndex + 1) >= pageNumbering.startFromPage) {
                drawPageNumberPreview(nc, layout, pageLeft, pageTop, pageNumbering, totalPages, scalePxPerPt)
            }

            // Snap alignment guides while moving
            if (snapGuides != null && snapGuides.pageIndex == layout.pageIndex) {
                snapGuides.verticalPdfX?.let { vx ->
                    val sx = pageLeft + vx * scalePxPerPt
                    nc.drawLine(sx, pageTop, sx, pageBottom, guidePaint)
                }
                snapGuides.horizontalPdfY?.let { hy ->
                    val sy = pageTop + hy * scalePxPerPt
                    nc.drawLine(pageLeft, sy, pageRight, sy, guidePaint)
                }
            }

            // Live drag-to-create shape or line preview
            if (draftShapePreview != null && draftShapePreview.pageIndex == layout.pageIndex) {
                if (draftShapePreview.isLine) {
                    strokePaint.color = draftShapePreview.strokeColorValue
                    strokePaint.strokeWidth = draftShapePreview.strokeWidth * scalePxPerPt
                    strokePaint.pathEffect = null
                    nc.drawLine(
                        pageLeft + draftShapePreview.startPdf.x * scalePxPerPt,
                        pageTop + draftShapePreview.startPdf.y * scalePxPerPt,
                        pageLeft + draftShapePreview.endPdf.x * scalePxPerPt,
                        pageTop + draftShapePreview.endPdf.y * scalePxPerPt,
                        strokePaint,
                    )
                } else {
                    val dr = RectF(
                        pageLeft + draftShapePreview.rectPdf.left * scalePxPerPt,
                        pageTop + draftShapePreview.rectPdf.top * scalePxPerPt,
                        pageLeft + draftShapePreview.rectPdf.right * scalePxPerPt,
                        pageTop + draftShapePreview.rectPdf.bottom * scalePxPerPt,
                    )
                    val p = buildShapePath(draftShapePreview.shapeType, dr, 0f)
                    if ((draftShapePreview.fillColorValue ushr 24) > 0) {
                        fillPaint.color = draftShapePreview.fillColorValue
                        nc.drawPath(p, fillPaint)
                    }
                    strokePaint.color = draftShapePreview.strokeColorValue
                    strokePaint.strokeWidth = draftShapePreview.strokeWidth * scalePxPerPt
                    strokePaint.pathEffect = null
                    nc.drawPath(p, strokePaint)
                }
            }

            if (draftMarqueePreview != null && draftMarqueePreview.pageIndex == layout.pageIndex) {
                val mr = RectF(
                    pageLeft + draftMarqueePreview.rectPdf.left * scalePxPerPt,
                    pageTop + draftMarqueePreview.rectPdf.top * scalePxPerPt,
                    pageLeft + draftMarqueePreview.rectPdf.right * scalePxPerPt,
                    pageTop + draftMarqueePreview.rectPdf.bottom * scalePxPerPt,
                )
                fillPaint.color = if (draftMarqueePreview.isVertexMode) 0x2210B981 else 0x222563EB
                nc.drawRect(mr, fillPaint)
                strokePaint.color = if (draftMarqueePreview.isVertexMode) 0xFF059669.toInt() else 0xFF2563EB.toInt()
                strokePaint.strokeWidth = 1.6f * density
                strokePaint.pathEffect = android.graphics.DashPathEffect(floatArrayOf(6f * density, 4f * density), 0f)
                nc.drawRect(mr, strokePaint)
                strokePaint.pathEffect = null
            }
        }

        // Ghost signature placement preview
        if (renderPass != OverlayRenderPass.BEHIND_ONLY && ghostSignature != null && activePageIndex in layouts.indices) {
            val activeLayout = layouts[activePageIndex]
            val pageLeft = activeLayout.rectSurface.left - scrollX
            val pageTop = activeLayout.rectSurface.top - scrollY
            val cx = pageLeft + ghostSignature.centerPdf.x * scalePxPerPt
            val cy = pageTop + ghostSignature.centerPdf.y * scalePxPerPt
            val hw = ghostSignature.sizePdfW * 0.5f * scalePxPerPt
            val hh = ghostSignature.sizePdfH * 0.5f * scalePxPerPt
            val gRect = RectF(cx - hw, cy - hh, cx + hw, cy + hh)
            fillPaint.color = 0x222563EB
            nc.drawRect(gRect, fillPaint)
            strokePaint.color = 0xFF2563EB.toInt()
            strokePaint.strokeWidth = 1.6f * density
            strokePaint.pathEffect = null
            nc.drawRect(gRect, strokePaint)

            val ghostBmp = ghostSignature.imageBytes?.let { decodeGhostBitmap(it) }
            if (ghostBmp != null) {
                bmpPaint.alpha = 255
                nc.drawBitmap(ghostBmp, Rect(0, 0, ghostBmp.width, ghostBmp.height), gRect, bmpPaint)
            }
            strokePaint.color = ghostSignature.colorValue
            strokePaint.strokeWidth = (0.9f * scalePxPerPt).coerceAtLeast(1f)
            for (s in if (ghostBmp != null) emptyList() else ghostSignature.strokes) {
                if (s.isEmpty()) continue
                val p = Path()
                p.moveTo(
                    gRect.left + (s.first().x / ghostSignature.viewBoxW) * gRect.width(),
                    gRect.top + (s.first().y / ghostSignature.viewBoxH) * gRect.height(),
                )
                for (i in 1 until s.size) {
                    p.lineTo(
                        gRect.left + (s[i].x / ghostSignature.viewBoxW) * gRect.width(),
                        gRect.top + (s[i].y / ghostSignature.viewBoxH) * gRect.height(),
                    )
                }
                nc.drawPath(p, strokePaint)
            }
        }

        // Live freehand / highlight / redact stroke preview
        if (renderPass != OverlayRenderPass.BEHIND_ONLY && liveStrokeScreenPts.isNotEmpty()) {
            val p = Path().apply {
                moveTo(liveStrokeScreenPts.first().x, liveStrokeScreenPts.first().y)
                for (i in 1 until liveStrokeScreenPts.size) {
                    lineTo(liveStrokeScreenPts[i].x, liveStrokeScreenPts[i].y)
                }
            }
            strokePaint.color = liveStrokeColor
            strokePaint.strokeWidth = liveStrokeWidthPx
            strokePaint.pathEffect = null
            nc.drawPath(p, strokePaint)
        }
    }

    private fun updateCustomTtfIfNeeded(bytes: ByteArray?) {
        if (bytes == null || bytes.size < 128) {
            cachedCustomSig = 0
            cachedCustomTf = null
            return
        }
        val sig = bytes.size * 31 + bytes[0].toInt() + (bytes[bytes.size / 2].toInt() shl 8)
        if (sig == cachedCustomSig && cachedCustomTf != null) return
        val dir = cacheDir ?: return
        try {
            val f = File(dir, "custom_overlay_font_$sig.ttf")
            if (!f.exists() || f.length() != bytes.size.toLong()) {
                f.writeBytes(bytes)
            }
            cachedCustomTf = Typeface.createFromFile(f)
            cachedCustomSig = sig
        } catch (_: Exception) {
            cachedCustomTf = null
        }
    }

    private fun loadBundledAssetTf(filename: String): Typeface? {
        return typefaceCache.getOrPut("asset:$filename") {
            val am = assetManager ?: return@getOrPut Typeface.DEFAULT
            try {
                Typeface.createFromAsset(am, "fonts/$filename")
            } catch (_: Exception) {
                Typeface.DEFAULT
            }
        }
    }

    private fun loadFileTf(path: String): Typeface? {
        typefaceCache["file:$path"]?.let { return it }
        return try {
            val tf = Typeface.createFromFile(path)
            typefaceCache["file:$path"] = tf
            tf
        } catch (_: Exception) {
            null
        }
    }

    private fun fontStyleInt(bold: Boolean, italic: Boolean): Int = when {
        bold && italic -> Typeface.BOLD_ITALIC
        bold -> Typeface.BOLD
        italic -> Typeface.ITALIC
        else -> Typeface.NORMAL
    }

    private fun resolveFallbackTypeface(family: String, bold: Boolean, italic: Boolean): Typeface {
        val lower = family.lowercase()
        val style = fontStyleInt(bold, italic)
        if ((lower.contains("custom") || lower.contains("user")) && cachedCustomTf != null) {
            return Typeface.create(cachedCustomTf, style)
        }
        if (lower.contains("mono") || lower.contains("courier") || lower.contains("consolas") || lower.contains("menlo")) {
            val base = loadBundledAssetTf("DejaVuSansMono.ttf") ?: Typeface.MONOSPACE
            return Typeface.create(base, style)
        }
        if (lower.contains("serif") || lower.contains("times") || lower.contains("georgia") ||
            lower.contains("cambria") || lower.contains("garamond") || lower.contains("palatino") ||
            lower.contains("baskerville") || lower.contains("book") || lower.contains("century") ||
            lower.contains("minion") || lower.contains("charter") || lower.contains("rockwell")
        ) {
            val base = loadBundledAssetTf("DejaVuSerif.ttf") ?: Typeface.SERIF
            return Typeface.create(base, style)
        }
        // Helvetica / Arial / Calibri / Roboto map closely to Android's native SANS_SERIF (Roboto) metrics.
        if (lower.contains("helvetica") || lower.contains("arial") || lower.contains("calibri") ||
            lower.contains("roboto") || lower.contains("inter") || lower.contains("segoe") ||
            lower.contains("verdana") || lower.contains("tahoma") || lower.contains("sans") && !lower.contains("dejavu")
        ) {
            return Typeface.create(Typeface.SANS_SERIF, style)
        }
        val assetFile = when {
            bold -> "DejaVuSans-Bold.ttf"
            italic -> "DejaVuSans-Oblique.ttf"
            else -> "DejaVuSans.ttf"
        }
        val base = loadBundledAssetTf(assetFile) ?: Typeface.SANS_SERIF
        return Typeface.create(base, style)
    }

    private fun typefaceHasAnySupportedGlyph(tf: Typeface, sample: String): Boolean {
        if (sample.isEmpty()) return true
        glyphCheckPaint.typeface = tf
        var i = 0
        while (i < sample.length) {
            val cp = sample.codePointAt(i)
            val charCount = Character.charCount(cp)
            if (!Character.isWhitespace(cp) && cp != 0x00A0 && cp != 0x2007 && cp != 0x202F) {
                if (glyphCheckPaint.hasGlyph(sample.substring(i, i + charCount))) {
                    return true
                }
            }
            i += charCount
        }
        return false
    }

    private fun selectEmbeddedTypeface(
        el: GpOverlayElement,
        bold: Boolean,
        italic: Boolean,
        sampleText: String,
        docFontLookup: Map<String, GpExtractedFontInfo>,
    ): Typeface? {
        val emb = el.embeddedFontId?.let { docFontLookup[it] } ?: return null
        val candidatePaths = when {
            bold && italic -> listOfNotNull(emb.boldItalicTtfPath, emb.boldTtfPath, emb.italicTtfPath, emb.regularTtfPath)
            bold -> listOfNotNull(emb.boldTtfPath, emb.regularTtfPath)
            italic -> listOfNotNull(emb.italicTtfPath, emb.regularTtfPath)
            else -> listOfNotNull(emb.regularTtfPath, emb.boldTtfPath, emb.italicTtfPath)
        }
        for (p in candidatePaths) {
            val tf = loadFileTf(p) ?: continue
            if (!typefaceHasAnySupportedGlyph(tf, sampleText)) continue
            val needFakeBold = bold && p != emb.boldTtfPath && p != emb.boldItalicTtfPath
            val needFakeItalic = italic && p != emb.italicTtfPath && p != emb.boldItalicTtfPath
            return if (needFakeBold || needFakeItalic) {
                Typeface.create(tf, fontStyleInt(needFakeBold, needFakeItalic))
            } else {
                tf
            }
        }
        return null
    }

    private fun resolveBestTypeface(
        el: GpOverlayElement,
        bold: Boolean,
        italic: Boolean,
        sampleText: String,
        docFontLookup: Map<String, GpExtractedFontInfo>,
    ): Typeface = selectEmbeddedTypeface(el, bold, italic, sampleText, docFontLookup)
        ?: resolveFallbackTypeface(el.fontFamily, bold, italic)

    private fun applyPerGlyphTypefaceSpans(
        ssb: SpannableStringBuilder,
        start: Int,
        seg: String,
        primaryTf: Typeface,
        fallbackTf: Typeface,
        checkPerGlyph: Boolean,
    ) {
        if (!checkPerGlyph) {
            ssb.setSpan(GpTypefaceSpan(primaryTf), start, start + seg.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            return
        }
        glyphCheckPaint.typeface = primaryTf
        var spanStart = 0
        var curIsPrimary: Boolean? = null
        var i = 0
        while (i < seg.length) {
            val cp = seg.codePointAt(i)
            val charCount = Character.charCount(cp)
            val isWs = Character.isWhitespace(cp) || cp == 0x00A0 || cp == 0x2007 || cp == 0x202F
            val supported = isWs || glyphCheckPaint.hasGlyph(seg.substring(i, i + charCount))
            if (curIsPrimary == null) {
                curIsPrimary = supported
            } else if (!isWs && supported != curIsPrimary) {
                val tf = if (curIsPrimary) primaryTf else fallbackTf
                ssb.setSpan(GpTypefaceSpan(tf), start + spanStart, start + i, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                spanStart = i
                curIsPrimary = supported
            }
            i += charCount
        }
        if (spanStart < seg.length) {
            val tf = if (curIsPrimary != false) primaryTf else fallbackTf
            ssb.setSpan(GpTypefaceSpan(tf), start + spanStart, start + seg.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }

    private fun buildRichSpannable(
        el: GpOverlayElement,
        docFontLookup: Map<String, GpExtractedFontInfo>,
    ): CharSequence {
        val runs = if (el.runs.isNotEmpty() && el.runs.sumOf { it.text.length } == el.text.length) {
            el.runs
        } else {
            listOf(GpTextRun(text = el.text))
        }
        val ssb = SpannableStringBuilder()
        var offset = 0
        for (r in runs) {
            val seg = r.text
            if (seg.isEmpty()) continue
            ssb.append(seg)
            val start = offset
            val end = offset + seg.length
            offset = end

            val rBold = r.bold ?: el.bold
            val rItalic = r.italic ?: el.italic
            val rUnder = r.underline ?: el.underline
            val rStrike = r.strikethrough ?: el.strikethrough
            val rScript = r.script ?: el.scriptMode

            val fallbackTf = resolveFallbackTypeface(el.fontFamily, rBold, rItalic)
            val embeddedTf = selectEmbeddedTypeface(el, rBold, rItalic, seg, docFontLookup)
            applyPerGlyphTypefaceSpans(
                ssb = ssb,
                start = start,
                seg = seg,
                primaryTf = embeddedTf ?: fallbackTf,
                fallbackTf = fallbackTf,
                checkPerGlyph = embeddedTf != null,
            )
            if (rUnder) {
                ssb.setSpan(UnderlineSpan(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            if (rStrike) {
                ssb.setSpan(StrikethroughSpan(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
            when (rScript) {
                "super" -> {
                    ssb.setSpan(SuperscriptSpan(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    ssb.setSpan(RelativeSizeSpan(0.68f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                "sub" -> {
                    ssb.setSpan(SubscriptSpan(), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    ssb.setSpan(RelativeSizeSpan(0.68f), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
            }
        }
        return ssb
    }

    private fun getOrBuildPdfSvgPath(d: String, vbW: Float, vbH: Float): Path {
        val key = PdfSvgPathKey(d, vbW, vbH)
        return svgPathCache.get(key) ?: parseSvgPath(d, RectF(0f, 0f, vbW, vbH), vbW, vbH).also {
            svgPathCache.put(key, it)
        }
    }

    private fun drawElement(
        nc: android.graphics.Canvas,
        el: GpOverlayElement,
        rect: RectF,
        pageLeft: Float,
        pageTop: Float,
        scalePxPerPt: Float,
        docFontLookup: Map<String, GpExtractedFontInfo>,
    ) {
        val alphaInt = (el.opacity.coerceIn(0.0, 1.0) * 255.0).toInt()
        if (el.isTextKind) {
            if ((el.backgroundColorValue ushr 24) > 0) {
                fillPaint.color = applyAlpha(el.backgroundColorValue, el.opacity)
                nc.drawRect(rect, fillPaint)
            }
            val wrapWidthPt = el.layoutWrapWidth()
            val refWidth = (wrapWidthPt * REF_TEXT_SCALE).roundToInt().coerceAtLeast(16)
            val key = TextLayoutCacheKey(
                text = el.text,
                runs = el.runs,
                widthRefPx = refWidth,
                origWidth = el.origWidth,
                paragraphWidth = el.paragraphWidth,
                baselineOffset = el.baselineOffset,
                fontSize = el.fontSize,
                fontFamily = el.fontFamily,
                bold = el.bold,
                italic = el.italic,
                underline = el.underline,
                strikethrough = el.strikethrough,
                scriptMode = el.scriptMode,
                align = el.align,
                lineHeight = el.lineHeight,
                letterSpacing = el.letterSpacing,
                horizontalScale = el.horizontalScale,
                embeddedFontId = el.embeddedFontId,
                colorArgb = applyAlpha(el.colorValue, el.opacity),
                fontCacheSig = cachedCustomSig xor (docFontLookup[el.embeddedFontId]?.hashCode() ?: 0),
            )
            var entry = textLayoutCache.get(key)
            if (entry == null) {
                val embTf = selectEmbeddedTypeface(el, el.bold, el.italic, el.text, docFontLookup)
                val baseTf = embTf ?: resolveFallbackTypeface(el.fontFamily, el.bold, el.italic)
                val layoutPaint = TextPaint(
                    Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG
                ).apply {
                    typeface = baseTf
                    color = key.colorArgb
                    textSize = (el.fontSize.coerceAtLeast(4.0) * REF_TEXT_SCALE).toFloat()
                    letterSpacing = (el.letterSpacing / max(4.0, el.fontSize)).toFloat()
                    textScaleX = el.horizontalScale.toFloat().coerceIn(0.4f, 2.5f)
                }
                if (embTf == null && el.sourceBlockId.isNotEmpty() && !el.text.contains('\n') && el.text.length >= 3) {
                    val targetPx = ((el.origWidth ?: el.width) * REF_TEXT_SCALE).toFloat()
                    val measured = layoutPaint.measureText(el.text)
                    if (measured > targetPx * 1.02f && targetPx > 1f) {
                        val cal = (targetPx / measured).coerceIn(0.84f, 1.0f)
                        layoutPaint.textScaleX = (layoutPaint.textScaleX * cal).coerceIn(0.4f, 2.5f)
                    }
                }
                val fm = layoutPaint.fontMetrics
                val natStepPx = (fm.descent - fm.ascent + fm.leading).coerceAtLeast(1f)
                val targetStepPx = (el.fontSize * el.lineHeight * REF_TEXT_SCALE).toFloat()
                val spacingMult = (targetStepPx / natStepPx).coerceIn(0.65f, 2.5f)

                val styled = buildRichSpannable(el, docFontLookup)
                val layoutAlign = when (el.align) {
                    "center" -> Layout.Alignment.ALIGN_CENTER
                    "right" -> Layout.Alignment.ALIGN_OPPOSITE
                    else -> Layout.Alignment.ALIGN_NORMAL
                }
                val builder = StaticLayout.Builder.obtain(styled, 0, styled.length, layoutPaint, refWidth)
                    .setAlignment(layoutAlign)
                    .setIncludePad(false)
                    .setLineSpacing(0f, spacingMult)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    builder.setHyphenationFrequency(Layout.HYPHENATION_FREQUENCY_NONE)
                }
                if (el.align == "justify" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    builder.setJustificationMode(Layout.JUSTIFICATION_MODE_INTER_WORD)
                }
                val sl = builder.build()
                val topShiftPt = if (el.baselineOffset != null && el.baselineOffset > 0.0 && sl.lineCount > 0) {
                    val actualBasePt = sl.getLineBaseline(0).toFloat() / REF_TEXT_SCALE
                    (el.baselineOffset.toFloat() - actualBasePt).coerceIn((-el.fontSize * 0.5).toFloat(), (el.fontSize * 0.5).toFloat())
                } else 0f
                entry = CachedTextEntry(sl, topShiftPt)
                textLayoutCache.put(key, entry)
            } else {
                entry.layout.paint.color = key.colorArgb
            }
            lastLayoutByElementId[el.id] = entry
            if (lastLayoutByElementId.size > 64) lastLayoutByElementId.clear()
            nc.save()
            nc.translate(rect.left, rect.top + entry.topShiftPt * scalePxPerPt)
            val toScreen = scalePxPerPt / REF_TEXT_SCALE
            nc.scale(toScreen, toScreen)
            entry.layout.draw(nc)
            nc.restore()
            return
        }

        if (el.kind == "highlight" || el.isRedact) {
            fillPaint.color = if (el.isRedact) 0xFF000000.toInt() else applyAlpha(el.fillColorValue, el.opacity)
            nc.drawRect(rect, fillPaint)
            return
        }

        if (el.kind == "shape" || el.kind == "shapeReplacement") {
            val path = if (el.kind == "shapeReplacement" && el.svgPath.isNotEmpty()) {
                val vbW = (if (el.viewBoxWidth > 0.0) el.viewBoxWidth else el.width).toFloat().coerceAtLeast(1f)
                val vbH = (if (el.viewBoxHeight > 0.0) el.viewBoxHeight else el.height).toFloat().coerceAtLeast(1f)
                val cachedPdf = getOrBuildPdfSvgPath(el.svgPath, vbW, vbH)
                pathMatrix.reset()
                pathMatrix.setScale(rect.width() / vbW, rect.height() / vbH)
                pathMatrix.postTranslate(rect.left, rect.top)
                cachedPdf.transform(pathMatrix, tmpPath)
                tmpPath
            } else {
                buildShapePath(el.shapeType, rect, (el.borderRadius * scalePxPerPt).toFloat())
            }
            if ((el.fillColorValue ushr 24) > 0) {
                fillPaint.color = applyAlpha(el.fillColorValue, el.opacity)
                nc.drawPath(path, fillPaint)
            }
            if ((el.colorValue ushr 24) > 0 && el.strokeWidth > 0) {
                strokePaint.color = applyAlpha(el.colorValue, el.opacity)
                val sw = (el.strokeWidth * scalePxPerPt).toFloat().coerceAtLeast(1f)
                strokePaint.strokeWidth = sw
                strokePaint.pathEffect = dashEffect(el.strokeDash, sw)
                nc.drawPath(path, strokePaint)
                strokePaint.pathEffect = null
            }
            return
        }

        if ((el.kind == "path" || el.kind == "ink") && el.points.isNotEmpty()) {
            val screenPts = el.points.map { GpPoint(pageLeft + it.x * scalePxPerPt, pageTop + it.y * scalePxPerPt, smooth = it.smooth) }
            val path = buildSmoothPointPath(screenPts, smooth = el.smooth, closed = el.closed)
            if (el.closed && (el.fillColorValue ushr 24) > 0) {
                fillPaint.color = applyAlpha(el.fillColorValue, el.opacity)
                nc.drawPath(path, fillPaint)
            }
            strokePaint.color = applyAlpha(el.colorValue, el.opacity)
            val sw = (el.strokeWidth * scalePxPerPt).toFloat().coerceAtLeast(1f)
            strokePaint.strokeWidth = sw
            strokePaint.pathEffect = dashEffect(el.strokeDash, sw)
            nc.drawPath(path, strokePaint)
            strokePaint.pathEffect = null
            return
        }

        if (el.kind == "image" || el.kind == "imageReplacement") {
            val bmp = elementBitmapCache.getOrDecode(el)
            if (bmp != null) {
                val crop = el.cropRect ?: dev.gullacpdf.android.model.GpRectF(0f, 0f, 1f, 1f)
                val src = Rect(
                    (crop.left * bmp.width).toInt().coerceIn(0, bmp.width - 1),
                    (crop.top * bmp.height).toInt().coerceIn(0, bmp.height - 1),
                    (crop.right * bmp.width).toInt().coerceIn(1, bmp.width),
                    (crop.bottom * bmp.height).toInt().coerceIn(1, bmp.height),
                )
                nc.save()
                if (el.flipX || el.flipY) {
                    nc.scale(if (el.flipX) -1f else 1f, if (el.flipY) -1f else 1f, rect.centerX(), rect.centerY())
                }
                bmpPaint.alpha = alphaInt
                nc.drawBitmap(bmp, src, rect, bmpPaint)
                nc.restore()
            } else {
                fillPaint.color = 0x223B82F6
                nc.drawRect(rect, fillPaint)
            }
            return
        }

        if (el.kind == "signature") {
            val bmp = elementBitmapCache.getOrDecode(el)
            if (bmp != null) {
                bmpPaint.alpha = alphaInt
                nc.drawBitmap(bmp, Rect(0, 0, bmp.width, bmp.height), rect, bmpPaint)
                return
            }
            val vbW = el.viewBoxWidth.toFloat().coerceAtLeast(1f)
            val vbH = el.viewBoxHeight.toFloat().coerceAtLeast(1f)
            for (sp in el.svgPaths) {
                val cachedPdf = getOrBuildPdfSvgPath(sp.d, vbW, vbH)
                pathMatrix.reset()
                pathMatrix.setScale(rect.width() / vbW, rect.height() / vbH)
                pathMatrix.postTranslate(rect.left, rect.top)
                cachedPdf.transform(pathMatrix, tmpPath)
                if (!sp.fill.isNullOrEmpty() && sp.fill != "none" && sp.fill != "transparent") {
                    fillPaint.color = applyAlpha(parseCssColorOrInt(sp.fill, el.colorValue), el.opacity)
                    nc.drawPath(tmpPath, fillPaint)
                }
                if (!sp.stroke.isNullOrEmpty() && sp.stroke != "none" && sp.stroke != "transparent") {
                    strokePaint.color = applyAlpha(parseCssColorOrInt(sp.stroke, el.colorValue), el.opacity)
                    strokePaint.strokeWidth = ((sp.strokeWidth ?: 2.0) * (rect.width() / max(1.0, el.viewBoxWidth))).toFloat().coerceAtLeast(1f)
                    strokePaint.pathEffect = null
                    nc.drawPath(tmpPath, strokePaint)
                }
            }
        }
    }

    private var ghostBytesRef: ByteArray? = null
    private var ghostBitmap: Bitmap? = null

    private fun decodeGhostBitmap(bytes: ByteArray): Bitmap? {
        if (ghostBytesRef !== bytes) {
            ghostBytesRef = bytes
            ghostBitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        }
        return ghostBitmap
    }

    private val engineTextPaint = TextPaint(
        Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG
    ).apply { fontFeatureSettings = GpTextEngine.NO_SHAPING_FEATURES }
    private val caretPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF2563EB.toInt() }
    private val selectionPaint = Paint().apply { color = 0x552563EB }

    /** Embedded-font lookup used for layout (shared with the viewport's caret hit-testing). */
    fun fontLookup(extractedFonts: Map<String, List<GpExtractedFontInfo>>): Map<String, GpExtractedFontInfo> {
        if (lastFontsMapRef !== extractedFonts) {
            lastFontsMapRef = extractedFonts
            cachedDocFontLookup = buildMap { extractedFonts.values.forEach { list -> list.forEach { put(it.id, it) } } }
        }
        return cachedDocFontLookup
    }

    /**
     * Paints a PDF paragraph edit from the shared engine layout. Untouched lines are left to the
     * original page raster; a replaced line is only painted once the displayed page no longer
     * contains the original line beneath it (no doubled text while the preview refreshes).
     */
    private fun drawEngineText(
        nc: android.graphics.Canvas,
        el: GpOverlayElement,
        pageLeft: Float,
        pageTop: Float,
        scalePxPerPt: Float,
        docFontLookup: Map<String, GpExtractedFontInfo>,
        meta: GpCleanElementMeta?,
    ) {
        val layout = GpTextEngine.layout(el, docFontLookup)
        val origCount = layout.origLines.size
        if (!layout.lineMode && (el.backgroundColorValue ushr 24) > 0 && meta?.wholeBlock == true) {
            fillPaint.color = applyAlpha(el.backgroundColorValue, el.opacity)
            nc.drawRect(
                pageLeft + (el.x * scalePxPerPt).toFloat(),
                pageTop + (el.y * scalePxPerPt).toFloat(),
                pageLeft + ((el.x + el.width) * scalePxPerPt).toFloat(),
                pageTop + ((el.y + el.height) * scalePxPerPt).toFloat(),
                fillPaint,
            )
        }
        val p = engineTextPaint
        p.color = applyAlpha(el.colorValue, el.opacity)
        p.textScaleX = layout.horizontalScale.toFloat()
        for (line in layout.lines) {
            if (line.kept) continue
            val originalStillShown = if (layout.lineMode) {
                line.slot < origCount && !(meta != null && (meta.wholeBlock || meta.strippedLines?.contains(line.slot) == true))
            } else {
                meta?.wholeBlock != true
            }
            if (originalStillShown) continue
            for (seg in line.segments) {
                p.typeface = seg.typeface
                p.textSize = (seg.sizePt * scalePxPerPt).toFloat()
                val sx = pageLeft + (seg.x * scalePxPerPt).toFloat()
                val sy = pageTop + ((line.baseline + seg.rise) * scalePxPerPt).toFloat()
                nc.drawText(seg.text, sx, sy, p)
                if (seg.underline || seg.strikethrough) {
                    strokePaint.color = p.color
                    strokePaint.pathEffect = null
                    strokePaint.strokeWidth = (seg.sizePt * 0.06 * scalePxPerPt).toFloat().coerceAtLeast(1f)
                    val ex = sx + (seg.width * scalePxPerPt).toFloat()
                    if (seg.underline) {
                        val uy = sy + (seg.sizePt * 0.14 * scalePxPerPt).toFloat()
                        nc.drawLine(sx, uy, ex, uy, strokePaint)
                    }
                    if (seg.strikethrough) {
                        val ty = sy - (seg.sizePt * 0.30 * scalePxPerPt).toFloat()
                        nc.drawLine(sx, ty, ex, ty, strokePaint)
                    }
                }
            }
        }
    }

    private fun drawCaret(
        nc: android.graphics.Canvas,
        el: GpOverlayElement,
        caret: GpCaretSpec,
        rect: RectF,
        pageLeft: Float,
        pageTop: Float,
        scalePxPerPt: Float,
        density: Float,
        docFontLookup: Map<String, GpExtractedFontInfo>,
    ) {
        if (GpTextEngine.handles(el)) {
            val layout = GpTextEngine.layout(el, docFontLookup)
            val lo = minOf(caret.selStart, caret.selEnd)
            val hi = maxOf(caret.selStart, caret.selEnd)
            if (hi > lo) {
                for (line in layout.lines) {
                    val a = maxOf(lo, line.start)
                    val b = minOf(hi, line.end)
                    if (b <= a) continue
                    val x0 = line.charX[a - line.start]
                    val x1 = line.charX[b - line.start]
                    nc.drawRect(
                        pageLeft + (x0 * scalePxPerPt).toFloat(),
                        pageTop + ((line.baseline - line.fontSize * 0.9) * scalePxPerPt).toFloat(),
                        pageLeft + (x1 * scalePxPerPt).toFloat(),
                        pageTop + ((line.baseline + line.fontSize * 0.25) * scalePxPerPt).toFloat(),
                        selectionPaint,
                    )
                }
                return
            }
            if (!caret.blinkOn) return
            val pos = GpTextEngine.caretPosition(layout, caret.selEnd) ?: return
            val (cx, base, fs) = pos
            val x = pageLeft + (cx * scalePxPerPt).toFloat()
            val w = (1.6f * density).coerceAtLeast(2f)
            nc.drawRect(
                x - w / 2f,
                pageTop + ((base - fs * 0.92) * scalePxPerPt).toFloat(),
                x + w / 2f,
                pageTop + ((base + fs * 0.24) * scalePxPerPt).toFloat(),
                caretPaint,
            )
            return
        }
        // Generic text boxes: caret from the cached StaticLayout.
        if (!caret.blinkOn) return
        val entry = lastTextLayoutFor(el) ?: return
        val sl = entry.layout
        val off = caret.selEnd.coerceIn(0, sl.text.length)
        val line = sl.getLineForOffset(off)
        val toScreen = scalePxPerPt / REF_TEXT_SCALE
        val x = rect.left + sl.getPrimaryHorizontal(off) * toScreen
        val top = rect.top + entry.topShiftPt * scalePxPerPt + sl.getLineTop(line) * toScreen
        val bottom = rect.top + entry.topShiftPt * scalePxPerPt + sl.getLineBottom(line) * toScreen
        val w = (1.6f * density).coerceAtLeast(2f)
        nc.drawRect(x - w / 2f, top, x + w / 2f, bottom, caretPaint)
    }

    private val lastLayoutByElementId = HashMap<String, CachedTextEntry>()

    private fun lastTextLayoutFor(el: GpOverlayElement): CachedTextEntry? = lastLayoutByElementId[el.id]

    /** Caret index for a tap on a generic (non-engine) text box, in page points. */
    fun hitTextBox(el: GpOverlayElement, pdfX: Double, pdfY: Double): Int? {
        val entry = lastTextLayoutFor(el) ?: return null
        val sl = entry.layout
        val ly = ((pdfY - el.y - entry.topShiftPt) * REF_TEXT_SCALE).toInt()
        val line = sl.getLineForVertical(ly.coerceAtLeast(0))
        return sl.getOffsetForHorizontal(line, ((pdfX - el.x) * REF_TEXT_SCALE).toFloat())
    }

    private fun drawSelectionChrome(
        nc: android.graphics.Canvas,
        el: GpOverlayElement,
        rect: RectF,
        pageLeft: Float,
        pageTop: Float,
        scalePxPerPt: Float,
        density: Float,
        showHandles: Boolean = true,
        selectedPathVertexIndices: Set<Int> = emptySet(),
    ) {
        val borderColor = if (el.locked) 0xFFF59E0B.toInt() else 0xFF2563EB.toInt()
        strokePaint.color = borderColor
        strokePaint.strokeWidth = 1.75f * density
        strokePaint.pathEffect = null
        nc.drawRect(rect, strokePaint)
        if (el.locked || !showHandles) return

        // Top rotation stem & knob
        val stemLen = 26f * density
        val topCenterX = rect.centerX()
        val rotY = rect.top - stemLen
        nc.drawLine(topCenterX, rect.top, topCenterX, rotY, strokePaint)
        fillPaint.color = 0xFFFFFFFF.toInt()
        val handleR = 6.5f * density
        nc.drawCircle(topCenterX, rotY, handleR, fillPaint)
        nc.drawCircle(topCenterX, rotY, handleR, strokePaint)

        // Resize handles: corners always, edge midpoints only when the box is big enough that
        // they don't cover the content (must match PdfViewport's handle hit-test).
        val showMidX = rect.width() >= SELECTION_MID_HANDLE_MIN_DP * density
        val showMidY = rect.height() >= SELECTION_MID_HANDLE_MIN_DP * density
        val hr = 5.2f * density
        fun handle(hx: Float, hy: Float) {
            nc.drawCircle(hx, hy, hr, fillPaint)
            nc.drawCircle(hx, hy, hr, strokePaint)
        }
        handle(rect.left, rect.top)
        handle(rect.right, rect.top)
        handle(rect.right, rect.bottom)
        handle(rect.left, rect.bottom)
        if (showMidX) {
            handle(rect.centerX(), rect.top)
            handle(rect.centerX(), rect.bottom)
        }
        if (showMidY) {
            handle(rect.right, rect.centerY())
            handle(rect.left, rect.centerY())
        }

        // Draggable vertex node handles for polylines/paths
        if (el.kind == "path" && el.points.size >= 2) {
            strokePaint.pathEffect = null
            strokePaint.strokeWidth = 1.6f * density
            for ((vIdx, pt) in el.points.withIndex()) {
                val vx = pageLeft + pt.x * scalePxPerPt
                val vy = pageTop + pt.y * scalePxPerPt
                val isSmoothVertex = pt.smooth ?: el.smooth
                val isSelectedVertex = vIdx in selectedPathVertexIndices
                val r = if (isSelectedVertex) 6.5f * density else 5f * density
                fillPaint.color = when {
                    isSelectedVertex -> 0xFF2563EB.toInt()
                    isSmoothVertex -> 0xFF06B6D4.toInt()
                    else -> 0xFF0F172A.toInt()
                }
                strokePaint.color = 0xFFFFFFFF.toInt()
                if (isSmoothVertex) {
                    nc.drawCircle(vx, vy, r, fillPaint)
                    nc.drawCircle(vx, vy, r, strokePaint)
                } else {
                    val diamond = Path().apply {
                        moveTo(vx, vy - r)
                        lineTo(vx + r, vy)
                        lineTo(vx, vy + r)
                        lineTo(vx - r, vy)
                        close()
                    }
                    nc.drawPath(diamond, fillPaint)
                    nc.drawPath(diamond, strokePaint)
                }
            }
        }
    }

    private fun drawPageNumberPreview(
        nc: android.graphics.Canvas,
        layout: PageLayoutRect,
        pageLeft: Float,
        pageTop: Float,
        pn: GpPageNumberingConfig,
        totalPages: Int,
        scalePxPerPt: Float,
    ) {
        val text = formatPageNumberText(pn, layout.pageIndex + 1, totalPages)
        val isTop = pn.position.startsWith("top")
        val mx = pn.marginX.toFloat().coerceIn(8f, (layout.page.displayWidth * 0.35).toFloat())
        val my = pn.marginY.toFloat().coerceIn(6f, (layout.page.displayHeight * 0.35).toFloat())
        val boxW = max(40f, (layout.page.displayWidth.toFloat() - mx * 2f)) * scalePxPerPt
        val yPdf = if (isTop) (my - pn.fontSize.toFloat() * 0.25f) else (layout.page.displayHeight.toFloat() - my - pn.fontSize.toFloat())

        textPaint.typeface = Typeface.DEFAULT
        textPaint.color = applyAlpha(pn.colorValue, pn.opacity)
        textPaint.textSize = (pn.fontSize * scalePxPerPt).toFloat().coerceAtLeast(6f)
        val align = when {
            pn.position.endsWith("left") -> Layout.Alignment.ALIGN_NORMAL
            pn.position.endsWith("right") -> Layout.Alignment.ALIGN_OPPOSITE
            else -> Layout.Alignment.ALIGN_CENTER
        }
        val sl = StaticLayout.Builder.obtain(text, 0, text.length, textPaint, boxW.toInt().coerceAtLeast(24))
            .setAlignment(align)
            .build()
        nc.save()
        nc.translate(pageLeft + mx * scalePxPerPt, pageTop + yPdf * scalePxPerPt)
        sl.draw(nc)
        nc.restore()
    }
}

private fun applyAlpha(argb: Int, opacity: Double): Int {
    val baseA = (argb ushr 24) and 0xFF
    val nextA = (baseA * opacity.coerceIn(0.0, 1.0)).toInt().coerceIn(0, 255)
    return (nextA shl 24) or (argb and 0x00FFFFFF)
}

private fun dashEffect(dashStyle: String, strokeWidth: Float): android.graphics.DashPathEffect? {
    return when (dashStyle) {
        "dashed" -> android.graphics.DashPathEffect(floatArrayOf(max(6f, strokeWidth * 3f), max(5f, strokeWidth * 2f)), 0f)
        "dotted" -> android.graphics.DashPathEffect(floatArrayOf(max(2f, strokeWidth), max(4f, strokeWidth * 2f)), 0f)
        else -> null
    }
}

private fun buildShapePath(shapeType: String, r: RectF, radius: Float): Path {
    val path = Path()
    when (shapeType) {
        "ellipse" -> path.addOval(r, Path.Direction.CW)
        "triangle" -> {
            path.moveTo(r.centerX(), r.top)
            path.lineTo(r.right, r.bottom)
            path.lineTo(r.left, r.bottom)
            path.close()
        }
        "diamond" -> {
            path.moveTo(r.centerX(), r.top)
            path.lineTo(r.right, r.centerY())
            path.lineTo(r.centerX(), r.bottom)
            path.lineTo(r.left, r.centerY())
            path.close()
        }
        "arrow" -> {
            val w = r.width()
            val h = r.height()
            path.moveTo(r.left, r.top + h * 0.3f)
            path.lineTo(r.left + w * 0.62f, r.top + h * 0.3f)
            path.lineTo(r.left + w * 0.62f, r.top)
            path.lineTo(r.right, r.top + h * 0.5f)
            path.lineTo(r.left + w * 0.62f, r.bottom)
            path.lineTo(r.left + w * 0.62f, r.top + h * 0.7f)
            path.lineTo(r.left, r.top + h * 0.7f)
            path.close()
        }
        else -> {
            if (radius > 0.25f) {
                path.addRoundRect(r, radius, radius, Path.Direction.CW)
            } else {
                path.addRect(r, Path.Direction.CW)
            }
        }
    }
    return path
}

internal fun buildSmoothPointPath(pts: List<GpPoint>, smooth: Boolean, closed: Boolean): Path {
    val p = Path()
    val n = pts.size
    if (n == 0) return p
    if (n == 1) {
        p.moveTo(pts[0].x, pts[0].y)
        p.lineTo(pts[0].x + 0.5f, pts[0].y + 0.5f)
        return p
    }
    fun isSmoothAt(i: Int): Boolean = pts[i].smooth ?: smooth
    val hasAnySmoothCorner = if (closed) {
        (0 until n).any(::isSmoothAt)
    } else {
        (1 until n - 1).any(::isSmoothAt)
    }
    if (!hasAnySmoothCorner || n < 3) {
        p.moveTo(pts[0].x, pts[0].y)
        for (i in 1 until n) p.lineTo(pts[i].x, pts[i].y)
        if (closed) p.close()
        return p
    }
    fun mid(a: GpPoint, b: GpPoint) = GpPoint((a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f)
    fun differs(a: GpPoint, b: GpPoint): Boolean = abs(a.x - b.x) > 1e-4f || abs(a.y - b.y) > 1e-4f

    if (!closed) {
        p.moveTo(pts[0].x, pts[0].y)
        var cursor = pts[0]
        for (i in 1 until n - 1) {
            val curr = pts[i]
            if (isSmoothAt(i)) {
                val enter = if (i == 1 && isSmoothAt(0)) pts[0] else mid(pts[i - 1], curr)
                val exit = mid(curr, pts[i + 1])
                if (differs(cursor, enter)) p.lineTo(enter.x, enter.y)
                p.quadTo(curr.x, curr.y, exit.x, exit.y)
                cursor = exit
            } else {
                if (differs(cursor, curr)) p.lineTo(curr.x, curr.y)
                cursor = curr
            }
        }
        val last = pts[n - 1]
        if (differs(cursor, last)) p.lineTo(last.x, last.y)
        return p
    }

    val enters = Array(n) { i ->
        if (isSmoothAt(i)) mid(pts[(i - 1 + n) % n], pts[i]) else pts[i]
    }
    val exits = Array(n) { i ->
        if (isSmoothAt(i)) mid(pts[i], pts[(i + 1) % n]) else pts[i]
    }
    p.moveTo(enters[0].x, enters[0].y)
    for (i in 0 until n) {
        if (isSmoothAt(i)) {
            p.quadTo(pts[i].x, pts[i].y, exits[i].x, exits[i].y)
        }
        val nextEnter = enters[(i + 1) % n]
        if (differs(exits[i], nextEnter)) {
            p.lineTo(nextEnter.x, nextEnter.y)
        }
    }
    p.close()
    return p
}

private val SVG_TOKEN_REGEX = Regex("""[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?""")

private fun parseSvgPath(d: String, targetRect: RectF, vbW: Float, vbH: Float): Path {
    val path = Path()
    val sx = targetRect.width() / max(1f, vbW)
    val sy = targetRect.height() / max(1f, vbH)
    val ox = targetRect.left
    val oy = targetRect.top
    val tokens = SVG_TOKEN_REGEX.findAll(d).map { it.value }.toList()
    var i = 0
    var cmd = ""
    var curX = 0f
    var curY = 0f

    fun nextNum(): Float? {
        if (i >= tokens.size) return null
        val v = tokens[i].toFloatOrNull()
        if (v != null) i++
        return v
    }

    while (i < tokens.size) {
        val t = tokens[i]
        if (t.length == 1 && t[0].isLetter()) {
            cmd = t
            i++
            if (cmd == "Z" || cmd == "z") path.close()
            continue
        }
        when (cmd) {
            "M", "m" -> {
                val x = nextNum() ?: break
                val y = nextNum() ?: break
                curX = if (cmd == "m") curX + x else x
                curY = if (cmd == "m") curY + y else y
                path.moveTo(ox + curX * sx, oy + curY * sy)
                cmd = if (cmd == "m") "l" else "L"
            }
            "L", "l" -> {
                val x = nextNum() ?: break
                val y = nextNum() ?: break
                curX = if (cmd == "l") curX + x else x
                curY = if (cmd == "l") curY + y else y
                path.lineTo(ox + curX * sx, oy + curY * sy)
            }
            "H", "h" -> {
                val x = nextNum() ?: break
                curX = if (cmd == "h") curX + x else x
                path.lineTo(ox + curX * sx, oy + curY * sy)
            }
            "V", "v" -> {
                val y = nextNum() ?: break
                curY = if (cmd == "v") curY + y else y
                path.lineTo(ox + curX * sx, oy + curY * sy)
            }
            "Q", "q" -> {
                val x1 = nextNum() ?: break
                val y1 = nextNum() ?: break
                val x = nextNum() ?: break
                val y = nextNum() ?: break
                val qx = if (cmd == "q") curX + x1 else x1
                val qy = if (cmd == "q") curY + y1 else y1
                curX = if (cmd == "q") curX + x else x
                curY = if (cmd == "q") curY + y else y
                path.quadTo(ox + qx * sx, oy + qy * sy, ox + curX * sx, oy + curY * sy)
            }
            "C", "c" -> {
                val x1 = nextNum() ?: break
                val y1 = nextNum() ?: break
                val x2 = nextNum() ?: break
                val y2 = nextNum() ?: break
                val x = nextNum() ?: break
                val y = nextNum() ?: break
                val ax1 = if (cmd == "c") curX + x1 else x1
                val ay1 = if (cmd == "c") curY + y1 else y1
                val ax2 = if (cmd == "c") curX + x2 else x2
                val ay2 = if (cmd == "c") curY + y2 else y2
                curX = if (cmd == "c") curX + x else x
                curY = if (cmd == "c") curY + y else y
                path.cubicTo(
                    ox + ax1 * sx, oy + ay1 * sy,
                    ox + ax2 * sx, oy + ay2 * sy,
                    ox + curX * sx, oy + curY * sy,
                )
            }
            else -> i++
        }
    }
    return path
}
