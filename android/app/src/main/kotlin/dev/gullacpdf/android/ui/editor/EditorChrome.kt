package dev.gullacpdf.android.ui.editor

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RangeSlider
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.zIndex
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpEditorTool
import dev.gullacpdf.android.model.GpExtractedFontInfo
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpRectF
import dev.gullacpdf.android.model.RichTextOps
import dev.gullacpdf.android.theme.GpComponents
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpColorPickerRow
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.viewmodel.GpAppState
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

@Composable
fun EditorTopBar(
    state: GpAppState,
    strings: GpStrings,
    isTabletOrWide: Boolean,
    onDoneToViewer: () -> Unit,
    onUndo: () -> Unit,
    onRedo: () -> Unit,
    onDeleteSelected: () -> Unit,
    onSave: () -> Unit,
    onShare: () -> Unit = {},
    onPrint: () -> Unit = {},
    onOpenWith: () -> Unit = {},
) {
    val palette = LocalGpPalette.current
    var menuOpen by remember { mutableStateOf(false) }

    Surface(
        color = palette.surfaceRaised,
        shadowElevation = 4.dp,
        modifier = Modifier.fillMaxWidth().zIndex(10f),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .statusBarsPadding()
                    .height(if (isTabletOrWide) 56.dp else 52.dp)
                    .padding(horizontal = GpSpacing.s2),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button(
                    onClick = onDoneToViewer,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = palette.accent,
                        contentColor = palette.accentForeground,
                    ),
                    shape = RoundedCornerShape(12.dp),
                    contentPadding = PaddingValues(start = 10.dp, end = 14.dp),
                    modifier = Modifier.height(38.dp),
                ) {
                    Icon(GpIcons.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(strings.t("action.done"), style = GpTypography.label)
                }
                Spacer(Modifier.width(GpSpacing.s2))
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = state.displayName,
                        style = GpTypography.label,
                        color = palette.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (state.dirty) {
                        Spacer(Modifier.width(6.dp))
                        if (isTabletOrWide) {
                            Surface(
                                color = palette.warning.copy(alpha = 0.2f),
                                shape = RoundedCornerShape(10.dp),
                            ) {
                                Text(
                                    text = strings.t("session.unsavedBadge"),
                                    style = GpTypography.caption,
                                    color = palette.warning,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        } else {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(palette.warning),
                            )
                        }
                    }
                }
                IconButton(onClick = onUndo, enabled = state.canUndo) {
                    Icon(
                        GpIcons.Undo,
                        contentDescription = strings.t("action.undo"),
                        tint = if (state.canUndo) palette.textPrimary else palette.textDisabled,
                    )
                }
                IconButton(onClick = onRedo, enabled = state.canRedo) {
                    Icon(
                        GpIcons.Redo,
                        contentDescription = strings.t("action.redo"),
                        tint = if (state.canRedo) palette.textPrimary else palette.textDisabled,
                    )
                }
                if (state.selectedElementId != null || state.selectedElementIds.isNotEmpty()) {
                    IconButton(onClick = onDeleteSelected) {
                        Icon(GpIcons.Delete, contentDescription = strings.t("action.delete"), tint = palette.danger)
                    }
                }
                IconButton(onClick = onSave) {
                    Icon(GpIcons.Save, contentDescription = strings.t("action.save"), tint = palette.accent)
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(GpIcons.MoreVert, contentDescription = strings.t("action.more"), tint = palette.textPrimary)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(strings.t("action.save")) },
                            leadingIcon = { Icon(GpIcons.Save, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onSave() },
                        )
                        DropdownMenuItem(
                            text = { Text(strings.t("action.share")) },
                            leadingIcon = { Icon(GpIcons.Share, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onShare() },
                        )
                        DropdownMenuItem(
                            text = { Text(strings.t("action.print")) },
                            leadingIcon = { Icon(GpIcons.Print, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onPrint() },
                        )
                        DropdownMenuItem(
                            text = { Text(strings.t("action.openWith")) },
                            leadingIcon = { Icon(GpIcons.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onOpenWith() },
                        )
                    }
                }
            }
            HorizontalDivider(color = palette.borderSubtle, thickness = 1.dp)
        }
    }
}

