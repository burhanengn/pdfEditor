package dev.gullacpdf.android.ui.signature

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas as ComposeCanvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpGhostSignature
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpSavedSignature
import dev.gullacpdf.android.model.GpSignatureSvgPath
import dev.gullacpdf.android.model.stripPaperBackgroundPng
import dev.gullacpdf.android.theme.GpComponents
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpColorPickerRow
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.viewmodel.GpAppState
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.hypot
import kotlin.math.max

private data class TimedStrokePoint(
    val x: Float,
    val y: Float,
    val tMs: Long,
)

private enum class TypeSigStyle(val id: String, val labelEn: String, val labelTr: String) {
    CALLIGRAPHY("calligraphy", "Italic Serif", "İtalik Serif"),
    SCRIPT("script", "Handwritten", "El Yazısı"),
    BOLD_SANS("bold", "Clean Bold", "Temiz Kalın"),
    MONO("mono", "Formal Mono", "Resmi Mono"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignatureStudioSheet(
    state: GpAppState,
    strings: GpStrings,
    uploadedImageBytes: ByteArray?,
    onPickUploadImage: () -> Unit,
    onClearUploadedImage: () -> Unit,
    onPlaceGhost: (GpGhostSignature) -> Unit,
    onSaveToVault: (GpSavedSignature) -> Unit,
    onDeleteFromVault: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var isParaf by remember { mutableStateOf(false) }
    var activeTab by remember { mutableIntStateOf(0) } // 0=Draw, 1=Type, 2=Upload, 3=Vault
    var inkColor by remember { mutableIntStateOf(0xFF0F172A.toInt()) }
    var realisticInk by remember { mutableStateOf(true) }

    // Draw tab state (stored normalized into pad pixel coordinates + viewBox)
    val timedStrokes = remember { mutableStateListOf<List<TimedStrokePoint>>() }
    var activeStroke by remember { mutableStateOf<List<TimedStrokePoint>>(emptyList()) }
    var padSize by remember { mutableStateOf(IntSize(600, 320)) }

    // Type tab state
    var typedText by remember { mutableStateOf("") }
    var typedStyle by remember { mutableStateOf(TypeSigStyle.CALLIGRAPHY) }

    // Upload tab state
    var removePaperBg by remember { mutableStateOf(true) }

    val viewBoxW = 360f
    val viewBoxH = if (isParaf) 200f else 170f

    val activePageCenter = remember(state.activePageIndex, state.pages) {
        val pg = state.pages.getOrNull(state.activePageIndex.coerceIn(0, (state.pages.size - 1).coerceAtLeast(0)))
        if (pg != null) GpPoint((pg.displayWidth * 0.5).toFloat(), (pg.displayHeight * 0.55).toFloat())
        else GpPoint(297f, 420f)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.surfaceRaised,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = GpSpacing.s4, vertical = GpSpacing.s2),
        ) {
            Text(
                text = strings.t("mobile.tool.signature"),
                style = GpTypography.titleM,
                color = palette.textPrimary,
            )
            Spacer(Modifier.height(10.dp))

            // Signature vs Paraf selector
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = !isParaf,
                    onClick = { isParaf = false },
                    shape = SegmentedButtonDefaults.itemShape(0, 2),
                    label = { Text(strings.t("mobile.sig.signatureTab")) },
                )
                SegmentedButton(
                    selected = isParaf,
                    onClick = { isParaf = true },
                    shape = SegmentedButtonDefaults.itemShape(1, 2),
                    label = { Text(strings.t("mobile.sig.parafTab")) },
                )
            }

            Spacer(Modifier.height(10.dp))

