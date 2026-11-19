package dev.gullacpdf.android.ui.signature

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import dev.gullacpdf.android.model.GpPoint
import java.io.ByteArrayOutputStream
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/** A pen sample captured on the signature pad (pad pixels + timestamp). */
data class InkSample(val x: Float, val y: Float, val tMs: Long)

/**
 * "Original looking" signature ink: a thin, pressure/velocity-modulated pen line rendered as if the
 * signed paper had been photocopied (toner grain, slightly soft and uneven edges, faint specks),
 * so the placed signature does not read as a clean digital vector.
 */
object PhotocopyInk {
    /** Pixels per signature viewBox unit for the rendered raster (≈ 600 dpi at typical sizes). */
    private const val RASTER_SCALE = 3.2f

    /** Ballpoint-like half widths in viewBox units (viewBox is ~300 units wide). */
    private const val BASE_RADIUS = 0.62f
    private const val MIN_RADIUS = 0.34f
    private const val MAX_RADIUS = 0.98f

    private fun catmullRom(p0: GpPoint, p1: GpPoint, p2: GpPoint, p3: GpPoint, t: Float): GpPoint {
        val t2 = t * t
        val t3 = t2 * t
        val x = 0.5f * ((2f * p1.x) + (-p0.x + p2.x) * t + (2f * p0.x - 5f * p1.x + 4f * p2.x - p3.x) * t2 +
            (-p0.x + 3f * p1.x - 3f * p2.x + p3.x) * t3)
        val y = 0.5f * ((2f * p1.y) + (-p0.y + p2.y) * t + (2f * p0.y - 5f * p1.y + 4f * p2.y - p3.y) * t2 +
            (-p0.y + 3f * p1.y - 3f * p2.y + p3.y) * t3)
        return GpPoint(x, y)
    }

    /**
     * Closed outline of a fine pen stroke in viewBox space: smoothed centre line, width thinner on
     * fast movement and slightly heavier on slow movement, tapered entry and exit.
     */
    fun fineRibbon(stroke: List<InkSample>, padW: Float, padH: Float, viewBoxW: Float, viewBoxH: Float): List<GpPoint>? {
        if (stroke.size < 2) return null
        val sx = viewBoxW / padW.coerceAtLeast(1f)
        val sy = viewBoxH / padH.coerceAtLeast(1f)
        val pts = stroke.map { GpPoint(it.x * sx, it.y * sy) }

        // Per-sample speed (viewBox units per ms), smoothed.
        val speed = FloatArray(stroke.size)
        var smooth = 0.25f
        for (i in stroke.indices) {
            val prev = stroke[max(0, i - 1)]
            val cur = stroke[i]
            val d = hypot((cur.x - prev.x) * sx, (cur.y - prev.y) * sy)
            val dt = max(1L, cur.tMs - prev.tMs).toFloat()
            smooth = smooth * 0.7f + (d / dt).coerceIn(0f, 2.5f) * 0.3f
            speed[i] = smooth
        }

        // Smooth centre line (Catmull-Rom) with interpolated speed.
        val centre = ArrayList<GpPoint>()
        val centreSpeed = ArrayList<Float>()
        val steps = 4
        for (i in 0 until pts.size - 1) {
            val p0 = pts[max(0, i - 1)]
            val p1 = pts[i]
            val p2 = pts[i + 1]
            val p3 = pts[min(pts.lastIndex, i + 2)]
            for (s in 0 until steps) {
                val t = s / steps.toFloat()
                centre.add(catmullRom(p0, p1, p2, p3, t))
                centreSpeed.add(speed[i] + (speed[i + 1] - speed[i]) * t)
            }
        }
        centre.add(pts.last())
        centreSpeed.add(speed.last())
        if (centre.size < 2) return null

        val cum = FloatArray(centre.size)
        for (i in 1 until centre.size) {
            cum[i] = cum[i - 1] + hypot(centre[i].x - centre[i - 1].x, centre[i].y - centre[i - 1].y)
        }
        val total = cum.last().coerceAtLeast(0.001f)
        val taperLen = min(total * 0.18f, 9f)

        val left = ArrayList<GpPoint>(centre.size)
        val right = ArrayList<GpPoint>(centre.size)
        for (i in centre.indices) {
            val prev = centre[max(0, i - 1)]
            val next = centre[min(centre.lastIndex, i + 1)]
            val vx = next.x - prev.x
            val vy = next.y - prev.y
            val len = hypot(vx, vy)
            if (len < 1e-4f) continue
            val nx = -vy / len
            val ny = vx / len
            val speedFactor = (1.25f - centreSpeed[i] * 0.55f).coerceIn(0.55f, 1.25f)
            val entry = (cum[i] / taperLen).coerceIn(0f, 1f)
            val exit = ((total - cum[i]) / taperLen).coerceIn(0f, 1f)
            val taper = 0.3f + 0.7f * min(entry, exit)
            val r = (BASE_RADIUS * speedFactor * taper).coerceIn(MIN_RADIUS * 0.6f, MAX_RADIUS)
            val c = centre[i]
            left.add(GpPoint(c.x + nx * r, c.y + ny * r))
            right.add(GpPoint(c.x - nx * r, c.y - ny * r))
        }
        if (left.size < 2) return null
        return left + right.reversed()
    }

