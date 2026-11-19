package dev.gullacpdf.android.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Rect
import dev.gullacpdf.android.model.GpExtractedFontInfo
import dev.gullacpdf.android.model.GpOutlineNode
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpPageLink
import dev.gullacpdf.android.model.GpPageMeta
import dev.gullacpdf.android.model.GpPageNumberingConfig
import dev.gullacpdf.android.model.GpRectF
import dev.gullacpdf.android.model.GpSearchMatch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

data class OpenDocOutcome(
    val ok: Boolean,
    val status: String, // ok | needs-password | invalid-password | error
    val error: String? = null,
    val pageCount: Int = 0,
    val pages: List<GpPageMeta> = emptyList(),
    val canCopyText: Boolean = true,
    val outline: List<GpOutlineNode> = emptyList(),
)

data class CompileSaveOutcome(
    val ok: Boolean,
    val error: String? = null,
    val outputPath: String = "",
    val verifiedPageCount: Int = 0,
    val byteSize: Long = 0L,
)

object NativePdfBridge {
    private val initialized = AtomicBoolean(false)

    init {
        System.loadLibrary("pdfium")
        System.loadLibrary("gp_jni")
    }

    private external fun nativeInitEngine(pdfiumLibPath: String?, tileBudgetBytes: Long): Boolean
    private external fun nativeOpenDocumentFile(docId: String, path: String, password: String?): String
    private external fun nativeOpenDocumentBytes(docId: String, bytes: ByteArray, password: String?): String
    private external fun nativeCloseDocument(docId: String)
    private external fun nativeRenderTileIntoBuffer(
        docId: String,
        pageIndex: Int,
        tileX: Int,
        tileY: Int,
        tileW: Int,
        tileH: Int,
        scale: Double,
        userRotation: Int,
        transparentBg: Boolean,
        theme: String,
        darkPaperInvert: Boolean,
        priorityTier: Int,
        scope: String?,
        outBuffer: ByteBuffer,
    ): String?

    private external fun nativeCancelRenderScope(scope: String): Int
    private external fun nativeTrimEngineMemory(targetBytes: Long)
    private external fun nativeExtractPageText(docId: String, pageIndex: Int): String
    private external fun nativeAnalyzePageObjects(docId: String, pageIndex: Int, pageId: String): String
    private external fun nativeExtractPageLinks(docId: String, pageIndex: Int): String
    private external fun nativePrepareCleanPagePreview(docId: String, pageIndex: Int, elementsJson: String): ByteArray?
    private external fun nativeSearchPage(
        docId: String,
        pageIndex: Int,
        query: String,
        matchCase: Boolean,
        wholeWord: Boolean,
    ): String

    private external fun nativeComputeRotatedResizeRect(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        rotationDeg: Double,
        handle: String,
        dxPx: Double,
        dyPx: Double,
        aspectLocked: Boolean,
    ): DoubleArray

    private external fun nativeComputeSnapGuidePosition(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        pageW: Double,
        pageH: Double,
        siblingsJson: String,
    ): DoubleArray

    private external fun nativeExtractEmbeddedFonts(
        docId: String,
        cacheDir: String,
    ): String

    private external fun nativeExtractPageImageRgba(
        docId: String,
        pageIndex: Int,
        imageId: String,
    ): ByteArray?

    private external fun nativeCompileAndSaveVerified(
        requestJson: String,
        fontRegular: ByteArray?,
        fontBold: ByteArray?,
        fontItalic: ByteArray?,
        fontSerif: ByteArray?,
        fontMono: ByteArray?,
        customTtf: ByteArray?,
        extraFontKeys: Array<String>,
        extraFontPaths: Array<String>,
        imageIds: Array<String>,
        imageWidths: IntArray,
        imageHeights: IntArray,
        imageRgbaArrays: Array<ByteArray>,
    ): String

    private external fun nativeRedactFileVerified(
        inputPath: String,
        outputPath: String,
        password: String?,
        rectsJson: String,
    ): String

    fun ensureInitialized() {
        if (initialized.compareAndSet(false, true)) {
            val ok = nativeInitEngine(null, 128L * 1024L * 1024L)
            if (!ok) {
                initialized.set(false)
                throw IllegalStateException("Failed to initialize PDFium native engine")
            }
        }
    }

    suspend fun openDocumentFile(docId: String, path: String, password: String? = null): OpenDocOutcome =
        withContext(Dispatchers.IO) {
            ensureInitialized()
            parseOpenOutcome(docId, nativeOpenDocumentFile(docId, path, password))
        }

