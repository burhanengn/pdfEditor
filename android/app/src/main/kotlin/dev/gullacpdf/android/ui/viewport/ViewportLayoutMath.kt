package dev.gullacpdf.android.ui.viewport

import dev.gullacpdf.android.model.GpPageMeta
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpRectF
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

data class PageLayoutRect(
    val pageIndex: Int,
    val page: GpPageMeta,
    val rectSurface: GpRectF,
)

data class ScrollBounds(
    val maxScrollX: Float,
    val maxScrollY: Float,
)

data class FocalAnchor(
    val pageIndex: Int,
    val pdfPoint: GpPoint,
)

data class SnapPositionResult(
    val x: Double,
    val y: Double,
    val vertGuideX: Float?,
    val horizGuideY: Float?,
)

/**
 * Pure deterministic viewport layout & focal-preserving zoom math.
 * Units:
 * - [zoom]: logical zoom where 1.0f means 1 PDF pt = [density] physical px.
 * - [viewportWidthPx], [viewportHeightPx], [scrollX], [scrollY]: physical px.
 */
object ViewportLayoutMath {
    const val MIN_ZOOM = 0.25f
    const val MAX_ZOOM = 8.0f
    const val PAGE_GAP_DP = 16f

    private val QUANTIZED_BUCKETS = floatArrayOf(
        0.25f, 0.5f, 0.75f, 1.0f, 1.25f, 1.5f, 2.0f, 2.5f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f,
    )

    fun quantizeTileZoom(rawZoom: Float, fitWidthZoom: Float): Float {
        if (fitWidthZoom > 0f && abs(rawZoom - fitWidthZoom) <= 0.03f) {
            return fitWidthZoom
        }
        var best = QUANTIZED_BUCKETS.first()
        var bestDiff = abs(rawZoom - best)
        for (b in QUANTIZED_BUCKETS) {
            val d = abs(rawZoom - b)
            if (d < bestDiff) {
                bestDiff = d
                best = b
            }
        }
        return best.coerceIn(MIN_ZOOM, MAX_ZOOM)
    }

    fun bucketKey(tileZoom: Float): String = String.format(java.util.Locale.US, "%.3f", tileZoom)

    fun computeFitWidthZoom(pages: List<GpPageMeta>, viewportWidthPx: Float, density: Float): Float {
        if (pages.isEmpty() || viewportWidthPx <= 0f || density <= 0f) return 1f
        val gapPx = PAGE_GAP_DP * density
        val firstW = pages.first().displayWidth.toFloat().coerceAtLeast(100f)
        return ((viewportWidthPx - gapPx * 2f) / (firstW * density)).coerceIn(0.35f, 3.0f)
    }

    fun computePageRects(
        pages: List<GpPageMeta>,
        zoom: Float,
        viewportWidthPx: Float,
        density: Float,
    ): List<PageLayoutRect> {
        if (pages.isEmpty()) return emptyList()
        val gapPx = PAGE_GAP_DP * density
        val scalePxPerPt = zoom * density
        val result = ArrayList<PageLayoutRect>(pages.size)
        var curY = gapPx
        for (i in pages.indices) {
            val p = pages[i]
            val w = (p.displayWidth * scalePxPerPt).toFloat()
            val h = (p.displayHeight * scalePxPerPt).toFloat()
            val x = max(gapPx, (viewportWidthPx - w) * 0.5f)
            result.add(PageLayoutRect(i, p, GpRectF.fromLTWH(x, curY, w, h)))
            curY += h + gapPx
        }
        return result
    }

    fun computeScrollBounds(
        layouts: List<PageLayoutRect>,
        viewportWidthPx: Float,
        viewportHeightPx: Float,
        density: Float,
    ): ScrollBounds {
        if (layouts.isEmpty()) return ScrollBounds(0f, 0f)
        val gapPx = PAGE_GAP_DP * density
        val totalH = layouts.last().rectSurface.bottom + gapPx
        var maxRight = 0f
        for (l in layouts) {
            if (l.rectSurface.right + gapPx > maxRight) {
                maxRight = l.rectSurface.right + gapPx
            }
        }
        return ScrollBounds(
            maxScrollX = max(0f, maxRight - viewportWidthPx),
            maxScrollY = max(0f, totalH - viewportHeightPx),
        )
    }

