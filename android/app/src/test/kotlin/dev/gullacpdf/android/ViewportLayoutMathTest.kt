package dev.gullacpdf.android

import dev.gullacpdf.android.model.GpPageMeta
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.ui.viewport.ViewportLayoutMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class ViewportLayoutMathTest {
    private val samplePages = listOf(
        GpPageMeta(id = "p0", sourceDocId = "d", sourcePageIndex = 0, baseWidth = 595.0, baseHeight = 842.0, intrinsicRotation = 0),
        GpPageMeta(id = "p1", sourceDocId = "d", sourcePageIndex = 1, baseWidth = 595.0, baseHeight = 842.0, intrinsicRotation = 0),
        GpPageMeta(id = "p2", sourceDocId = "d", sourcePageIndex = 2, baseWidth = 595.0, baseHeight = 842.0, intrinsicRotation = 0),
    )

    @Test
    fun deepZoomKeepsFocalPointPinnedWithoutDownwardShift() {
        val density = 3.0f
        val viewW = 1080f
        val viewH = 2200f
        val fit = ViewportLayoutMath.computeFitWidthZoom(samplePages, viewW, density)
        assertTrue(fit in 0.4f..1.0f)

        val focalX = 420f
        val focalY = 980f
        val startScrollX = 0f
        val startScrollY = 1400f // scrolled onto page 1

        val anchor = ViewportLayoutMath.captureFocalAnchor(
            pages = samplePages,
            zoom = fit,
            scrollX = startScrollX,
            scrollY = startScrollY,
            viewportWidthPx = viewW,
            density = density,
            screenX = focalX,
            screenY = focalY,
        )
        assertNotNull(anchor)
        anchor!!

        // Step through deep zoom up to 8.0x (both pinch & Adobe drag path)
        for (targetZoom in listOf(1.0f, 1.8f, 3.0f, 5.5f, 8.0f)) {
            val (nextScrollX, nextScrollY) = ViewportLayoutMath.computeFocalPreservingScroll(
                pages = samplePages,
                anchor = anchor,
                nextZoom = targetZoom,
                focalScreenX = focalX,
                focalScreenY = focalY,
                viewportWidthPx = viewW,
                viewportHeightPx = viewH,
                density = density,
            )

            val layoutsAfter = ViewportLayoutMath.computePageRects(samplePages, targetZoom, viewW, density)
            val bounds = ViewportLayoutMath.computeScrollBounds(layoutsAfter, viewW, viewH, density)
            assertTrue(nextScrollX in 0f..bounds.maxScrollX)
            assertTrue(nextScrollY in 0f..bounds.maxScrollY)

            // Verify focal screen coordinate re-maps right back to the exact PDF point
            val targetPageRect = layoutsAfter[anchor.pageIndex].rectSurface
            val scale = targetZoom * density
            val recoveredPdfX = (nextScrollX + focalX - targetPageRect.left) / scale
            val recoveredPdfY = (nextScrollY + focalY - targetPageRect.top) / scale
            assertEquals(anchor.pdfPoint.x, recoveredPdfX, 0.2f)
            assertEquals(anchor.pdfPoint.y, recoveredPdfY, 0.2f)
        }
    }

    @Test
    fun highDpiBucketsScaleSharplyToMaxZoom() {
        val page = samplePages.first()
        val density = 3.0f
        val q8 = ViewportLayoutMath.quantizeTileZoom(8.0f, 0.56f)
        assertEquals(8.0f, q8, 0.001f)
        val (wPx, hPx) = ViewportLayoutMath.computeTotalPagePixels(page, q8, density)
        // 595 * 8.0 * 3.0 = 14280 px high-DPI virtual tile surface
        assertEquals(14280, wPx)
        assertEquals(20208, hPx)
    }

    @Test
    fun userRotationSwapsDisplayDimensionsWithoutDoubleApplyingIntrinsic() {
        val rotatedIntrinsic = GpPageMeta(
            id = "p_rot",
            sourceDocId = "d",
            sourcePageIndex = 0,
            baseWidth = 842.0,
            baseHeight = 595.0,
            intrinsicRotation = 90,
            userRotation = 0,
        )
        assertEquals(842.0, rotatedIntrinsic.displayWidth, 0.001)
        assertEquals(595.0, rotatedIntrinsic.displayHeight, 0.001)

        val userRotated = rotatedIntrinsic.copy(userRotation = 90)
        assertEquals(595.0, userRotated.displayWidth, 0.001)
        assertEquals(842.0, userRotated.displayHeight, 0.001)
    }
}