    suspend fun openDocumentBytes(docId: String, bytes: ByteArray, password: String? = null): OpenDocOutcome =
        withContext(Dispatchers.IO) {
            ensureInitialized()
            parseOpenOutcome(docId, nativeOpenDocumentBytes(docId, bytes, password))
        }

    suspend fun closeDocument(docId: String) = withContext(Dispatchers.IO) {
        if (initialized.get()) {
            nativeCloseDocument(docId)
        }
    }

    suspend fun renderTileBitmap(
        docId: String,
        pageIndex: Int,
        tileX: Int,
        tileY: Int,
        tileWidthPx: Int,
        tileHeightPx: Int,
        scale: Double,
        userRotation: Int,
        theme: String,
        darkPaperInvert: Boolean,
        priorityTier: Int,
        scope: String?,
        bufferPool: DirectBufferPool,
        transparentBg: Boolean = false,
    ): Bitmap? = withContext(Dispatchers.IO) {
        ensureInitialized()
        val w = tileWidthPx.coerceAtLeast(1)
        val h = tileHeightPx.coerceAtLeast(1)
        val needed = w * h * 4
        val buf = bufferPool.acquire(needed)
        try {
            buf.clear()
            val err = nativeRenderTileIntoBuffer(
                docId = docId,
                pageIndex = pageIndex,
                tileX = tileX,
                tileY = tileY,
                tileW = w,
                tileH = h,
                scale = scale,
                userRotation = userRotation,
                transparentBg = transparentBg,
                theme = theme,
                darkPaperInvert = darkPaperInvert,
                priorityTier = priorityTier,
                scope = scope,
                outBuffer = buf,
            )
            if (err != null) return@withContext null
            buf.rewind()
            buf.limit(needed)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.copyPixelsFromBuffer(buf)
            bmp
        } finally {
            bufferPool.release(buf)
        }
    }

    fun cancelRenderScope(scope: String): Int {
        if (!initialized.get()) return 0
        return nativeCancelRenderScope(scope)
    }

    fun trimEngineMemory(targetBytes: Long) {
        if (initialized.get()) {
            nativeTrimEngineMemory(targetBytes)
        }
    }

    suspend fun extractPageText(docId: String, pageIndex: Int): String = withContext(Dispatchers.IO) {
        ensureInitialized()
        val raw = nativeExtractPageText(docId, pageIndex)
        try {
            JSONObject(raw).optString("plainText", "")
        } catch (_: Exception) {
            ""
        }
    }

    suspend fun analyzePageObjectsJson(docId: String, pageIndex: Int, pageId: String): String =
        withContext(Dispatchers.IO) {
            ensureInitialized()
            nativeAnalyzePageObjects(docId, pageIndex, pageId)
        }

