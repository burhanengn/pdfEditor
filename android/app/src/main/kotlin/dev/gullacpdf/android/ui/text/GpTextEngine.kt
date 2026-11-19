package dev.gullacpdf.android.ui.text

import android.content.Context
import android.content.res.AssetManager
import android.graphics.Paint
import android.graphics.Typeface
import android.text.TextPaint
import dev.gullacpdf.android.model.GpExtractedFontInfo
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpTextLineInfo
import dev.gullacpdf.android.model.GpTextRun
import dev.gullacpdf.android.model.RichTextOps
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.abs
import kotlin.math.min

/** One run of glyphs placed at an exact position (page points, visual top-down coordinates). */
class GpPlacedSegment(
    val text: String,
    val start: Int,
    val end: Int,
    val x: Double,
    val width: Double,
    val bold: Boolean,
    val italic: Boolean,
    val underline: Boolean,
    val strikethrough: Boolean,
    val fallback: Boolean,
    val typeface: Typeface,
    val sizePt: Double,
    val rise: Double,
)

class GpPlacedLine(
    /** Line slot inside the paragraph (slot i sits on the i-th original baseline). */
    val slot: Int,
    val baseline: Double,
    val start: Int,
    val end: Int,
    /** x of every caret boundary start..end (size = end - start + 1). */
    val charX: DoubleArray,
    val segments: List<GpPlacedSegment>,
    /** Painted by the untouched original PDF raster/content (not stripped, not redrawn). */
    val kept: Boolean,
    val fontSize: Double,
)

class GpParagraphLayout(
    val lines: List<GpPlacedLine>,
    /** True when original line geometry is preserved and only changed lines are replaced. */
    val lineMode: Boolean,
    /** Original line indices removed from the PDF content; null = the whole original block. */
    val strippedOrigLines: Set<Int>?,
    val origLines: List<GpTextLineInfo>,
    val horizontalScale: Double,
)

/**
 * Shared text layout for editing PDF paragraphs. The SAME positions drive the on-screen editor,
 * the caret, the live clean preview and the exported/printed PDF, so text never shifts between
 * them. Untouched original lines are never re-rendered: they stay in the original PDF content.
 */
object GpTextEngine {
    private const val MEASURE_SIZE = 64f
    /** Plain advances only: PDF text objects apply no kerning, ligatures or contextual forms. */
    const val NO_SHAPING_FEATURES = "'kern' 0, 'liga' 0, 'clig' 0, 'calt' 0, 'dlig' 0"

    private val serifKeys = listOf(
        "serif", "times", "georgia", "book", "garamond", "cambria", "palatino", "baskerville",
        "century", "minion", "charter", "antiqua", "bodoni", "caslon",
    )

    @Volatile
    private var assets: AssetManager? = null
    @Volatile
    private var cacheDir: File? = null

    private val fileFaces = ConcurrentHashMap<String, Typeface>()
    private val assetFaces = ConcurrentHashMap<String, Typeface>()
    private var customSig = 0
    private var customFace: Typeface? = null

    private val lock = Any()
    private val measurePaint = TextPaint(Paint.ANTI_ALIAS_FLAG or Paint.LINEAR_TEXT_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
        textSize = MEASURE_SIZE
        fontFeatureSettings = NO_SHAPING_FEATURES
    }
    private val advanceCache = HashMap<Typeface, HashMap<Int, Float>>()
    private val glyphCache = HashMap<Typeface, HashMap<Int, Boolean>>()

    private class CacheEntry(
        val el: GpOverlayElement,
        val fonts: Map<String, GpExtractedFontInfo>,
        val customSig: Int,
        val layout: GpParagraphLayout,
    )
    private val layoutCache = ArrayDeque<CacheEntry>()

    fun init(context: Context) {
        if (assets == null) {
            assets = context.applicationContext.assets
            cacheDir = context.applicationContext.cacheDir
        }
    }

    /** Elements whose text is laid out by this engine (others keep the generic text path). */
    fun handles(el: GpOverlayElement): Boolean =
        el.kind == "textEdit" && !el.deleted && abs(el.rotationDeg) < 0.01 && el.letterSpacing == 0.0

    // ---------------------------------------------------------------- typefaces

