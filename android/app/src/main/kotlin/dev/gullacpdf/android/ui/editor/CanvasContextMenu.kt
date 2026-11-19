package dev.gullacpdf.android.ui.editor

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.viewmodel.GpContextMenuRequest
import kotlin.math.roundToInt

/** Every action the long-press menu can trigger; the host maps them to view-model calls. */
class CanvasMenuActions(
    val onCopy: (String) -> Unit,
    val onCut: (String) -> Unit,
    val onPaste: (pageIndex: Int, x: Float?, y: Float?) -> Unit,
    val onDuplicate: (String) -> Unit,
    val onDelete: (String) -> Unit,
    val onEditText: (String) -> Unit,
    val onFormatText: (String) -> Unit,
    val onCrop: (String) -> Unit,
    val onFlip: (String, horizontal: Boolean) -> Unit,
    val onRotate: (String, deg: Double) -> Unit,
    val onBringFront: (String) -> Unit,
    val onSendBack: (String) -> Unit,
    val onToggleLock: (String) -> Unit,
    val onApplyAllPages: (String) -> Unit,
    val onProperties: (String) -> Unit,
    val onAddTextAt: (pageIndex: Int, x: Float, y: Float) -> Unit,
    val onAddShapeAt: (pageIndex: Int, x: Float, y: Float) -> Unit,
    val onInsertImage: () -> Unit,
    val onAddSignature: () -> Unit,
    val onBoxSelect: () -> Unit,
    val onRotatePage: (pageIndex: Int) -> Unit,
)

/**
 * Long-press context menu (the touch equivalent of the web editor's right-click menu).
 * Anchored at the pressed point; quick actions sit in an icon row, the rest in a list.
 */
@Composable
fun CanvasContextMenu(
    request: GpContextMenuRequest,
    element: GpOverlayElement?,
    hasClipboard: Boolean,
    pageCount: Int,
    strings: GpStrings,
    actions: CanvasMenuActions,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    Box(
        modifier = Modifier.offset {
            IntOffset(request.screenX.roundToInt(), request.screenY.roundToInt())
        },
    ) {
        run {
            DropdownMenu(
                expanded = true,
                onDismissRequest = onDismiss,
                offset = DpOffset(0.dp, 8.dp),
                shape = RoundedCornerShape(16.dp),
                containerColor = palette.surfaceOverlay,
                shadowElevation = 12.dp,
                border = BorderStroke(1.dp, palette.border),
                modifier = Modifier.widthIn(min = 236.dp, max = 300.dp),
            ) {
                fun act(block: () -> Unit) {
                    onDismiss()
                    block()
                }
                if (element != null) {
                    val id = element.id
                    val locked = element.locked
                    MenuHeader(elementLabel(element, strings), locked)
                    QuickRow {
                        QuickAction(GpIcons.Copy, strings.t("mobile.ctx.copy")) { act { actions.onCopy(id) } }
                        QuickAction(GpIcons.Cut, strings.t("mobile.ctx.cut"), enabled = !locked) { act { actions.onCut(id) } }
                        QuickAction(GpIcons.Paste, strings.t("mobile.ctx.paste"), enabled = hasClipboard) {
                            act { actions.onPaste(request.pageIndex, null, null) }
                        }
                        QuickAction(GpIcons.Duplicate, strings.t("mobile.duplicate")) { act { actions.onDuplicate(id) } }
                        QuickAction(GpIcons.Delete, strings.t("action.delete"), tint = palette.danger, enabled = !locked) {
                            act { actions.onDelete(id) }
                        }
                    }
                    MenuDivider()
                    if (element.isTextKind && !locked) {
                        MenuItem(GpIcons.TextTool, strings.t("mobile.ctx.editText")) { act { actions.onEditText(id) } }
                        MenuItem(GpIcons.Tune, strings.t("mobile.ctx.formatText")) { act { actions.onFormatText(id) } }
                    }
                    val isImage = element.kind == "image" || element.kind == "imageReplacement"
                    if (isImage && !locked) {
                        MenuItem(GpIcons.Crop, strings.t("mobile.ctx.crop")) { act { actions.onCrop(id) } }
                    }
                    if (!locked && element.kind != "highlight") {
                        QuickRow {
                            QuickAction(GpIcons.RotateCcw, strings.t("mobile.ctx.rotateLeft")) { actions.onRotate(id, -90.0) }
                            QuickAction(GpIcons.RotateCw, strings.t("mobile.ctx.rotateRight")) { actions.onRotate(id, 90.0) }
                            if (isImage || element.kind == "signature") {
                                QuickAction(GpIcons.FlipH, strings.t("mobile.ctx.flipH")) { actions.onFlip(id, true) }
                                QuickAction(GpIcons.FlipV, strings.t("mobile.ctx.flipV")) { actions.onFlip(id, false) }
                            }
                        }
                    }
                    MenuItem(GpIcons.BringFront, strings.t("mobile.ctx.bringFront")) { act { actions.onBringFront(id) } }
                    MenuItem(GpIcons.SendBack, strings.t("mobile.ctx.sendBack")) { act { actions.onSendBack(id) } }
                    MenuItem(
                        if (locked) GpIcons.LockOpen else GpIcons.Lock,
                        strings.t(if (locked) "mobile.unlock" else "mobile.lock"),
                    ) { act { actions.onToggleLock(id) } }
                    if (pageCount > 1 && (isImage || element.kind == "signature" || element.isTextKind)) {
                        MenuItem(GpIcons.Pages, strings.t("mobile.ctx.applyAll")) { act { actions.onApplyAllPages(id) } }
                    }
                    MenuItem(GpIcons.Info, strings.t("mobile.ctx.properties")) { act { actions.onProperties(id) } }
                } else {
                    MenuHeader("${strings.t("nav.pages")} ${request.pageIndex + 1}", false)
                    if (hasClipboard) {
                        MenuItem(GpIcons.Paste, strings.t("mobile.ctx.pasteHere")) {
                            act { actions.onPaste(request.pageIndex, request.pdfX, request.pdfY) }
                        }
                    }
                    MenuItem(GpIcons.TextAdd, strings.t("mobile.ctx.addTextHere")) {
                        act { actions.onAddTextAt(request.pageIndex, request.pdfX, request.pdfY) }
                    }
                    MenuItem(GpIcons.ShapeRect, strings.t("mobile.ctx.addShapeHere")) {
                        act { actions.onAddShapeAt(request.pageIndex, request.pdfX, request.pdfY) }
                    }
                    MenuItem(GpIcons.ImageAdd, strings.t("mobile.ctx.addImage")) { act { actions.onInsertImage() } }
                    MenuItem(GpIcons.Signature, strings.t("mobile.ctx.addSignature")) { act { actions.onAddSignature() } }
                    MenuDivider()
                    MenuItem(GpIcons.BoxSelect, strings.t("mobile.ctx.boxSelect")) { act { actions.onBoxSelect() } }
                    MenuItem(GpIcons.RotateCw, strings.t("mobile.ctx.rotatePage")) { act { actions.onRotatePage(request.pageIndex) } }
                }
            }
        }
    }
}