    /**
     * Captures the exact page and PDF-point coordinates beneath a screen focal point [screenX], [screenY].
     */
    fun captureFocalAnchor(
        pages: List<GpPageMeta>,
        zoom: Float,
        scrollX: Float,
        scrollY: Float,
        viewportWidthPx: Float,
        density: Float,
        screenX: Float,
        screenY: Float,
    ): FocalAnchor? {
        val layouts = computePageRects(pages, zoom, viewportWidthPx, density)
        if (layouts.isEmpty()) return null
        val surfX = scrollX + screenX
        val surfY = scrollY + screenY

        var best = layouts.first()
        var bestDist = Float.POSITIVE_INFINITY
        for (l in layouts) {
            val dy = when {
                surfY < l.rectSurface.top -> l.rectSurface.top - surfY
                surfY > l.rectSurface.bottom -> surfY - l.rectSurface.bottom
                else -> 0f
            }
            if (dy < bestDist) {
                bestDist = dy
                best = l
                if (dy == 0f) break
            }
        }

        val scale = (zoom * density).coerceAtLeast(0.01f)
        val pdfX = (surfX - best.rectSurface.left) / scale
        val pdfY = (surfY - best.rectSurface.top) / scale
        return FocalAnchor(best.pageIndex, GpPoint(pdfX, pdfY))
    }

    /**
     * Computes clamped scroll coordinates at [nextZoom] that pin [anchor] directly under ([focalScreenX], [focalScreenY]).
     * Eliminates page-gap scaling drift and centering transitions completely.
     */
    fun computeFocalPreservingScroll(
        pages: List<GpPageMeta>,
        anchor: FocalAnchor,
        nextZoom: Float,
        focalScreenX: Float,
        focalScreenY: Float,
        viewportWidthPx: Float,
        viewportHeightPx: Float,
        density: Float,
    ): Pair<Float, Float> {
        val clampedZoom = nextZoom.coerceIn(MIN_ZOOM, MAX_ZOOM)
        val layouts = computePageRects(pages, clampedZoom, viewportWidthPx, density)
        if (layouts.isEmpty()) return 0f to 0f
        val targetLayout = layouts[anchor.pageIndex.coerceIn(0, layouts.lastIndex)]
        val scale = clampedZoom * density
        val rawScrollX = targetLayout.rectSurface.left + anchor.pdfPoint.x * scale - focalScreenX
        val rawScrollY = targetLayout.rectSurface.top + anchor.pdfPoint.y * scale - focalScreenY
        val bounds = computeScrollBounds(layouts, viewportWidthPx, viewportHeightPx, density)
        return rawScrollX.coerceIn(0f, bounds.maxScrollX) to rawScrollY.coerceIn(0f, bounds.maxScrollY)
    }

    fun computeTotalPagePixels(page: GpPageMeta, tileZoom: Float, density: Float): Pair<Int, Int> {
        val scale = tileZoom * density
        val w = (page.displayWidth * scale).roundToInt().coerceAtLeast(1)
        val h = (page.displayHeight * scale).roundToInt().coerceAtLeast(1)
        return w to h
    }