@Composable
fun EditorToolDock(
    activeTool: GpEditorTool,
    toolLocked: Boolean,
    strings: GpStrings,
    onSelectTool: (GpEditorTool) -> Unit,
    onToggleToolLock: () -> Unit,
    onOpenSignatureStudio: () -> Unit,
    onInsertImage: () -> Unit,
    onOpenOrganizeSheet: () -> Unit,
    marqueeSelectMode: Boolean = false,
    onToggleMarqueeSelect: () -> Unit = {},
) {
    val palette = LocalGpPalette.current

    Surface(
        color = palette.surfaceRaised,
        shadowElevation = 6.dp,
        modifier = Modifier.fillMaxWidth().zIndex(8f),
    ) {
        Column(modifier = Modifier.navigationBarsPadding()) {
            HorizontalDivider(color = palette.borderSubtle, thickness = 1.dp)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = GpSpacing.s2, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                ToolDockItem(GpIcons.SelectArrow, strings.t("mobile.tool.select"), activeTool == GpEditorTool.SELECT && !marqueeSelectMode) {
                    onSelectTool(GpEditorTool.SELECT)
                }
                ToolDockItem(GpIcons.BoxSelect, strings.t("mobile.boxSelect"), activeTool == GpEditorTool.SELECT && marqueeSelectMode) {
                    onToggleMarqueeSelect()
                }
                ToolDockDivider()
                ToolDockItem(GpIcons.TextTool, strings.t("mobile.tool.text"), activeTool == GpEditorTool.TEXT) {
                    onSelectTool(GpEditorTool.TEXT)
                }
                ToolDockItem(GpIcons.DrawPen, strings.t("mobile.tool.draw"), activeTool == GpEditorTool.DRAW) {
                    onSelectTool(GpEditorTool.DRAW)
                }
                ToolDockItem(GpIcons.Highlight, strings.t("mobile.tool.highlight"), activeTool == GpEditorTool.HIGHLIGHT) {
                    onSelectTool(GpEditorTool.HIGHLIGHT)
                }
                ToolDockItem(GpIcons.Eraser, strings.t("mobile.tool.eraser"), activeTool == GpEditorTool.ERASER) {
                    onSelectTool(GpEditorTool.ERASER)
                }
                ToolDockItem(GpIcons.ShapeRect, strings.t("mobile.tool.shape"), activeTool == GpEditorTool.SHAPE) {
                    onSelectTool(GpEditorTool.SHAPE)
                }
                ToolDockItem(GpIcons.LineTool, strings.t("mobile.tool.line"), activeTool == GpEditorTool.LINE) {
                    onSelectTool(GpEditorTool.LINE)
                }
                ToolDockDivider()
                ToolDockItem(GpIcons.Signature, strings.t("mobile.tool.signature"), activeTool == GpEditorTool.SIGNATURE) {
                    onOpenSignatureStudio()
                }
                ToolDockItem(GpIcons.ImageAdd, strings.t("mobile.tool.image"), activeTool == GpEditorTool.IMAGE) {
                    onInsertImage()
                }
                ToolDockItem(GpIcons.Redact, strings.t("mobile.tool.redact"), activeTool == GpEditorTool.REDACT) {
                    onSelectTool(GpEditorTool.REDACT)
                }
                ToolDockDivider()
                ToolDockItem(GpIcons.Pages, strings.t("nav.pages"), false) {
                    onOpenOrganizeSheet()
                }

                // Tool-Lock toggle (keeps the active drawing/shape tool after each use)
                ToolDockItem(
                    if (toolLocked) GpIcons.Lock else GpIcons.LockOpen,
                    strings.t("mobile.toolLock"),
                    toolLocked,
                ) { onToggleToolLock() }
            }
        }
    }
}

