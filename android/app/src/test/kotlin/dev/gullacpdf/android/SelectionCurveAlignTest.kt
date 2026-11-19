package dev.gullacpdf.android

import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.normalizedPointMap
import dev.gullacpdf.android.viewmodel.computeAlignedDeltas
import dev.gullacpdf.android.viewmodel.computeElementVisualBounds
import dev.gullacpdf.android.viewmodel.computeToggledPathVertices
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SelectionCurveAlignTest {
    private fun samplePath(): GpOverlayElement {
        val pts = listOf(
            GpPoint(10f, 10f),
            GpPoint(50f, 10f, smooth = true),
            GpPoint(90f, 60f, smooth = false),
            GpPoint(120f, 60f),
        )
        return GpOverlayElement(
            id = "path_1",
            pageId = "p0",
            kind = "path",
            x = 10.0,
            y = 10.0,
            width = 110.0,
            height = 50.0,
            smooth = false,
            closed = false,
            points = pts,
        )
    }

    @Test
    fun pathPointNormalizationEmitsPerVertexSmoothFlagsWhenPresent() {
        val path = samplePath()
        val serialized = path.points.map { p -> normalizedPointMap(p, path.x, path.y, path.width, path.height) }
        assertEquals(4, serialized.size)
        assertFalse(serialized[0].containsKey("smooth"))
        assertEquals(true, serialized[1]["smooth"])
        assertEquals(false, serialized[2]["smooth"])
        assertFalse(serialized[3].containsKey("smooth"))
        assertEquals(0.0, serialized[0]["x"] as Double, 1e-6)
        assertEquals(1.0, serialized[3]["x"] as Double, 1e-6)

        val cloned = path.cloneForPage("path_copy", "p1")
        assertEquals(true, cloned.points[1].smooth)
        assertEquals(false, cloned.points[2].smooth)
    }

    @Test
    fun togglingSubsetVerticesLeavesOtherVerticesUntouched() {
        val base = samplePath()
        val updated = computeToggledPathVertices(base, setOf(1, 3), forceValue = true)
        assertNull(updated.points[0].smooth)
        assertEquals(true, updated.points[1].smooth)
        assertEquals(false, updated.points[2].smooth)
        assertEquals(true, updated.points[3].smooth)
        assertFalse(updated.smooth)

        // With forceValue = null on already-smooth target subset {1, 3}, flips to false.
        val flipped = computeToggledPathVertices(updated, setOf(1, 3), forceValue = null)
        assertEquals(false, flipped.points[1].smooth)
        assertEquals(false, flipped.points[3].smooth)
    }

    @Test
    fun togglingAllVerticesUpdatesGlobalAndVertexFlags() {
        val base = samplePath()
        val allSmooth = computeToggledPathVertices(base, emptySet(), forceValue = true)
        assertTrue(allSmooth.smooth)
        assertTrue(allSmooth.points.all { it.smooth == true })
    }

    @Test
    fun alignAndDistributeComputeExactDeltasIncludingPaths() {
        val r1 = GpOverlayElement(id = "a", pageId = "p0", kind = "shape", x = 20.0, y = 40.0, width = 40.0, height = 20.0)
        val p1 = samplePath() // bounds [10..120, 10..60] => width 110, height 50
        val r2 = GpOverlayElement(id = "c", pageId = "p0", kind = "shape", x = 210.0, y = 100.0, width = 30.0, height = 40.0)

        // Left aligns everyone's left edge to x = 10.0 (samplePath's minX)
        val leftDeltas = computeAlignedDeltas(listOf(r1, p1, r2), "left")
        assertEquals(-10.0, leftDeltas.getValue("a").first, 1e-4)
        assertEquals(0.0, leftDeltas.getValue("path_1").first, 1e-4)
        assertEquals(-200.0, leftDeltas.getValue("c").first, 1e-4)

        // Applying delta to path shifts every vertex & preserves per-vertex smooth flags
        val pathDx = leftDeltas.getValue("path_1").first + 25.0
        val shiftedPts = p1.points.map { it.copy(x = it.x + pathDx.toFloat()) }
        assertEquals(35f, shiftedPts[0].x, 1e-4f)
        assertEquals(true, shiftedPts[1].smooth)
        assertEquals(false, shiftedPts[2].smooth)

        // Distribute requires at least 3 elements
        assertTrue(computeAlignedDeltas(listOf(r1, r2), "distribute-h").isEmpty())

        // Distribute-h across span [10..240] (total span = 230, total widths = 110+40+30 = 180, gap = 25)
        // Sorted left edges: path_1 (x=10, w=110) -> stays 10; a (x=20->145, dx=+125); c (x=210->210, dx=0)
        val distH = computeAlignedDeltas(listOf(r1, p1, r2), "distribute-h")
        assertEquals(0.0, distH.getValue("path_1").first, 1e-4)
        assertEquals(125.0, distH.getValue("a").first, 1e-4)
        assertEquals(0.0, distH.getValue("c").first, 1e-4)

        // Rotated AABB check (40x20 rotated 90deg => 20x40 centered at (40,50) => left=30, top=30)
        val rot = r1.copy(rotationDeg = 90.0)
        val bounds = computeElementVisualBounds(rot)
        assertEquals(30f, bounds.left, 0.01f)
        assertEquals(30f, bounds.top, 0.01f)
        assertEquals(20f, bounds.width, 0.01f)
        assertEquals(40f, bounds.height, 0.01f)
    }
}