    suspend fun extractPageLinks(docId: String, pageIndex: Int): List<GpPageLink> =
        withContext(Dispatchers.IO) {
            ensureInitialized()
            val raw = nativeExtractPageLinks(docId, pageIndex)
            try {
                val arr = JSONArray(raw)
                buildList {
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        add(
                            GpPageLink(
                                id = o.optString("id", ""),
                                pageIndex = o.optInt("pageIndex", pageIndex),
                                x = o.optDouble("x", 0.0),
                                y = o.optDouble("y", 0.0),
                                width = o.optDouble("width", 0.0),
                                height = o.optDouble("height", 0.0),
                                kind = o.optString("kind", "uri"),
                                uri = o.optString("uri").takeIf { it.isNotEmpty() && !o.isNull("uri") },
                                destPageIndex = if (o.has("destPageIndex") && !o.isNull("destPageIndex")) o.optInt("destPageIndex") else null,
                            )
                        )
                    }
                }
            } catch (_: Exception) {
                emptyList()
            }
        }

    suspend fun prepareCleanPagePreview(
        docId: String,
        pageIndex: Int,
        elements: List<GpOverlayElement>,
        decorate: (GpOverlayElement, JSONObject) -> Unit = { _, _ -> },
    ): ByteArray? = withContext(Dispatchers.IO) {
        ensureInitialized()
        val arr = JSONArray().apply { elements.forEach { el -> put(el.toCoreJson().also { decorate(el, it) }) } }
        nativePrepareCleanPagePreview(docId, pageIndex, arr.toString())
    }

    suspend fun searchPage(
        docId: String,
        pageIndex: Int,
        query: String,
        matchCase: Boolean,
        wholeWord: Boolean,
    ): List<GpSearchMatch> = withContext(Dispatchers.IO) {
        ensureInitialized()
        val raw = nativeSearchPage(docId, pageIndex, query, matchCase, wholeWord)
        try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val rectsArr = o.optJSONArray("rects")
                    val rects = buildList {
                        if (rectsArr != null) {
                            for (j in 0 until rectsArr.length()) {
                                val r = rectsArr.optJSONObject(j) ?: continue
                                add(
                                    GpRectF.fromLTWH(
                                        r.optDouble("x", 0.0).toFloat(),
                                        r.optDouble("y", 0.0).toFloat(),
                                        r.optDouble("width", 0.0).toFloat(),
                                        r.optDouble("height", 0.0).toFloat(),
                                    )
                                )
                            }
                        }
                    }
                    add(
                        GpSearchMatch(
                            pageIndex = o.optInt("pageIndex", pageIndex),
                            matchIndexInPage = o.optInt("matchIndexInPage", i),
                            snippet = o.optString("snippet", ""),
                            rects = rects,
                        )
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun computeRotatedResizeRect(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        rotationDeg: Double,
        handle: String,
        dxPx: Double,
        dyPx: Double,
        aspectLocked: Boolean,
    ): DoubleArray {
        if (!initialized.get()) return doubleArrayOf(x, y, width, height)
        return nativeComputeRotatedResizeRect(
            x, y, width, height, rotationDeg, handle, dxPx, dyPx, aspectLocked
        )
    }

    fun computeSnapGuidePosition(
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        pageW: Double,
        pageH: Double,
        siblings: List<GpRectF>,
    ): DoubleArray {
        if (!initialized.get()) return doubleArrayOf(x, y, 0.0)
        val arr = JSONArray().apply {
            siblings.forEach { s ->
                put(JSONObject().apply {
                    put("x", s.left.toDouble())
                    put("y", s.top.toDouble())
                    put("width", s.width.toDouble())
                    put("height", s.height.toDouble())
                })
            }
        }
        return nativeComputeSnapGuidePosition(x, y, width, height, pageW, pageH, arr.toString())
    }

    suspend fun extractEmbeddedFonts(context: Context, docId: String): List<GpExtractedFontInfo> =
        withContext(Dispatchers.IO) {
            ensureInitialized()
            val cacheDir = File(context.cacheDir, "embedded_fonts/$docId").apply { mkdirs() }
            val raw = nativeExtractEmbeddedFonts(docId, cacheDir.absolutePath).trim()
            if (!raw.startsWith("[")) return@withContext emptyList()
            try {
                val arr = JSONArray(raw)
                buildList {
                    for (i in 0 until arr.length()) {
                        val o = arr.optJSONObject(i) ?: continue
                        add(
                            GpExtractedFontInfo(
                                id = o.optString("id", ""),
                                cleanName = o.optString("cleanName", ""),
                                displayName = o.optString("displayName", ""),
                                baseKey = o.optString("baseKey", ""),
                                fallbackFamily = o.optString("fallbackFamily", "DejaVuSans"),
                                unicodeUsable = o.optBoolean("unicodeUsable", true),
                                regularTtfPath = o.optString("regularTtfPath").takeIf { it.isNotEmpty() && !o.isNull("regularTtfPath") },
                                boldTtfPath = o.optString("boldTtfPath").takeIf { it.isNotEmpty() && !o.isNull("boldTtfPath") },
                                italicTtfPath = o.optString("italicTtfPath").takeIf { it.isNotEmpty() && !o.isNull("italicTtfPath") },
                                boldItalicTtfPath = o.optString("boldItalicTtfPath").takeIf { it.isNotEmpty() && !o.isNull("boldItalicTtfPath") },
                            )
                        )
                    }
                }
            } catch (_: Exception) {
                emptyList()
            }
        }

    suspend fun extractPageImagePng(docId: String, pageIndex: Int, imageId: String): ByteArray? =
        withContext(Dispatchers.IO) {
            ensureInitialized()
            val packed = nativeExtractPageImageRgba(docId, pageIndex, imageId) ?: return@withContext null
            if (packed.size < 8) return@withContext null
            val hdr = ByteBuffer.wrap(packed, 0, 8).order(ByteOrder.LITTLE_ENDIAN)
            val w = hdr.int
            val h = hdr.int
            if (w <= 0 || h <= 0 || packed.size < 8 + w * h * 4) return@withContext null
            val argb = IntArray(w * h)
            var src = 8
            for (i in argb.indices) {
                val r = packed[src++].toInt() and 0xFF
                val g = packed[src++].toInt() and 0xFF
                val b = packed[src++].toInt() and 0xFF
                val a = packed[src++].toInt() and 0xFF
                argb[i] = (a shl 24) or (r shl 16) or (g shl 8) or b
            }
            val bmp = Bitmap.createBitmap(argb, w, h, Bitmap.Config.ARGB_8888)
            val baos = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.PNG, 100, baos)
            bmp.recycle()
            baos.toByteArray()
        }

    suspend fun compileAndSaveVerified(
        context: Context,
        pages: List<GpPageMeta>,
        elements: List<GpOverlayElement>,
        outputPath: String,
        pageNumbering: GpPageNumberingConfig?,
        customTtfBytes: ByteArray?,
        embeddedFonts: List<GpExtractedFontInfo> = emptyList(),
        decorate: (GpOverlayElement, JSONObject) -> Unit = { _, _ -> },
    ): CompileSaveOutcome = withContext(Dispatchers.IO) {
        ensureInitialized()

        fun readFont(name: String): ByteArray? = try {
            context.assets.open("fonts/$name").use { it.readBytes() }
        } catch (_: Exception) {
            null
        }

        val fontReg = readFont("DejaVuSans.ttf")
        val fontBold = readFont("DejaVuSans-Bold.ttf")
        val fontItalic = readFont("DejaVuSans-Oblique.ttf")
        val fontSerif = readFont("DejaVuSerif.ttf")
        val fontMono = readFont("DejaVuSansMono.ttf")

        val extraFontKeys = mutableListOf<String>()
        val extraFontPaths = mutableListOf<String>()
        for (ef in embeddedFonts) {
            ef.regularTtfPath?.let { extraFontKeys.add(ef.id); extraFontPaths.add(it) }
            ef.boldTtfPath?.let { extraFontKeys.add("${ef.id}#bold"); extraFontPaths.add(it) }
            ef.italicTtfPath?.let { extraFontKeys.add("${ef.id}#italic"); extraFontPaths.add(it) }
            ef.boldItalicTtfPath?.let { extraFontKeys.add("${ef.id}#boldItalic"); extraFontPaths.add(it) }
        }

        val imgIds = mutableListOf<String>()
        val imgWidths = mutableListOf<Int>()
        val imgHeights = mutableListOf<Int>()
        val imgRgbas = mutableListOf<ByteArray>()

        for (el in elements) {
            // In-place moves reuse the original image object; no pixels need to be re-encoded.
            if ((el.kind == "image" || el.kind == "imageReplacement" || el.kind == "signature") &&
                el.imageBytes != null && !el.deleted && !el.movesInPlace()
            ) {
                val decoded = rasterizeElementImageRgba(el)
                if (decoded != null) {
                    imgIds.add(el.id)
                    imgWidths.add(decoded.width)
                    imgHeights.add(decoded.height)
                    imgRgbas.add(decoded.rgba)
                }
            }
        }

        val redactArr = JSONArray().apply {
            for (e in elements) {
                if (e.isRedact && !e.deleted) {
                    val pageIdx = pages.indexOfFirst { it.id == e.pageId }.coerceIn(0, (pages.size - 1).coerceAtLeast(0))
                    put(JSONObject().apply {
                        put("pageIndex", pageIdx)
                        put("x", e.x)
                        put("y", e.y)
                        put("width", e.width)
                        put("height", e.height)
                    })
                }
            }
        }

        val pagesArr = JSONArray().apply { pages.forEach { put(it.toCoreJson()) } }
        val elsArr = JSONArray().apply { elements.forEach { el -> put(el.toCoreJson().also { decorate(el, it) }) } }

        val reqObj = JSONObject().apply {
            put("pagesJson", pagesArr.toString())
            put("elementsJson", elsArr.toString())
            if (pageNumbering != null && pageNumbering.enabled) {
                put("pageNumberingJson", pageNumbering.toCoreJson().toString())
            }
            put("redactions", redactArr)
            put("outputPath", outputPath)
        }

        val rawOut = nativeCompileAndSaveVerified(
            requestJson = reqObj.toString(),
            fontRegular = fontReg,
            fontBold = fontBold,
            fontItalic = fontItalic,
            fontSerif = fontSerif,
            fontMono = fontMono,
            customTtf = customTtfBytes,
            extraFontKeys = extraFontKeys.toTypedArray(),
            extraFontPaths = extraFontPaths.toTypedArray(),
            imageIds = imgIds.toTypedArray(),
            imageWidths = imgWidths.toIntArray(),
            imageHeights = imgHeights.toIntArray(),
            imageRgbaArrays = imgRgbas.toTypedArray(),
        )
        try {
            val obj = JSONObject(rawOut)
            CompileSaveOutcome(
                ok = obj.optBoolean("ok", false),
                error = obj.optString("error").takeIf { it.isNotEmpty() && !obj.isNull("error") },
                outputPath = obj.optString("outputPath", outputPath),
                verifiedPageCount = obj.optInt("verifiedPageCount", 0),
                byteSize = obj.optLong("byteSize", 0L),
            )
        } catch (e: Exception) {
            CompileSaveOutcome(ok = false, error = e.message)
        }
    }

    private data class DecodedRgba(val width: Int, val height: Int, val rgba: ByteArray)

    private fun rasterizeElementImageRgba(el: GpOverlayElement): DecodedRgba? {
        val raw = el.imageBytes ?: return null
        val src = BitmapFactory.decodeByteArray(raw, 0, raw.size) ?: return null
        val crop = el.cropRect
        val cropped = if (crop != null && (crop.left > 0.005f || crop.top > 0.005f || crop.width < 0.995f || crop.height < 0.995f)) {
            val sx = (crop.left.coerceIn(0f, 0.98f) * src.width).toInt()
            val sy = (crop.top.coerceIn(0f, 0.98f) * src.height).toInt()
            val sw = (crop.width.coerceIn(0.02f, 1f) * src.width).toInt().coerceIn(1, src.width - sx)
            val sh = (crop.height.coerceIn(0.02f, 1f) * src.height).toInt().coerceIn(1, src.height - sy)
            val outW = sw.coerceIn(1, 1600)
            val outH = sh.coerceIn(1, 1600)
            val dest = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
            Canvas(dest).drawBitmap(src, Rect(sx, sy, sx + sw, sy + sh), Rect(0, 0, outW, outH), null)
            src.recycle()
            dest
        } else if (src.config != Bitmap.Config.ARGB_8888) {
            val copy = src.copy(Bitmap.Config.ARGB_8888, false)
            src.recycle()
            copy
        } else {
            src
        }

        val buf = ByteBuffer.allocate(cropped.width * cropped.height * 4)
        cropped.copyPixelsToBuffer(buf)
        val res = DecodedRgba(cropped.width, cropped.height, buf.array())
        cropped.recycle()
        return res
    }

    private fun parseOpenOutcome(docId: String, rawJson: String): OpenDocOutcome {
        return try {
            val obj = JSONObject(rawJson)
            val ok = obj.optBoolean("ok", false)
            val status = obj.optString("status", if (ok) "ok" else "error")
            val err = obj.optString("error").takeIf { it.isNotEmpty() && !obj.isNull("error") }
            val pagesArr = obj.optJSONArray("pages")
            val pages = buildList {
                if (pagesArr != null) {
                    for (i in 0 until pagesArr.length()) {
                        val p = pagesArr.optJSONObject(i) ?: continue
                        val srcIdx = p.optInt("sourcePageIndex", i)
                        add(
                            GpPageMeta(
                                id = "${docId}_p$srcIdx",
                                sourceDocId = docId,
                                sourcePageIndex = srcIdx,
                                baseWidth = p.optDouble("baseWidth", 595.0),
                                baseHeight = p.optDouble("baseHeight", 842.0),
                                intrinsicRotation = p.optInt("intrinsicRotation", 0),
                            )
                        )
                    }
                }
            }
            val outline = parseOutlineArray(obj.optJSONArray("outline"))
            OpenDocOutcome(
                ok = ok,
                status = status,
                error = err,
                pageCount = obj.optInt("pageCount", pages.size),
                pages = pages,
                canCopyText = obj.optBoolean("canCopyText", true),
                outline = outline,
            )
        } catch (e: Exception) {
            OpenDocOutcome(ok = false, status = "error", error = e.message)
        }
    }

    private fun parseOutlineArray(arr: JSONArray?): List<GpOutlineNode> {
        if (arr == null) return emptyList()
        return buildList {
            for (i in 0 until arr.length()) {
                val o = arr.optJSONObject(i) ?: continue
                add(
                    GpOutlineNode(
                        id = o.optString("id", "bm_$i"),
                        title = o.optString("title", ""),
                        pageIndex = if (o.has("pageIndex") && !o.isNull("pageIndex")) o.optInt("pageIndex") else null,
                        children = parseOutlineArray(o.optJSONArray("children")),
                    )
                )
            }
        }
    }
}
