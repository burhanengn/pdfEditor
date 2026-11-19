package dev.gullacpdf.android.model

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.runtime.Immutable
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.abs

enum class GpAppMode { VIEW, EDIT }

enum class GpEditorTool {
    SELECT,
    TEXT,
    DRAW,
    ERASER,
    HIGHLIGHT,
    SIGNATURE,
    SHAPE,
    LINE,
    IMAGE,
    REDACT,
}

enum class GpSheetKind {
    NONE,
    NAVIGATOR,
    SEARCH,
    SETTINGS,
    SAVE_WORKFLOW,
    ORGANIZE,
    PAGE_NUMBERING,
    PAGE_TEXT,
    ELEMENT_INSPECTOR,
    SIGNATURE_STUDIO,
}

enum class GpLayoutClass { COMPACT, MEDIUM, EXPANDED }

@Immutable
data class GpPoint(val x: Float, val y: Float, val smooth: Boolean? = null)

internal fun normalizedPointMap(
    p: GpPoint,
    originX: Double,
    originY: Double,
    safeW: Double,
    safeH: Double,
): Map<String, Any> = buildMap {
    put("x", ((p.x - originX) / safeW).coerceIn(0.0, 1.0))
    put("y", ((p.y - originY) / safeH).coerceIn(0.0, 1.0))
    p.smooth?.let { put("smooth", it) }
}

@Immutable
data class GpRectF(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val width: Float get() = (right - left).coerceAtLeast(0f)
    val height: Float get() = (bottom - top).coerceAtLeast(0f)
    val centerX: Float get() = (left + right) * 0.5f
    val centerY: Float get() = (top + bottom) * 0.5f

    fun contains(x: Float, y: Float): Boolean =
        x >= left && x <= right && y >= top && y <= bottom

    fun inflate(delta: Float): GpRectF =
        GpRectF(left - delta, top - delta, right + delta, bottom + delta)

    fun overlaps(other: GpRectF): Boolean =
        left < other.right && right > other.left && top < other.bottom && bottom > other.top

    companion object {
        fun fromLTWH(x: Float, y: Float, w: Float, h: Float) =
            GpRectF(x, y, x + w, y + h)
    }
}

@Immutable
data class GpPageMeta(
    val id: String,
    val sourceDocId: String,
    val sourcePageIndex: Int,
    val baseWidth: Double,
    val baseHeight: Double,
    val intrinsicRotation: Int,
    val userRotation: Int = 0,
) {
    val displayWidth: Double
        get() = if (userRotation == 90 || userRotation == 270) baseHeight else baseWidth

    val displayHeight: Double
        get() = if (userRotation == 90 || userRotation == 270) baseWidth else baseHeight

    fun toCoreJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("sourceDocId", sourceDocId)
        put("sourcePageIndex", sourcePageIndex)
        put("baseWidth", baseWidth)
        put("baseHeight", baseHeight)
        put("intrinsicRotation", intrinsicRotation)
        put("userRotation", userRotation)
        put("mediaBox", JSONArray().apply {
            put(0.0); put(0.0); put(baseWidth); put(baseHeight)
        })
        put("cropBox", JSONArray().apply {
            put(0.0); put(0.0); put(baseWidth); put(baseHeight)
        })
    }
}

@Immutable
data class GpOutlineNode(
    val id: String,
    val title: String,
    val pageIndex: Int? = null,
    val children: List<GpOutlineNode> = emptyList(),
)

@Immutable
data class GpSignatureSvgPath(
    val d: String,
    val fill: String? = null,
    val stroke: String? = null,
    val strokeWidth: Double? = null,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("d", d)
        if (fill != null) put("fill", fill)
        if (stroke != null) put("stroke", stroke)
        if (strokeWidth != null) put("strokeWidth", strokeWidth)
    }

    companion object {
        fun fromJson(obj: JSONObject): GpSignatureSvgPath = GpSignatureSvgPath(
            d = obj.optString("d", ""),
            fill = obj.optString("fill").takeIf { it.isNotEmpty() && !obj.isNull("fill") },
            stroke = obj.optString("stroke").takeIf { it.isNotEmpty() && !obj.isNull("stroke") },
            strokeWidth = if (obj.has("strokeWidth") && !obj.isNull("strokeWidth")) obj.optDouble("strokeWidth") else null,
        )
    }
}

@Immutable
data class GpTextRun(
    val text: String,
    val bold: Boolean? = null,
    val italic: Boolean? = null,
    val underline: Boolean? = null,
    val strikethrough: Boolean? = null,
    val script: String? = null, // normal | super | sub
) {
    fun toCoreJson(): JSONObject = JSONObject().apply {
        put("text", text)
        bold?.let { put("bold", it) }
        italic?.let { put("italic", it) }
        underline?.let { put("underline", it) }
        strikethrough?.let { put("strikethrough", it) }
        script?.takeIf { it.isNotEmpty() && it != "normal" }?.let { put("script", it) }
    }
}

/**
 * What a clean preview document already contains for one element: the original text lines it
 * stripped (null + [wholeBlock] = the whole paragraph) or the placement of an in-place move.
 */
@Immutable
data class GpCleanElementMeta(
    val strippedLines: Set<Int>? = null,
    val wholeBlock: Boolean = false,
    val placementSig: Int? = null,
)

/** One original typeset line of a PDF paragraph (visual page coordinates, points). */
@Immutable
data class GpTextLineInfo(
    val text: String,
    val x0: Double,
    val x1: Double,
    val y0: Double,
    val y1: Double,
    val baseline: Double,
    val fontSize: Double,
    val softWrapAfter: Boolean,
)

@Immutable
data class GpExtractedFontInfo(
    val id: String,
    val cleanName: String,
    val displayName: String,
    val baseKey: String,
    val fallbackFamily: String,
    val unicodeUsable: Boolean,
    val regularTtfPath: String? = null,
    val boldTtfPath: String? = null,
    val italicTtfPath: String? = null,
    val boldItalicTtfPath: String? = null,
) {
    val hasAnyTtf: Boolean
        get() = regularTtfPath != null || boldTtfPath != null || italicTtfPath != null || boldItalicTtfPath != null
}

