package dev.gullacpdf.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Official gullacpdf 3-layer brand mark rendered natively from public/favicon.svg geometry.
 */
@Composable
fun GullacBrandMark(
    modifier: Modifier = Modifier,
    size: Dp = 32.dp,
) {
    Canvas(modifier = modifier.size(size)) {
        val sx = this.size.width / 128f
        val sy = this.size.height / 128f

        // 3. Back sheet (+6 deg)
        rotate(degrees = 6f, pivot = Offset(67f * sx, 54f * sy)) {
            drawRoundRect(
                brush = Brush.linearGradient(
                    colors = listOf(Color(0x7393C5FD), Color(0x593B82F6)),
                    start = Offset(30f * sx, 16f * sy),
                    end = Offset(98f * sx, 88f * sy),
                ),
                topLeft = Offset(34f * sx, 12f * sy),
                size = Size(66f * sx, 84f * sy),
                cornerRadius = CornerRadius(14f * sx, 14f * sy),
            )
        }

        // 2. Mid sheet (-5 deg)
        rotate(degrees = -5f, pivot = Offset(56f * sx, 65f * sy)) {
            drawRoundRect(
                brush = Brush.linearGradient(
                    colors = listOf(Color(0xD938BDF8), Color(0xE60284C7)),
                    start = Offset(20f * sx, 32f * sy),
                    end = Offset(108f * sx, 96f * sy),
                ),
                topLeft = Offset(22f * sx, 22f * sy),
                size = Size(68f * sx, 86f * sy),
                cornerRadius = CornerRadius(14f * sx, 14f * sy),
            )
        }

        // 1. Front page with top-right dog-ear cutout
        val front = Path().apply {
            moveTo(38f * sx, 22f * sy)
            lineTo(76f * sx, 22f * sy)
            lineTo(98f * sx, 44f * sy)
            lineTo(98f * sx, 98f * sy)
            cubicTo(98f * sx, 105.732f * sy, 91.732f * sx, 112f * sy, 84f * sx, 112f * sy)
            lineTo(38f * sx, 112f * sy)
            cubicTo(30.268f * sx, 112f * sy, 24f * sx, 105.732f * sy, 24f * sx, 98f * sy)
            lineTo(24f * sx, 36f * sy)
            cubicTo(24f * sx, 28.268f * sy, 30.268f * sx, 22f * sy, 38f * sx, 22f * sy)
            close()
        }
        drawPath(
            path = front,
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFF3B82F6), Color(0xFF2563EB), Color(0xFF1D4ED8)),
                start = Offset(24f * sx, 20f * sy),
                end = Offset(104f * sx, 112f * sy),
            ),
        )

        // Dog-ear fold
        val fold = Path().apply {
            moveTo(76f * sx, 22f * sy)
            lineTo(76f * sx, 36f * sy)
            cubicTo(76f * sx, 40.4183f * sy, 79.5817f * sx, 44f * sy, 84f * sx, 44f * sy)
            lineTo(98f * sx, 44f * sy)
            close()
        }
        drawPath(
            path = fold,
            brush = Brush.linearGradient(
                colors = listOf(Color(0xFFBAE6FD), Color(0xFF60A5FA)),
                start = Offset(76f * sx, 16f * sy),
                end = Offset(100f * sx, 40f * sy),
            ),
        )

        // Stylized 'G'
        val gPath = Path().apply {
            moveTo(66f * sx, 56f * sy)
            lineTo(54f * sx, 56f * sy)
            cubicTo(47.3726f * sx, 56f * sy, 42f * sx, 61.3726f * sy, 42f * sx, 68f * sy)
            lineTo(42f * sx, 76f * sy)
            cubicTo(42f * sx, 82.6274f * sy, 47.3726f * sx, 88f * sy, 54f * sx, 88f * sy)
            lineTo(68f * sx, 88f * sy)
            cubicTo(73.5228f * sx, 88f * sy, 78f * sx, 83.5228f * sy, 78f * sx, 78f * sy)
            lineTo(78f * sx, 72f * sy)
            lineTo(61f * sx, 72f * sy)
        }
        drawPath(
            path = gPath,
            color = Color.White,
            style = Stroke(width = 6.5f * sx, cap = StrokeCap.Round, join = StrokeJoin.Round),
        )

        // Cyan selection handle dot
        drawCircle(
            color = Color(0xFF38BDF8),
            radius = 4f * sx,
            center = Offset(78f * sx, 60f * sy),
        )
    }
}