    fun ribbonPath(ribbon: List<GpPoint>, scaleX: Float, scaleY: Float): Path = Path().apply {
        moveTo(ribbon.first().x * scaleX, ribbon.first().y * scaleY)
        for (i in 1 until ribbon.size) lineTo(ribbon[i].x * scaleX, ribbon[i].y * scaleY)
        close()
    }

    /** Toner colour: the chosen ink pulled towards photocopier black. */
    fun tonerColor(inkColor: Int): Int {
        val k = 0.5f
        val r = ((inkColor ushr 16) and 0xFF) * (1 - k) + 0x1C * k
        val g = ((inkColor ushr 8) and 0xFF) * (1 - k) + 0x1C * k
        val b = (inkColor and 0xFF) * (1 - k) + 0x20 * k
        return (0xFF shl 24) or (r.toInt() shl 16) or (g.toInt() shl 8) or b.toInt()
    }

    private fun noise(x: Int, y: Int, seed: Int): Float {
        var h = x * 374761393 + y * 668265263 + seed * 1442695041
        h = (h xor (h ushr 13)) * 1274126177
        h = h xor (h ushr 16)
        return (h and 0xFFFF) / 65535f
    }

    /** Renders the strokes as a transparent PNG with a photocopied-ink look. */
    fun renderPng(
        strokes: List<List<InkSample>>,
        padW: Float,
        padH: Float,
        viewBoxW: Float,
        viewBoxH: Float,
        inkColor: Int,
    ): ByteArray? {
        val w = (viewBoxW * RASTER_SCALE).toInt().coerceIn(64, 2000)
        val h = (viewBoxH * RASTER_SCALE).toInt().coerceIn(32, 1200)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val toner = tonerColor(inkColor)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = toner
            style = Paint.Style.FILL
        }
        var drew = false
        for (s in strokes) {
            val ribbon = fineRibbon(s, padW, padH, viewBoxW, viewBoxH) ?: continue
            canvas.drawPath(ribbonPath(ribbon, RASTER_SCALE, RASTER_SCALE), paint)
            drew = true
        }
        if (!drew) {
            bmp.recycle()
            return null
        }

        val px = IntArray(w * h)
        bmp.getPixels(px, 0, w, 0, 0, w, h)
        val alpha = IntArray(w * h) { (px[it] ushr 24) and 0xFF }

        // Soft toner spread: blend each pixel with a light 3x3 blur of the alpha channel.
        val spread = IntArray(w * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                var sum = 0
                var n = 0
                for (dy in -1..1) {
                    val yy = y + dy
                    if (yy < 0 || yy >= h) continue
                    for (dx in -1..1) {
                        val xx = x + dx
                        if (xx < 0 || xx >= w) continue
                        sum += alpha[yy * w + xx]
                        n++
                    }
                }
                spread[y * w + x] = sum / max(1, n)
            }
        }

        val seed = strokes.sumOf { it.size } * 7919 + (strokes.firstOrNull()?.firstOrNull()?.tMs?.toInt() ?: 0)
        val rgb = toner and 0x00FFFFFF
        var minX = w
        var minY = h
        var maxX = 0
        var maxY = 0
        for (y in 0 until h) {
            for (x in 0 until w) {
                val i = y * w + x
                var a = (alpha[i] * 0.72f + spread[i] * 0.28f)
                if (a <= 0f) continue
                val n = noise(x, y, seed)
                // Uneven toner density + tiny dropouts inside the line.
                a *= 0.80f + 0.20f * n
                if (n < 0.03f) a *= 0.45f
                val ai = a.toInt().coerceIn(0, 255)
                px[i] = (ai shl 24) or rgb
                if (ai > 0) {
                    if (x < minX) minX = x
                    if (y < minY) minY = y
                    if (x > maxX) maxX = x
                    if (y > maxY) maxY = y
                }
            }
        }
        // A few faint toner specks around the signature, as photocopies have.
        if (maxX > minX && maxY > minY) {
            val area = (maxX - minX) * (maxY - minY)
            val specks = (area / 9000).coerceIn(4, 40)
            for (k in 0 until specks) {
                val sxp = minX + (noise(k, 17, seed) * (maxX - minX)).toInt()
                val syp = minY + (noise(31, k, seed) * (maxY - minY)).toInt()
                val sa = (35 + noise(k, k, seed) * 55).toInt()
                for (dy in 0..1) for (dx in 0..1) {
                    val xx = sxp + dx
                    val yy = syp + dy
                    if (xx in 0 until w && yy in 0 until h) {
                        val i = yy * w + xx
                        val cur = (px[i] ushr 24) and 0xFF
                        if (cur < sa) px[i] = (sa shl 24) or rgb
                    }
                }
            }
        }
        bmp.setPixels(px, 0, w, 0, 0, w, h)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        return out.toByteArray()
    }
}
