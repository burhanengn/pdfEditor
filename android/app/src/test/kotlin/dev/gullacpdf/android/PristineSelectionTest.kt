package dev.gullacpdf.android

import dev.gullacpdf.android.l10n.GpLocale
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpOverlayElement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PristineSelectionTest {
    private fun selectedPdfImage(behind: Boolean) = GpOverlayElement(
        id = "ir_1",
        pageId = "p0",
        kind = "imageReplacement",
        x = 0.0,
        y = 0.0,
        width = 595.0,
        height = 842.0,
        origX = 0.0,
        origY = 0.0,
        origWidth = 595.0,
        origHeight = 842.0,
        behindContent = behind,
        sourceBlockId = "img_0_0",
        pristine = true,
    )

    @Test
    fun selectedButUntouchedPdfObjectsStayInOriginalRaster() {
        // Foreground and background images alike keep their original layer while only selected.
        assertTrue(selectedPdfImage(behind = false).staysInPdfRaster())
        assertTrue(selectedPdfImage(behind = true).staysInPdfRaster())
        val paragraph = GpOverlayElement(
            id = "te_1", pageId = "p0", kind = "textEdit", x = 10.0, y = 10.0, width = 200.0, height = 40.0,
            text = "Original", originalText = "Original", sourceBlockId = "tb_1", pristine = true,
        )
        assertTrue(paragraph.staysInPdfRaster())
    }

    @Test
    fun anyRealChangeLiftsObjectOutOfRaster() {
        val before = selectedPdfImage(behind = false)
        val moved = before.copy(x = 40.0).withPristineResolvedAgainst(before)
        assertFalse(moved.pristine)
        assertFalse(moved.staysInPdfRaster())

        val deleted = before.copy(deleted = true).withPristineResolvedAgainst(before)
        assertFalse(deleted.staysInPdfRaster())
    }

    @Test
    fun lockToggleAndNoOpUpdatesKeepPristine() {
        val before = selectedPdfImage(behind = true)
        assertTrue(before.copy(locked = true).withPristineResolvedAgainst(before).pristine)
        assertTrue(before.copy().withPristineResolvedAgainst(before).pristine)
    }

    @Test
    fun overflowMenuStringsExistInBothLocales() {
        assertEquals("Birlikte Aç", GpStrings(GpLocale.TR).t("action.openWith"))
        assertEquals("Open With", GpStrings(GpLocale.EN).t("action.openWith"))
        assertEquals("Yükleniyor…", GpStrings(GpLocale.TR).t("status.loading"))
    }
}