@Immutable
data class GpOverlayElement(
    val id: String,
    val pageId: String,
    val kind: String, // textAdd | textEdit | ink | path | highlight | shape | shapeReplacement | signature | image | imageReplacement
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val rotationDeg: Double = 0.0,
    val text: String = "",
    val runs: List<GpTextRun> = emptyList(),
    val fontSize: Double = 14.0,
    val fontFamily: String = "DejaVuSans",
    val bold: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val strikethrough: Boolean = false,
    val scriptMode: String = "normal", // normal | super | sub
    val align: String = "left", // left | center | right | justify
    val lineHeight: Double = 1.25,
    val letterSpacing: Double = 0.0,
    val horizontalScale: Double = 1.0,
    val embeddedFontId: String? = null,
    val fontWarning: String? = null,
    val colorValue: Int = 0xFF0F172A.toInt(),
    val backgroundColorValue: Int = 0x00000000,
    val fillColorValue: Int = 0x00000000,
    val strokeWidth: Double = 2.0,
    val opacity: Double = 1.0,
    val points: List<GpPoint> = emptyList(),
    val isRedact: Boolean = false,
    val sourceBlockId: String = "",
    val originalText: String = "",
    val shapeType: String = "rect", // rect | ellipse | triangle | diamond | arrow
    val borderRadius: Double = 0.0,
    val strokeDash: String = "solid", // solid | dashed | dotted
    val closed: Boolean = false,
    val smooth: Boolean = true,
    val behindContent: Boolean = false,
    val zIndex: Int = 0,
    val locked: Boolean = false,
    val deleted: Boolean = false,
    val origX: Double? = null,
    val origY: Double? = null,
    val origWidth: Double? = null,
    val origHeight: Double? = null,
    val origRotationDeg: Double = 0.0,
    val origOpacity: Double = 1.0,
    val origFlipX: Boolean = false,
    val origFlipY: Boolean = false,
    val isBackgroundLayer: Boolean = false,
    val baselineOffset: Double? = null,
    val paragraphWidth: Double? = null,
    val imageName: String = "",
    val mimeType: String = "image/png",
    val imageBytes: ByteArray? = null,
    val cropRect: GpRectF? = null, // normalized 0..1
    val flipX: Boolean = false,
    val flipY: Boolean = false,
    val repeatAcrossPages: Boolean = false,
    val svgPath: String = "",
    val signatureId: String = "",
    val svgPaths: List<GpSignatureSvgPath> = emptyList(),
    val viewBoxWidth: Double = 300.0,
    val viewBoxHeight: Double = 180.0,
    val realisticInk: Boolean = false,
    /**
     * True while an object promoted from the PDF (text block, image, vector shape) has only been
     * selected and not changed in any way. Pristine objects keep rendering from the original PDF
     * raster (no clean-preview stripping, no overlay redraw, untouched on export/print), so merely
     * selecting a background photo or a paragraph never changes its layer, font or position.
     */
    val pristine: Boolean = false,
    /** Original lines of a promoted PDF paragraph (empty for everything else). */
    val origLines: List<GpTextLineInfo> = emptyList(),
    /** Rich runs of the original paragraph, used to detect style-only edits per character. */
    val originalRuns: List<GpTextRun> = emptyList(),
    /** [styleKey] captured when the object was promoted from the PDF. */
    val origStyleKey: String? = null,
    /** Box width when the paragraph was promoted (line geometry is kept while unchanged). */
    val origBoxWidth: Double? = null,
) {
    val isTextKind: Boolean get() = kind == "textAdd" || kind == "textEdit"

    val isPdfSourceKind: Boolean
        get() = kind == "textEdit" || kind == "imageReplacement" || kind == "shapeReplacement"

    /**
     * Visual style fingerprint. Paragraph edits keep the original line geometry (and untouched
     * lines stay byte-for-byte original) only while this equals [origStyleKey].
     */
    fun styleKey(): String = when (kind) {
        "textEdit", "textAdd" ->
            "t|$fontSize|$fontFamily|$bold|$italic|$underline|$strikethrough|$scriptMode|$align|" +
                "$lineHeight|$horizontalScale|$letterSpacing|$embeddedFontId|$colorValue|$opacity|$backgroundColorValue"
        "shapeReplacement" -> "s|$fillColorValue|$colorValue|$strokeWidth|$opacity|$svgPath|$strokeDash"
        // Crop is applied in place too (clip path around the original image), so it is not a style change.
        "imageReplacement" -> "i|$opacity"
        else -> kind
    }

    /**
     * A promoted PDF image/shape that was only moved, resized, rotated or flipped: the original
     * object is re-placed inside the content stream, so it keeps its exact layer (a background
     * stays behind text and panels) and its original encoding.
     */
    fun movesInPlace(): Boolean =
        !deleted && !pristine && (kind == "imageReplacement" || kind == "shapeReplacement") &&
            origStyleKey != null && origStyleKey == styleKey() && origX != null && origWidth != null

    /** Signature of the placement an in-place move produces (clean previews are matched by it). */
    fun placementSignature(): Int {
        var r = x.hashCode()
        r = 31 * r + y.hashCode()
        r = 31 * r + width.hashCode()
        r = 31 * r + height.hashCode()
        r = 31 * r + rotationDeg.hashCode()
        r = 31 * r + flipX.hashCode()
        r = 31 * r + flipY.hashCode()
        r = 31 * r + cropRect.hashCode()
        return r
    }

    /** Whether this element is still painted by the untouched PDF page raster/content. */
    fun staysInPdfRaster(analysis: GpPageAnalysis? = null): Boolean =
        (pristine && !deleted && isPdfSourceKind) || isUnmodifiedBehind(analysis)

    /** Same element with [pristine] cleared when anything other than the flag differs from [before]. */
    fun withPristineResolvedAgainst(before: GpOverlayElement): GpOverlayElement =
        if (pristine && copy(pristine = false, locked = before.locked) != before.copy(pristine = false)) {
            copy(pristine = false)
        } else {
            this
        }

    fun effectiveOriginalRectJson(): JSONObject? {
        val ox = origX ?: return null
        val oy = origY ?: return null
        val ow = origWidth ?: return null
        val oh = origHeight ?: return null
        return JSONObject().apply {
            put("x", ox)
            put("y", oy)
            put("width", ow)
            put("height", oh)
        }
    }

    /**
     * Unmodified behind-content replacements remain inside the underlying PDF raster tiles so
     * selecting them never brings a background graphic in front of PDF text or forces tile re-renders.
     */
    fun isUnmodifiedBehind(analysis: GpPageAnalysis? = null): Boolean {
        if (deleted || !behindContent) return false
        if (kind != "imageReplacement" && kind != "shapeReplacement") return false
        val ox = origX ?: return false
        val oy = origY ?: return false
        val ow = origWidth ?: return false
        val oh = origHeight ?: return false
        val geomUnchanged = kotlin.math.abs(x - ox) < 0.5 &&
            kotlin.math.abs(y - oy) < 0.5 &&
            kotlin.math.abs(width - ow) < 0.5 &&
            kotlin.math.abs(height - oh) < 0.5 &&
            kotlin.math.abs(rotationDeg - origRotationDeg) < 0.5 &&
            kotlin.math.abs(opacity - origOpacity) < 0.02 &&
            flipX == origFlipX &&
            flipY == origFlipY
        if (!geomUnchanged) return false
        if (kind == "shapeReplacement" && analysis != null && sourceBlockId.isNotEmpty()) {
            val origShape = analysis.shapes.firstOrNull { it.id == sourceBlockId }
            if (origShape != null) {
                val strokeDiffers = (colorValue != origShape.strokeColorValue) ||
                    (((colorValue ushr 24) > 0) &&
                        kotlin.math.abs(strokeWidth - origShape.strokeWidth.coerceAtLeast(0.5)) > 0.25)
                if (fillColorValue != origShape.fillColorValue || strokeDiffers) {
                    return false
                }
            }
        }
        return true
    }

    /** Paragraph wrap width: the original paragraph measure until the user resizes the box. */
    fun layoutWrapWidth(): Double {
        val para = paragraphWidth
        val ow = origWidth
        return if (para != null && ow != null && kotlin.math.abs(width - ow) < 6.0) para else width
    }

    fun cloneForPage(newId: String, newPageId: String): GpOverlayElement =
        copy(id = newId, pageId = newPageId, points = points.toList())

    fun withAppendedPoint(pt: GpPoint, prepend: Boolean = false): GpOverlayElement {
        val nextPts = if (prepend) listOf(pt) + points else points + pt
        return withUpdatedPoints(nextPts, closed = closed)
    }

    fun withUpdatedPoints(nextPts: List<GpPoint>, closed: Boolean = this.closed): GpOverlayElement {
        if (nextPts.isEmpty()) return this
        var minX = Float.POSITIVE_INFINITY
        var minY = Float.POSITIVE_INFINITY
        var maxX = Float.NEGATIVE_INFINITY
        var maxY = Float.NEGATIVE_INFINITY
        for (p in nextPts) {
            if (p.x < minX) minX = p.x
            if (p.y < minY) minY = p.y
            if (p.x > maxX) maxX = p.x
            if (p.y > maxY) maxY = p.y
        }
        val w = (maxX - minX).toDouble().coerceAtLeast(12.0)
        val h = (maxY - minY).toDouble().coerceAtLeast(12.0)
        return copy(
            x = minX.toDouble(),
            y = minY.toDouble(),
            width = w,
            height = h,
            points = nextPts,
            closed = closed,
        )
    }

    fun toCoreJson(): JSONObject {
        fun toHex(argb: Int): String = String.format("#%06x", argb and 0xFFFFFF)

        return when (kind) {
            "textEdit" -> JSONObject().apply {
                put("id", id)
                put("pageId", pageId)
                put("kind", "text-edit")
                put("x", x)
                put("y", y)
                // Same wrap width the on-screen overlay uses, so exported line breaks match the
                // original paragraph (and the editor preview) while the box was not resized.
                put("width", layoutWrapWidth())
                put("height", height)
                put("rotation", rotationDeg)
                put("opacity", opacity)
                put("zIndex", if (zIndex == 0) 10 else zIndex)
                if (isBackgroundLayer) put("isBackgroundLayer", true)
                put("sourceBlockId", sourceBlockId)
                effectiveOriginalRectJson()?.let { put("originalRect", it) }
                put("originalText", originalText)
                put("text", text)
                if (runs.isNotEmpty()) {
                    put("runs", JSONArray().apply { runs.forEach { put(it.toCoreJson()) } })
                }
                put("fontSize", fontSize)
                put("fontFamily", fontFamily)
                put("color", toHex(colorValue))
                if ((backgroundColorValue ushr 24) > 0) {
                    put("backgroundColor", toHex(backgroundColorValue))
                }
                put("bold", bold)
                put("italic", italic)
                if (underline) put("underline", true)
                if (strikethrough) put("strikethrough", true)
                if (scriptMode != "normal") put("scriptMode", scriptMode)
                embeddedFontId?.takeIf { it.isNotEmpty() }?.let { put("embeddedFontId", it) }
                put("align", align)
                put("lineHeight", lineHeight)
                if (letterSpacing != 0.0) put("letterSpacing", letterSpacing)
                if (horizontalScale != 1.0) put("horizontalScale", horizontalScale)
                if (deleted) put("deleted", true)
            }
            "textAdd" -> JSONObject().apply {
                put("id", id)
                put("pageId", pageId)
                put("kind", "text-add")
                put("x", x)
                put("y", y)
                put("width", width)
                put("height", height)
                put("rotation", rotationDeg)
                put("opacity", opacity)
                put("zIndex", if (zIndex == 0) 10 else zIndex)
                put("text", text)
                if (runs.isNotEmpty()) {
                    put("runs", JSONArray().apply { runs.forEach { put(it.toCoreJson()) } })
                }
                put("fontSize", fontSize)
                put("fontFamily", fontFamily)
                put("color", toHex(colorValue))
                if ((backgroundColorValue ushr 24) > 0) {
                    put("backgroundColor", toHex(backgroundColorValue))
                }
                put("bold", bold)
                put("italic", italic)
                if (underline) put("underline", true)
                if (strikethrough) put("strikethrough", true)
                if (scriptMode != "normal") put("scriptMode", scriptMode)
                embeddedFontId?.takeIf { it.isNotEmpty() }?.let { put("embeddedFontId", it) }
                put("align", align)
                put("lineHeight", lineHeight)
                if (letterSpacing != 0.0) put("letterSpacing", letterSpacing)
                if (horizontalScale != 1.0) put("horizontalScale", horizontalScale)
            }
            "highlight" -> JSONObject().apply {
                put("id", id)
                put("pageId", pageId)
                put("kind", "highlight")
                put("shape", if (isRedact) "redact" else "highlight")
                put("x", x)
                put("y", y)
                put("width", width)
                put("height", height)
                put("rotation", rotationDeg)
                put("opacity", if (isRedact) 1.0 else opacity)
                put("zIndex", if (zIndex == 0) 5 else zIndex)
                put("fillColor", if (isRedact) "#000000" else toHex(fillColorValue))
            }
            "image", "imageReplacement" -> {
                val isRep = kind == "imageReplacement"
                JSONObject().apply {
                    put("id", id)
                    put("pageId", pageId)
                    put("kind", if (isRep) "image-replacement" else "image")
                    // An in-place crop re-places the FULL original image and clips it to this frame.
                    val inPlaceCrop = isRep && cropRect != null && movesInPlace()
                    val full = if (inPlaceCrop) CropMath.fullFramePage(this@GpOverlayElement) else null
                    put("x", full?.left ?: x)
                    put("y", full?.top ?: y)
                    put("width", full?.width ?: width)
                    put("height", full?.height ?: height)
                    if (inPlaceCrop) {
                        put("inPlaceClip", JSONObject().apply {
                            put("x", x)
                            put("y", y)
                            put("width", width)
                            put("height", height)
                        })
                    }
                    put("rotation", rotationDeg)
                    put("opacity", opacity)
                    put("zIndex", if (zIndex == 0) 6 else zIndex)
                    if (isBackgroundLayer) put("isBackgroundLayer", true)
                    if (!isRep) put("name", imageName.ifEmpty { "image.png" })
                    if (isRep) {
                        put("sourceImageId", sourceBlockId)
                        effectiveOriginalRectJson()?.let { put("originalRect", it) }
                    }
                    put("mimeType", mimeType)
                    put("previewUrl", "")
                    put("naturalWidth", width)
                    put("naturalHeight", height)
                    put("aspectLocked", true)
                    put("behindContent", behindContent)
                    if (behindContent) put("layerTier", 1)
                    put("flipX", flipX)
                    put("flipY", flipY)
                    if (!isRep) put("repeatAcrossPages", repeatAcrossPages)
                    if (deleted && isRep) put("deleted", true)
                    if (isRep && movesInPlace()) {
                        put("inPlace", true)
                        put("originalRotation", origRotationDeg)
                        put("originalFlipX", origFlipX)
                        put("originalFlipY", origFlipY)
                    }
                }
            }
            "shapeReplacement" -> JSONObject().apply {
                put("id", id)
                put("pageId", pageId)
                put("kind", "shape-replacement")
                put("x", x)
                put("y", y)
                put("width", width)
                put("height", height)
                put("rotation", rotationDeg)
                put("opacity", opacity)
                put("zIndex", if (zIndex == 0) 7 else zIndex)
                if (isBackgroundLayer) put("isBackgroundLayer", true)
                put("sourceShapeId", sourceBlockId)
                effectiveOriginalRectJson()?.let { put("originalRect", it) }
                put("fillColor", if ((fillColorValue ushr 24) == 0) "transparent" else toHex(fillColorValue))
                put("strokeColor", if ((colorValue ushr 24) == 0) "transparent" else toHex(colorValue))
                put("strokeWidth", strokeWidth)
                put("svgPath", svgPath)
                put("behindContent", behindContent)
                if (behindContent) put("layerTier", 1)
                if (deleted) put("deleted", true)
                if (movesInPlace()) put("inPlace", true)
            }
            "signature" -> JSONObject().apply {
                put("id", id)
                put("pageId", pageId)
                put("kind", "signature")
                put("x", x)
                put("y", y)
                put("width", width)
                put("height", height)
                put("rotation", rotationDeg)
                put("opacity", opacity)
                put("zIndex", if (zIndex == 0) 15 else zIndex)
                put("signatureId", signatureId.ifEmpty { id })
                put("dataUrl", "")
                put("aspectLocked", true)
                put("realisticInk", realisticInk)
                if (svgPaths.isNotEmpty()) {
                    put("svgPaths", JSONArray().apply { svgPaths.forEach { put(it.toJson()) } })
                }
                put("viewBoxWidth", viewBoxWidth)
                put("viewBoxHeight", viewBoxHeight)
            }
            "path" -> {
                val safeW = if (width <= 0.0) 1.0 else width
                val safeH = if (height <= 0.0) 1.0 else height
                JSONObject().apply {
                    put("id", id)
                    put("pageId", pageId)
                    put("kind", "path")
                    put("x", x)
                    put("y", y)
                    put("width", width)
                    put("height", height)
                    put("rotation", rotationDeg)
                    put("opacity", opacity)
                    put("zIndex", if (zIndex == 0) 11 else zIndex)
                    put("closed", closed)
                    put("smooth", smooth)
                    put("fillColor", if ((fillColorValue ushr 24) == 0) "transparent" else toHex(fillColorValue))
                    put("strokeColor", if ((colorValue ushr 24) == 0) "transparent" else toHex(colorValue))
                    put("strokeWidth", strokeWidth)
                    put("strokeDash", strokeDash)
                    put("behindContent", behindContent)
                    if (behindContent) put("layerTier", 1)
                    put("points", JSONArray().apply {
                        points.forEach { p ->
                            put(JSONObject().apply {
                                normalizedPointMap(p, x, y, safeW, safeH).forEach { (k, v) -> put(k, v) }
                            })
                        }
                    })
                }
            }
            "ink" -> {
                val safeW = if (width <= 0.0) 1.0 else width
                val safeH = if (height <= 0.0) 1.0 else height
                JSONObject().apply {
                    put("id", id)
                    put("pageId", pageId)
                    put("kind", "stroke")
                    put("x", x)
                    put("y", y)
                    put("width", width)
                    put("height", height)
                    put("rotation", rotationDeg)
                    put("opacity", opacity)
                    put("zIndex", if (zIndex == 0) 12 else zIndex)
                    put("color", toHex(colorValue))
                    put("strokeWidth", strokeWidth)
                    put("points", JSONArray().apply {
                        points.forEach { p ->
                            put(JSONObject().apply {
                                normalizedPointMap(p, x, y, safeW, safeH).forEach { (k, v) -> put(k, v) }
                            })
                        }
                    })
                }
            }
            else -> JSONObject().apply {
                put("id", id)
                put("pageId", pageId)
                put("kind", "shape")
                put("shapeType", shapeType)
                put("x", x)
                put("y", y)
                put("width", width)
                put("height", height)
                put("rotation", rotationDeg)
                put("opacity", opacity)
                put("zIndex", if (zIndex == 0) 8 else zIndex)
                put("borderRadius", borderRadius)
                put("strokeDash", strokeDash)
                put("behindContent", behindContent)
                if (behindContent) put("layerTier", 1)
                put("strokeColor", if ((colorValue ushr 24) == 0) "transparent" else toHex(colorValue))
                put("strokeWidth", strokeWidth)
                put("fillColor", if ((fillColorValue ushr 24) == 0) "transparent" else toHex(fillColorValue))
            }
        }
    }

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is GpOverlayElement) return false
        return id == other.id && pageId == other.pageId && kind == other.kind &&
            x == other.x && y == other.y && width == other.width && height == other.height &&
            rotationDeg == other.rotationDeg && text == other.text && runs == other.runs &&
            fontSize == other.fontSize && fontFamily == other.fontFamily &&
            bold == other.bold && italic == other.italic &&
            underline == other.underline && strikethrough == other.strikethrough &&
            scriptMode == other.scriptMode && align == other.align &&
            lineHeight == other.lineHeight && letterSpacing == other.letterSpacing &&
            horizontalScale == other.horizontalScale &&
            embeddedFontId == other.embeddedFontId && fontWarning == other.fontWarning &&
            colorValue == other.colorValue &&
            backgroundColorValue == other.backgroundColorValue && fillColorValue == other.fillColorValue &&
            strokeWidth == other.strokeWidth && opacity == other.opacity && points == other.points &&
            isRedact == other.isRedact && shapeType == other.shapeType && borderRadius == other.borderRadius &&
            strokeDash == other.strokeDash && closed == other.closed && smooth == other.smooth &&
            behindContent == other.behindContent && zIndex == other.zIndex && locked == other.locked &&
            deleted == other.deleted &&
            origX == other.origX && origY == other.origY &&
            origWidth == other.origWidth && origHeight == other.origHeight &&
            origRotationDeg == other.origRotationDeg && origOpacity == other.origOpacity &&
            origFlipX == other.origFlipX && origFlipY == other.origFlipY &&
            isBackgroundLayer == other.isBackgroundLayer &&
            baselineOffset == other.baselineOffset && paragraphWidth == other.paragraphWidth &&
            cropRect == other.cropRect && flipX == other.flipX &&
            flipY == other.flipY && svgPaths == other.svgPaths && svgPath == other.svgPath &&
            sourceBlockId == other.sourceBlockId && pristine == other.pristine &&
            origStyleKey == other.origStyleKey &&
            (imageBytes === other.imageBytes || (imageBytes != null && other.imageBytes != null && imageBytes.contentEquals(other.imageBytes)))
    }

    override fun hashCode(): Int {
        var r = id.hashCode()
        r = 31 * r + pageId.hashCode()
        r = 31 * r + x.hashCode()
        r = 31 * r + y.hashCode()
        r = 31 * r + width.hashCode()
        r = 31 * r + height.hashCode()
        r = 31 * r + text.hashCode()
        r = 31 * r + runs.hashCode()
        r = 31 * r + fontSize.hashCode()
        r = 31 * r + fontFamily.hashCode()
        r = 31 * r + align.hashCode()
        r = 31 * r + bold.hashCode()
        r = 31 * r + italic.hashCode()
        r = 31 * r + underline.hashCode()
        r = 31 * r + strikethrough.hashCode()
        r = 31 * r + scriptMode.hashCode()
        r = 31 * r + lineHeight.hashCode()
        r = 31 * r + letterSpacing.hashCode()
        r = 31 * r + horizontalScale.hashCode()
        r = 31 * r + (embeddedFontId?.hashCode() ?: 0)
        r = 31 * r + (fontWarning?.hashCode() ?: 0)
        r = 31 * r + colorValue
        r = 31 * r + backgroundColorValue
        r = 31 * r + fillColorValue
        r = 31 * r + strokeWidth.hashCode()
        r = 31 * r + points.hashCode()
        r = 31 * r + deleted.hashCode()
        r = 31 * r + behindContent.hashCode()
        r = 31 * r + isBackgroundLayer.hashCode()
        r = 31 * r + (origX?.hashCode() ?: 0)
        r = 31 * r + (baselineOffset?.hashCode() ?: 0)
        r = 31 * r + pristine.hashCode()
        return r
    }
}