    private fun assetFace(name: String): Typeface = assetFaces.getOrPut(name) {
        val am = assets ?: return@getOrPut Typeface.DEFAULT
        try {
            Typeface.createFromAsset(am, "fonts/$name")
        } catch (_: Exception) {
            Typeface.DEFAULT
        }
    }

    private fun fileFace(path: String): Typeface? {
        fileFaces[path]?.let { return it }
        return try {
            Typeface.createFromFile(path).also { fileFaces[path] = it }
        } catch (_: Exception) {
            null
        }
    }

    fun setCustomTtf(bytes: ByteArray?) {
        if (bytes == null || bytes.isEmpty()) {
            customSig = 0
            customFace = null
            return
        }
        val sig = bytes.size * 31 + bytes[0].toInt() + (bytes[bytes.size / 2].toInt() shl 8)
        if (sig == customSig && customFace != null) return
        val dir = cacheDir ?: return
        try {
            val f = File(dir, "gp_custom_text_$sig.ttf")
            if (!f.exists() || f.length() != bytes.size.toLong()) f.writeBytes(bytes)
            customFace = Typeface.createFromFile(f)
            customSig = sig
        } catch (_: Exception) {
            customFace = null
        }
    }

    /** Embedded face exactly as the exporter picks it (same candidate order, no fake styles). */
    private fun embeddedFace(emb: GpExtractedFontInfo?, bold: Boolean, italic: Boolean): Typeface? {
        emb ?: return null
        val candidates = when {
            bold && italic -> listOf(emb.boldItalicTtfPath, emb.boldTtfPath, emb.regularTtfPath)
            bold -> listOf(emb.boldTtfPath, emb.regularTtfPath)
            italic -> listOf(emb.italicTtfPath, emb.regularTtfPath)
            else -> listOf(emb.regularTtfPath)
        }
        for (p in candidates) {
            if (p != null) fileFace(p)?.let { return it }
        }
        return null
    }

    fun isSerifFamily(family: String): Boolean {
        val lower = family.lowercase()
        return serifKeys.any { lower.contains(it) } && !lower.contains("sans")
    }

    /** Bundled fallback face, mirroring the exporter's font resolution rules exactly. */
    fun fallbackFace(family: String, bold: Boolean, italic: Boolean): Typeface {
        val lower = family.lowercase()
        if ((lower.contains("custom") || lower.contains("user")) && customFace != null) return customFace!!
        if (lower.contains("mono") || lower.contains("courier")) return assetFace("DejaVuSansMono.ttf")
        if (isSerifFamily(family)) {
            return if (bold && !lower.contains("times")) assetFace("DejaVuSans-Bold.ttf") else assetFace("DejaVuSerif.ttf")
        }
        if (bold) return assetFace("DejaVuSans-Bold.ttf")
        if (italic) return assetFace("DejaVuSans-Oblique.ttf")
        return assetFace("DejaVuSans.ttf")
    }

    private fun hasGlyph(tf: Typeface, cp: Int): Boolean {
        val m = glyphCache.getOrPut(tf) { HashMap() }
        return m.getOrPut(cp) {
            measurePaint.typeface = tf
            measurePaint.hasGlyph(String(Character.toChars(cp)))
        }
    }

    /** Unscaled advance (points at MEASURE_SIZE) of one code point. */
    private fun advance(tf: Typeface, cp: Int): Float {
        val m = advanceCache.getOrPut(tf) { HashMap() }
        return m.getOrPut(cp) {
            measurePaint.typeface = tf
            measurePaint.textScaleX = 1f
            measurePaint.measureText(String(Character.toChars(cp)))
        }
    }

    // ---------------------------------------------------------------- layout

    private class CharInfo(
        val face: Typeface,
        val fallback: Boolean,
        val adv: Double,
        val bold: Boolean,
        val italic: Boolean,
        val underline: Boolean,
        val strike: Boolean,
        val script: String,
    )