private fun elementLabel(el: GpOverlayElement, strings: GpStrings): String {
    val tr = strings.isTr
    return when {
        el.isTextKind -> el.text.lineSequence().firstOrNull()?.trim()?.take(32)?.ifEmpty { null }
            ?: if (tr) "Metin" else "Text"
        el.kind == "image" || el.kind == "imageReplacement" -> if (tr) "Resim" else "Image"
        el.kind == "signature" -> if (tr) "İmza" else "Signature"
        el.kind == "shape" || el.kind == "shapeReplacement" -> if (tr) "Şekil" else "Shape"
        el.kind == "path" -> if (tr) "Çizgi / Yol" else "Path"
        el.kind == "ink" -> if (tr) "Serbest çizim" else "Drawing"
        el.kind == "highlight" -> if (el.isRedact) (if (tr) "Karartma" else "Redaction") else (if (tr) "Vurgu" else "Highlight")
        else -> if (tr) "Nesne" else "Object"
    }
}

@Composable
private fun MenuHeader(title: String, locked: Boolean) {
    val palette = LocalGpPalette.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 4.dp),
    ) {
        Text(
            text = title,
            style = GpTypography.caption,
            color = palette.textSecondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (locked) {
            Icon(GpIcons.Lock, contentDescription = null, tint = palette.warning, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun MenuDivider() {
    HorizontalDivider(color = LocalGpPalette.current.borderSubtle, modifier = Modifier.padding(vertical = 4.dp))
}

@Composable
private fun QuickRow(content: @Composable () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) { content() }
}

@Composable
private fun QuickAction(
    icon: ImageVector,
    label: String,
    tint: Color? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = LocalGpPalette.current
    val color = when {
        !enabled -> palette.textDisabled
        tint != null -> tint
        else -> palette.textPrimary
    }
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .width(52.dp)
            .clip(RoundedCornerShape(12.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(vertical = 6.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(34.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(palette.surfaceRaised),
        ) {
            Icon(icon, contentDescription = label, tint = color, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.height(3.dp))
        Text(
            text = label,
            style = GpTypography.caption.copy(fontSize = GpTypography.caption.fontSize * 0.85f),
            color = if (enabled) palette.textSecondary else palette.textDisabled,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun MenuItem(icon: ImageVector, label: String, tint: Color? = null, onClick: () -> Unit) {
    val palette = LocalGpPalette.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
    ) {
        Icon(icon, contentDescription = null, tint = tint ?: palette.textSecondary, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(14.dp))
        Text(label, style = GpTypography.label, color = tint ?: palette.textPrimary)
    }
}

/** Bottom bar shown while an image is in interactive crop mode. */
@Composable
fun CropModeBar(
    strings: GpStrings,
    canReset: Boolean,
    onCancel: () -> Unit,
    onReset: () -> Unit,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = LocalGpPalette.current
    Surface(
        color = palette.surfaceRaised,
        shadowElevation = 10.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(GpIcons.Crop, contentDescription = null, tint = palette.accent, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(strings.t("mobile.crop.title"), style = GpTypography.titleM, color = palette.textPrimary)
                    Text(strings.t("mobile.crop.hint"), style = GpTypography.caption, color = palette.textSecondary)
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = onCancel) { Text(strings.t("action.cancel"), color = palette.textSecondary) }
                TextButton(onClick = onReset, enabled = canReset) {
                    Text(strings.t("mobile.crop.reset"), color = if (canReset) palette.accent else palette.textDisabled)
                }
                Spacer(Modifier.weight(1f))
                Button(
                    onClick = onDone,
                    colors = ButtonDefaults.buttonColors(containerColor = palette.accent, contentColor = palette.accentForeground),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Icon(GpIcons.Check, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(strings.t("mobile.crop.done"))
                }
            }
        }
    }
}