@Composable
private fun ToolDockItem(
    icon: ImageVector,
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val palette = LocalGpPalette.current
    val pillColor by androidx.compose.animation.animateColorAsState(
        targetValue = if (selected) palette.accent.copy(alpha = 0.20f) else Color.Transparent,
        label = "toolPill",
    )
    val tint by androidx.compose.animation.animateColorAsState(
        targetValue = if (selected) palette.accent else palette.textPrimary,
        label = "toolTint",
    )
    Column(
        modifier = Modifier
            .width(62.dp)
            .heightIn(min = GpComponents.primaryTouchTarget)
            .clip(RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(width = 50.dp, height = 30.dp)
                .clip(RoundedCornerShape(15.dp))
                .background(pillColor),
        ) {
            Icon(imageVector = icon, contentDescription = label, tint = tint, modifier = Modifier.size(21.dp))
        }
        Spacer(Modifier.height(3.dp))
        Text(
            text = label,
            style = GpTypography.caption.copy(fontSize = 11.sp),
            color = if (selected) palette.accent else palette.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ToolDockDivider() {
    Box(
        modifier = Modifier
            .padding(horizontal = 4.dp)
            .width(1.dp)
            .height(30.dp)
            .background(LocalGpPalette.current.borderSubtle),
    )
}

@Composable
fun ShapeVariantStrip(
    activeShapeType: String,
    activeStrokeColor: Int,
    activeFillColor: Int,
    strings: GpStrings,
    onSelectShape: (String) -> Unit,
    onSelectStrokeColor: (Int) -> Unit,
    onSelectFillColor: (Int) -> Unit,
) {
    val palette = LocalGpPalette.current
    val shapes = listOf(
        "rect" to GpIcons.ShapeRect,
        "ellipse" to GpIcons.ShapeEllipse,
        "triangle" to GpIcons.ShapeTriangle,
        "diamond" to GpIcons.ShapeDiamond,
        "arrow" to GpIcons.ShapeArrow,
    )

    Surface(
        color = palette.surfaceOverlay.copy(alpha = 0.96f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, palette.border),
        shadowElevation = 4.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = GpSpacing.s3, vertical = 6.dp),
    ) {
        Column(modifier = Modifier.padding(horizontal = GpSpacing.s3, vertical = 8.dp)) {
            Row(
                modifier = Modifier.horizontalScroll(rememberScrollState()),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                for ((type, icon) in shapes) {
                    val sel = activeShapeType == type
                    Surface(
                        color = if (sel) palette.accent.copy(alpha = 0.2f) else Color.Transparent,
                        shape = RoundedCornerShape(8.dp),
                        border = if (sel) BorderStroke(1.dp, palette.accent) else null,
                        modifier = Modifier.size(38.dp).clickable { onSelectShape(type) },
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(icon, contentDescription = type, tint = if (sel) palette.accent else palette.textPrimary, modifier = Modifier.size(20.dp))
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                for (c in listOf(0xFF2563EB.toInt(), 0xFFDC2626.toInt(), 0xFF15803D.toInt(), 0xFF0F172A.toInt())) {
                    Box(
                        modifier = Modifier
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(Color(c))
                            .border(if (activeStrokeColor == c) 2.5.dp else 1.dp, if (activeStrokeColor == c) palette.accent else palette.border, CircleShape)
                            .clickable { onSelectStrokeColor(c) },
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            GpColorPickerRow(
                label = strings.t("mobile.fillColor"),
                selectedColor = activeFillColor,
                allowTransparent = true,
                strings = strings,
                onSelectColor = onSelectFillColor,
            )
        }
    }
}

@Composable
fun PolylineChainingBar(
    state: GpAppState,
    strings: GpStrings,
    onUndoVertex: () -> Unit,
    onFinish: () -> Unit,
) {
    val palette = LocalGpPalette.current
    val activePoly = state.activePolylineId?.let { id -> state.elements.firstOrNull { it.id == id && !it.deleted } }
    val ptCount = activePoly?.points?.size ?: if (state.pendingPolylineAnchor != null) 1 else 0

    Surface(
        color = palette.surfaceOverlay.copy(alpha = 0.96f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, palette.accent),
        shadowElevation = 6.dp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = GpSpacing.s3, vertical = 6.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (ptCount > 0) "${strings.t("mobile.tool.line")} • $ptCount pt" else strings.t("mobile.tool.line"),
                    style = GpTypography.label,
                    color = palette.textPrimary,
                )
                Text(
                    text = strings.t("mobile.polylineHint"),
                    style = GpTypography.caption,
                    color = palette.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (ptCount > 0) {
                TextButton(onClick = onUndoVertex) {
                    Text(strings.t("action.undo"))
                }
                Button(
                    onClick = onFinish,
                    colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                    modifier = Modifier.height(36.dp),
                ) {
                    Text(strings.t("mobile.polylineFinish"), style = GpTypography.caption)
                }
            }
        }
    }
}

/**
 * MANDATORY FIX #6: Collapsible Bottom Text Panel.
 * Hidden/collapsed by default showing ONLY a compact upward-pointing arrow (`^`) pill;
 * expands into full Text Input + Text Color + Background Color + Style drawer ONLY when tapped.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CollapsibleBottomTextPanel(
    element: GpOverlayElement,
    expanded: Boolean,
    strings: GpStrings,
    onToggleExpanded: (Boolean) -> Unit,
    onUpdate: (GpOverlayElement, Boolean) -> Unit,
    onOpenFullInspector: () -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    customTtfBytes: ByteArray? = null,
    customFontLabel: String? = null,
    extractedFonts: List<GpExtractedFontInfo> = emptyList(),
    onPickCustomFont: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val palette = LocalGpPalette.current
    var tfv by remember(element.id) {
        mutableStateOf(TextFieldValue(element.text, TextRange(element.text.length)))
    }
    if (tfv.text != element.text) {
        val clampedStart = tfv.selection.start.coerceIn(0, element.text.length)
        val clampedEnd = tfv.selection.end.coerceIn(0, element.text.length)
        tfv = TextFieldValue(element.text, TextRange(clampedStart, clampedEnd))
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .imePadding()
            .padding(horizontal = GpSpacing.s3, vertical = 6.dp)
            .animateContentSize(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        AnimatedContent(targetState = expanded, label = "text_panel_collapse") { isExpanded ->
            if (!isExpanded) {
                // DEFAULT COLLAPSED STATE: Compact upward-pointing arrow (`^`) pill + subtle font warning dot if any
                Surface(
                    color = palette.surfaceOverlay.copy(alpha = 0.96f),
                    shape = RoundedCornerShape(22.dp),
                    border = BorderStroke(
                        1.dp,
                        if (element.fontWarning != null) palette.warning else palette.accent,
                    ),
                    shadowElevation = 6.dp,
                    modifier = Modifier.clickable { onToggleExpanded(true) },
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            imageVector = GpIcons.ChevronUp,
                            contentDescription = strings.t("mobile.tool.text"),
                            tint = palette.accent,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(
                            text = strings.t("mobile.tool.text"),
                            style = GpTypography.caption.copy(fontWeight = FontWeight.SemiBold),
                            color = palette.textPrimary,
                        )
                        if (element.fontWarning != null) {
                            Spacer(Modifier.width(6.dp))
                            Icon(
                                imageVector = GpIcons.Warning,
                                contentDescription = null,
                                tint = palette.warning,
                                modifier = Modifier.size(14.dp),
                            )
                        }
                    }
                }
            } else {
                // EXPANDED COMPREHENSIVE QUICK TEXT PANEL (First screen has Alignment, B/I/U/S/Sub/Sup, Size, Font, Colors, Spacing)
                Surface(
                    color = palette.surfaceOverlay.copy(alpha = 0.98f),
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, palette.accent),
                    shadowElevation = 8.dp,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(
                        modifier = Modifier
                            .padding(GpSpacing.s3)
                            .heightIn(max = 360.dp)
                            .verticalScroll(rememberScrollState()),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = strings.t("mobile.tool.text"),
                                style = GpTypography.label,
                                color = palette.textPrimary,
                                modifier = Modifier.weight(1f),
                            )
                            IconButton(onClick = onOpenFullInspector, modifier = Modifier.size(34.dp)) {
                                Icon(GpIcons.Tune, contentDescription = strings.t("mobile.tool.inspect"), tint = palette.accent, modifier = Modifier.size(18.dp))
                            }
                            IconButton(onClick = onDuplicate, modifier = Modifier.size(34.dp)) {
                                Icon(GpIcons.Copy, contentDescription = strings.t("mobile.duplicate"), tint = palette.textPrimary, modifier = Modifier.size(18.dp))
                            }
                            IconButton(onClick = onDelete, modifier = Modifier.size(34.dp)) {
                                Icon(GpIcons.Delete, contentDescription = strings.t("action.delete"), tint = palette.danger, modifier = Modifier.size(18.dp))
                            }
                            IconButton(onClick = { onToggleExpanded(false) }, modifier = Modifier.size(34.dp)) {
                                Icon(GpIcons.ChevronDown, contentDescription = null, tint = palette.textSecondary, modifier = Modifier.size(20.dp))
                            }
                        }

                        RichTextControlsBody(
                            element = element,
                            tfv = tfv,
                            onTfvChange = { next ->
                                tfv = next
                                val nextEl = RichTextOps.applyTextChange(element, next.text)
                                if (nextEl !== element) onUpdate(nextEl, false)
                            },
                            strings = strings,
                            customTtfBytes = customTtfBytes,
                            customFontLabel = customFontLabel,
                            extractedFonts = extractedFonts,
                            onUpdate = onUpdate,
                            onPickCustomFont = onPickCustomFont,
                            includeAdvancedScale = false,
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun RichTextControlsBody(
    element: GpOverlayElement,
    tfv: TextFieldValue,
    onTfvChange: (TextFieldValue) -> Unit,
    strings: GpStrings,
    customTtfBytes: ByteArray?,
    customFontLabel: String?,
    extractedFonts: List<GpExtractedFontInfo>,
    onUpdate: (GpOverlayElement, Boolean) -> Unit,
    onPickCustomFont: () -> Unit,
    includeAdvancedScale: Boolean,
) {
    val palette = LocalGpPalette.current
    val selMin = tfv.selection.min
    val selMax = tfv.selection.max
    val selFlags = RichTextOps.effectiveFlagsAt(element, selMin, selMax)

    // Embedded Font Status / Missing Font Warning
    val warn = element.fontWarning
    if (warn != null) {
        val isMissing = warn.startsWith("missing:")
        val missingName = warn.removePrefix("missing:").removePrefix("subset:").ifEmpty { element.fontFamily }
        val msg = if (isMissing) {
            strings.t("mobile.fontMissingWarning").replace("{name}", missingName)
        } else {
            strings.t("mobile.fontSubsetWarning")
        }
        Surface(
            color = palette.warning.copy(alpha = 0.14f),
            shape = RoundedCornerShape(8.dp),
            border = BorderStroke(1.dp, palette.warning.copy(alpha = 0.55f)),
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(GpIcons.Warning, contentDescription = null, tint = palette.warning, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text(msg, style = GpTypography.caption, color = palette.textPrimary, modifier = Modifier.weight(1f))
                TextButton(onClick = onPickCustomFont) {
                    Text(strings.t("mobile.uploadTtf"), style = GpTypography.caption, color = palette.accent)
                }
            }
        }
    } else if (element.embeddedFontId != null) {
        Surface(
            color = palette.success.copy(alpha = 0.12f),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(GpIcons.Check, contentDescription = null, tint = palette.success, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text(
                    "${element.fontFamily} • ${strings.t("mobile.fontEmbeddedOk")}",
                    style = GpTypography.caption,
                    color = palette.textSecondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }

    OutlinedTextField(
        value = tfv,
        onValueChange = onTfvChange,
        minLines = 2,
        maxLines = 4,
        modifier = Modifier.fillMaxWidth(),
    )

    Spacer(Modifier.height(8.dp))

    // Row 1 (First screen): Left / Center / Right / Justify alignment
    val aligns = listOf(
        Triple("left", GpIcons.AlignLeft, strings.t("mobile.alignLeft")),
        Triple("center", GpIcons.AlignCenter, strings.t("mobile.alignCenter")),
        Triple("right", GpIcons.AlignRight, strings.t("mobile.alignRight")),
        Triple("justify", GpIcons.AlignJustify, strings.t("mobile.alignJustify")),
    )
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        aligns.forEachIndexed { idx, (alKey, icon, desc) ->
            SegmentedButton(
                selected = element.align == alKey,
                onClick = { onUpdate(element.copy(align = alKey), true) },
                shape = SegmentedButtonDefaults.itemShape(idx, aligns.size),
                label = {
                    Icon(icon, contentDescription = desc, modifier = Modifier.size(16.dp))
                },
            )
        }
    }

    Spacer(Modifier.height(6.dp))

    // Row 2 (First screen): Selection-aware B / I / U / S / Subscript / Superscript
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        FilterChip(
            selected = selFlags.bold,
            onClick = { onUpdate(RichTextOps.toggleStyle(element, selMin, selMax, "bold"), true) },
            label = { Text("B", fontWeight = FontWeight.Bold) },
        )
        FilterChip(
            selected = selFlags.italic,
            onClick = { onUpdate(RichTextOps.toggleStyle(element, selMin, selMax, "italic"), true) },
            label = { Text("I", fontStyle = FontStyle.Italic, fontWeight = FontWeight.Medium) },
        )
        FilterChip(
            selected = selFlags.underline,
            onClick = { onUpdate(RichTextOps.toggleStyle(element, selMin, selMax, "underline"), true) },
            label = { Text("U", textDecoration = TextDecoration.Underline) },
        )
        FilterChip(
            selected = selFlags.strikethrough,
            onClick = { onUpdate(RichTextOps.toggleStyle(element, selMin, selMax, "strikethrough"), true) },
            label = { Text("S", textDecoration = TextDecoration.LineThrough) },
        )
        FilterChip(
            selected = selFlags.scriptMode == "sub",
            onClick = { onUpdate(RichTextOps.toggleStyle(element, selMin, selMax, "sub"), true) },
            label = { Text("x₂") },
        )
        FilterChip(
            selected = selFlags.scriptMode == "super",
            onClick = { onUpdate(RichTextOps.toggleStyle(element, selMin, selMax, "super"), true) },
            label = { Text("x²") },
        )
    }

    Spacer(Modifier.height(6.dp))

    // Row 3: Fine Font Size +/- 0.5pt + Font Family chips (including Extracted Embedded Fonts)
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        OutlinedButton(
            onClick = { onUpdate(element.copy(fontSize = max(4.0, ((element.fontSize - 0.5) * 10.0).roundToInt() / 10.0)), true) },
            modifier = Modifier.height(34.dp),
        ) { Text("A-", style = GpTypography.caption) }
        Spacer(Modifier.width(6.dp))
        val sizeText = if ((element.fontSize * 10.0).roundToInt() % 10 == 0) {
            "${element.fontSize.roundToInt()}pt"
        } else {
            "${"%.1f".format(element.fontSize)}pt"
        }
        Text(sizeText, style = GpTypography.numeric, color = palette.textPrimary)
        Spacer(Modifier.width(6.dp))
        OutlinedButton(
            onClick = { onUpdate(element.copy(fontSize = min(144.0, ((element.fontSize + 0.5) * 10.0).roundToInt() / 10.0)), true) },
            modifier = Modifier.height(34.dp),
        ) { Text("A+", style = GpTypography.caption) }
        Spacer(Modifier.width(8.dp))
        Slider(
            value = element.fontSize.toFloat().coerceIn(6f, 72f),
            onValueChange = {
                val snapped = (it * 2f).roundToInt() / 2.0
                onUpdate(element.copy(fontSize = snapped), false)
            },
            valueRange = 6f..72f,
            modifier = Modifier.weight(1f),
        )
    }

    Spacer(Modifier.height(4.dp))
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (ef in extractedFonts.filter { it.hasAnyTtf }) {
            val label = ef.displayName.ifEmpty { ef.cleanName }
            FilterChip(
                selected = element.embeddedFontId == ef.id,
                onClick = {
                    onUpdate(
                        element.copy(
                            embeddedFontId = ef.id,
                            fontFamily = label,
                            fontWarning = if (!ef.unicodeUsable) "subset:${ef.cleanName}" else null,
                        ),
                        true,
                    )
                },
                label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            )
        }
        val builtinFamilies = buildList {
            add("DejaVuSans" to "Sans")
            add("Serif" to "Serif")
            add("Mono" to "Mono")
            if (customTtfBytes != null) add("Custom" to (customFontLabel ?: "Custom TTF"))
        }
        for ((fId, fLbl) in builtinFamilies) {
            FilterChip(
                selected = element.embeddedFontId == null && element.fontFamily.equals(fId, ignoreCase = true),
                onClick = {
                    onUpdate(element.copy(embeddedFontId = null, fontFamily = fId, fontWarning = null), true)
                },
                label = { Text(fLbl) },
            )
        }
        OutlinedButton(onClick = onPickCustomFont, modifier = Modifier.height(32.dp)) {
            Text(strings.t("mobile.uploadTtf"), style = GpTypography.caption)
        }
    }

    Spacer(Modifier.height(6.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "${strings.t("mobile.lineHeight")}: ${"%.2f".format(element.lineHeight)}",
            style = GpTypography.caption,
            color = palette.textSecondary,
        )
        Slider(
            value = element.lineHeight.toFloat().coerceIn(0.85f, 2.5f),
            onValueChange = { onUpdate(element.copy(lineHeight = ((it * 20).roundToInt() / 20.0)), false) },
            valueRange = 0.85f..2.5f,
            modifier = Modifier.weight(1f).padding(start = 8.dp),
        )
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            "${strings.t("mobile.letterSpacing")}: ${"%.1f".format(element.letterSpacing)}pt",
            style = GpTypography.caption,
            color = palette.textSecondary,
        )
        Slider(
            value = element.letterSpacing.toFloat().coerceIn(-1.5f, 8f),
            onValueChange = { onUpdate(element.copy(letterSpacing = ((it * 10).roundToInt() / 10.0)), false) },
            valueRange = -1.5f..8f,
            modifier = Modifier.weight(1f).padding(start = 8.dp),
        )
    }
    if (includeAdvancedScale) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "${strings.t("mobile.horizScale")}: ${(element.horizontalScale * 100).roundToInt()}%",
                style = GpTypography.caption,
                color = palette.textSecondary,
            )
            Slider(
                value = element.horizontalScale.toFloat().coerceIn(0.6f, 1.8f),
                onValueChange = { onUpdate(element.copy(horizontalScale = ((it * 20).roundToInt() / 20.0)), false) },
                valueRange = 0.6f..1.8f,
                modifier = Modifier.weight(1f).padding(start = 8.dp),
            )
        }
    }

    Spacer(Modifier.height(6.dp))
    GpColorPickerRow(
        label = strings.t("mobile.textColor"),
        selectedColor = element.colorValue,
        allowTransparent = false,
        strings = strings,
        onSelectColor = { c -> onUpdate(element.copy(colorValue = c), true) },
    )
    Spacer(Modifier.height(6.dp))
    GpColorPickerRow(
        label = strings.t("mobile.bgColor"),
        selectedColor = element.backgroundColorValue,
        allowTransparent = true,
        strings = strings,
        onSelectColor = { c -> onUpdate(element.copy(backgroundColorValue = c), true) },
    )
}

@Composable
fun MultiSelectAlignBar(
    selectedCount: Int,
    strings: GpStrings,
    onAlign: (String) -> Unit,
    onDelete: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalGpPalette.current
    val canDistribute = selectedCount >= 3
    val actions = listOf(
        Triple("left", GpIcons.AlignObjLeft, strings.t("mobile.alignLeft")),
        Triple("center-h", GpIcons.AlignObjCenterH, strings.t("mobile.alignCenterH")),
        Triple("right", GpIcons.AlignObjRight, strings.t("mobile.alignRight")),
        Triple("top", GpIcons.AlignObjTop, strings.t("mobile.alignTop")),
        Triple("center-v", GpIcons.AlignObjCenterV, strings.t("mobile.alignCenterV")),
        Triple("bottom", GpIcons.AlignObjBottom, strings.t("mobile.alignBottom")),
        Triple("distribute-h", GpIcons.DistributeH, strings.t("mobile.distributeH")),
        Triple("distribute-v", GpIcons.DistributeV, strings.t("mobile.distributeV")),
    )
    Surface(
        color = palette.surfaceOverlay.copy(alpha = 0.96f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, palette.accent),
        shadowElevation = 6.dp,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = GpSpacing.s3, vertical = 6.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                color = palette.accent.copy(alpha = 0.16f),
                shape = RoundedCornerShape(8.dp),
            ) {
                Text(
                    text = "$selectedCount",
                    style = GpTypography.label.copy(fontWeight = FontWeight.Bold),
                    color = palette.accent,
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                )
            }
            Spacer(Modifier.width(6.dp))
            Row(
                modifier = Modifier
                    .weight(1f)
                    .horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(2.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for ((key, icon, label) in actions) {
                    val isDist = key.startsWith("distribute")
                    val enabled = !isDist || canDistribute
                    IconButton(
                        onClick = { onAlign(key) },
                        enabled = enabled,
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            icon,
                            contentDescription = label,
                            tint = if (enabled) palette.textPrimary else palette.textDisabled,
                            modifier = Modifier.size(19.dp),
                        )
                    }
                }
            }
            IconButton(onClick = onDelete, modifier = Modifier.size(38.dp)) {
                Icon(GpIcons.Delete, contentDescription = strings.t("action.delete"), tint = palette.danger, modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onClose, modifier = Modifier.size(38.dp)) {
                Icon(GpIcons.Close, contentDescription = strings.t("action.close"), tint = palette.textSecondary, modifier = Modifier.size(20.dp))
            }
        }
    }
}

@Composable
fun CompactElementSelectionBar(
    element: GpOverlayElement,
    strings: GpStrings,
    onUpdate: (GpOverlayElement, Boolean) -> Unit,
    onOpenFullInspector: () -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    onClose: () -> Unit,
    selectedVertexIndices: Set<Int> = emptySet(),
    marqueeSelectMode: Boolean = false,
    onToggleMarqueeSelect: () -> Unit = {},
    onToggleVerticesSmooth: (Boolean?) -> Unit = {},
    onDeleteSelectedVertices: () -> Unit = {},
    onCrop: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val palette = LocalGpPalette.current
    Surface(
        color = palette.surfaceOverlay.copy(alpha = 0.96f),
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, palette.accent),
        shadowElevation = 6.dp,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = GpSpacing.s3, vertical = 6.dp),
    ) {
        Column(modifier = Modifier.fillMaxWidth()) {
            if (element.kind == "path") {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(start = 10.dp, end = 10.dp, top = 6.dp, bottom = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    FilterChip(
                        selected = marqueeSelectMode,
                        onClick = onToggleMarqueeSelect,
                        leadingIcon = { Icon(GpIcons.BoxSelect, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        label = {
                            Text(
                                text = if (selectedVertexIndices.isNotEmpty()) {
                                    "${strings.t("mobile.boxSelect")} (${selectedVertexIndices.size})"
                                } else {
                                    strings.t("mobile.boxSelect")
                                },
                                style = GpTypography.caption,
                            )
                        },
                    )
                    FilterChip(
                        selected = false,
                        onClick = { onToggleVerticesSmooth(true) },
                        leadingIcon = { Icon(GpIcons.SmoothCurve, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        label = { Text(strings.t("mobile.vertexSmooth"), style = GpTypography.caption) },
                    )
                    FilterChip(
                        selected = false,
                        onClick = { onToggleVerticesSmooth(false) },
                        leadingIcon = { Icon(GpIcons.SharpCorner, contentDescription = null, modifier = Modifier.size(16.dp)) },
                        label = { Text(strings.t("mobile.vertexSharp"), style = GpTypography.caption) },
                    )
                    if (selectedVertexIndices.isNotEmpty()) {
                        FilterChip(
                            selected = false,
                            onClick = onDeleteSelectedVertices,
                            leadingIcon = {
                                Icon(GpIcons.Delete, contentDescription = null, tint = palette.danger, modifier = Modifier.size(16.dp))
                            },
                            label = {
                                Text(strings.t("mobile.vertexDelete"), style = GpTypography.caption, color = palette.danger)
                            },
                        )
                    } else {
                        Text(
                            text = strings.t("mobile.vertexSelectHint"),
                            style = GpTypography.caption,
                            color = palette.textSecondary,
                        )
                    }
                }
                HorizontalDivider(color = palette.borderSubtle, modifier = Modifier.padding(horizontal = 8.dp))
            }
            Row(
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                for (c in listOf(0xFF0F172A.toInt(), 0xFF2563EB.toInt(), 0xFFDC2626.toInt(), 0xFF15803D.toInt())) {
                    Box(
                        modifier = Modifier
                            .padding(end = 6.dp)
                            .size(24.dp)
                            .clip(CircleShape)
                            .background(Color(c))
                            .border(1.5.dp, Color.White, CircleShape)
                            .clickable {
                                val next = if (element.kind == "highlight") element.copy(fillColorValue = c) else element.copy(colorValue = c)
                                onUpdate(next, true)
                            },
                    )
                }
                Spacer(Modifier.weight(1f))
                if (onCrop != null) {
                    IconButton(onClick = onCrop, modifier = Modifier.size(40.dp)) {
                        Icon(GpIcons.Crop, contentDescription = strings.t("mobile.ctx.crop"), tint = palette.textPrimary, modifier = Modifier.size(20.dp))
                    }
                }
                IconButton(onClick = onOpenFullInspector, modifier = Modifier.size(40.dp)) {
                    Icon(GpIcons.Tune, contentDescription = strings.t("mobile.tool.inspect"), tint = palette.accent, modifier = Modifier.size(20.dp))
                }
                IconButton(onClick = onDuplicate, modifier = Modifier.size(40.dp)) {
                    Icon(GpIcons.Copy, contentDescription = strings.t("mobile.duplicate"), tint = palette.textPrimary, modifier = Modifier.size(20.dp))
                }
                IconButton(onClick = onDelete, modifier = Modifier.size(40.dp)) {
                    Icon(GpIcons.Delete, contentDescription = strings.t("action.delete"), tint = palette.danger, modifier = Modifier.size(20.dp))
                }
                IconButton(onClick = onClose, modifier = Modifier.size(40.dp)) {
                    Icon(GpIcons.Close, contentDescription = strings.t("action.close"), tint = palette.textSecondary, modifier = Modifier.size(20.dp))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ElementInspectorSheet(
    element: GpOverlayElement,
    state: GpAppState,
    strings: GpStrings,
    onUpdate: (GpOverlayElement) -> Unit,
    onPickCustomFont: () -> Unit,
    onBringForward: () -> Unit,
    onSendBackward: () -> Unit,
    onDuplicate: () -> Unit,
    onToggleLock: () -> Unit,
    onStartCrop: () -> Unit = {},
    onApplyAllPages: (String) -> Unit,
    onDelete: () -> Unit,
    onDismiss: () -> Unit,
    selectedVertexIndices: Set<Int> = emptySet(),
    onToggleVerticesSmooth: (Boolean?) -> Unit = {},
    onDeleteSelectedVertices: () -> Unit = {},
) {
    val palette = LocalGpPalette.current
    var tfv by remember(element.id) {
        mutableStateOf(TextFieldValue(element.text, TextRange(element.text.length)))
    }
    if (tfv.text != element.text) {
        val clampedStart = tfv.selection.start.coerceIn(0, element.text.length)
        val clampedEnd = tfv.selection.end.coerceIn(0, element.text.length)
        tfv = TextFieldValue(element.text, TextRange(clampedStart, clampedEnd))
    }
    val docFonts = remember(state.extractedFonts, state.pages, state.activePageIndex) {
        val p = state.pages.getOrNull(state.activePageIndex)
        if (p != null) state.extractedFonts[p.sourceDocId].orEmpty() else emptyList()
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(strings.t("mobile.tool.inspect"), style = GpTypography.titleM, color = palette.textPrimary, modifier = Modifier.weight(1f))
                IconButton(onClick = { onToggleLock(); onDismiss() }) {
                    Icon(
                        if (element.locked) GpIcons.Lock else GpIcons.LockOpen,
                        contentDescription = null,
                        tint = if (element.locked) palette.warning else palette.textSecondary,
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(GpIcons.Close, contentDescription = strings.t("action.close"), tint = palette.textPrimary)
                }
            }

            if (element.isTextKind) {
                RichTextControlsBody(
                    element = element,
                    tfv = tfv,
                    onTfvChange = { next ->
                        tfv = next
                        val nextEl = RichTextOps.applyTextChange(element, next.text)
                        if (nextEl !== element) onUpdate(nextEl)
                    },
                    strings = strings,
                    customTtfBytes = state.customTtfBytes,
                    customFontLabel = state.customFontLabel,
                    extractedFonts = docFonts,
                    onUpdate = { nextEl, _ -> onUpdate(nextEl) },
                    onPickCustomFont = onPickCustomFont,
                    includeAdvancedScale = true,
                )
            }

            if (element.kind == "shape" || element.kind == "shapeReplacement" || element.kind == "path" || element.kind == "ink") {
                if (element.kind == "shape") {
                    Text(if (strings.isTr) "Şekil Türü" else "Shape Type", style = GpTypography.caption, color = palette.textSecondary)
                    Spacer(Modifier.height(6.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for ((st, lbl) in listOf("rect" to "Rect", "ellipse" to "Ellipse", "triangle" to "Triangle", "diamond" to "Diamond", "arrow" to "Arrow")) {
                            FilterChip(selected = element.shapeType == st, onClick = { onUpdate(element.copy(shapeType = st)) }, label = { Text(lbl) })
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                GpColorPickerRow(
                    label = strings.t("mobile.strokeColor"),
                    selectedColor = element.colorValue,
                    allowTransparent = element.kind == "shape" || element.kind == "shapeReplacement",
                    strings = strings,
                    onSelectColor = { onUpdate(element.copy(colorValue = it)) },
                )
                if (element.kind == "shape" || element.kind == "shapeReplacement" || element.kind == "path") {
                    Spacer(Modifier.height(8.dp))
                    GpColorPickerRow(
                        label = strings.t("mobile.fillColor"),
                        selectedColor = element.fillColorValue,
                        allowTransparent = true,
                        strings = strings,
                        onSelectColor = { onUpdate(element.copy(fillColorValue = it)) },
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${if (strings.isTr) "Kalınlık" else "Stroke"}: ${"%.1f".format(element.strokeWidth)}pt", style = GpTypography.caption, color = palette.textSecondary)
                    Slider(
                        value = element.strokeWidth.toFloat().coerceIn(0.5f, 16f),
                        onValueChange = { onUpdate(element.copy(strokeWidth = it.toDouble())) },
                        valueRange = 0.5f..16f,
                        modifier = Modifier.weight(1f).padding(start = 8.dp),
                    )
                }
                if (element.kind == "shape" || element.kind == "shapeReplacement" || element.kind == "path") {
                    val dashes = listOf("solid" to if (strings.isTr) "Düz" else "Solid", "dashed" to if (strings.isTr) "Kesikli" else "Dashed", "dotted" to if (strings.isTr) "Noktalı" else "Dotted")
                    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                        dashes.forEachIndexed { idx, (dKey, dLbl) ->
                            SegmentedButton(
                                selected = element.strokeDash == dKey,
                                onClick = { onUpdate(element.copy(strokeDash = dKey)) },
                                shape = SegmentedButtonDefaults.itemShape(idx, dashes.size),
                                label = { Text(dLbl) },
                            )
                        }
                    }
                }
                if (element.kind == "shape" && element.shapeType == "rect") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("${if (strings.isTr) "Köşe" else "Radius"}: ${element.borderRadius.roundToInt()}pt", style = GpTypography.caption, color = palette.textSecondary)
                        Slider(
                            value = element.borderRadius.toFloat().coerceIn(0f, 48f),
                            onValueChange = { onUpdate(element.copy(borderRadius = it.toDouble())) },
                            valueRange = 0f..48f,
                            modifier = Modifier.weight(1f).padding(start = 8.dp),
                        )
                    }
                }
                if (element.kind == "path") {
                    Spacer(Modifier.height(6.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (strings.isTr) "Yumuşak Eğri" else "Smooth Curve",
                            style = GpTypography.body,
                            color = palette.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(
                            checked = element.smooth,
                            onCheckedChange = { checked ->
                                val nextPts = element.points.map { it.copy(smooth = checked) }
                                onUpdate(element.withUpdatedPoints(nextPts).copy(smooth = checked))
                            },
                        )
                    }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (strings.isTr) "Kapalı Şekil" else "Closed Path",
                            style = GpTypography.body,
                            color = palette.textPrimary,
                            modifier = Modifier.weight(1f),
                        )
                        Switch(
                            checked = element.closed,
                            onCheckedChange = { checked -> onUpdate(element.withUpdatedPoints(element.points, closed = checked)) },
                        )
                    }
                    if (selectedVertexIndices.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(
                                selected = false,
                                onClick = { onToggleVerticesSmooth(true) },
                                leadingIcon = { Icon(GpIcons.SmoothCurve, contentDescription = null, modifier = Modifier.size(16.dp)) },
                                label = { Text("${strings.t("mobile.vertexSmooth")} (${selectedVertexIndices.size})") },
                            )
                            FilterChip(
                                selected = false,
                                onClick = { onToggleVerticesSmooth(false) },
                                leadingIcon = { Icon(GpIcons.SharpCorner, contentDescription = null, modifier = Modifier.size(16.dp)) },
                                label = { Text("${strings.t("mobile.vertexSharp")} (${selectedVertexIndices.size})") },
                            )
                            FilterChip(
                                selected = false,
                                onClick = { onDismiss(); onDeleteSelectedVertices() },
                                leadingIcon = { Icon(GpIcons.Delete, contentDescription = null, tint = palette.danger, modifier = Modifier.size(16.dp)) },
                                label = { Text(strings.t("mobile.vertexDelete"), color = palette.danger) },
                            )
                        }
                    }
                }
            }

            if (element.kind == "image" || element.kind == "imageReplacement") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = element.flipX,
                        onClick = { onUpdate(element.copy(flipX = !element.flipX)) },
                        label = { Text(if (strings.isTr) "Yatay Çevir" else "Flip H") },
                        modifier = Modifier.weight(1f),
                    )
                    FilterChip(
                        selected = element.flipY,
                        onClick = { onUpdate(element.copy(flipY = !element.flipY)) },
                        label = { Text(if (strings.isTr) "Dikey Çevir" else "Flip V") },
                        modifier = Modifier.weight(1f),
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedButton(
                    onClick = { onDismiss(); onStartCrop() },
                    enabled = !element.locked,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(GpIcons.Crop, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(strings.t("mobile.ctx.crop"))
                }
            }

            Spacer(Modifier.height(6.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${if (strings.isTr) "Opaklık" else "Opacity"}: ${(element.opacity * 100).roundToInt()}%", style = GpTypography.caption, color = palette.textSecondary)
                Slider(
                    value = element.opacity.toFloat().coerceIn(0.1f, 1f),
                    onValueChange = { onUpdate(element.copy(opacity = it.toDouble())) },
                    valueRange = 0.1f..1f,
                    modifier = Modifier.weight(1f).padding(start = 8.dp),
                )
            }

            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = if (strings.isTr) "Sayfa içeriğinin arkasında (Filigran)" else "Place behind page content",
                    style = GpTypography.body,
                    color = palette.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                Switch(checked = element.behindContent, onCheckedChange = { onUpdate(element.copy(behindContent = it)) })
            }

            if (state.pages.size > 1 && (element.kind == "image" || element.kind == "signature" || element.isTextKind)) {
                Spacer(Modifier.height(6.dp))
                OutlinedButton(
                    onClick = { onDismiss(); onApplyAllPages("all") },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(strings.t("mobile.applyAllPages"))
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedButton(onClick = onBringForward) { Text(strings.t("mobile.bringForward"), style = GpTypography.caption) }
                Spacer(Modifier.width(6.dp))
                OutlinedButton(onClick = onSendBackward) { Text(strings.t("mobile.sendBackward"), style = GpTypography.caption) }
                Spacer(Modifier.weight(1f))
                Button(
                    onClick = { onDismiss(); onDelete() },
                    colors = ButtonDefaults.buttonColors(containerColor = palette.danger),
                ) {
                    Text(strings.t("action.delete"))
                }
            }
            Spacer(Modifier.height(GpSpacing.s4))
        }
    }
}
