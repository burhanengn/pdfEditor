package dev.gullacpdf.android

import dev.gullacpdf.android.model.CropMath
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpRectF
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CropMathTest {
    private fun img(rot: Double = 0.0, flipX: Boolean = false) = GpOverlayElement(
        id = "img",
        pageId = "p",
        kind = "imageReplacement",
        x = 100.0,
        y = 200.0,
        width = 200.0,
        height = 100.0,
        rotationDeg = rot,
        flipX = flipX,
    )

    @Test
    fun cropKeepsFullImageFixedOnPage() {
        for (rot in listOf(0.0, 30.0, 90.0, -135.0)) {
            for (flip in listOf(false, true)) {
                val el = img(rot, flip)
                val before = CropMath.fullFramePage(el)
                val cropped = CropMath.withDisplayCrop(el, GpRectF(0.25f, 0.1f, 0.75f, 0.6f))
                val after = CropMath.fullFramePage(cropped)
                assertEquals(before.left, after.left, 1e-6)
                assertEquals(before.top, after.top, 1e-6)
                assertEquals(before.width, after.width, 1e-6)
                assertEquals(before.height, after.height, 1e-6)
                assertEquals(100.0, cropped.width, 1e-6)
                assertEquals(50.0, cropped.height, 1e-6)
                // Display crop round-trips through the (possibly mirrored) source crop.
                val d = CropMath.displayCropOf(cropped)
                assertEquals(0.25f, d.left, 1e-5f)
                assertEquals(0.6f, d.bottom, 1e-5f)
            }
        }
    }

    @Test
    fun unrotatedCropMovesFrameByCropOffset() {
        val cropped = CropMath.withDisplayCrop(img(), GpRectF(0.5f, 0.5f, 1f, 1f))
        assertEquals(200.0, cropped.x, 1e-6)
        assertEquals(250.0, cropped.y, 1e-6)
        assertEquals(GpRectF(0.5f, 0.5f, 1f, 1f), cropped.cropRect)
    }

    @Test
    fun flippedCropStoresMirroredSourceRect() {
        val cropped = CropMath.withDisplayCrop(img(flipX = true), GpRectF(0f, 0f, 0.3f, 1f))
        val src = cropped.cropRect!!
        assertEquals(0.7f, src.left, 1e-5f)
        assertEquals(1f, src.right, 1e-5f)
    }

    @Test
    fun fullCropClearsCropRect() {
        val cropped = CropMath.withDisplayCrop(img(), GpRectF(0.2f, 0.2f, 0.8f, 0.8f))
        val reset = CropMath.withDisplayCrop(cropped, GpRectF(0f, 0f, 1f, 1f))
        assertNull(reset.cropRect)
        assertEquals(100.0, reset.x, 1e-6)
        assertEquals(200.0, reset.width, 1e-6)
    }

    @Test
    fun dragClampsToImageAndMinimumSize() {
        val d = CropMath.dragDisplayCrop(GpRectF(0.1f, 0.1f, 0.9f, 0.9f), "nw", -1f, 2f)
        assertEquals(0f, d.left, 1e-6f)
        assertEquals(0.9f - CropMath.MIN_SIZE, d.top, 1e-5f)
        val m = CropMath.dragDisplayCrop(GpRectF(0.1f, 0.1f, 0.5f, 0.5f), "move", 0.8f, 0f)
        assertEquals(0.6f, m.left, 1e-5f)
        assertEquals(1f, m.right, 1e-5f)
    }
}
