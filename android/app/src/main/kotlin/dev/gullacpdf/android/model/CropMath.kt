package dev.gullacpdf.android.model

import kotlin.math.cos
import kotlin.math.sin

/**
 * Geometry for interactive image cropping.
 *
 * An image element draws the source region `cropRect` (normalized 0..1, source/bitmap space)
 * stretched into its frame `x, y, width, height` (rotated by `rotationDeg` about the frame
 * centre, mirrored by `flipX/flipY`). While cropping we keep the *full* image frame fixed on the
 * page and move the crop window inside it, so the visible pixels never change scale.
 *
 * "Display crop" is the crop window in the element's local, unrotated, already-mirrored frame,
 * i.e. what the user sees; it differs from `cropRect` only when the image is flipped.
 */
object CropMath {
    const val MIN_SIZE = 0.04f

    private val FULL = GpRectF(0f, 0f, 1f, 1f)

    fun displayCropOf(el: GpOverlayElement): GpRectF = toDisplay(el.cropRect ?: FULL, el.flipX, el.flipY)

    private fun toDisplay(c: GpRectF, flipX: Boolean, flipY: Boolean): GpRectF = GpRectF(
        if (flipX) 1f - c.right else c.left,
        if (flipY) 1f - c.bottom else c.top,
        if (flipX) 1f - c.left else c.right,
        if (flipY) 1f - c.top else c.bottom,
    )

    /** Display crop -> source crop (the mirror mapping is its own inverse). */
    private fun toSource(d: GpRectF, flipX: Boolean, flipY: Boolean): GpRectF = toDisplay(d, flipX, flipY)

    /**
     * The full (uncropped) image frame in local unrotated coordinates relative to the element
     * centre, in page points: left, top, width, height.
     */
    data class FullFrame(val left: Double, val top: Double, val width: Double, val height: Double)

    fun fullFrameLocal(el: GpOverlayElement): FullFrame {
        val d = displayCropOf(el)
        val fw = el.width / d.width.coerceAtLeast(MIN_SIZE).toDouble()
        val fh = el.height / d.height.coerceAtLeast(MIN_SIZE).toDouble()
        val left = -el.width / 2.0 - d.left * fw
        val top = -el.height / 2.0 - d.top * fh
        return FullFrame(left, top, fw, fh)
    }

    /** The full uncropped image frame on the page (unrotated rect; same rotation as [el]). */
    fun fullFramePage(el: GpOverlayElement): FullFrame {
        val ff = fullFrameLocal(el)
        val lcx = ff.left + ff.width / 2.0
        val lcy = ff.top + ff.height / 2.0
        val rad = Math.toRadians(el.rotationDeg)
        val cx = el.x + el.width / 2.0 + lcx * cos(rad) - lcy * sin(rad)
        val cy = el.y + el.height / 2.0 + lcx * sin(rad) + lcy * cos(rad)
        return FullFrame(cx - ff.width / 2.0, cy - ff.height / 2.0, ff.width, ff.height)
    }

    /**
     * Returns [el] re-framed so it shows display crop [d] while the full image stays where it is.
     */
    fun withDisplayCrop(el: GpOverlayElement, d: GpRectF): GpOverlayElement {
        val ff = fullFrameLocal(el)
        val c = clampDisplay(d)
        val ww = c.width * ff.width
        val wh = c.height * ff.height
        val lcx = ff.left + c.left * ff.width + ww / 2.0
        val lcy = ff.top + c.top * ff.height + wh / 2.0
        val rad = Math.toRadians(el.rotationDeg)
        val cosR = cos(rad)
        val sinR = sin(rad)
        val cx = el.x + el.width / 2.0 + lcx * cosR - lcy * sinR
        val cy = el.y + el.height / 2.0 + lcx * sinR + lcy * cosR
        val src = toSource(c, el.flipX, el.flipY)
        val isFull = src.left <= 0.001f && src.top <= 0.001f && src.right >= 0.999f && src.bottom >= 0.999f
        return el.copy(
            x = cx - ww / 2.0,
            y = cy - wh / 2.0,
            width = ww,
            height = wh,
            cropRect = if (isFull) null else src,
        )
    }

    fun clampDisplay(d: GpRectF): GpRectF {
        var l = d.left.coerceIn(0f, 1f - MIN_SIZE)
        var t = d.top.coerceIn(0f, 1f - MIN_SIZE)
        var r = d.right.coerceIn(l + MIN_SIZE, 1f)
        var b = d.bottom.coerceIn(t + MIN_SIZE, 1f)
        if (r - l < MIN_SIZE) l = (r - MIN_SIZE).coerceAtLeast(0f)
        if (b - t < MIN_SIZE) t = (b - MIN_SIZE).coerceAtLeast(0f)
        return GpRectF(l, t, r, b)
    }

    /**
     * Applies a drag of ([du], [dv]) — in fractions of the full image size — to [origin] for the
     * given handle ("nw", "n", "ne", "e", "se", "s", "sw", "w" or "move").
     */
    fun dragDisplayCrop(origin: GpRectF, handle: String, du: Float, dv: Float): GpRectF {
        if (handle == "move") {
            val w = origin.width
            val h = origin.height
            val l = (origin.left + du).coerceIn(0f, 1f - w)
            val t = (origin.top + dv).coerceIn(0f, 1f - h)
            return GpRectF(l, t, l + w, t + h)
        }
        var l = origin.left
        var t = origin.top
        var r = origin.right
        var b = origin.bottom
        if ('w' in handle) l = (l + du).coerceIn(0f, r - MIN_SIZE)
        if ('e' in handle) r = (r + du).coerceIn(l + MIN_SIZE, 1f)
        if ('n' in handle) t = (t + dv).coerceIn(0f, b - MIN_SIZE)
        if ('s' in handle) b = (b + dv).coerceIn(t + MIN_SIZE, 1f)
        return GpRectF(l, t, r, b)
    }
}