    fun layout(
        el: GpOverlayElement,
        docFonts: Map<String, GpExtractedFontInfo>,
    ): GpParagraphLayout = synchronized(lock) {
        layoutCache.firstOrNull { it.el === el && it.fonts === docFonts && it.customSig == customSig }?.let {
            return it.layout
        }
        val computed = compute(el, docFonts)
        layoutCache.addFirst(CacheEntry(el, docFonts, customSig, computed))
        while (layoutCache.size > 32) layoutCache.removeLast()
        computed
    }

    private fun styleSig(r: GpTextRun): Int {
        var s = 0
        if (r.bold == true) s = s or 1
        if (r.italic == true) s = s or 2
        if (r.underline == true) s = s or 4
        if (r.strikethrough == true) s = s or 8
        if (r.script == "super") s = s or 16
        if (r.script == "sub") s = s or 32
        return s
    }

    private fun perCharStyle(text: String, runs: List<GpTextRun>, el: GpOverlayElement): IntArray {
        val out = IntArray(text.length)
        val effective = if (runs.isNotEmpty() && runs.sumOf { it.text.length } == text.length) {
            runs.map {
                it.copy(
                    bold = it.bold ?: el.bold,
                    italic = it.italic ?: el.italic,
                    underline = it.underline ?: el.underline,
                    strikethrough = it.strikethrough ?: el.strikethrough,
                    script = it.script ?: el.scriptMode,
                )
            }
        } else {
            listOf(GpTextRun(text, el.bold, el.italic, el.underline, el.strikethrough, el.scriptMode))
        }
        var pos = 0
        for (r in effective) {
            val sig = styleSig(r)
            for (i in r.text.indices) if (pos + i < out.size) out[pos + i] = sig
            pos += r.text.length
        }
        return out
    }

    /** Maps original lines onto [origText]; null when they cannot be matched exactly. */
    private fun mapLines(origText: String, lines: List<GpTextLineInfo>): List<IntArray>? {
        if (lines.isEmpty()) return null
        val out = ArrayList<IntArray>(lines.size)
        var cursor = 0
        for (l in lines) {
            while (cursor < origText.length && origText[cursor].isWhitespace()) cursor++
            if (l.text.isEmpty() || !origText.startsWith(l.text, cursor)) return null
            out.add(intArrayOf(cursor, cursor + l.text.length))
            cursor += l.text.length
        }
        while (cursor < origText.length && origText[cursor].isWhitespace()) cursor++
        return if (cursor == origText.length) out else null
    }

    private fun compute(el: GpOverlayElement, docFonts: Map<String, GpExtractedFontInfo>): GpParagraphLayout {
        val text = el.text
        val fs = el.fontSize.coerceAtLeast(1.0)
        val hs = el.horizontalScale.coerceIn(0.3, 3.0)
        val emb = el.embeddedFontId?.let { id ->
            docFonts[id] ?: docFonts.values.firstOrNull { it.id == id }
        }
        val styles = perCharStyle(text, RichTextOps.expandRuns(el), el)

        // Per-character face + advance (code point aware; low surrogates get zero width).
        val chars = arrayOfNulls<CharInfo>(text.length)
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            val n = Character.charCount(cp)
            val st = styles[i]
            val bold = st and 1 != 0
            val italic = st and 2 != 0
            val script = when {
                st and 16 != 0 -> "super"
                st and 32 != 0 -> "sub"
                else -> "normal"
            }
            val sizeFactor = if (script == "normal") 1.0 else 0.66
            val embFace = embeddedFace(emb, bold, italic)
            val probe = if (Character.isWhitespace(cp)) ' '.code else cp
            val useEmb = embFace != null && hasGlyph(embFace, probe)
            val face = if (useEmb) embFace!! else fallbackFace(el.fontFamily, bold, italic)
            val adv = if (cp == '\n'.code) 0.0 else advance(face, probe).toDouble() * (fs * sizeFactor / MEASURE_SIZE) * hs
            val info = CharInfo(face, !useEmb, adv, bold, italic, st and 4 != 0, st and 8 != 0, script)
            chars[i] = info
            for (k in 1 until n) {
                chars[i + k] = CharInfo(face, !useEmb, 0.0, bold, italic, st and 4 != 0, st and 8 != 0, script)
            }
            i += n
        }
        val prefixW = DoubleArray(text.length + 1)
        for (c in text.indices) prefixW[c + 1] = prefixW[c] + (chars[c]?.adv ?: 0.0)
        fun width(a: Int, b: Int) = prefixW[b] - prefixW[a]

