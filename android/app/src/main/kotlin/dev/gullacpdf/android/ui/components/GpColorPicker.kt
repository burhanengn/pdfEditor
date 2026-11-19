package dev.gullacpdf.android.ui.components

import android.graphics.Color as AndroidColor
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette

val GpStandardSwatches = listOf(
    0xFF0F172A.toInt(),
    0xFF1E3A8A.toInt(),
    0xFF1D4ED8.toInt(),
    0xFF0284C7.toInt(),
    0xFF15803D.toInt(),
    0xFFD97706.toInt(),
    0xFFDC2626.toInt(),
    0xFF7C3AED.toInt(),
    0xFFFACC15.toInt(),
    0xFFFFFFFF.toInt(),
)

/**
 * Glitch-free swatch row + optional None/Transparent + custom HSV Color Picker dialog.
 * Works reliably for foreground text/stroke color AND background/fill color without scroll interference.
 */
@Composable
fun GpColorPickerRow(
    label: String,
    selectedColor: Int,
    allowTransparent: Boolean,
    strings: GpStrings,
    onSelectColor: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalGpPalette.current
    var showCustomDialog by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxWidth()) {
        Text(
            text = label,
            style = GpTypography.caption,
            color = palette.textSecondary,
        )
        Spacer(Modifier.height(6.dp))
        Row(
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (allowTransparent) {
                val isNone = (selectedColor ushr 24) == 0
                Box(
                    modifier = Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(palette.surfaceOverlay)
                        .border(if (isNone) 2.5.dp else 1.dp, if (isNone) palette.accent else palette.border, CircleShape)
                        .clickable { onSelectColor(0x00000000) },
                    contentAlignment = Alignment.Center,
                ) {
                    Canvas(modifier = Modifier.size(16.dp)) {
                        drawCircle(color = Color(0xFF94A3B8), style = Stroke(width = 2f))
                        drawLine(color = Color(0xFFEF4444), start = Offset(2f, size.height - 2f), end = Offset(size.width - 2f, 2f), strokeWidth = 2.5f)
                    }
                }
            }

            for (c in GpStandardSwatches) {
                val selected = selectedColor == c
                Box(
                    modifier = Modifier
                        .size(30.dp)
                        .clip(CircleShape)
                        .background(Color(c))
                        .border(if (selected) 2.5.dp else 1.dp, if (selected) palette.accent else palette.border, CircleShape)
                        .clickable { onSelectColor(c) },
                )
            }

            // Custom HSV Color Wheel button
            val isCustom = (selectedColor ushr 24) > 0 && selectedColor !in GpStandardSwatches
            Box(
                modifier = Modifier
                    .size(30.dp)
                    .clip(CircleShape)
                    .background(
                        Brush.sweepGradient(
                            listOf(
                                Color.Red, Color.Yellow, Color.Green, Color.Cyan, Color.Blue, Color.Magenta, Color.Red,
                            ),
                        ),
                    )
                    .border(if (isCustom) 2.5.dp else 1.dp, if (isCustom) palette.accent else palette.border, CircleShape)
                    .clickable { showCustomDialog = true },
                contentAlignment = Alignment.Center,
            ) {
                if (isCustom) {
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(CircleShape)
                            .background(Color(selectedColor))
                            .border(1.dp, Color.White, CircleShape),
                    )
                }
            }
        }
    }

    if (showCustomDialog) {
        GpCustomHsvColorDialog(
            initialColor = if ((selectedColor ushr 24) == 0) 0xFF2563EB.toInt() else selectedColor,
            strings = strings,
            onDismiss = { showCustomDialog = false },
            onConfirm = { picked ->
                onSelectColor(picked)
                showCustomDialog = false
            },
        )
    }
}