            val tabs = listOf(
                strings.t("mobile.sig.draw"),
                strings.t("mobile.sig.type"),
                strings.t("mobile.sig.upload"),
                "${strings.t("mobile.sig.vault")} (${state.savedSignatures.size})",
            )
            TabRow(
                selectedTabIndex = activeTab,
                containerColor = Color.Transparent,
                contentColor = palette.accent,
            ) {
                tabs.forEachIndexed { idx, title ->
                    Tab(
                        selected = activeTab == idx,
                        onClick = { activeTab = idx },
                        text = {
                            Text(
                                text = title,
                                style = GpTypography.caption.copy(fontWeight = if (activeTab == idx) FontWeight.SemiBold else FontWeight.Normal),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        },
                    )
                }
            }

            Spacer(Modifier.height(12.dp))

            when (activeTab) {
                // TAB 0: DRAW SIGNATURE / PARAF
                0 -> {
                    Surface(
                        color = Color.White,
                        shape = RoundedCornerShape(14.dp),
                        border = BorderStroke(1.5.dp, palette.border),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(if (isParaf) 200.dp else 180.dp)
                            .onSizeChanged { padSize = it },
                    ) {
                        Box(modifier = Modifier.fillMaxSize()) {
                            ComposeCanvas(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .pointerInput(Unit) {
                                        awaitEachGesture {
                                            val down = awaitFirstDown(requireUnconsumed = false)
                                            down.consume()
                                            val startPt = TimedStrokePoint(down.position.x, down.position.y, SystemClock.uptimeMillis())
                                            var curStroke = listOf(startPt)
                                            activeStroke = curStroke
                                            while (true) {
                                                val ev = awaitPointerEvent()
                                                val ch = ev.changes.firstOrNull { it.id == down.id }
                                                if (ch == null || !ch.pressed) break
                                                ch.consume()
                                                val last = curStroke.last()
                                                if (hypot(ch.position.x - last.x, ch.position.y - last.y) >= 2f) {
                                                    curStroke = curStroke + TimedStrokePoint(ch.position.x, ch.position.y, SystemClock.uptimeMillis())
                                                    activeStroke = curStroke
                                                }
                                            }
                                            if (curStroke.size >= 2) {
                                                timedStrokes.add(curStroke)
                                            }
                                            activeStroke = emptyList()
                                        }
                                    },
                            ) {
                                // Subtle signature guide line
                                val guideY = size.height * 0.76f
                                drawLine(
                                    color = Color(0xFFE2E8F0),
                                    start = Offset(20f, guideY),
                                    end = Offset(size.width - 20f, guideY),
                                    strokeWidth = 2f,
                                )
                                val allStrokes = if (activeStroke.isNotEmpty()) timedStrokes + listOf(activeStroke) else timedStrokes.toList()
                                val composeInk = Color(inkColor)
                                for (stroke in allStrokes) {
                                    if (stroke.size < 2) continue
                                    if (realisticInk) {
                                        val ribbon = PhotocopyInk.fineRibbon(
                                            stroke.map { InkSample(it.x, it.y, it.tMs) },
                                            size.width,
                                            size.height,
                                            viewBoxW,
                                            viewBoxH,
                                        )
                                        if (ribbon != null) {
                                            val composePath = ribbonPointsToComposePath(ribbon, size.width / viewBoxW, size.height / viewBoxH)
                                            drawPath(composePath, color = Color(PhotocopyInk.tonerColor(inkColor)), style = Fill)
                                            continue
                                        }
                                    }
                                    val p = Path().apply {
                                        moveTo(stroke.first().x, stroke.first().y)
                                        for (i in 1 until stroke.size) {
                                            val prev = stroke[i - 1]
                                            val cur = stroke[i]
                                            quadraticTo(prev.x, prev.y, (prev.x + cur.x) * 0.5f, (prev.y + cur.y) * 0.5f)
                                        }
                                        lineTo(stroke.last().x, stroke.last().y)
                                    }
                                    drawPath(
                                        path = p,
                                        color = composeInk,
                                        style = Stroke(width = 4.5f, cap = StrokeCap.Round, join = StrokeJoin.Round),
                                    )
                                }
                            }

                            if (timedStrokes.isEmpty() && activeStroke.isEmpty()) {
                                Text(
                                    text = if (isParaf) strings.t("mobile.sig.parafTab") else strings.t("mobile.sig.draw"),
                                    style = GpTypography.caption,
                                    color = Color(0xFF94A3B8),
                                    modifier = Modifier.align(Alignment.Center),
                                )
                            }
                        }
                    }

                    Spacer(Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = strings.t("mobile.sig.realisticInk"),
                            style = GpTypography.body,
                            color = palette.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(checked = realisticInk, onCheckedChange = { realisticInk = it })
                    }

                    Spacer(Modifier.height(8.dp))
                    GpColorPickerRow(
                        label = strings.t("mobile.strokeColor"),
                        selectedColor = inkColor,
                        allowTransparent = false,
                        strings = strings,
                        onSelectColor = { inkColor = it },
                    )

                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = { if (timedStrokes.isNotEmpty()) timedStrokes.removeAt(timedStrokes.lastIndex) },
                            enabled = timedStrokes.isNotEmpty(),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(strings.t("action.undo"))
                        }
                        OutlinedButton(
                            onClick = { timedStrokes.clear() },
                            enabled = timedStrokes.isNotEmpty(),
                            modifier = Modifier.weight(1f),
                        ) {
                            Text(strings.t("action.delete"))
                        }
                    }

                    Spacer(Modifier.height(10.dp))
                    val wPx = padSize.width.coerceAtLeast(100).toFloat()
                    val hPx = padSize.height.coerceAtLeast(80).toFloat()

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                val built = buildDrawnSignatureData(timedStrokes, wPx, hPx, viewBoxW, viewBoxH, inkColor, realisticInk)
                                onSaveToVault(
                                    GpSavedSignature(
                                        id = "sig_${System.nanoTime()}",
                                        label = if (isParaf) strings.t("mobile.sig.parafTab") else strings.t("mobile.sig.signatureTab"),
                                        isParaf = isParaf,
                                        strokes = built.strokes,
                                        svgPaths = built.svgPaths,
                                        imageBytes = built.imageBytes,
                                        realisticInk = realisticInk,
                                        colorValue = inkColor,
                                        viewBoxW = viewBoxW.toDouble(),
                                        viewBoxH = viewBoxH.toDouble(),
                                        createdAtMs = System.currentTimeMillis(),
                                    ),
                                )
                            },
                            enabled = timedStrokes.isNotEmpty(),
                            modifier = Modifier.weight(1f).height(GpComponents.primaryTouchTarget),
                        ) {
                            Text(strings.t("action.save"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        Button(
                            onClick = {
                                val built = buildDrawnSignatureData(timedStrokes, wPx, hPx, viewBoxW, viewBoxH, inkColor, realisticInk)
                                val targetW = if (isParaf) 110f else 185f
                                val targetH = targetW * (viewBoxH / viewBoxW)
                                onPlaceGhost(
                                    GpGhostSignature(
                                        label = if (isParaf) strings.t("mobile.sig.parafTab") else strings.t("mobile.sig.signatureTab"),
                                        strokes = built.strokes,
                                        centerPdf = activePageCenter,
                                        sizePdfW = targetW,
                                        sizePdfH = targetH,
                                        isParaf = isParaf,
                                        realisticInk = realisticInk,
                                        colorValue = inkColor,
                                        svgPaths = built.svgPaths,
                                        imageBytes = built.imageBytes,
                                        viewBoxW = viewBoxW,
                                        viewBoxH = viewBoxH,
                                        signatureId = "drawn_${System.nanoTime()}",
                                    ),
                                )
                            },
                            enabled = timedStrokes.isNotEmpty(),
                            colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                            modifier = Modifier.weight(1.4f).height(GpComponents.primaryTouchTarget),
                        ) {
                            Text(strings.t("mobile.placeGhost"), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }

                // TAB 1: TYPE SIGNATURE
                1 -> {
                    OutlinedTextField(
                        value = typedText,
                        onValueChange = { typedText = it },
                        label = { Text(strings.t("mobile.sig.type")) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        for (st in TypeSigStyle.entries) {
                            FilterChip(
                                selected = typedStyle == st,
                                onClick = { typedStyle = st },
                                label = { Text(if (strings.isTr) st.labelTr else st.labelEn) },
                            )
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    GpColorPickerRow(
                        label = strings.t("mobile.strokeColor"),
                        selectedColor = inkColor,
                        allowTransparent = false,
                        strings = strings,
                        onSelectColor = { inkColor = it },
                    )

                    val previewBmp = remember(typedText, typedStyle, inkColor) {
                        if (typedText.trim().isNotEmpty()) renderTypedSignatureBitmap(typedText.trim(), typedStyle, inkColor)
                        else null
                    }
                    if (previewBmp != null) {
                        Spacer(Modifier.height(10.dp))
                        Surface(
                            color = Color.White,
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(1.dp, palette.border),
                            modifier = Modifier.fillMaxWidth().height(92.dp),
                        ) {
                            Image(
                                bitmap = previewBmp.asImageBitmap(),
                                contentDescription = typedText,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxSize().padding(10.dp),
                            )
                        }
                    }

                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                val bmp = previewBmp ?: return@OutlinedButton
                                val png = bitmapToPngBytes(bmp)
                                onSaveToVault(
                                    GpSavedSignature(
                                        id = "sig_${System.nanoTime()}",
                                        label = typedText.trim(),
                                        isParaf = isParaf,
                                        imageBytes = png,
                                        colorValue = inkColor,
                                        viewBoxW = bmp.width.toDouble(),
                                        viewBoxH = bmp.height.toDouble(),
                                        createdAtMs = System.currentTimeMillis(),
                                    ),
                                )
                            },
                            enabled = typedText.trim().isNotEmpty(),
                            modifier = Modifier.weight(1f).height(GpComponents.primaryTouchTarget),
                        ) {
                            Text(strings.t("action.save"))
                        }
                        Button(
                            onClick = {
                                val bmp = previewBmp ?: return@Button
                                val png = bitmapToPngBytes(bmp)
                                val aspect = bmp.height.toFloat() / bmp.width.coerceAtLeast(1).toFloat()
                                val targetW = if (isParaf) 110f else 185f
                                onPlaceGhost(
                                    GpGhostSignature(
                                        label = typedText.trim(),
                                        strokes = emptyList(),
                                        centerPdf = activePageCenter,
                                        sizePdfW = targetW,
                                        sizePdfH = (targetW * aspect).coerceIn(30f, 120f),
                                        isParaf = isParaf,
                                        realisticInk = false,
                                        colorValue = inkColor,
                                        imageBytes = png,
                                        viewBoxW = bmp.width.toFloat(),
                                        viewBoxH = bmp.height.toFloat(),
                                        signatureId = "typed_${System.nanoTime()}",
                                    ),
                                )
                            },
                            enabled = typedText.trim().isNotEmpty(),
                            colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                            modifier = Modifier.weight(1.4f).height(GpComponents.primaryTouchTarget),
                        ) {
                            Text(strings.t("mobile.placeGhost"))
                        }
                    }
                }

                // TAB 2: UPLOAD IMAGE SIGNATURE
                2 -> {
                    val processedBytes = remember(uploadedImageBytes, removePaperBg) {
                        uploadedImageBytes?.let { bytes ->
                            if (removePaperBg) stripPaperBackgroundPng(bytes) else bytes
                        }
                    }
                    val uploadBmp = remember(processedBytes) {
                        processedBytes?.let { b -> BitmapFactory.decodeByteArray(b, 0, b.size) }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = strings.t("mobile.sig.removeBg"),
                            style = GpTypography.body,
                            color = palette.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(checked = removePaperBg, onCheckedChange = { removePaperBg = it })
                    }
                    Spacer(Modifier.height(8.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = onPickUploadImage,
                            modifier = Modifier.weight(1f).height(GpComponents.primaryTouchTarget),
                        ) {
                            Icon(GpIcons.ImageAdd, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(strings.t("mobile.sig.upload"))
                        }
                        if (uploadedImageBytes != null) {
                            OutlinedButton(
                                onClick = onClearUploadedImage,
                                modifier = Modifier.height(GpComponents.primaryTouchTarget),
                            ) {
                                Text(strings.t("action.delete"), color = palette.danger)
                            }
                        }
                    }

                    if (uploadBmp != null) {
                        Spacer(Modifier.height(10.dp))
                        Surface(
                            color = palette.surfaceOverlay,
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(1.dp, palette.border),
                            modifier = Modifier.fillMaxWidth().height(130.dp),
                        ) {
                            Image(
                                bitmap = uploadBmp.asImageBitmap(),
                                contentDescription = null,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier.fillMaxSize().padding(10.dp),
                            )
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(
                                onClick = {
                                    val png = processedBytes ?: return@OutlinedButton
                                    onSaveToVault(
                                        GpSavedSignature(
                                            id = "sig_${System.nanoTime()}",
                                            label = if (isParaf) strings.t("mobile.sig.parafTab") else strings.t("mobile.sig.upload"),
                                            isParaf = isParaf,
                                            imageBytes = png,
                                            viewBoxW = uploadBmp.width.toDouble(),
                                            viewBoxH = uploadBmp.height.toDouble(),
                                            createdAtMs = System.currentTimeMillis(),
                                        ),
                                    )
                                },
                                modifier = Modifier.weight(1f).height(GpComponents.primaryTouchTarget),
                            ) {
                                Text(strings.t("action.save"))
                            }
                            Button(
                                onClick = {
                                    val png = processedBytes ?: return@Button
                                    val aspect = uploadBmp.height.toFloat() / uploadBmp.width.coerceAtLeast(1).toFloat()
                                    val targetW = if (isParaf) 110f else 185f
                                    onPlaceGhost(
                                        GpGhostSignature(
                                            label = strings.t("mobile.sig.signatureTab"),
                                            strokes = emptyList(),
                                            centerPdf = activePageCenter,
                                            sizePdfW = targetW,
                                            sizePdfH = (targetW * aspect).coerceIn(36f, 160f),
                                            isParaf = isParaf,
                                            realisticInk = false,
                                            imageBytes = png,
                                            viewBoxW = uploadBmp.width.toFloat(),
                                            viewBoxH = uploadBmp.height.toFloat(),
                                            signatureId = "upload_${System.nanoTime()}",
                                        ),
                                    )
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                                modifier = Modifier.weight(1.4f).height(GpComponents.primaryTouchTarget),
                            ) {
                                Text(strings.t("mobile.placeGhost"))
                            }
                        }
                    }
                }

                // TAB 3: SAVED SIGNATURE VAULT
                else -> {
                    if (state.savedSignatures.isEmpty()) {
                        Surface(
                            color = palette.surfaceOverlay,
                            shape = RoundedCornerShape(12.dp),
                            border = BorderStroke(1.dp, palette.borderSubtle),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(
                                text = if (strings.isTr) "Henüz kayıtlı imza yok. Çiz veya Yaz sekmesinden kaydedin." else "No saved signatures yet. Save one from Draw or Type.",
                                style = GpTypography.body,
                                color = palette.textSecondary,
                                modifier = Modifier.padding(GpSpacing.s4),
                            )
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (saved in state.savedSignatures) {
                                val savedBmp = remember(saved.id) {
                                    saved.imageBytes?.let { b -> BitmapFactory.decodeByteArray(b, 0, b.size) }
                                }
                                Surface(
                                    color = palette.surfaceOverlay,
                                    shape = RoundedCornerShape(12.dp),
                                    border = BorderStroke(1.dp, palette.borderSubtle),
                                    modifier = Modifier.fillMaxWidth().clickable {
                                        val vbW = saved.viewBoxW.toFloat().coerceAtLeast(100f)
                                        val vbH = saved.viewBoxH.toFloat().coerceAtLeast(40f)
                                        val targetW = if (saved.isParaf) 110f else 185f
                                        onPlaceGhost(
                                            GpGhostSignature(
                                                label = saved.label,
                                                strokes = saved.strokes,
                                                centerPdf = activePageCenter,
                                                sizePdfW = targetW,
                                                sizePdfH = (targetW * (vbH / vbW)).coerceIn(32f, 160f),
                                                isParaf = saved.isParaf,
                                                realisticInk = saved.realisticInk,
                                                colorValue = saved.colorValue,
                                                svgPaths = saved.svgPaths,
                                                imageBytes = saved.imageBytes,
                                                viewBoxW = vbW,
                                                viewBoxH = vbH,
                                                signatureId = saved.id,
                                            ),
                                        )
                                    },
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Surface(
                                            color = Color.White,
                                            shape = RoundedCornerShape(8.dp),
                                            border = BorderStroke(1.dp, palette.borderSubtle),
                                            modifier = Modifier.width(108.dp).height(54.dp),
                                        ) {
                                            if (savedBmp != null) {
                                                Image(
                                                    bitmap = savedBmp.asImageBitmap(),
                                                    contentDescription = saved.label,
                                                    contentScale = ContentScale.Fit,
                                                    modifier = Modifier.fillMaxSize().padding(4.dp),
                                                )
                                            } else {
                                                ComposeCanvas(modifier = Modifier.fillMaxSize().padding(4.dp)) {
                                                    val vbW = saved.viewBoxW.toFloat().coerceAtLeast(100f)
                                                    val vbH = saved.viewBoxH.toFloat().coerceAtLeast(40f)
                                                    val sx = size.width / vbW
                                                    val sy = size.height / vbH
                                                    val col = Color(saved.colorValue)
                                                    for (st in saved.strokes) {
                                                        if (st.size < 2) continue
                                                        val p = Path().apply {
                                                            moveTo(st.first().x * sx, st.first().y * sy)
                                                            for (i in 1 until st.size) {
                                                                lineTo(st[i].x * sx, st[i].y * sy)
                                                            }
                                                        }
                                                        drawPath(p, color = col, style = Stroke(width = 2.5f, cap = StrokeCap.Round))
                                                    }
                                                }
                                            }
                                        }
                                        Spacer(Modifier.width(12.dp))
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(saved.label, style = GpTypography.label, color = palette.textPrimary)
                                            Text(
                                                text = if (saved.isParaf) strings.t("mobile.sig.parafTab") else strings.t("mobile.sig.signatureTab"),
                                                style = GpTypography.caption,
                                                color = palette.textSecondary,
                                            )
                                        }
                                        IconButton(onClick = { onDeleteFromVault(saved.id) }) {
                                            Icon(GpIcons.Delete, contentDescription = strings.t("action.delete"), tint = palette.danger, modifier = Modifier.size(20.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(GpSpacing.s4))
        }
    }
}

private data class BuiltDrawnSignature(
    val strokes: List<List<GpPoint>>,
    val svgPaths: List<GpSignatureSvgPath>,
    /** Photocopy-look raster for "original looking" ink (vector paths are then left empty). */
    val imageBytes: ByteArray? = null,
)

private fun buildDrawnSignatureData(
    timedStrokes: List<List<TimedStrokePoint>>,
    padW: Float,
    padH: Float,
    viewBoxW: Float,
    viewBoxH: Float,
    inkColor: Int,
    realisticInk: Boolean,
): BuiltDrawnSignature {
    val hex = String.format(Locale.US, "#%06x", inkColor and 0xFFFFFF)
    val sx = viewBoxW / padW.coerceAtLeast(1f)
    val sy = viewBoxH / padH.coerceAtLeast(1f)

    val normStrokes = timedStrokes.filter { it.size >= 2 }.map { stroke ->
        stroke.map { GpPoint(it.x * sx, it.y * sy) }
    }

    if (realisticInk) {
        val png = PhotocopyInk.renderPng(
            timedStrokes.filter { it.size >= 2 }.map { s -> s.map { InkSample(it.x, it.y, it.tMs) } },
            padW,
            padH,
            viewBoxW,
            viewBoxH,
            inkColor,
        )
        if (png != null) {
            return BuiltDrawnSignature(strokes = normStrokes, svgPaths = emptyList(), imageBytes = png)
        }
    }

    val svgPaths = buildList {
        for (stroke in timedStrokes) {
            if (stroke.size < 2) continue
            val nPts = stroke.map { GpPoint(it.x * sx, it.y * sy) }
            val d = buildString {
                append(String.format(Locale.US, "M %.1f %.1f", nPts.first().x, nPts.first().y))
                for (i in 1 until nPts.size) {
                    val prev = nPts[i - 1]
                    val cur = nPts[i]
                    val mx = (prev.x + cur.x) * 0.5f
                    val my = (prev.y + cur.y) * 0.5f
                    append(String.format(Locale.US, " Q %.1f %.1f %.1f %.1f", prev.x, prev.y, mx, my))
                }
                append(String.format(Locale.US, " L %.1f %.1f", nPts.last().x, nPts.last().y))
            }
            add(GpSignatureSvgPath(d = d, fill = "none", stroke = hex, strokeWidth = 2.4))
        }
    }

    return BuiltDrawnSignature(strokes = normStrokes, svgPaths = svgPaths)
}

private fun ribbonPointsToComposePath(ribbon: List<GpPoint>, scaleX: Float, scaleY: Float): Path {
    return Path().apply {
        moveTo(ribbon.first().x * scaleX, ribbon.first().y * scaleY)
        for (i in 1 until ribbon.size) {
            lineTo(ribbon[i].x * scaleX, ribbon[i].y * scaleY)
        }
        close()
    }
}

private fun renderTypedSignatureBitmap(text: String, style: TypeSigStyle, inkColor: Int): Bitmap {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = inkColor
        textSize = 92f
        typeface = when (style) {
            TypeSigStyle.CALLIGRAPHY -> Typeface.create(Typeface.SERIF, Typeface.BOLD_ITALIC)
            TypeSigStyle.SCRIPT -> Typeface.create(Typeface.SERIF, Typeface.ITALIC)
            TypeSigStyle.BOLD_SANS -> Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            TypeSigStyle.MONO -> Typeface.create(Typeface.MONOSPACE, Typeface.ITALIC)
        }
    }
    val textW = paint.measureText(text).toInt().coerceIn(80, 1200) + 48
    val fm = paint.fontMetrics
    val textH = (fm.descent - fm.ascent + 32f).toInt().coerceIn(80, 320)
    val bmp = Bitmap.createBitmap(textW, textH, Bitmap.Config.ARGB_8888)
    val c = Canvas(bmp)
    c.drawText(text, 24f, -fm.ascent + 16f, paint)
    return bmp
}

private fun bitmapToPngBytes(bmp: Bitmap): ByteArray {
    val out = ByteArrayOutputStream()
    bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
    return out.toByteArray()
}