        val orig = el.origLines
        val mapped = mapLines(el.originalText, orig)
        val widthSame = abs(el.width - (el.origBoxWidth ?: el.origWidth ?: el.width)) < 0.5
        val lineMode = mapped != null && el.origStyleKey != null && el.origStyleKey == el.styleKey() && widthSame

        val lines = ArrayList<GpPlacedLine>()

        fun buildLine(slot: Int, a: Int, b: Int, left: Double, baseline: Double, justifyTo: Double?, kept: Boolean): GpPlacedLine {
            var spaces = 0
            for (c in a until b) if (text[c] == ' ') spaces++
            val natural = width(a, b)
            val extra = if (justifyTo != null && spaces > 0) {
                ((justifyTo - left - natural) / spaces).coerceIn(-fs * 0.25, fs * 3.0)
            } else {
                0.0
            }
            val xs = DoubleArray(b - a + 1)
            var cur = left
            for (c in a until b) {
                xs[c - a] = cur
                cur += (chars[c]?.adv ?: 0.0) + if (text[c] == ' ') extra else 0.0
            }
            xs[b - a] = cur
            val segs = ArrayList<GpPlacedSegment>()
            var s = a
            while (s < b) {
                if (text[s] == ' ' || text[s] == '\n') {
                    s++
                    continue
                }
                val ci = chars[s]!!
                var e = s + 1
                while (e < b && text[e] != ' ' && text[e] != '\n') {
                    val cj = chars[e]!!
                    if (cj.face !== ci.face || cj.fallback != ci.fallback || cj.bold != ci.bold || cj.italic != ci.italic ||
                        cj.underline != ci.underline || cj.strike != ci.strike || cj.script != ci.script
                    ) break
                    e++
                }
                val sizePt = if (ci.script == "normal") fs else fs * 0.66
                val rise = when (ci.script) {
                    "super" -> -fs * 0.34
                    "sub" -> fs * 0.22
                    else -> 0.0
                }
                segs.add(
                    GpPlacedSegment(
                        text = text.substring(s, e),
                        start = s,
                        end = e,
                        x = xs[s - a],
                        width = xs[e - a] - xs[s - a],
                        bold = ci.bold,
                        italic = ci.italic,
                        underline = ci.underline,
                        strikethrough = ci.strike,
                        fallback = ci.fallback,
                        typeface = ci.face,
                        sizePt = sizePt,
                        rise = rise,
                    )
                )
                s = e
            }
            return GpPlacedLine(slot, baseline, a, b, xs, segs, kept, fs)
        }

