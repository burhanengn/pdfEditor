package dev.gullacpdf.android

import dev.gullacpdf.android.engine.TileKey
import dev.gullacpdf.android.l10n.GpLocale
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpDetectedShapeObj
import dev.gullacpdf.android.model.GpExtractedFontInfo
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpPageAnalysis
import dev.gullacpdf.android.model.GpPageNumberingConfig
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpRectF
import dev.gullacpdf.android.model.RichTextOps
import dev.gullacpdf.android.model.formatPageNumberText
import dev.gullacpdf.android.model.parseCssColorOrInt
import dev.gullacpdf.android.ui.viewport.ViewportLayoutMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class OverlayAndComplianceTest {
    @Test
    fun polylineVertexChainingUpdatesBoundsAndEndpointOrder() {
        val line = GpOverlayElement(
            id = "poly_1",
            pageId = "p0",
            kind = "path",
            x = 50.0,
            y = 100.0,
            width = 100.0,
            height = 20.0,
            points = listOf(GpPoint(50f, 100f), GpPoint(150f, 120f)),
        )

        val appended = line.withAppendedPoint(GpPoint(220f, 180f), prepend = false)
        assertEquals(3, appended.points.size)
        assertEquals(50.0, appended.x, 0.01)
        assertEquals(100.0, appended.y, 0.01)
        assertEquals(170.0, appended.width, 0.01)
        assertEquals(80.0, appended.height, 0.01)

        val prepended = appended.withAppendedPoint(GpPoint(20f, 40f), prepend = true)
        assertEquals(4, prepended.points.size)
        assertEquals(20f, prepended.points.first().x, 0.01f)
        assertEquals(40f, prepended.points.first().y, 0.01f)
        assertEquals(20.0, prepended.x, 0.01)
        assertEquals(40.0, prepended.y, 0.01)
    }

    @Test
    fun colorParsingSupportsTransparentAndHex() {
        assertEquals(0x00000000, parseCssColorOrInt("transparent", 0xFF000000.toInt()))
        assertEquals(0x00000000, parseCssColorOrInt("none", 0xFF000000.toInt()))
        assertEquals(0xFF2563EB.toInt(), parseCssColorOrInt("#2563eb", 0))
    }

    @Test
    fun pageNumberingFormatsRomanAndOffsets() {
        val cfg = GpPageNumberingConfig(
            enabled = true,
            format = "roman-upper",
            startFromPage = 2,
            startNumber = 4,
        )
        assertEquals("IV", formatPageNumberText(cfg, 2, 10))
        assertEquals("V", formatPageNumberText(cfg, 3, 10))
    }

    @Test
    fun localizationCoversBothEnAndTrMobileKeys() {
        val en = GpStrings(GpLocale.EN)
        val tr = GpStrings(GpLocale.TR)
        val requiredKeys = listOf(
            "mobile.toolLock",
            "mobile.polylineHint",
            "mobile.textColor",
            "mobile.bgColor",
            "mobile.noneTransparent",
            "mobile.customColor",
            "mobile.alignLeft",
            "mobile.alignCenter",
            "mobile.alignRight",
            "mobile.alignJustify",
            "mobile.bold",
            "mobile.italic",
            "mobile.underline",
            "mobile.strike",
            "mobile.subscript",
            "mobile.superscript",
            "mobile.letterSpacing",
            "mobile.lineHeight",
            "mobile.horizScale",
            "mobile.fontEmbeddedOk",
            "mobile.fontMissingWarning",
            "mobile.fontSubsetWarning",
            "mobile.pdfShapeSelected",
            "mobile.pdfImageSelected",
        )
        for (k in requiredKeys) {
            assertFalse("Missing EN key $k", en.t(k) == k)
            assertFalse("Missing TR key $k", tr.t(k) == k)
        }
    }

    @Test
    fun richTextOpsPreservesRunsOnEditAndSelectionToggle() {
        val base = GpOverlayElement(
            id = "te_1",
            pageId = "p0",
            kind = "textEdit",
            x = 40.0,
            y = 80.0,
            width = 240.0,
            height = 40.0,
            text = "Hello World!",
            align = "justify",
        )
        val styled = RichTextOps.toggleStyle(base, 6, 11, "bold")
        val styledUnder = RichTextOps.toggleStyle(styled, 6, 11, "underline")
        val styledSub = RichTextOps.toggleStyle(styledUnder, 11, 12, "sub")

        val worldFlags = RichTextOps.effectiveFlagsAt(styledSub, 6, 11)
        assertTrue(worldFlags.bold)
        assertTrue(worldFlags.underline)
        assertEquals("normal", worldFlags.scriptMode)

        val bangFlags = RichTextOps.effectiveFlagsAt(styledSub, 11, 12)
        assertFalse(bangFlags.bold)
        assertEquals("sub", bangFlags.scriptMode)

        val edited = RichTextOps.applyTextChange(styledSub, "Hello Wide World!")
        assertEquals("Hello Wide World!", edited.text)
        assertTrue(RichTextOps.effectiveFlagsAt(edited, 6, 16).bold)
        assertTrue(RichTextOps.effectiveFlagsAt(edited, 6, 16).underline)
    }

    @Test
    fun overlayElementEqualityDetectsTypographyAndFontChanges() {
        val el = GpOverlayElement(
            id = "te_2",
            pageId = "p0",
            kind = "textEdit",
            x = 20.0,
            y = 30.0,
            width = 180.0,
            height = 28.0,
            text = "Sample",
            align = "left",
        )
        assertNotEquals(el, el.copy(align = "justify"))
        assertNotEquals(el, el.copy(underline = true))
        assertNotEquals(el, el.copy(strikethrough = true))
        assertNotEquals(el, el.copy(scriptMode = "super"))
        assertNotEquals(el, el.copy(letterSpacing = 1.2))
        assertNotEquals(el, el.copy(horizontalScale = 0.85))
        assertNotEquals(el, el.copy(embeddedFontId = "f1"))
        assertNotEquals(el, el.copy(fontWarning = "missing:Calibri"))
        val ef = GpExtractedFontInfo(
            id = "f1",
            cleanName = "Roboto",
            displayName = "Roboto",
            baseKey = "roboto",
            fallbackFamily = "DejaVuSans",
            unicodeUsable = true,
            regularTtfPath = "/tmp/emb_0_roboto_reg.ttf",
        )
        assertTrue(ef.hasAnyTtf)
    }

    @Test
    fun manifestAndGradleContainZeroAgplOrForbiddenPermissions() {
        val cwd = File(System.getProperty("user.dir") ?: ".")
        val androidRoot = if (File(cwd, "app/src/main/AndroidManifest.xml").exists()) cwd else cwd.parentFile
        val manifest = File(androidRoot, "app/src/main/AndroidManifest.xml").readText()
        val gradle = File(androidRoot, "app/build.gradle.kts").readText()

        assertFalse(manifest.contains("READ_EXTERNAL_STORAGE"))
        assertFalse(manifest.contains("WRITE_EXTERNAL_STORAGE"))
        assertFalse(manifest.contains("MANAGE_EXTERNAL_STORAGE"))
        assertFalse(manifest.contains("android.permission.INTERNET"))
        assertTrue(manifest.contains("application/pdf"))

        assertFalse(gradle.lowercase().contains("mupdf"))
        assertTrue(File(androidRoot, "app/src/main/jniLibs/arm64-v8a/libgp_jni.so").exists())
        assertTrue(File(androidRoot, "app/src/main/jniLibs/arm64-v8a/libpdfium.so").exists())
    }

    @Test
    fun behindImageStateTransitionsAndDeletedCleanPreviewEligibility() {
        val bg = GpOverlayElement(
            id = "ir_bg",
            pageId = "p0",
            kind = "imageReplacement",
            x = 20.0,
            y = 30.0,
            width = 400.0,
            height = 600.0,
            origX = 20.0,
            origY = 30.0,
            origWidth = 400.0,
            origHeight = 600.0,
            behindContent = true,
            isBackgroundLayer = true,
            sourceBlockId = "img_0_0",
        )
        assertTrue(bg.isUnmodifiedBehind())

        val moved = bg.copy(x = 60.0)
        assertFalse(moved.isUnmodifiedBehind())

        val deleted = moved.copy(deleted = true)
        assertFalse(deleted.isUnmodifiedBehind())
        assertEquals(20.0, deleted.origX!!, 0.01)

        // Modified shape should also flip isUnmodifiedBehind to false
        val shape = GpOverlayElement(
            id = "sr_1",
            pageId = "p0",
            kind = "shapeReplacement",
            x = 10.0,
            y = 10.0,
            width = 100.0,
            height = 80.0,
            origX = 10.0,
            origY = 10.0,
            origWidth = 100.0,
            origHeight = 80.0,
            behindContent = true,
            fillColorValue = 0xFFEEEEEE.toInt(),
            strokeWidth = 1.0,
            sourceBlockId = "shp_0_1",
        )
        val analysis = GpPageAnalysis(
            shapes = listOf(
                GpDetectedShapeObj(
                    id = "shp_0_1",
                    x = 10.0,
                    y = 10.0,
                    width = 100.0,
                    height = 80.0,
                    fillColorValue = 0xFFEEEEEE.toInt(),
                    behindContent = true,
                )
            )
        )
        assertTrue(shape.isUnmodifiedBehind(analysis))
        assertFalse(shape.copy(fillColorValue = 0xFFCCCCCC.toInt()).isUnmodifiedBehind(analysis))
    }

    @Test
    fun i18nOpenWithAndTileKeyIsolationAndLocalGeomMathWork() {
        assertEquals("Open With", GpStrings(GpLocale.EN).t("action.openWith"))
        assertEquals("Birlikte Aç", GpStrings(GpLocale.TR).t("action.openWith"))

        val kOpaque = TileKey("d1", 0, 0, 0, "1.0", 0, "light", isPreview = false, transparentBg = false)
        val kTrans = kOpaque.copy(transparentBg = true)
        assertNotEquals(kOpaque, kTrans)

        val snap = ViewportLayoutMath.computeSnapPosition(
            x = 38.0,
            y = 100.0,
            width = 50.0,
            height = 20.0,
            pageW = 595.0,
            pageH = 842.0,
            siblings = listOf(GpRectF.fromLTWH(200f, 102f, 80f, 20f)),
        )
        assertEquals(36.0, snap.x, 0.01)
        assertEquals(102.0, snap.y, 0.01)

        val resized = ViewportLayoutMath.computeRotatedResizeRect(
            x = 100.0,
            y = 120.0,
            width = 160.0,
            height = 80.0,
            rotationDeg = 0.0,
            handle = "se",
            dxPdf = 40.0,
            dyPdf = 10.0,
            aspectLocked = true,
        )
        assertEquals(100.0, resized[0], 0.01)
        assertEquals(120.0, resized[1], 0.01)
        assertEquals(200.0, resized[2], 0.01)
        assertEquals(100.0, resized[3], 0.01)
    }
}