private fun vecIcon(name: String, block: androidx.compose.ui.graphics.vector.ImageVector.Builder.() -> Unit): ImageVector {
    return ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f,
    ).apply(block).build()
}

private fun androidx.compose.ui.graphics.vector.ImageVector.Builder.fillPath(d: Path.() -> Unit) {
    // helper unused; using Builder.path directly below
}

object GpIcons {
    val ArrowBack by lazy {
        vecIcon("ArrowBack") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(20f, 11f); horizontalLineTo(7.83f); lineTo(13.42f, 5.41f); lineTo(12f, 4f)
                lineTo(4f, 12f); lineTo(12f, 20f); lineTo(13.41f, 18.59f); lineTo(7.83f, 13f)
                horizontalLineTo(20f); close()
            }
        }
    }
    val Close by lazy {
        vecIcon("Close") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(19f, 6.41f); lineTo(17.59f, 5f); lineTo(12f, 10.59f); lineTo(6.41f, 5f)
                lineTo(5f, 6.41f); lineTo(10.59f, 12f); lineTo(5f, 17.59f); lineTo(6.41f, 19f)
                lineTo(12f, 13.41f); lineTo(17.59f, 19f); lineTo(19f, 17.59f); lineTo(13.41f, 12f); close()
            }
        }
    }
    val Check by lazy {
        vecIcon("Check") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(9f, 16.17f); lineTo(4.83f, 12f); lineTo(3.41f, 13.41f)
                lineTo(9f, 19f); lineTo(21f, 7f); lineTo(19.59f, 5.59f); close()
            }
        }
    }
    val ChevronUp by lazy {
        vecIcon("ChevronUp") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(7.41f, 15.41f); lineTo(12f, 10.83f); lineTo(16.59f, 15.41f)
                lineTo(18f, 14f); lineTo(12f, 8f); lineTo(6f, 14f); close()
            }
        }
    }
    val ChevronDown by lazy {
        vecIcon("ChevronDown") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(7.41f, 8.59f); lineTo(12f, 13.17f); lineTo(16.59f, 8.59f)
                lineTo(18f, 10f); lineTo(12f, 16f); lineTo(6f, 10f); close()
            }
        }
    }
    val ChevronLeft by lazy {
        vecIcon("ChevronLeft") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(15.41f, 7.41f); lineTo(14f, 6f); lineTo(8f, 12f)
                lineTo(14f, 18f); lineTo(15.41f, 16.59f); lineTo(10.83f, 12f); close()
            }
        }
    }
    val ChevronRight by lazy {
        vecIcon("ChevronRight") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(10f, 6f); lineTo(8.59f, 7.41f); lineTo(13.17f, 12f)
                lineTo(8.59f, 16.59f); lineTo(10f, 18f); lineTo(16f, 12f); close()
            }
        }
    }
    val Search by lazy {
        vecIcon("Search") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(11f, 4f)
                arcTo(7f, 7f, 0f, isMoreThanHalf = true, isPositiveArc = false, 11f, 18f)
                arcTo(7f, 7f, 0f, isMoreThanHalf = true, isPositiveArc = false, 11f, 4f)
                moveTo(16.5f, 16.5f); lineTo(20.5f, 20.5f)
            }
        }
    }
    val MoreVert by lazy {
        vecIcon("MoreVert") {
            path(fill = SolidColor(Color.Black)) {
                moveTo(12f, 5f); arcTo(1.5f, 1.5f, 0f, true, true, 12f, 8f); arcTo(1.5f, 1.5f, 0f, true, true, 12f, 5f)
                moveTo(12f, 10.5f); arcTo(1.5f, 1.5f, 0f, true, true, 12f, 13.5f); arcTo(1.5f, 1.5f, 0f, true, true, 12f, 10.5f)
                moveTo(12f, 16f); arcTo(1.5f, 1.5f, 0f, true, true, 12f, 19f); arcTo(1.5f, 1.5f, 0f, true, true, 12f, 16f)
            }
        }
    }
    val Edit by lazy {
        vecIcon("Edit") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(12f, 20f); horizontalLineTo(21f)
                moveTo(16.5f, 3.5f); lineTo(20.5f, 7.5f); lineTo(7f, 21f); horizontalLineTo(3f); verticalLineTo(17f); close()
            }
        }
    }
    val Save by lazy {
        vecIcon("Save") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(19f, 21f); horizontalLineTo(5f); lineTo(3f, 19f); verticalLineTo(5f); lineTo(5f, 3f); horizontalLineTo(16f); lineTo(21f, 8f); verticalLineTo(19f); close()
                moveTo(7f, 3f); verticalLineTo(8f); horizontalLineTo(15f); verticalLineTo(3f)
                moveTo(7f, 21f); verticalLineTo(14f); horizontalLineTo(17f); verticalLineTo(21f)
            }
        }
    }
    val Undo by lazy {
        vecIcon("Undo") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(9f, 14f); lineTo(4f, 9f); lineTo(9f, 4f)
                moveTo(4f, 9f); horizontalLineTo(15f); curveTo(18.5f, 9f, 20f, 11.5f, 20f, 14.5f); curveTo(20f, 17.5f, 18f, 19f, 15f, 19f); horizontalLineTo(11f)
            }
        }
    }
    val Redo by lazy {
        vecIcon("Redo") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(15f, 14f); lineTo(20f, 9f); lineTo(15f, 4f)
                moveTo(20f, 9f); horizontalLineTo(9f); curveTo(5.5f, 9f, 4f, 11.5f, 4f, 14.5f); curveTo(4f, 17.5f, 6f, 19f, 9f, 19f); horizontalLineTo(13f)
            }
        }
    }
    val Delete by lazy {
        vecIcon("Delete") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(3f, 6f); horizontalLineTo(21f)
                moveTo(8f, 6f); verticalLineTo(4f); horizontalLineTo(16f); verticalLineTo(6f)
                moveTo(19f, 6f); verticalLineTo(20f); horizontalLineTo(5f); verticalLineTo(6f)
                moveTo(10f, 11f); verticalLineTo(17f); moveTo(14f, 11f); verticalLineTo(17f)
            }
        }
    }
    val Pages by lazy {
        vecIcon("Pages") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(12f, 2f); lineTo(2f, 7f); lineTo(12f, 12f); lineTo(22f, 7f); close()
                moveTo(2f, 12f); lineTo(12f, 17f); lineTo(22f, 12f)
                moveTo(2f, 17f); lineTo(12f, 22f); lineTo(22f, 17f)
            }
        }
    }
    val SelectArrow by lazy {
        vecIcon("SelectArrow") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(4f, 4f); lineTo(11f, 20f); lineTo(13.5f, 13.5f); lineTo(20f, 11f); close()
            }
        }
    }
    val TextTool by lazy {
        vecIcon("TextTool") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(4f, 6f); horizontalLineTo(20f); moveTo(12f, 6f); verticalLineTo(19f); moveTo(8f, 19f); horizontalLineTo(16f)
            }
        }
    }
    val DrawPen by lazy {
        vecIcon("DrawPen") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(12f, 19f); lineTo(19f, 12f); lineTo(22f, 15f); lineTo(15f, 22f); close()
                moveTo(18f, 13f); lineTo(16.5f, 5.5f); lineTo(2f, 2f); lineTo(5.5f, 16.5f); lineTo(13f, 18f)
                moveTo(2f, 2f); lineTo(9.5f, 9.5f)
            }
        }
    }
    val Eraser by lazy {
        vecIcon("Eraser") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(20f, 20f); horizontalLineTo(7f); lineTo(3f, 16f); lineTo(13f, 6f); lineTo(21f, 14f); lineTo(15f, 20f)
                moveTo(8f, 11f); lineTo(15f, 18f)
            }
        }
    }
    val Highlight by lazy {
        vecIcon("Highlight") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(9f, 11f); lineTo(4f, 16f); lineTo(4f, 20f); lineTo(8f, 20f); lineTo(13f, 15f)
                moveTo(22f, 12f); lineTo(12f, 2f); lineTo(9f, 5f); lineTo(19f, 15f); close()
            }
        }
    }
    val Signature by lazy {
        vecIcon("Signature") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(3f, 17f); curveTo(6f, 10f, 9f, 8f, 10f, 14f); curveTo(11f, 18f, 14f, 8f, 16f, 12f); curveTo(17f, 15f, 19f, 13f, 21f, 11f)
                moveTo(3f, 20f); horizontalLineTo(21f)
            }
        }
    }
    val ShapeRect by lazy {
        vecIcon("ShapeRect") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineJoin = StrokeJoin.Round) {
                moveTo(4f, 4f); horizontalLineTo(20f); verticalLineTo(20f); horizontalLineTo(4f); close()
            }
        }
    }
    val ShapeEllipse by lazy {
        vecIcon("ShapeEllipse") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f) {
                moveTo(12f, 4f); arcTo(8f, 8f, 0f, true, true, 12f, 20f); arcTo(8f, 8f, 0f, true, true, 12f, 4f)
            }
        }
    }
    val ShapeTriangle by lazy {
        vecIcon("ShapeTriangle") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineJoin = StrokeJoin.Round) {
                moveTo(12f, 4f); lineTo(21f, 19f); horizontalLineTo(3f); close()
            }
        }
    }
    val ShapeDiamond by lazy {
        vecIcon("ShapeDiamond") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineJoin = StrokeJoin.Round) {
                moveTo(12f, 3f); lineTo(21f, 12f); lineTo(12f, 21f); lineTo(3f, 12f); close()
            }
        }
    }
    val ShapeArrow by lazy {
        vecIcon("ShapeArrow") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(4f, 12f); horizontalLineTo(19f); moveTo(13f, 6f); lineTo(19f, 12f); lineTo(13f, 18f)
            }
        }
    }
    val LineTool by lazy {
        vecIcon("LineTool") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(4f, 19f); lineTo(10f, 8f); lineTo(15f, 14f); lineTo(20f, 5f)
            }
        }
    }
    val ImageAdd by lazy {
        vecIcon("ImageAdd") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(3f, 5f); horizontalLineTo(21f); verticalLineTo(19f); horizontalLineTo(3f); close()
                moveTo(3f, 15f); lineTo(8f, 10f); lineTo(13f, 15f); lineTo(16f, 12f); lineTo(21f, 17f)
                moveTo(16f, 8f); arcTo(1.2f, 1.2f, 0f, true, true, 16f, 10.4f)
            }
        }
    }
    val Redact by lazy {
        vecIcon("Redact") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 3f); lineTo(21f, 21f)
                moveTo(4f, 7f); horizontalLineTo(11f); moveTo(4f, 12f); horizontalLineTo(9f); moveTo(14f, 12f); horizontalLineTo(20f); moveTo(4f, 17f); horizontalLineTo(14f)
            }
        }
    }
    val Lock by lazy {
        vecIcon("Lock") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(5f, 11f); horizontalLineTo(19f); verticalLineTo(21f); horizontalLineTo(5f); close()
                moveTo(8f, 11f); verticalLineTo(7f); curveTo(8f, 4.8f, 9.8f, 3f, 12f, 3f); curveTo(14.2f, 3f, 16f, 4.8f, 16f, 7f); verticalLineTo(11f)
            }
        }
    }
    val LockOpen by lazy {
        vecIcon("LockOpen") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(5f, 11f); horizontalLineTo(19f); verticalLineTo(21f); horizontalLineTo(5f); close()
                moveTo(8f, 11f); verticalLineTo(7f); curveTo(8f, 4.8f, 9.8f, 3f, 12f, 3f); curveTo(13.8f, 3f, 15.2f, 4.1f, 15.7f, 5.6f)
            }
        }
    }
    val Tune by lazy {
        vecIcon("Tune") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(4f, 6f); horizontalLineTo(20f); moveTo(4f, 12f); horizontalLineTo(20f); moveTo(4f, 18f); horizontalLineTo(20f)
                moveTo(9f, 4f); verticalLineTo(8f); moveTo(15f, 10f); verticalLineTo(14f); moveTo(8f, 16f); verticalLineTo(20f)
            }
        }
    }
    val Copy by lazy {
        vecIcon("Copy") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineJoin = StrokeJoin.Round) {
                moveTo(9f, 9f); horizontalLineTo(20f); verticalLineTo(20f); horizontalLineTo(9f); close()
                moveTo(5f, 15f); horizontalLineTo(4f); verticalLineTo(4f); horizontalLineTo(15f); verticalLineTo(5f)
            }
        }
    }
    val FolderOpen by lazy {
        vecIcon("FolderOpen") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(3f, 6f); horizontalLineTo(9f); lineTo(11f, 8f); horizontalLineTo(21f); verticalLineTo(19f); horizontalLineTo(3f); close()
            }
        }
    }
    val NoteAdd by lazy {
        vecIcon("NoteAdd") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(6f, 3f); horizontalLineTo(14f); lineTo(19f, 8f); verticalLineTo(21f); horizontalLineTo(6f); close()
                moveTo(12f, 11f); verticalLineTo(17f); moveTo(9f, 14f); horizontalLineTo(15f)
            }
        }
    }
    val RotateCw by lazy {
        vecIcon("RotateCw") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(21f, 4f); verticalLineTo(10f); horizontalLineTo(15f)
                moveTo(20.5f, 10f); arcTo(8.5f, 8.5f, 0f, true, false, 18.5f, 17.5f)
            }
        }
    }
    val RotateCcw by lazy {
        vecIcon("RotateCcw") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(3f, 4f); verticalLineTo(10f); horizontalLineTo(9f)
                moveTo(3.5f, 10f); arcTo(8.5f, 8.5f, 0f, true, true, 5.5f, 17.5f)
            }
        }
    }
    val Language by lazy {
        vecIcon("Language") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f, strokeLineCap = StrokeCap.Round) {
                moveTo(12f, 3f); arcTo(9f, 9f, 0f, true, true, 12f, 21f); arcTo(9f, 9f, 0f, true, true, 12f, 3f)
                moveTo(3f, 12f); horizontalLineTo(21f)
                moveTo(12f, 3f); curveTo(14.5f, 6f, 15.5f, 9f, 15.5f, 12f); curveTo(15.5f, 15f, 14.5f, 18f, 12f, 21f)
                moveTo(12f, 3f); curveTo(9.5f, 6f, 8.5f, 9f, 8.5f, 12f); curveTo(8.5f, 15f, 9.5f, 18f, 12f, 21f)
            }
        }
    }
    val ThemeMode by lazy {
        vecIcon("ThemeMode") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round) {
                moveTo(12f, 3f); arcTo(9f, 9f, 0f, true, true, 12f, 21f); arcTo(9f, 9f, 0f, true, true, 12f, 3f)
                moveTo(12f, 6f); arcTo(6f, 6f, 0f, false, true, 12f, 18f); close()
            }
        }
    }
    val Share by lazy {
        vecIcon("Share") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(18f, 5f); arcTo(2f, 2f, 0f, true, true, 18f, 9f); arcTo(2f, 2f, 0f, true, true, 18f, 5f)
                moveTo(6f, 10f); arcTo(2f, 2f, 0f, true, true, 6f, 14f); arcTo(2f, 2f, 0f, true, true, 6f, 10f)
                moveTo(18f, 15f); arcTo(2f, 2f, 0f, true, true, 18f, 19f); arcTo(2f, 2f, 0f, true, true, 18f, 15f)
                moveTo(7.8f, 11.1f); lineTo(16.2f, 7.4f); moveTo(7.8f, 12.9f); lineTo(16.2f, 16.6f)
            }
        }
    }
    val Print by lazy {
        vecIcon("Print") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineJoin = StrokeJoin.Round) {
                moveTo(6f, 9f); verticalLineTo(3f); horizontalLineTo(18f); verticalLineTo(9f)
                moveTo(6f, 18f); horizontalLineTo(4f); verticalLineTo(11f); horizontalLineTo(20f); verticalLineTo(18f); horizontalLineTo(18f)
                moveTo(6f, 14f); horizontalLineTo(18f); verticalLineTo(21f); horizontalLineTo(6f); close()
            }
        }
    }
    val Palette by lazy {
        vecIcon("Palette") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.9f, strokeLineCap = StrokeCap.Round) {
                moveTo(12f, 3f); arcTo(9f, 9f, 0f, true, false, 21f, 12f); curveTo(21f, 13.8f, 19.5f, 14.5f, 18f, 14.5f); horizontalLineTo(16f); curveTo(14.8f, 14.5f, 14f, 15.5f, 14f, 16.5f); curveTo(14f, 18f, 15f, 19.5f, 13.5f, 20.5f)
            }
        }
    }
    val AlignLeft by lazy {
        vecIcon("AlignLeft") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 6f); horizontalLineTo(21f)
                moveTo(3f, 10f); horizontalLineTo(15f)
                moveTo(3f, 14f); horizontalLineTo(21f)
                moveTo(3f, 18f); horizontalLineTo(15f)
            }
        }
    }
    val AlignCenter by lazy {
        vecIcon("AlignCenter") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 6f); horizontalLineTo(21f)
                moveTo(6f, 10f); horizontalLineTo(18f)
                moveTo(3f, 14f); horizontalLineTo(21f)
                moveTo(6f, 18f); horizontalLineTo(18f)
            }
        }
    }
    val AlignRight by lazy {
        vecIcon("AlignRight") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 6f); horizontalLineTo(21f)
                moveTo(9f, 10f); horizontalLineTo(21f)
                moveTo(3f, 14f); horizontalLineTo(21f)
                moveTo(9f, 18f); horizontalLineTo(21f)
            }
        }
    }
    val AlignJustify by lazy {
        vecIcon("AlignJustify") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 6f); horizontalLineTo(21f)
                moveTo(3f, 10f); horizontalLineTo(21f)
                moveTo(3f, 14f); horizontalLineTo(21f)
                moveTo(3f, 18f); horizontalLineTo(21f)
            }
        }
    }
    val Warning by lazy {
        vecIcon("Warning") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(12f, 3f); lineTo(2.5f, 20f); horizontalLineTo(21.5f); close()
                moveTo(12f, 9f); verticalLineTo(13.5f)
                moveTo(12f, 16.8f); verticalLineTo(17.2f)
            }
        }
    }
    val OpenInNew by lazy {
        vecIcon("OpenInNew") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(14f, 4f); horizontalLineTo(20f); verticalLineTo(10f)
                moveTo(10f, 14f); lineTo(20f, 4f)
                moveTo(18f, 14f); verticalLineTo(19f); curveTo(18f, 19.6f, 17.6f, 20f, 17f, 20f)
                horizontalLineTo(5f); curveTo(4.4f, 20f, 4f, 19.6f, 4f, 19f)
                verticalLineTo(7f); curveTo(4f, 6.4f, 4.4f, 6f, 5f, 6f); horizontalLineTo(10f)
            }
        }
    }
    val BoxSelect by lazy {
        vecIcon("BoxSelect") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round) {
                moveTo(4f, 8f); verticalLineTo(4f); horizontalLineTo(8f)
                moveTo(16f, 4f); horizontalLineTo(20f); verticalLineTo(8f)
                moveTo(4f, 16f); verticalLineTo(20f); horizontalLineTo(8f)
                moveTo(16f, 20f); horizontalLineTo(20f); verticalLineTo(16f)
                moveTo(11f, 4f); horizontalLineTo(13f)
                moveTo(11f, 20f); horizontalLineTo(13f)
                moveTo(4f, 11f); verticalLineTo(13f)
                moveTo(20f, 11f); verticalLineTo(13f)
            }
        }
    }
    val SmoothCurve by lazy {
        vecIcon("SmoothCurve") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(4f, 18f); curveTo(4f, 9f, 12f, 6f, 20f, 6f)
            }
            path(fill = SolidColor(Color.Black)) {
                moveTo(10.5f, 7f); arcTo(2f, 2f, 0f, true, true, 10.5f, 11f); arcTo(2f, 2f, 0f, true, true, 10.5f, 7f)
            }
        }
    }
    val SharpCorner by lazy {
        vecIcon("SharpCorner") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Miter) {
                moveTo(4f, 18f); lineTo(10f, 7f); lineTo(20f, 7f)
            }
        }
    }
    val AlignObjLeft by lazy {
        vecIcon("AlignObjLeft") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(4f, 3f); verticalLineTo(21f)
                moveTo(8f, 6f); horizontalLineTo(19f); verticalLineTo(10f); horizontalLineTo(8f); close()
                moveTo(8f, 14f); horizontalLineTo(15f); verticalLineTo(18f); horizontalLineTo(8f); close()
            }
        }
    }
    val AlignObjCenterH by lazy {
        vecIcon("AlignObjCenterH") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(12f, 3f); verticalLineTo(21f)
                moveTo(5f, 6f); horizontalLineTo(19f); verticalLineTo(10f); horizontalLineTo(5f); close()
                moveTo(7f, 14f); horizontalLineTo(17f); verticalLineTo(18f); horizontalLineTo(7f); close()
            }
        }
    }
    val AlignObjRight by lazy {
        vecIcon("AlignObjRight") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(20f, 3f); verticalLineTo(21f)
                moveTo(5f, 6f); horizontalLineTo(16f); verticalLineTo(10f); horizontalLineTo(5f); close()
                moveTo(9f, 14f); horizontalLineTo(16f); verticalLineTo(18f); horizontalLineTo(9f); close()
            }
        }
    }
    val AlignObjTop by lazy {
        vecIcon("AlignObjTop") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 4f); horizontalLineTo(21f)
                moveTo(6f, 8f); verticalLineTo(19f); horizontalLineTo(10f); verticalLineTo(8f); close()
                moveTo(14f, 8f); verticalLineTo(15f); horizontalLineTo(18f); verticalLineTo(8f); close()
            }
        }
    }
    val AlignObjCenterV by lazy {
        vecIcon("AlignObjCenterV") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 12f); horizontalLineTo(21f)
                moveTo(6f, 5f); verticalLineTo(19f); horizontalLineTo(10f); verticalLineTo(5f); close()
                moveTo(14f, 7f); verticalLineTo(17f); horizontalLineTo(18f); verticalLineTo(7f); close()
            }
        }
    }
    val AlignObjBottom by lazy {
        vecIcon("AlignObjBottom") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 20f); horizontalLineTo(21f)
                moveTo(6f, 5f); verticalLineTo(16f); horizontalLineTo(10f); verticalLineTo(5f); close()
                moveTo(14f, 9f); verticalLineTo(16f); horizontalLineTo(18f); verticalLineTo(9f); close()
            }
        }
    }
    val DistributeH by lazy {
        vecIcon("DistributeH") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(4f, 3f); verticalLineTo(21f)
                moveTo(20f, 3f); verticalLineTo(21f)
                moveTo(9f, 7f); horizontalLineTo(15f); verticalLineTo(17f); horizontalLineTo(9f); close()
            }
        }
    }
    val DistributeV by lazy {
        vecIcon("DistributeV") {
            path(stroke = SolidColor(Color.Black), strokeLineWidth = 2f, strokeLineCap = StrokeCap.Round) {
                moveTo(3f, 4f); horizontalLineTo(21f)
                moveTo(3f, 20f); horizontalLineTo(21f)
                moveTo(7f, 9f); verticalLineTo(15f); horizontalLineTo(17f); verticalLineTo(9f); close()
            }
        }
    }

    private fun strokeIcon(name: String, block: androidx.compose.ui.graphics.vector.PathBuilder.() -> Unit): ImageVector =
        vecIcon(name) {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.9f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = block,
            )
        }

    val Crop by lazy {
        strokeIcon("Crop") {
            moveTo(6f, 2f); verticalLineTo(18f); horizontalLineTo(22f)
            moveTo(2f, 6f); horizontalLineTo(18f); verticalLineTo(22f)
        }
    }
    val Cut by lazy {
        strokeIcon("Cut") {
            moveTo(9f, 6f); arcToRelative(3f, 3f, 0f, true, true, -6f, 0f); arcToRelative(3f, 3f, 0f, true, true, 6f, 0f)
            moveTo(9f, 18f); arcToRelative(3f, 3f, 0f, true, true, -6f, 0f); arcToRelative(3f, 3f, 0f, true, true, 6f, 0f)
            moveTo(8.1f, 8.1f); lineTo(20f, 20f)
            moveTo(8.1f, 15.9f); lineTo(20f, 4f)
        }
    }
    val Paste by lazy {
        strokeIcon("Paste") {
            moveTo(9f, 4f); horizontalLineTo(6f); verticalLineTo(21f); horizontalLineTo(18f); verticalLineTo(4f); horizontalLineTo(15f)
            moveTo(9f, 2.5f); horizontalLineTo(15f); verticalLineTo(5.5f); horizontalLineTo(9f); close()
            moveTo(9f, 11f); horizontalLineTo(15f); moveTo(9f, 15f); horizontalLineTo(13f)
        }
    }
    val Duplicate by lazy {
        strokeIcon("Duplicate") {
            moveTo(8f, 8f); horizontalLineTo(20f); verticalLineTo(20f); horizontalLineTo(8f); close()
            moveTo(4f, 16f); verticalLineTo(4f); horizontalLineTo(16f)
            moveTo(14f, 11f); verticalLineTo(17f); moveTo(11f, 14f); horizontalLineTo(17f)
        }
    }
    val FlipH by lazy {
        strokeIcon("FlipH") {
            moveTo(12f, 3f); verticalLineTo(21f)
            moveTo(9f, 6f); lineTo(3f, 18f); horizontalLineTo(9f); close()
            moveTo(15f, 6f); lineTo(21f, 18f); horizontalLineTo(15f); close()
        }
    }
    val FlipV by lazy {
        strokeIcon("FlipV") {
            moveTo(3f, 12f); horizontalLineTo(21f)
            moveTo(6f, 9f); lineTo(18f, 3f); verticalLineTo(9f); close()
            moveTo(6f, 15f); lineTo(18f, 21f); verticalLineTo(15f); close()
        }
    }
    val BringFront by lazy {
        strokeIcon("BringFront") {
            moveTo(8f, 8f); horizontalLineTo(20f); verticalLineTo(20f); horizontalLineTo(8f); close()
            moveTo(4f, 14f); verticalLineTo(4f); horizontalLineTo(14f)
            moveTo(14f, 17f); verticalLineTo(11f); moveTo(11.5f, 13.5f); lineTo(14f, 11f); lineTo(16.5f, 13.5f)
        }
    }
    val SendBack by lazy {
        strokeIcon("SendBack") {
            moveTo(4f, 4f); horizontalLineTo(16f); verticalLineTo(16f); horizontalLineTo(4f); close()
            moveTo(20f, 10f); verticalLineTo(20f); horizontalLineTo(10f)
            moveTo(10f, 7f); verticalLineTo(13f); moveTo(7.5f, 10.5f); lineTo(10f, 13f); lineTo(12.5f, 10.5f)
        }
    }
    val Layers by lazy {
        strokeIcon("Layers") {
            moveTo(12f, 3f); lineTo(21f, 8f); lineTo(12f, 13f); lineTo(3f, 8f); close()
            moveTo(3f, 12.5f); lineTo(12f, 17.5f); lineTo(21f, 12.5f)
            moveTo(3f, 16.5f); lineTo(12f, 21.5f); lineTo(21f, 16.5f)
        }
    }
    val TextAdd by lazy {
        strokeIcon("TextAdd") {
            moveTo(4f, 6f); verticalLineTo(4f); horizontalLineTo(14f); verticalLineTo(6f)
            moveTo(9f, 4f); verticalLineTo(18f); moveTo(7f, 18f); horizontalLineTo(11f)
            moveTo(18f, 12f); verticalLineTo(20f); moveTo(14f, 16f); horizontalLineTo(22f)
        }
    }
    val SelectAll by lazy {
        strokeIcon("SelectAll") {
            moveTo(3f, 7f); verticalLineTo(3f); horizontalLineTo(7f)
            moveTo(17f, 3f); horizontalLineTo(21f); verticalLineTo(7f)
            moveTo(21f, 17f); verticalLineTo(21f); horizontalLineTo(17f)
            moveTo(7f, 21f); horizontalLineTo(3f); verticalLineTo(17f)
            moveTo(8f, 8f); horizontalLineTo(16f); verticalLineTo(16f); horizontalLineTo(8f); close()
        }
    }
    val Info by lazy {
        strokeIcon("Info") {
            moveTo(21f, 12f); arcToRelative(9f, 9f, 0f, true, true, -18f, 0f); arcToRelative(9f, 9f, 0f, true, true, 18f, 0f)
            moveTo(12f, 11f); verticalLineTo(17f); moveTo(12f, 7.5f); verticalLineTo(7.6f)
        }
    }
}