        if (lineMode) {
            val m = mapped!!
            val n = orig.size
            val dx = el.x - (el.origX ?: el.x)
            val dy = el.y - (el.origY ?: el.y)
            val inPlace = abs(dx) < 0.01 && abs(dy) < 0.01
            val pitch = if (n >= 2) (orig[n - 1].baseline - orig[0].baseline) / (n - 1) else fs * el.lineHeight
            val paraLeft = orig.minOf { it.x0 }
            val paraRight = orig.maxOf { it.x1 }
            fun slotLeft(slot: Int) = orig[min(slot, n - 1)].x0 + dx
            fun slotBaseline(slot: Int) =
                if (slot < n) orig[slot].baseline + dy else orig[n - 1].baseline + (slot - n + 1) * pitch + dy

            val origText = el.originalText
            val origStyles = perCharStyle(origText, el.originalRuns, el)
            val maxCommon = min(text.length, origText.length)
            var prefix = 0
            while (prefix < maxCommon && text[prefix] == origText[prefix] && styles[prefix] == origStyles[prefix]) prefix++
            var suffix = 0
            while (suffix < maxCommon - prefix &&
                text[text.length - 1 - suffix] == origText[origText.length - 1 - suffix] &&
                styles[text.length - 1 - suffix] == origStyles[origText.length - 1 - suffix]
            ) suffix++
            val unchanged = prefix == text.length && text.length == origText.length

            fun reproduce(j: Int, slot: Int, shift: Int, kept: Boolean): GpPlacedLine {
                val a = m[j][0] + shift
                val b = m[j][1] + shift
                val justify = if (el.align == "justify" && orig[j].softWrapAfter) orig[j].x1 + dx else null
                return buildLine(slot, a, b, orig[j].x0 + dx, slotBaseline(slot), justify, kept)
            }

            if (unchanged) {
                for (j in 0 until n) lines.add(reproduce(j, j, 0, inPlace))
            } else {
                var k = m.indexOfFirst { it[1] >= prefix }.let { if (it < 0) n - 1 else it }
                if (k > 0 && prefix <= m[k][0] && orig[k - 1].softWrapAfter) k--
                for (j in 0 until k) lines.add(reproduce(j, j, 0, inPlace))

                val delta = text.length - origText.length
                val suffixStart = text.length - suffix
                var p = if (k < n) m[k][0] else text.length
                var slot = k
                val rightEdge = paraRight + dx
                var guard = 0
                while (guard++ < 10_000) {
                    if (p >= suffixStart && p <= text.length) {
                        val pOld = p - delta
                        val j = m.indexOfFirst { it[0] == pOld }
                        if (j >= 0) {
                            for (jj in j until n) {
                                val targetSlot = slot + (jj - j)
                                lines.add(reproduce(jj, targetSlot, delta, inPlace && targetSlot == jj))
                            }
                            break
                        }
                    }
                    if (p >= text.length) {
                        if (lines.isEmpty() || text.endsWith("\n")) {
                            lines.add(buildLine(slot, text.length, text.length, slotLeft(slot), slotBaseline(slot), null, false))
                        }
                        break
                    }
                    val left = if (el.align == "center" || el.align == "right") paraLeft + dx else slotLeft(slot)
                    val avail = rightEdge - left
                    val nl = text.indexOf('\n', p).let { if (it < 0) text.length else it }
                    var best = -1
                    var q = p
                    while (q <= nl) {
                        if (q == nl || text[q] == ' ') {
                            if (width(p, q) <= avail + 0.01) best = q else break
                        }
                        q++
                    }
                    if (best <= p) {
                        best = text.indexOf(' ', p + 1).let { if (it < 0 || it > nl) nl else it }
                    }
                    val softBreak = best < nl
                    val natural = width(p, best)
                    val placedLeft = when (el.align) {
                        "center" -> (paraLeft + dx + rightEdge - natural) / 2.0
                        "right" -> rightEdge - natural
                        else -> left
                    }
                    val justify = if (el.align == "justify" && softBreak) rightEdge else null
                    lines.add(buildLine(slot, p, best, placedLeft, slotBaseline(slot), justify, false))
                    slot++
                    p = if (softBreak) best + 1 else best + 1
                    if (!softBreak && best >= text.length) break
                }
            }
            val keptSlots = lines.filter { it.kept }.map { it.slot }.toSet()
            val stripped = (0 until n).filter { it !in keptSlots }.toSet()
            return GpParagraphLayout(lines, true, stripped, orig, hs)
        }