@Immutable
data class GpDetectedTextBlock(
    val id: String,
    val text: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val fontSize: Double,
    val fontFamily: String = "DejaVuSans",
    val rawFontName: String = "",
    val originalFontName: String = "",
    val fallbackFontFamily: String = "DejaVuSans",
    val fontSource: String = "missing", // embedded | builtin | missing
    val isCustomFont: Boolean = false,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val align: String = "left", // left | center | right | justify
    val colorValue: Int = 0xFF0F172A.toInt(),
    val lineHeight: Double = 1.25,
    val letterSpacing: Double = 0.0,
    val horizontalScale: Double = 1.0,
    val baselineOffset: Double = 0.0,
    val paragraphWidth: Double? = null,
    val runs: List<GpTextRun> = emptyList(),
    val lines: List<GpTextLineInfo> = emptyList(),
) {
    val rect: GpRectF get() = GpRectF.fromLTWH(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
}

@Immutable
data class GpDetectedImageObj(
    val id: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val rotation: Double = 0.0,
    val flipX: Boolean = false,
    val flipY: Boolean = false,
    val zOrder: Int = 0,
    val behindContent: Boolean = false,
    val isBackgroundLayer: Boolean = false,
    val opacity: Double = 1.0,
) {
    val rect: GpRectF get() = GpRectF.fromLTWH(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
}

@Immutable
data class GpDetectedShapeObj(
    val id: String,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val fillColorValue: Int = 0x00000000,
    val strokeColorValue: Int = 0xFF0F172A.toInt(),
    val strokeWidth: Double = 1.0,
    val svgPath: String = "",
    val zOrder: Int = 0,
    val behindContent: Boolean = false,
    val isBackgroundLayer: Boolean = false,
    val opacity: Double = 1.0,
) {
    val rect: GpRectF get() = GpRectF.fromLTWH(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
}

@Immutable
data class GpPageAnalysis(
    val textBlocks: List<GpDetectedTextBlock> = emptyList(),
    val images: List<GpDetectedImageObj> = emptyList(),
    val shapes: List<GpDetectedShapeObj> = emptyList(),
) {
    companion object {
        fun fromJsonString(raw: String): GpPageAnalysis {
            val trimmed = raw.trim()
            if (trimmed.isEmpty() || trimmed == "{}") return GpPageAnalysis()
            return try {
                val obj = JSONObject(trimmed)
                val tbArr = obj.optJSONArray("textBlocks")
                val tbList = buildList {
                    if (tbArr != null) {
                        for (i in 0 until tbArr.length()) {
                            val m = tbArr.optJSONObject(i) ?: continue
                            val rawRuns = m.optJSONArray("runs")
                            val parsedRuns = buildList {
                                if (rawRuns != null) {
                                    for (j in 0 until rawRuns.length()) {
                                        val r = rawRuns.optJSONObject(j) ?: continue
                                        add(
                                            GpTextRun(
                                                text = r.optString("text", ""),
                                                bold = if (r.has("bold") && !r.isNull("bold")) r.optBoolean("bold") else null,
                                                italic = if (r.has("italic") && !r.isNull("italic")) r.optBoolean("italic") else null,
                                                underline = if (r.has("underline") && !r.isNull("underline")) r.optBoolean("underline") else null,
                                                strikethrough = if (r.has("strikethrough") && !r.isNull("strikethrough")) r.optBoolean("strikethrough") else null,
                                                script = r.optString("script").takeIf { it.isNotEmpty() && !r.isNull("script") },
                                            )
                                        )
                                    }
                                }
                            }
                            val rawLines = m.optJSONArray("lines")
                            val parsedLines = buildList {
                                if (rawLines != null) {
                                    for (j in 0 until rawLines.length()) {
                                        val l = rawLines.optJSONObject(j) ?: continue
                                        add(
                                            GpTextLineInfo(
                                                text = l.optString("text", ""),
                                                x0 = l.optDouble("x0", 0.0),
                                                x1 = l.optDouble("x1", 0.0),
                                                y0 = l.optDouble("y0", 0.0),
                                                y1 = l.optDouble("y1", 0.0),
                                                baseline = l.optDouble("baselineY", 0.0),
                                                fontSize = l.optDouble("fontSize", 12.0),
                                                softWrapAfter = l.optBoolean("softWrapAfter", false),
                                            )
                                        )
                                    }
                                }
                            }
                            val fontFamilyVal = m.optString("fontFamily", "DejaVuSans")
                            val isCustomVal = m.optBoolean("isCustomFont", false)
                            add(
                                GpDetectedTextBlock(
                                    id = m.optString("id", ""),
                                    text = m.optString("text", ""),
                                    x = m.optDouble("x", 0.0),
                                    y = m.optDouble("y", 0.0),
                                    width = m.optDouble("width", 60.0),
                                    height = m.optDouble("height", 16.0),
                                    fontSize = m.optDouble("fontSize", 12.0),
                                    fontFamily = fontFamilyVal,
                                    rawFontName = m.optString("rawFontName", ""),
                                    originalFontName = m.optString("originalFontName", fontFamilyVal),
                                    fallbackFontFamily = m.optString("fallbackFontFamily", fontFamilyVal),
                                    fontSource = m.optString("fontSource", if (isCustomVal) "embedded" else "missing"),
                                    isCustomFont = isCustomVal,
                                    bold = m.optBoolean("bold", false),
                                    italic = m.optBoolean("italic", false),
                                    align = m.optString("align", "left"),
                                    colorValue = parseCssColorOrInt(m.opt("color"), 0xFF0F172A.toInt()),
                                    lineHeight = m.optDouble("lineHeight", 1.25),
                                    letterSpacing = m.optDouble("letterSpacing", 0.0),
                                    horizontalScale = m.optDouble("horizontalScale", 1.0),
                                    baselineOffset = m.optDouble("baselineOffset", 0.0),
                                    paragraphWidth = if (m.has("paragraphWidth") && !m.isNull("paragraphWidth")) m.optDouble("paragraphWidth") else null,
                                    runs = parsedRuns,
                                    lines = parsedLines,
                                )
                            )
                        }
                    }
                }
                val imgArr = obj.optJSONArray("images")
                val imgList = buildList {
                    if (imgArr != null) {
                        for (i in 0 until imgArr.length()) {
                            val m = imgArr.optJSONObject(i) ?: continue
                            add(
                                GpDetectedImageObj(
                                    id = m.optString("id", ""),
                                    x = m.optDouble("x", 0.0),
                                    y = m.optDouble("y", 0.0),
                                    width = m.optDouble("width", 40.0),
                                    height = m.optDouble("height", 40.0),
                                    rotation = m.optDouble("rotation", 0.0),
                                    flipX = m.optBoolean("flipX", false),
                                    flipY = m.optBoolean("flipY", false),
                                    zOrder = m.optInt("zOrder", 0),
                                    behindContent = m.optBoolean("behindContent", false),
                                    isBackgroundLayer = m.optBoolean("isBackgroundLayer", false),
                                    opacity = m.optDouble("opacity", 1.0),
                                )
                            )
                        }
                    }
                }
                val shpArr = obj.optJSONArray("shapes")
                val shpList = buildList {
                    if (shpArr != null) {
                        for (i in 0 until shpArr.length()) {
                            val m = shpArr.optJSONObject(i) ?: continue
                            add(
                                GpDetectedShapeObj(
                                    id = m.optString("id", ""),
                                    x = m.optDouble("x", 0.0),
                                    y = m.optDouble("y", 0.0),
                                    width = m.optDouble("width", 40.0),
                                    height = m.optDouble("height", 40.0),
                                    fillColorValue = parseCssColorOrInt(m.opt("fillColor"), 0x00000000),
                                    strokeColorValue = parseCssColorOrInt(m.opt("strokeColor"), 0xFF0F172A.toInt()),
                                    strokeWidth = m.optDouble("strokeWidth", 1.0),
                                    svgPath = m.optString("svgPath", ""),
                                    zOrder = m.optInt("zOrder", 0),
                                    behindContent = m.optBoolean("behindContent", false),
                                    isBackgroundLayer = m.optBoolean("isBackgroundLayer", false),
                                    opacity = m.optDouble("opacity", 1.0),
                                )
                            )
                        }
                    }
                }
                GpPageAnalysis(textBlocks = tbList, images = imgList, shapes = shpList)
            } catch (_: Exception) {
                GpPageAnalysis()
            }
        }
    }
}

@Immutable
data class GpPageLink(
    val id: String,
    val pageIndex: Int,
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val kind: String,
    val uri: String? = null,
    val destPageIndex: Int? = null,
) {
    val rect: GpRectF get() = GpRectF.fromLTWH(x.toFloat(), y.toFloat(), width.toFloat(), height.toFloat())
}

@Immutable
data class GpSearchMatch(
    val pageIndex: Int,
    val matchIndexInPage: Int,
    val snippet: String,
    val rects: List<GpRectF>,
)

@Immutable
data class GpRecentDoc(
    val sourceId: String,
    val displayName: String,
    val lastOpenedMs: Long,
    val lastPageIndex: Int = 0,
    val lastZoom: Double = 1.0,
    val writable: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("sourceId", sourceId)
        put("displayName", displayName)
        put("lastOpenedMs", lastOpenedMs)
        put("lastPageIndex", lastPageIndex)
        put("lastZoom", lastZoom)
        put("writable", writable)
    }

    companion object {
        fun fromJson(obj: JSONObject): GpRecentDoc = GpRecentDoc(
            sourceId = obj.optString("sourceId", ""),
            displayName = obj.optString("displayName", "document.pdf"),
            lastOpenedMs = obj.optLong("lastOpenedMs", 0L),
            lastPageIndex = obj.optInt("lastPageIndex", 0),
            lastZoom = obj.optDouble("lastZoom", 1.0),
            writable = obj.optBoolean("writable", false),
        )
    }
}

@Immutable
data class GpPageNumberingConfig(
    val enabled: Boolean = false,
    val position: String = "bottom-center",
    val format: String = "number",
    val fontFamily: String = "DejaVuSans",
    val fontSize: Double = 10.5,
    val colorValue: Int = 0xFF334155.toInt(),
    val marginX: Double = 36.0,
    val marginY: Double = 26.0,
    val startFromPage: Int = 1,
    val startNumber: Int = 1,
    val opacity: Double = 0.92,
) {
    fun toCoreJson(): JSONObject = JSONObject().apply {
        put("enabled", enabled)
        put("position", position)
        put("format", format)
        put("fontFamily", fontFamily)
        put("fontSize", fontSize)
        put("color", String.format("#%06x", colorValue and 0xFFFFFF))
        put("marginX", marginX)
        put("marginY", marginY)
        put("startFromPage", startFromPage)
        put("startNumber", startNumber)
        put("opacity", opacity)
    }
}

@Immutable
data class GpSavedSignature(
    val id: String,
    val label: String,
    val isParaf: Boolean,
    val strokes: List<List<GpPoint>> = emptyList(),
    val svgPaths: List<GpSignatureSvgPath> = emptyList(),
    val imageBytes: ByteArray? = null,
    val realisticInk: Boolean = true,
    val colorValue: Int = 0xFF0F172A.toInt(),
    val viewBoxW: Double = 300.0,
    val viewBoxH: Double = 170.0,
    val createdAtMs: Long = 0L,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("label", label)
        put("isParaf", isParaf)
        put("strokes", JSONArray().apply {
            strokes.forEach { s ->
                put(JSONArray().apply {
                    s.forEach { pt ->
                        put(JSONArray().apply { put(pt.x.toDouble()); put(pt.y.toDouble()) })
                    }
                })
            }
        })
        put("svgPaths", JSONArray().apply { svgPaths.forEach { put(it.toJson()) } })
        if (imageBytes != null) {
            put("imageB64", Base64.encodeToString(imageBytes, Base64.NO_WRAP))
        }
        put("realisticInk", realisticInk)
        put("colorValue", colorValue)
        put("viewBoxW", viewBoxW)
        put("viewBoxH", viewBoxH)
        put("createdAtMs", createdAtMs)
    }

    companion object {
        fun fromJson(obj: JSONObject): GpSavedSignature {
            val rawStrokes = obj.optJSONArray("strokes")
            val strokes = buildList {
                if (rawStrokes != null) {
                    for (i in 0 until rawStrokes.length()) {
                        val sArr = rawStrokes.optJSONArray(i) ?: continue
                        add(buildList {
                            for (j in 0 until sArr.length()) {
                                val pArr = sArr.optJSONArray(j) ?: continue
                                add(GpPoint(pArr.optDouble(0, 0.0).toFloat(), pArr.optDouble(1, 0.0).toFloat()))
                            }
                        })
                    }
                }
            }
            val rawSvg = obj.optJSONArray("svgPaths")
            val svgPaths = buildList {
                if (rawSvg != null) {
                    for (i in 0 until rawSvg.length()) {
                        val sp = rawSvg.optJSONObject(i) ?: continue
                        add(GpSignatureSvgPath.fromJson(sp))
                    }
                }
            }
            val b64 = obj.optString("imageB64", "")
            val bytes = if (b64.isNotEmpty()) Base64.decode(b64, Base64.DEFAULT) else null
            return GpSavedSignature(
                id = obj.optString("id", ""),
                label = obj.optString("label", "Signature"),
                isParaf = obj.optBoolean("isParaf", false),
                strokes = strokes,
                svgPaths = svgPaths,
                imageBytes = bytes,
                realisticInk = obj.optBoolean("realisticInk", true),
                colorValue = obj.optInt("colorValue", 0xFF0F172A.toInt()),
                viewBoxW = obj.optDouble("viewBoxW", 300.0),
                viewBoxH = obj.optDouble("viewBoxH", 170.0),
                createdAtMs = obj.optLong("createdAtMs", 0L),
            )
        }
    }
}

@Immutable
data class GpGhostSignature(
    val label: String,
    val strokes: List<List<GpPoint>>,
    val centerPdf: GpPoint,
    val sizePdfW: Float,
    val sizePdfH: Float,
    val isParaf: Boolean = false,
    val realisticInk: Boolean = true,
    val colorValue: Int = 0xFF1D4ED8.toInt(),
    val svgPaths: List<GpSignatureSvgPath> = emptyList(),
    val imageBytes: ByteArray? = null,
    val viewBoxW: Float = 300f,
    val viewBoxH: Float = 170f,
    val signatureId: String = "",
)

fun parseCssColorOrInt(raw: Any?, fallback: Int): Int {
    if (raw == null || raw == JSONObject.NULL) return fallback
    if (raw is Number) return raw.toInt()
    val s = raw.toString().trim()
    if (s.isEmpty() || s.equals("transparent", ignoreCase = true) || s.equals("none", ignoreCase = true)) {
        return 0x00000000
    }
    val hex = s.removePrefix("#")
    return when (hex.length) {
        6 -> hex.toLongOrNull(16)?.let { (0xFF000000L or it).toInt() } ?: fallback
        8 -> hex.toLongOrNull(16)?.toInt() ?: fallback
        else -> fallback
    }
}

/**
 * Strips light/white paper background from photographed signature images into clean transparent PNG.
 */
fun stripPaperBackgroundPng(srcBytes: ByteArray): ByteArray {
    return try {
        val opts = BitmapFactory.Options().apply { inMutable = true }
        val decoded = BitmapFactory.decodeByteArray(srcBytes, 0, srcBytes.size, opts) ?: return srcBytes
        val maxDim = maxOf(decoded.width, decoded.height)
        val bmp = if (maxDim > 720) {
            val scale = 720f / maxDim
            val nw = (decoded.width * scale).toInt().coerceAtLeast(1)
            val nh = (decoded.height * scale).toInt().coerceAtLeast(1)
            val scaled = Bitmap.createScaledBitmap(decoded, nw, nh, true)
            decoded.recycle()
            scaled
        } else {
            decoded
        }
        val w = bmp.width
        val h = bmp.height
        val pixels = IntArray(w * h)
        bmp.getPixels(pixels, 0, w, 0, 0, w, h)
        for (i in pixels.indices) {
            val c = pixels[i]
            val a = (c ushr 24) and 0xFF
            if (a == 0) continue
            val r = (c ushr 16) and 0xFF
            val g = (c ushr 8) and 0xFF
            val b = c and 0xFF
            val lum = 0.299 * r + 0.587 * g + 0.114 * b
            val chroma = maxOf(r, maxOf(g, b)) - minOf(r, minOf(g, b))
            if (lum > 205.0 && chroma < 42) {
                pixels[i] = c and 0x00FFFFFF
            } else if (lum > 175.0 && chroma < 35) {
                val factor = ((205.0 - lum) / 30.0).coerceIn(0.0, 1.0)
                val newA = (a * factor).toInt().coerceIn(0, 255)
                pixels[i] = (newA shl 24) or (c and 0x00FFFFFF)
            }
        }
        bmp.setPixels(pixels, 0, w, 0, 0, w, h)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        bmp.recycle()
        out.toByteArray()
    } catch (_: Exception) {
        srcBytes
    }
}

fun toRomanNumeral(num: Int): String {
    val table = listOf(
        1000 to "M", 900 to "CM", 500 to "D", 400 to "CD",
        100 to "C", 90 to "XC", 50 to "L", 40 to "XL",
        10 to "X", 9 to "IX", 5 to "V", 4 to "IV", 1 to "I",
    )
    var rem = num.coerceIn(1, 3999)
    val sb = StringBuilder()
    for ((v, sym) in table) {
        while (rem >= v) {
            sb.append(sym)
            rem -= v
        }
    }
    return sb.toString()
}

fun formatPageNumberText(cfg: GpPageNumberingConfig, oneBasedPage: Int, totalPages: Int): String {
    val numVal = cfg.startNumber + (oneBasedPage - cfg.startFromPage)
    val total = maxOf(numVal, totalPages - (cfg.startFromPage - 1) + (cfg.startNumber - 1))
    return when (cfg.format) {
        "number-of-total" -> "$numVal / $total"
        "page-number" -> "Sayfa $numVal"
        "page-number-of-total" -> "Sayfa $numVal / $total"
        "roman-lower" -> toRomanNumeral(numVal).lowercase()
        "roman-upper" -> toRomanNumeral(numVal)
        else -> "$numVal"
    }
}

fun isNearZero(v: Double): Boolean = abs(v) < 0.001

object RichTextOps {
    data class SelectionFlags(
        val bold: Boolean,
        val italic: Boolean,
        val underline: Boolean,
        val strikethrough: Boolean,
        val scriptMode: String,
    )

    fun expandRuns(el: GpOverlayElement): List<GpTextRun> {
        if (el.text.isEmpty()) return emptyList()
        if (el.runs.isEmpty() || el.runs.sumOf { it.text.length } != el.text.length) {
            return listOf(
                GpTextRun(
                    text = el.text,
                    bold = el.bold,
                    italic = el.italic,
                    underline = el.underline,
                    strikethrough = el.strikethrough,
                    script = el.scriptMode,
                )
            )
        }
        return el.runs.map { r ->
            GpTextRun(
                text = r.text,
                bold = r.bold ?: el.bold,
                italic = r.italic ?: el.italic,
                underline = r.underline ?: el.underline,
                strikethrough = r.strikethrough ?: el.strikethrough,
                script = r.script ?: el.scriptMode,
            )
        }
    }

    fun normalizeRuns(runs: List<GpTextRun>): List<GpTextRun> {
        val merged = mutableListOf<GpTextRun>()
        for (r in runs) {
            if (r.text.isEmpty()) continue
            val prev = merged.lastOrNull()
            if (prev != null &&
                prev.bold == r.bold &&
                prev.italic == r.italic &&
                prev.underline == r.underline &&
                prev.strikethrough == r.strikethrough &&
                (prev.script ?: "normal") == (r.script ?: "normal")
            ) {
                merged[merged.lastIndex] = prev.copy(text = prev.text + r.text)
            } else {
                merged.add(r)
            }
        }
        return merged
    }

    fun applyTextChange(el: GpOverlayElement, nextText: String): GpOverlayElement {
        if (nextText == el.text) return el
        if (el.runs.isEmpty() || el.runs.sumOf { it.text.length } != el.text.length) {
            return el.copy(text = nextText, runs = emptyList())
        }
        val oldText = el.text
        var prefix = 0
        val minLen = minOf(oldText.length, nextText.length)
        while (prefix < minLen && oldText[prefix] == nextText[prefix]) {
            prefix++
        }
        var suffix = 0
        while (suffix < (oldText.length - prefix) &&
            suffix < (nextText.length - prefix) &&
            oldText[oldText.length - 1 - suffix] == nextText[nextText.length - 1 - suffix]
        ) {
            suffix++
        }
        val oldMidEnd = oldText.length - suffix
        val inserted = nextText.substring(prefix, nextText.length - suffix)

        val expanded = expandRuns(el)
        val out = mutableListOf<GpTextRun>()
        var pos = 0
        var insertedDone = false
        for (r in expanded) {
            val rStart = pos
            val rEnd = pos + r.text.length
            pos = rEnd

            // Prefix kept before changed span
            if (rStart < prefix) {
                val keepEnd = minOf(rEnd, prefix)
                if (keepEnd > rStart) {
                    out.add(r.copy(text = r.text.substring(0, keepEnd - rStart)))
                }
            }
            // Inserted text inherits style at insertion point
            if (!insertedDone && inserted.isNotEmpty() && prefix in rStart..rEnd) {
                out.add(r.copy(text = inserted))
                insertedDone = true
            }
            // Suffix kept after changed span
            if (rEnd > oldMidEnd) {
                val keepStart = maxOf(rStart, oldMidEnd)
                if (rEnd > keepStart) {
                    out.add(r.copy(text = r.text.substring(keepStart - rStart, rEnd - rStart)))
                }
            }
        }
        if (!insertedDone && inserted.isNotEmpty()) {
            val template = expanded.lastOrNull() ?: GpTextRun(
                text = inserted,
                bold = el.bold,
                italic = el.italic,
                underline = el.underline,
                strikethrough = el.strikethrough,
                script = el.scriptMode,
            )
            out.add(template.copy(text = inserted))
        }
        return el.copy(text = nextText, runs = normalizeRuns(out))
    }

    fun effectiveFlagsAt(el: GpOverlayElement, selStart: Int, selEnd: Int): SelectionFlags {
        val expanded = expandRuns(el)
        if (expanded.isEmpty()) {
            return SelectionFlags(el.bold, el.italic, el.underline, el.strikethrough, el.scriptMode)
        }
        val lo = minOf(selStart, selEnd).coerceIn(0, el.text.length)
        val hi = maxOf(selStart, selEnd).coerceIn(0, el.text.length)
        var pos = 0
        if (lo == hi) {
            val probe = (lo - 1).coerceIn(0, (el.text.length - 1).coerceAtLeast(0))
            for (r in expanded) {
                val rEnd = pos + r.text.length
                if (probe < rEnd) {
                    return SelectionFlags(
                        bold = r.bold ?: el.bold,
                        italic = r.italic ?: el.italic,
                        underline = r.underline ?: el.underline,
                        strikethrough = r.strikethrough ?: el.strikethrough,
                        scriptMode = r.script ?: el.scriptMode,
                    )
                }
                pos = rEnd
            }
            return SelectionFlags(el.bold, el.italic, el.underline, el.strikethrough, el.scriptMode)
        }
        var allBold = true
        var allItalic = true
        var allUnder = true
        var allStrike = true
        var allScript: String? = null
        var seen = false
        for (r in expanded) {
            val rStart = pos
            val rEnd = pos + r.text.length
            pos = rEnd
            if (rEnd <= lo || rStart >= hi) continue
            seen = true
            allBold = allBold && (r.bold ?: el.bold)
            allItalic = allItalic && (r.italic ?: el.italic)
            allUnder = allUnder && (r.underline ?: el.underline)
            allStrike = allStrike && (r.strikethrough ?: el.strikethrough)
            val s = r.script ?: el.scriptMode
            allScript = if (allScript == null) s else if (allScript == s) s else "mixed"
        }
        if (!seen) {
            return SelectionFlags(el.bold, el.italic, el.underline, el.strikethrough, el.scriptMode)
        }
        return SelectionFlags(
            bold = allBold,
            italic = allItalic,
            underline = allUnder,
            strikethrough = allStrike,
            scriptMode = if (allScript == "super" || allScript == "sub") allScript else "normal",
        )
    }

    fun toggleStyle(
        el: GpOverlayElement,
        selStart: Int,
        selEnd: Int,
        property: String, // bold | italic | underline | strikethrough | super | sub
    ): GpOverlayElement {
        val lo = minOf(selStart, selEnd).coerceIn(0, el.text.length)
        val hi = maxOf(selStart, selEnd).coerceIn(0, el.text.length)
        val flags = effectiveFlagsAt(el, lo, hi)
        if (lo == hi || (lo == 0 && hi == el.text.length)) {
            val nextBold = if (property == "bold") !el.bold else el.bold
            val nextItalic = if (property == "italic") !el.italic else el.italic
            val nextUnder = if (property == "underline") !el.underline else el.underline
            val nextStrike = if (property == "strikethrough") !el.strikethrough else el.strikethrough
            val nextScript = when (property) {
                "super" -> if (el.scriptMode == "super") "normal" else "super"
                "sub" -> if (el.scriptMode == "sub") "normal" else "sub"
                else -> el.scriptMode
            }
            val updatedRuns = if (el.runs.isEmpty()) {
                emptyList()
            } else {
                normalizeRuns(
                    expandRuns(el).map { r ->
                        r.copy(
                            bold = if (property == "bold") nextBold else r.bold,
                            italic = if (property == "italic") nextItalic else r.italic,
                            underline = if (property == "underline") nextUnder else r.underline,
                            strikethrough = if (property == "strikethrough") nextStrike else r.strikethrough,
                            script = if (property == "super" || property == "sub") nextScript else r.script,
                        )
                    }
                )
            }
            return el.copy(
                bold = nextBold,
                italic = nextItalic,
                underline = nextUnder,
                strikethrough = nextStrike,
                scriptMode = nextScript,
                runs = updatedRuns,
            )
        }

        val expanded = expandRuns(el)
        val out = mutableListOf<GpTextRun>()
        var pos = 0
        for (r in expanded) {
            val rStart = pos
            val rEnd = pos + r.text.length
            pos = rEnd
            if (rEnd <= lo || rStart >= hi) {
                out.add(r)
                continue
            }
            if (rStart < lo) {
                out.add(r.copy(text = r.text.substring(0, lo - rStart)))
            }
            val midStart = maxOf(rStart, lo) - rStart
            val midEnd = minOf(rEnd, hi) - rStart
            val updatedMid = when (property) {
                "bold" -> r.copy(text = r.text.substring(midStart, midEnd), bold = !flags.bold)
                "italic" -> r.copy(text = r.text.substring(midStart, midEnd), italic = !flags.italic)
                "underline" -> r.copy(text = r.text.substring(midStart, midEnd), underline = !flags.underline)
                "strikethrough" -> r.copy(text = r.text.substring(midStart, midEnd), strikethrough = !flags.strikethrough)
                "super" -> r.copy(
                    text = r.text.substring(midStart, midEnd),
                    script = if (flags.scriptMode == "super") "normal" else "super",
                )
                "sub" -> r.copy(
                    text = r.text.substring(midStart, midEnd),
                    script = if (flags.scriptMode == "sub") "normal" else "sub",
                )
                else -> r.copy(text = r.text.substring(midStart, midEnd))
            }
            out.add(updatedMid)
            if (rEnd > hi) {
                out.add(r.copy(text = r.text.substring(hi - rStart, rEnd - rStart)))
            }
        }
        return el.copy(runs = normalizeRuns(out))
    }
}