    /**
     * Local rotated resize math matching `gp_geom::compute_rotated_resize_rect` at zoom=1 PDF-pt
     * coordinates, avoiding per-frame JNI + JSON overhead during interactive handle dragging.
     */
    fun computeRotatedResizeRect(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        rotationDeg: Double,
        handle: String,
        dxPdf: Double,
        dyPdf: Double,
        aspectLocked: Boolean,
        minSize: Double = 12.0,
    ): DoubleArray {
        val startCx = x + width * 0.5
        val startCy = y + height * 0.5
        val isCorner = handle == "nw" || handle == "ne" || handle == "se" || handle == "sw"
        val aspect = width / max(1.0, height)
        val rad = Math.toRadians(rotationDeg)
        val cosR = cos(rad)
        val sinR = sin(rad)
        val localDx = dxPdf * cosR + dyPdf * sinR
        val localDy = -dxPdf * sinR + dyPdf * cosR

        val dirX = when (handle) {
            "ne", "e", "se" -> 1.0
            "nw", "w", "sw" -> -1.0
            else -> 0.0
        }
        val dirY = when (handle) {
            "sw", "s", "se" -> 1.0
            "nw", "n", "ne" -> -1.0
            else -> 0.0
        }

        var dw = dirX * localDx
        var dh = dirY * localDy
        if (isCorner && aspectLocked) {
            if ((abs(dw) / aspect) >= abs(dh)) {
                dh = dw / aspect
            } else {
                dw = dh * aspect
            }
        }

        val minDim = max(1.0, minSize)
        var nextW = max(minDim, width + dw)
        var nextH = max(minDim, height + dh)
        if (isCorner && aspectLocked) {
            if (nextW / aspect < minDim) {
                nextH = minDim
                nextW = nextH * aspect
            } else {
                nextH = nextW / aspect
            }
        }

        val actualDw = nextW - width
        val actualDh = nextH - height
        val localShiftX = (dirX * actualDw) * 0.5
        val localShiftY = (dirY * actualDh) * 0.5
        val nextCx = startCx + (localShiftX * cosR - localShiftY * sinR)
        val nextCy = startCy + (localShiftX * sinR + localShiftY * cosR)
        return doubleArrayOf(nextCx - nextW * 0.5, nextCy - nextH * 0.5, nextW, nextH)
    }

    /**
     * Local page-margin & sibling snap alignment matching `gp_geom::compute_snap_position`.
     */
    fun computeSnapPosition(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        pageW: Double,
        pageH: Double,
        siblings: List<GpRectF>,
        threshold: Double = 5.0,
        margin: Double = 36.0,
    ): SnapPositionResult {
        val xTargets = DoubleArray(3 + siblings.size * 3)
        val yTargets = DoubleArray(3 + siblings.size * 3)
        xTargets[0] = margin
        xTargets[1] = pageW * 0.5
        xTargets[2] = pageW - margin
        yTargets[0] = margin
        yTargets[1] = pageH * 0.5
        yTargets[2] = pageH - margin
        var xi = 3
        var yi = 3
        for (sib in siblings) {
            xTargets[xi++] = sib.left.toDouble()
            xTargets[xi++] = (sib.left + sib.width * 0.5f).toDouble()
            xTargets[xi++] = sib.right.toDouble()
            yTargets[yi++] = sib.top.toDouble()
            yTargets[yi++] = (sib.top + sib.height * 0.5f).toDouble()
            yTargets[yi++] = sib.bottom.toDouble()
        }

        var bestDx = 0.0
        var bestXDist = threshold + 1.0
        var bestXTarget: Float? = null
        val mx0 = x
        val mx1 = x + width * 0.5
        val mx2 = x + width
        for (t in xTargets) {
            for (edge in doubleArrayOf(mx0, mx1, mx2)) {
                val d = abs(t - edge)
                if (d < bestXDist) {
                    bestXDist = d
                    bestDx = t - edge
                    bestXTarget = t.toFloat()
                }
            }
        }

        var bestDy = 0.0
        var bestYDist = threshold + 1.0
        var bestYTarget: Float? = null
        val my0 = y
        val my1 = y + height * 0.5
        val my2 = y + height
        for (t in yTargets) {
            for (edge in doubleArrayOf(my0, my1, my2)) {
                val d = abs(t - edge)
                if (d < bestYDist) {
                    bestYDist = d
                    bestDy = t - edge
                    bestYTarget = t.toFloat()
                }
            }
        }

        return SnapPositionResult(
            x = if (bestXDist <= threshold) x + bestDx else x,
            y = if (bestYDist <= threshold) y + bestDy else y,
            vertGuideX = if (bestXDist <= threshold) bestXTarget else null,
            horizGuideY = if (bestYDist <= threshold) bestYTarget else null,
        )
    }
}