        // Free reflow (style/width changed or no line data): uniform geometry from the box.
        val origFs = orig.firstOrNull()?.fontSize ?: fs
        val ratio = if (origFs > 0.0) fs / origFs else 1.0
        val pitch = if (orig.size >= 2) {
            (orig.last().baseline - orig.first().baseline) / (orig.size - 1) * ratio
        } else {
            fs * el.lineHeight
        }
        val left = el.x
        val right = el.x + el.layoutWrapWidth()
        val firstBaseline = el.y + ((el.baselineOffset ?: (origFs * 0.88)) * ratio)
        var p = 0
        var slot = 0
        var guard = 0
        while (guard++ < 10_000) {
            if (p >= text.length) {
                if (lines.isEmpty() || text.endsWith("\n")) {
                    lines.add(buildLine(slot, text.length, text.length, left, firstBaseline + slot * pitch, null, false))
                }
                break
            }
            val nl = text.indexOf('\n', p).let { if (it < 0) text.length else it }
            var best = -1
            var q = p
            while (q <= nl) {
                if (q == nl || text[q] == ' ') {
                    if (width(p, q) <= (right - left) + 0.01) best = q else break
                }
                q++
            }
            if (best <= p) best = text.indexOf(' ', p + 1).let { if (it < 0 || it > nl) nl else it }
            val softBreak = best < nl
            val natural = width(p, best)
            val placedLeft = when (el.align) {
                "center" -> (left + right - natural) / 2.0
                "right" -> right - natural
                else -> left
            }
            val justify = if (el.align == "justify" && softBreak) right else null
            lines.add(buildLine(slot, p, best, placedLeft, firstBaseline + slot * pitch, justify, false))
            slot++
            p = best + 1
            if (!softBreak && best >= text.length) break
        }
        return GpParagraphLayout(lines, false, null, orig, hs)
    }

    // ---------------------------------------------------------------- caret & hit testing

    /** Caret x/baseline (page points) for a text index, or null if unknown. */
    fun caretPosition(layout: GpParagraphLayout, index: Int): Triple<Double, Double, Double>? {
        if (layout.lines.isEmpty()) return null
        var best: GpPlacedLine = layout.lines.first()
        for (l in layout.lines) {
            if (index >= l.start) best = l
        }
        val local = (index - best.start).coerceIn(0, best.charX.size - 1)
        return Triple(best.charX[local], best.baseline, best.fontSize)
    }

    /** Nearest caret index to a page-space point. */
    fun hitIndex(layout: GpParagraphLayout, x: Double, y: Double): Int {
        if (layout.lines.isEmpty()) return 0
        val line = layout.lines.minByOrNull { l ->
            val mid = l.baseline - l.fontSize * 0.32
            abs(y - mid)
        } ?: return 0
        var bestIdx = line.start
        var bestDist = Double.MAX_VALUE
        for (k in line.charX.indices) {
            val d = abs(line.charX[k] - x)
            if (d < bestDist) {
                bestDist = d
                bestIdx = line.start + k
            }
        }
        return bestIdx
    }

    // ---------------------------------------------------------------- export

    /** Thin bands around each stripped original line: they hit only that line's glyphs. */
    fun stripRectsJson(layout: GpParagraphLayout): JSONArray? {
        val stripped = layout.strippedOrigLines ?: return null
        val arr = JSONArray()
        for (idx in stripped.sorted()) {
            val l = layout.origLines.getOrNull(idx) ?: continue
            val dxBand = 0.75
            arr.put(JSONObject().apply {
                put("x", l.x0 - dxBand)
                put("y", l.baseline - l.fontSize * 0.55)
                put("width", (l.x1 - l.x0) + dxBand * 2)
                put("height", l.fontSize * 0.3)
            })
        }
        return arr
    }

    fun layoutLinesJson(layout: GpParagraphLayout): JSONArray = JSONArray().apply {
        for (line in layout.lines) {
            if (line.kept) continue
            put(JSONObject().apply {
                put("baseline", line.baseline)
                put("segments", JSONArray().apply {
                    for (s in line.segments) {
                        put(JSONObject().apply {
                            put("text", s.text)
                            put("x", s.x)
                            put("width", s.width)
                            if (s.bold) put("bold", true)
                            if (s.italic) put("italic", true)
                            if (s.underline) put("underline", true)
                            if (s.strikethrough) put("strikethrough", true)
                            if (s.fallback) put("fallback", true)
                            if (abs(s.sizePt - line.fontSize) > 1e-6) put("size", s.sizePt)
                            if (abs(s.rise) > 1e-6) put("rise", s.rise)
                        })
                    }
                })
            })
        }
    }

    /** Adds the exact layout to a text-edit's export JSON (ignored for other elements). */
    fun decorateExportJson(el: GpOverlayElement, json: JSONObject, docFonts: Map<String, GpExtractedFontInfo>) {
        if (!handles(el) || el.pristine) return
        val layout = layout(el, docFonts)
        stripRectsJson(layout)?.let { json.put("stripRects", it) }
        json.put("layoutLines", layoutLinesJson(layout))
    }

    /** Identity of what a clean preview must strip for this text edit. */
    fun stripSignature(el: GpOverlayElement, docFonts: Map<String, GpExtractedFontInfo>): Set<Int>? {
        if (!handles(el)) return null
        return layout(el, docFonts).strippedOrigLines
    }
}
