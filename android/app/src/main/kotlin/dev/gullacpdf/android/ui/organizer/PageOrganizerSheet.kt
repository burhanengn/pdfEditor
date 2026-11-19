package dev.gullacpdf.android.ui.organizer

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.gullacpdf.android.engine.TileBitmapCache
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpPageNumberingConfig
import dev.gullacpdf.android.model.formatPageNumberText
import dev.gullacpdf.android.theme.GpComponents
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpColorPickerRow
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.ui.viewer.PageThumbnailPreview
import dev.gullacpdf.android.viewmodel.GpAppState
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PageOrganizerSheet(
    state: GpAppState,
    strings: GpStrings,
    tileCache: TileBitmapCache,
    onJumpToPage: (Int) -> Unit,
    onAddBlankPageAfter: (Int) -> Unit,
    onMergeExternalPdf: () -> Unit,
    onOpenPageNumbering: () -> Unit,
    onRotatePage: (Int, Int) -> Unit,
    onMovePage: (Int, Int) -> Unit,
    onDuplicatePage: (Int) -> Unit,
    onDeletePage: (Int) -> Unit,
    onBatchRotate: (Set<Int>, Int) -> Unit,
    onBatchDelete: (Set<Int>) -> Unit,
    onSplitExtract: (Set<Int>) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var selectedIndices by remember(state.docId) { mutableStateOf(emptySet<Int>()) }
    var multiSelectMode by remember { mutableStateOf(false) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.surfaceRaised,
    ) {
        Column(modifier = Modifier.fillMaxWidth().padding(bottom = GpSpacing.s4)) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = GpSpacing.s4, vertical = GpSpacing.s1),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = strings.t("nav.pages"),
                        style = GpTypography.titleM,
                        color = palette.textPrimary,
                    )
                    Text(
                        text = "${state.pages.size} ${if (strings.isTr) "sayfa" else "pages"}",
                        style = GpTypography.caption,
                        color = palette.textSecondary,
                    )
                }
                FilterChip(
                    selected = multiSelectMode,
                    onClick = {
                        multiSelectMode = !multiSelectMode
                        if (!multiSelectMode) selectedIndices = emptySet()
                    },
                    label = {
                        Text(
                            text = if (strings.isTr) {
                                if (multiSelectMode) "Seçim (${selectedIndices.size})" else "Çoklu Seçim"
                            } else {
                                if (multiSelectMode) "Selected (${selectedIndices.size})" else "Multi-Select"
                            },
                        )
                    },
                )
            }

            // Document-level actions bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = GpSpacing.s4, vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedButton(
                    onClick = { onAddBlankPageAfter(state.activePageIndex) },
                    modifier = Modifier.height(38.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) {
                    Icon(GpIcons.NoteAdd, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(strings.t("mobile.addBlankPage"), style = GpTypography.caption)
                }
                OutlinedButton(
                    onClick = onMergeExternalPdf,
                    modifier = Modifier.height(38.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) {
                    Icon(GpIcons.FolderOpen, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(strings.t("mobile.mergePdf"), style = GpTypography.caption)
                }
                OutlinedButton(
                    onClick = onOpenPageNumbering,
                    modifier = Modifier.height(38.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) {
                    Icon(GpIcons.Tune, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(strings.t("mobile.pageNumbers"), style = GpTypography.caption)
                }
            }

            // Batch bar when pages are checked in Multi-Select mode
            if (multiSelectMode && selectedIndices.isNotEmpty()) {
                Surface(
                    color = palette.accent.copy(alpha = 0.12f),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, palette.accent.copy(alpha = 0.45f)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = GpSpacing.s4, vertical = 6.dp),
                ) {
                    Row(
                        modifier = Modifier
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TextButton(onClick = { onBatchRotate(selectedIndices, -90) }) {
                            Icon(GpIcons.RotateCcw, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("-90°")
                        }
                        TextButton(onClick = { onBatchRotate(selectedIndices, 90) }) {
                            Icon(GpIcons.RotateCw, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("+90°")
                        }
                        Button(
                            onClick = { onSplitExtract(selectedIndices) },
                            colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                            modifier = Modifier.height(34.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp),
                        ) {
                            Text(strings.t("mobile.splitPdf"), style = GpTypography.caption)
                        }
                        if (state.pages.size - selectedIndices.size >= 1) {
                            TextButton(onClick = {
                                val toRemove = selectedIndices
                                selectedIndices = emptySet()
                                onBatchDelete(toRemove)
                            }) {
                                Text(strings.t("action.delete"), color = palette.danger)
                            }
                        }
                    }
                }
            }

            HorizontalDivider(color = palette.borderSubtle, modifier = Modifier.padding(top = 4.dp))

            LazyVerticalGrid(
                columns = GridCells.Adaptive(148.dp),
                contentPadding = PaddingValues(GpSpacing.s4),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 260.dp, max = 520.dp),
            ) {
                itemsIndexed(state.pages, key = { idx, p -> "${p.id}_$idx" }) { idx, page ->
                    val isActive = idx == state.activePageIndex
                    val isChecked = selectedIndices.contains(idx)

                    Surface(
                        color = palette.surfaceOverlay,
                        shape = RoundedCornerShape(12.dp),
                        border = BorderStroke(
                            width = if (isChecked || isActive) 2.dp else 1.dp,
                            color = when {
                                isChecked -> palette.accent
                                isActive -> palette.accent.copy(alpha = 0.65f)
                                else -> palette.borderSubtle
                            },
                        ),
                    ) {
                        Column(modifier = Modifier.padding(8.dp)) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(0.76f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .clickable {
                                        if (multiSelectMode) {
                                            selectedIndices = if (isChecked) selectedIndices - idx else selectedIndices + idx
                                        } else {
                                            onJumpToPage(idx)
                                            onDismiss()
                                        }
                                    },
                            ) {
                                PageThumbnailPreview(
                                    page = page,
                                    themeName = state.theme.engineKey,
                                    darkPaperInvert = state.darkPaperInvert,
                                    tileCache = tileCache,
                                    modifier = Modifier.matchParentSize(),
                                )
                                Surface(
                                    color = if (isActive) palette.accent else Color(0xCC0F172A),
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.align(Alignment.BottomStart).padding(6.dp),
                                ) {
                                    Text(
                                        text = "${idx + 1}",
                                        style = GpTypography.caption.copy(fontWeight = FontWeight.SemiBold),
                                        color = Color.White,
                                        modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                                    )
                                }
                                if (multiSelectMode) {
                                    Box(
                                        modifier = Modifier
                                            .align(Alignment.TopEnd)
                                            .padding(6.dp)
                                            .size(22.dp)
                                            .clip(CircleShape)
                                            .background(if (isChecked) palette.accent else Color(0x99000000))
                                            .border(1.5.dp, Color.White, CircleShape),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        if (isChecked) {
                                            Icon(GpIcons.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
                                        }
                                    }
                                }
                            }

                            Spacer(Modifier.height(6.dp))

                            // Row 1: Reorder + Rotate
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                IconButton(
                                    onClick = { if (idx > 0) onMovePage(idx, idx - 1) },
                                    enabled = idx > 0,
                                    modifier = Modifier.size(32.dp),
                                ) {
                                    Icon(GpIcons.ChevronLeft, contentDescription = null, tint = if (idx > 0) palette.textPrimary else palette.textDisabled, modifier = Modifier.size(18.dp))
                                }
                                IconButton(
                                    onClick = { onRotatePage(idx, -90) },
                                    modifier = Modifier.size(32.dp),
                                ) {
                                    Icon(GpIcons.RotateCcw, contentDescription = "-90", tint = palette.textPrimary, modifier = Modifier.size(16.dp))
                                }
                                IconButton(
                                    onClick = { onRotatePage(idx, 90) },
                                    modifier = Modifier.size(32.dp),
                                ) {
                                    Icon(GpIcons.RotateCw, contentDescription = "+90", tint = palette.textPrimary, modifier = Modifier.size(16.dp))
                                }
                                IconButton(
                                    onClick = { if (idx < state.pages.lastIndex) onMovePage(idx, idx + 1) },
                                    enabled = idx < state.pages.lastIndex,
                                    modifier = Modifier.size(32.dp),
                                ) {
                                    Icon(GpIcons.ChevronRight, contentDescription = null, tint = if (idx < state.pages.lastIndex) palette.textPrimary else palette.textDisabled, modifier = Modifier.size(18.dp))
                                }
                            }

                            // Row 2: Duplicate / Split single / Delete
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceEvenly,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                IconButton(
                                    onClick = { onDuplicatePage(idx) },
                                    modifier = Modifier.size(32.dp),
                                ) {
                                    Icon(GpIcons.Copy, contentDescription = strings.t("mobile.duplicate"), tint = palette.textPrimary, modifier = Modifier.size(16.dp))
                                }
                                TextButton(
                                    onClick = { onSplitExtract(setOf(idx)) },
                                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp),
                                    modifier = Modifier.height(30.dp),
                                ) {
                                    Text(
                                        text = strings.t("mobile.splitPdf"),
                                        style = GpTypography.caption,
                                        color = palette.accent,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                IconButton(
                                    onClick = { onDeletePage(idx) },
                                    enabled = state.pages.size > 1,
                                    modifier = Modifier.size(32.dp),
                                ) {
                                    Icon(
                                        imageVector = GpIcons.Delete,
                                        contentDescription = strings.t("action.delete"),
                                        tint = if (state.pages.size > 1) palette.danger else palette.textDisabled,
                                        modifier = Modifier.size(16.dp),
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PageNumberingSheet(
    config: GpPageNumberingConfig,
    totalPages: Int,
    strings: GpStrings,
    onUpdate: (GpPageNumberingConfig) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var draft by remember(config) { mutableStateOf(config) }

    val positions = listOf(
        "top-left" to (if (strings.isTr) "Üst Sol" else "Top Left"),
        "top-center" to (if (strings.isTr) "Üst Orta" else "Top Center"),
        "top-right" to (if (strings.isTr) "Üst Sağ" else "Top Right"),
        "bottom-left" to (if (strings.isTr) "Alt Sol" else "Bottom Left"),
        "bottom-center" to (if (strings.isTr) "Alt Orta" else "Bottom Center"),
        "bottom-right" to (if (strings.isTr) "Alt Sağ" else "Bottom Right"),
    )

    val formats = listOf(
        "number" to "1",
        "number-of-total" to "1 / $totalPages",
        "page-number" to (if (strings.isTr) "Sayfa 1" else "Page 1"),
        "page-number-of-total" to (if (strings.isTr) "Sayfa 1 / $totalPages" else "Page 1 / $totalPages"),
        "roman-lower" to "i",
        "roman-upper" to "I",
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = palette.surfaceRaised,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = GpSpacing.s4, vertical = GpSpacing.s2),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = strings.t("mobile.pageNumbers"),
                    style = GpTypography.titleM,
                    color = palette.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                Switch(
                    checked = draft.enabled,
                    onCheckedChange = { draft = draft.copy(enabled = it) },
                )
            }

            if (draft.enabled) {
                Spacer(Modifier.height(8.dp))
                Surface(
                    color = palette.surfaceOverlay,
                    shape = RoundedCornerShape(10.dp),
                    border = BorderStroke(1.dp, palette.borderSubtle),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "${if (strings.isTr) "Önizleme:" else "Preview:"}  ${formatPageNumberText(draft, draft.startFromPage, totalPages)}",
                        style = GpTypography.label,
                        color = palette.accent,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }

                Spacer(Modifier.height(12.dp))
                Text(if (strings.isTr) "Konum" else "Position", style = GpTypography.caption, color = palette.textSecondary)
                Spacer(Modifier.height(4.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    for ((id, label) in positions) {
                        FilterChip(
                            selected = draft.position == id,
                            onClick = { draft = draft.copy(position = id) },
                            label = { Text(label) },
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))
                Text(if (strings.isTr) "Biçim" else "Format", style = GpTypography.caption, color = palette.textSecondary)
                Spacer(Modifier.height(4.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    for ((id, label) in formats) {
                        FilterChip(
                            selected = draft.format == id,
                            onClick = { draft = draft.copy(format = id) },
                            label = { Text(label) },
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))
                Text("${if (strings.isTr) "Yazı Boyutu" else "Font Size"}: ${draft.fontSize.roundToInt()} pt", style = GpTypography.caption, color = palette.textSecondary)
                Slider(
                    value = draft.fontSize.toFloat().coerceIn(7f, 24f),
                    onValueChange = { draft = draft.copy(fontSize = it.toDouble()) },
                    valueRange = 7f..24f,
                )

                val maxPage = totalPages.coerceAtLeast(1)
                if (maxPage > 1) {
                    Text("${if (strings.isTr) "Başlangıç Sayfası" else "Start From Page"}: ${draft.startFromPage}", style = GpTypography.caption, color = palette.textSecondary)
                    Slider(
                        value = draft.startFromPage.toFloat().coerceIn(1f, maxPage.toFloat()),
                        onValueChange = { draft = draft.copy(startFromPage = it.roundToInt().coerceIn(1, maxPage)) },
                        valueRange = 1f..maxPage.toFloat(),
                    )
                }

                Text("${if (strings.isTr) "İlk Numara" else "Start Number"}: ${draft.startNumber}", style = GpTypography.caption, color = palette.textSecondary)
                Slider(
                    value = draft.startNumber.toFloat().coerceIn(1f, 100f),
                    onValueChange = { draft = draft.copy(startNumber = it.roundToInt().coerceAtLeast(1)) },
                    valueRange = 1f..100f,
                )

                GpColorPickerRow(
                    label = strings.t("mobile.textColor"),
                    selectedColor = draft.colorValue,
                    allowTransparent = false,
                    strings = strings,
                    onSelectColor = { draft = draft.copy(colorValue = it) },
                )
            }

            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onDismiss,
                    modifier = Modifier.weight(1f).height(GpComponents.primaryTouchTarget),
                ) {
                    Text(strings.t("action.cancel"))
                }
                Button(
                    onClick = {
                        onUpdate(draft)
                        onDismiss()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                    modifier = Modifier.weight(1f).height(GpComponents.primaryTouchTarget),
                ) {
                    Text(strings.t("action.apply"))
                }
            }
            Spacer(Modifier.height(GpSpacing.s4))
        }
    }
}