@Composable
fun GpCustomHsvColorDialog(
    initialColor: Int,
    strings: GpStrings,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit,
) {
    val palette = LocalGpPalette.current
    val initialHsv = remember(initialColor) {
        FloatArray(3).also { AndroidColor.colorToHSV(initialColor or 0xFF000000.toInt(), it) }
    }
    var hue by remember { mutableFloatStateOf(initialHsv[0]) }
    var sat by remember { mutableFloatStateOf(initialHsv[1]) }
    var value by remember { mutableFloatStateOf(initialHsv[2]) }
    val currentArgb = AndroidColor.HSVToColor(0xFF, floatArrayOf(hue, sat, value))
    var hexText by remember(currentArgb) {
        mutableStateOf(String.format("#%06X", currentArgb and 0xFFFFFF))
    }

    Dialog(onDismissRequest = onDismiss) {
        Surface(
            color = palette.surfaceRaised,
            shape = RoundedCornerShape(16.dp),
            tonalElevation = 6.dp,
        ) {
            Column(modifier = Modifier.padding(GpSpacing.s4)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(36.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .background(Color(currentArgb))
                            .border(1.dp, palette.border, RoundedCornerShape(8.dp)),
                    )
                    Spacer(Modifier.width(12.dp))
                    Text(
                        text = strings.t("mobile.customColor"),
                        style = GpTypography.titleM,
                        color = palette.textPrimary,
                    )
                }

                Spacer(Modifier.height(14.dp))

                // Saturation / Value 2D Canvas (pointer-isolated so drag never glitches!)
                val huePure = Color(AndroidColor.HSVToColor(floatArrayOf(hue, 1f, 1f)))
                Canvas(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(170.dp)
                        .clip(RoundedCornerShape(10.dp))
                        .pointerInput(Unit) {
                            detectTapGestures { offset ->
                                sat = (offset.x / size.width).coerceIn(0f, 1f)
                                value = (1f - offset.y / size.height).coerceIn(0f, 1f)
                            }
                        }
                        .pointerInput(Unit) {
                            detectDragGestures { change, _ ->
                                change.consume()
                                sat = (change.position.x / size.width).coerceIn(0f, 1f)
                                value = (1f - change.position.y / size.height).coerceIn(0f, 1f)
                            }
                        },
                ) {
                    drawRoundRect(
                        brush = Brush.horizontalGradient(listOf(Color.White, huePure)),
                        cornerRadius = CornerRadius(10f, 10f),
                    )
                    drawRoundRect(
                        brush = Brush.verticalGradient(listOf(Color.Transparent, Color.Black)),
                        cornerRadius = CornerRadius(10f, 10f),
                    )
                    val cx = sat * size.width
                    val cy = (1f - value) * size.height
                    drawCircle(color = Color.White, radius = 10.dp.toPx(), center = Offset(cx, cy), style = Stroke(width = 3.dp.toPx()))
                    drawCircle(color = Color.Black, radius = 8.dp.toPx(), center = Offset(cx, cy), style = Stroke(width = 1.5.dp.toPx()))
                }

                Spacer(Modifier.height(14.dp))

                // Hue strip
                Canvas(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(28.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .pointerInput(Unit) {
                            detectTapGestures { offset ->
                                hue = ((offset.x / size.width) * 360f).coerceIn(0f, 360f)
                            }
                        }
                        .pointerInput(Unit) {
                            detectDragGestures { change, _ ->
                                change.consume()
                                hue = ((change.position.x / size.width) * 360f).coerceIn(0f, 360f)
                            }
                        },
                ) {
                    drawRoundRect(
                        brush = Brush.horizontalGradient(
                            listOf(
                                Color(0xFFFF0000), Color(0xFFFFFF00), Color(0xFF00FF00),
                                Color(0xFF00FFFF), Color(0xFF0000FF), Color(0xFFFF00FF), Color(0xFFFF0000),
                            ),
                        ),
                        cornerRadius = CornerRadius(14.dp.toPx(), 14.dp.toPx()),
                    )
                    val hx = (hue / 360f) * size.width
                    drawCircle(color = Color.White, radius = 12.dp.toPx(), center = Offset(hx, size.height * 0.5f), style = Stroke(width = 3.dp.toPx()))
                }

                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = hexText,
                    onValueChange = { raw ->
                        hexText = raw
                        val clean = raw.trim().removePrefix("#")
                        if (clean.length == 6) {
                            clean.toLongOrNull(16)?.let { rgb ->
                                val parsed = (0xFF000000L or rgb).toInt()
                                val outHsv = FloatArray(3)
                                AndroidColor.colorToHSV(parsed, outHsv)
                                hue = outHsv[0]
                                sat = outHsv[1]
                                value = outHsv[2]
                            }
                        }
                    },
                    singleLine = true,
                    label = { Text("HEX") },
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(14.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = onDismiss) {
                        Text(strings.t("action.cancel"))
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = { onConfirm(currentArgb) },
                        colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                    ) {
                        Text(strings.t("action.done"))
                    }
                }
            }
        }
    }
}
