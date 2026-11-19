package dev.gullacpdf.android.ui.viewer

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.zIndex
import dev.gullacpdf.android.engine.DirectBufferPool
import dev.gullacpdf.android.engine.NativePdfBridge
import dev.gullacpdf.android.engine.TileBitmapCache
import dev.gullacpdf.android.engine.TileKey
import dev.gullacpdf.android.l10n.GpLocale
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpPageMeta
import dev.gullacpdf.android.theme.GpComponents
import dev.gullacpdf.android.theme.GpReadingTheme
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.viewmodel.GpAppState
import kotlin.math.roundToInt

@Composable
fun ViewerTopBar(
    state: GpAppState,
    strings: GpStrings,
    isTabletOrWide: Boolean,
    onBackToLibrary: () -> Unit,
    onToggleNavigator: () -> Unit,
    onToggleSearch: () -> Unit,
    onOpenSaveSheet: () -> Unit,
    onShare: () -> Unit,
    onPrint: () -> Unit,
    onOpenWith: () -> Unit = {},
    onCopyPageText: () -> Unit,
    onOpenSettings: () -> Unit,
    onSwitchToEdit: () -> Unit,
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
                    .padding(horizontal = GpSpacing.s1),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = onBackToLibrary) {
                    Icon(GpIcons.ArrowBack, contentDescription = strings.t("action.close"), tint = palette.textPrimary)
                }
                IconButton(onClick = onToggleNavigator) {
                    Icon(GpIcons.Pages, contentDescription = strings.t("nav.pages"), tint = palette.textPrimary)
                }
                Column(modifier = Modifier.weight(1f).padding(horizontal = 4.dp)) {
                    Text(
                        text = state.displayName.ifEmpty { strings.t("app.name") },
                        style = GpTypography.label,
                        color = palette.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${state.activePageIndex + 1} / ${state.pages.size}",
                        style = GpTypography.caption,
                        color = palette.textSecondary,
                    )
                }
                IconButton(onClick = onToggleSearch) {
                    Icon(GpIcons.Search, contentDescription = strings.t("action.search"), tint = palette.textPrimary)
                }
                if (isTabletOrWide) {
                    Button(
                        onClick = onSwitchToEdit,
                        colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                        modifier = Modifier.padding(end = 6.dp).height(40.dp),
                    ) {
                        Icon(GpIcons.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(strings.t("action.editPdf"), style = GpTypography.label)
                    }
                }
                if (state.dirty) {
                    IconButton(onClick = onOpenSaveSheet) {
                        Icon(GpIcons.Save, contentDescription = strings.t("action.save"), tint = palette.accent)
                    }
                }
                Box {
                    IconButton(onClick = { menuOpen = true }) {
                        Icon(GpIcons.MoreVert, contentDescription = null, tint = palette.textPrimary)
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(strings.t("action.save")) },
                            leadingIcon = { Icon(GpIcons.Save, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onOpenSaveSheet() },
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
                        DropdownMenuItem(
                            text = { Text(strings.t("mobile.copyPageText")) },
                            leadingIcon = { Icon(GpIcons.Copy, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onCopyPageText() },
                        )
                        DropdownMenuItem(
                            text = { Text("${strings.t("settings.language")} / Theme") },
                            leadingIcon = { Icon(GpIcons.Tune, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            onClick = { menuOpen = false; onOpenSettings() },
                        )
                    }
                }
            }
            HorizontalDivider(color = palette.borderSubtle, thickness = 1.dp)
        }
    }
}

@Composable
fun ViewerSearchStrip(
    state: GpAppState,
    strings: GpStrings,
    onQuerySubmit: (String) -> Unit,
    onStepResult: (Int) -> Unit,
    onClose: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var text by remember(state.docId) { mutableStateOf(state.searchQuery) }
    val hits = state.searchHits
    val countLabel = when {
        state.searchQuery.isEmpty() -> ""
        hits.isEmpty() -> if (state.searchScanning) "…" else strings.t("search.noResults")
        else -> "${state.activeSearchIdx + 1}/${hits.size}"
    }

    Surface(
        color = palette.surfaceOverlay,
        shadowElevation = 4.dp,
        modifier = Modifier.fillMaxWidth().zIndex(9f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = GpSpacing.s3, vertical = GpSpacing.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = text,
                onValueChange = { text = it },
                placeholder = { Text(strings.t("search.placeholder"), style = GpTypography.body) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onQuerySubmit(text) }),
                modifier = Modifier.weight(1f),
            )
            if (countLabel.isNotEmpty()) {
                Text(
                    text = countLabel,
                    style = GpTypography.numeric,
                    color = palette.textSecondary,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
            }
            IconButton(onClick = { onStepResult(-1) }, enabled = hits.isNotEmpty()) {
                Icon(GpIcons.ChevronUp, contentDescription = null, tint = palette.textPrimary)
            }
            IconButton(onClick = { onStepResult(1) }, enabled = hits.isNotEmpty()) {
                Icon(GpIcons.ChevronDown, contentDescription = null, tint = palette.textPrimary)
            }
            IconButton(onClick = onClose) {
                Icon(GpIcons.Close, contentDescription = strings.t("action.close"), tint = palette.textPrimary)
            }
        }
    }
}

@Composable
fun PageThumbnailPreview(
    page: GpPageMeta,
    themeName: String,
    darkPaperInvert: Boolean,
    tileCache: TileBitmapCache,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current.density
    val bufferPool = remember { DirectBufferPool(2) }
    val key = remember(page.sourceDocId, page.sourcePageIndex, page.userRotation, themeName) {
        TileKey(
            docId = page.sourceDocId,
            pageIndex = page.sourcePageIndex,
            tileX = 0,
            tileY = 0,
            scaleBucket = "preview",
            rotation = page.userRotation,
            themeKey = themeName,
            isPreview = true,
        )
    }
    var bmp by remember(key) { mutableStateOf<Bitmap?>(tileCache.get(key)?.bitmap) }

    LaunchedEffect(key) {
        if (bmp == null && page.sourceDocId != "blank") {
            val pw = (page.displayWidth * 0.4 * density).roundToInt().coerceIn(120, 420)
            val ph = (page.displayHeight * 0.4 * density).roundToInt().coerceIn(150, 600)
            val rendered = NativePdfBridge.renderTileBitmap(
                docId = page.sourceDocId,
                pageIndex = page.sourcePageIndex,
                tileX = 0,
                tileY = 0,
                tileWidthPx = pw,
                tileHeightPx = ph,
                scale = pw.toDouble() / page.displayWidth,
                userRotation = page.userRotation,
                theme = themeName,
                darkPaperInvert = darkPaperInvert,
                priorityTier = 2,
                scope = "thumb:${page.sourceDocId}",
                bufferPool = bufferPool,
            )
            if (rendered != null) {
                tileCache.put(key, rendered)
                bmp = rendered
            }
        }
    }

    Box(
        modifier = modifier.background(Color.White),
        contentAlignment = Alignment.Center,
    ) {
        val current = bmp
        if (current != null && !current.isRecycled) {
            Image(
                bitmap = current.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text("${page.sourcePageIndex + 1}", style = GpTypography.label, color = Color(0xFF94A3B8))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NavigatorSheet(
    state: GpAppState,
    strings: GpStrings,
    tileCache: TileBitmapCache,
    onSelectPage: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var tab by remember { mutableIntStateOf(0) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false),
        containerColor = palette.surfaceRaised,
    ) {
        Column(modifier = Modifier.fillMaxWidth().heightIn(min = 300.dp, max = 560.dp)) {
            TabRow(selectedTabIndex = tab, containerColor = palette.surfaceRaised, contentColor = palette.accent) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text(strings.t("nav.pages")) })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text(strings.t("nav.outline")) })
            }

            if (tab == 0) {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(3),
                    contentPadding = PaddingValues(GpSpacing.s3),
                    horizontalArrangement = Arrangement.spacedBy(GpSpacing.s3),
                    verticalArrangement = Arrangement.spacedBy(GpSpacing.s3),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    itemsIndexed(state.pages) { idx, pg ->
                        val active = idx == state.activePageIndex
                        Box(
                            modifier = Modifier
                                .aspectRatio(0.74f)
                                .clip(RoundedCornerShape(10.dp))
                                .border(if (active) 2.5.dp else 1.dp, if (active) palette.accent else palette.border, RoundedCornerShape(10.dp))
                                .clickable { onSelectPage(idx); onDismiss() },
                        ) {
                            PageThumbnailPreview(
                                page = pg,
                                themeName = state.theme.engineKey,
                                darkPaperInvert = state.darkPaperInvert,
                                tileCache = tileCache,
                                modifier = Modifier.fillMaxSize(),
                            )
                            Surface(
                                color = if (active) palette.accent else Color(0xCC0F172A),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
                            ) {
                                Text(
                                    text = "${idx + 1}",
                                    style = GpTypography.caption.copy(fontWeight = FontWeight.SemiBold),
                                    color = Color.White,
                                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                }
            } else {
                if (state.outline.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize().padding(GpSpacing.s5), contentAlignment = Alignment.Center) {
                        Text(
                            text = if (strings.isTr) "Yer imi / içindekiler bulunamadı" else "No bookmarks / outline entries",
                            style = GpTypography.body,
                            color = palette.textSecondary,
                        )
                    }
                } else {
                    LazyColumn(contentPadding = PaddingValues(GpSpacing.s3)) {
                        items(state.outline) { node ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable(enabled = node.pageIndex != null) {
                                        node.pageIndex?.let { onSelectPage(it); onDismiss() }
                                    }
                                    .padding(vertical = 12.dp, horizontal = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(node.title, style = GpTypography.body, color = palette.textPrimary, modifier = Modifier.weight(1f))
                                node.pageIndex?.let {
                                    Text("${it + 1}", style = GpTypography.numeric, color = palette.textSecondary)
                                }
                            }
                            HorizontalDivider(color = palette.borderSubtle)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SaveWorkflowSheet(
    state: GpAppState,
    strings: GpStrings,
    onSaveAsCopy: () -> Unit,
    onOverwriteOriginal: () -> Unit,
    onSetDontAsk: (Boolean) -> Unit,
    onShare: () -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var confirmingOverwrite by remember { mutableStateOf(false) }
    var dontAskChecked by remember { mutableStateOf(state.overwriteDontAskAgain) }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.surfaceRaised) {
        Column(modifier = Modifier.fillMaxWidth().padding(GpSpacing.s4)) {
            Text(strings.t("action.save"), style = GpTypography.titleM, color = palette.textPrimary)
            Spacer(Modifier.height(GpSpacing.s3))

            if (!state.writable) {
                Text(
                    text = strings.t("mobile.readOnlyFallbackHint"),
                    style = GpTypography.caption,
                    color = palette.warning,
                    modifier = Modifier.padding(bottom = GpSpacing.s3),
                )
            }

            if (!confirmingOverwrite) {
                Button(
                    onClick = { onDismiss(); onSaveAsCopy() },
                    colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                    modifier = Modifier.fillMaxWidth().height(GpComponents.primaryTouchTarget),
                ) {
                    Text(strings.t("action.saveAsCopy"))
                }
                if (state.writable) {
                    Spacer(Modifier.height(GpSpacing.s2))
                    OutlinedButton(
                        onClick = {
                            if (state.overwriteDontAskAgain) {
                                onDismiss(); onOverwriteOriginal()
                            } else {
                                confirmingOverwrite = true
                            }
                        },
                        modifier = Modifier.fillMaxWidth().height(GpComponents.primaryTouchTarget),
                    ) {
                        Text(strings.t("action.overwriteOriginal"))
                    }
                }
                Spacer(Modifier.height(GpSpacing.s2))
                TextButton(
                    onClick = { onDismiss(); onShare() },
                    modifier = Modifier.fillMaxWidth().height(GpComponents.touchTargetMin),
                ) {
                    Icon(GpIcons.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(strings.t("action.share"))
                }
            } else {
                Text(strings.t("save.overwriteConfirmTitle"), style = GpTypography.titleM, color = palette.danger)
                Spacer(Modifier.height(GpSpacing.s2))
                Text(strings.t("save.overwriteConfirmBody"), style = GpTypography.body, color = palette.textSecondary)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 8.dp)) {
                    Checkbox(checked = dontAskChecked, onCheckedChange = { dontAskChecked = it })
                    Text(strings.t("save.dontAskAgain"), style = GpTypography.body, color = palette.textPrimary)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(GpSpacing.s3)) {
                    OutlinedButton(onClick = { confirmingOverwrite = false }, modifier = Modifier.weight(1f)) {
                        Text(strings.t("action.cancel"))
                    }
                    Button(
                        onClick = {
                            if (dontAskChecked) onSetDontAsk(true)
                            onDismiss()
                            onOverwriteOriginal()
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = palette.danger),
                        modifier = Modifier.weight(1f),
                    ) {
                        Text(strings.t("action.overwriteOriginal"))
                    }
                }
            }
            Spacer(Modifier.height(GpSpacing.s4))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSheet(
    state: GpAppState,
    strings: GpStrings,
    onSetLocale: (GpLocale) -> Unit,
    onSetTheme: (GpReadingTheme) -> Unit,
    onToggleDarkInvert: () -> Unit,
    onToggleLeftHanded: () -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.surfaceRaised) {
        Column(modifier = Modifier.fillMaxWidth().padding(GpSpacing.s4)) {
            Text(strings.t("settings.language"), style = GpTypography.titleM, color = palette.textPrimary)
            Spacer(Modifier.height(8.dp))
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = state.locale == GpLocale.EN,
                    onClick = { onSetLocale(GpLocale.EN) },
                    shape = SegmentedButtonDefaults.itemShape(0, 2),
                    label = { Text(strings.t("settings.languageEn")) },
                )
                SegmentedButton(
                    selected = state.locale == GpLocale.TR,
                    onClick = { onSetLocale(GpLocale.TR) },
                    shape = SegmentedButtonDefaults.itemShape(1, 2),
                    label = { Text(strings.t("settings.languageTr")) },
                )
            }

            Spacer(Modifier.height(GpSpacing.s4))
            Text(if (strings.isTr) "Tema" else "Theme", style = GpTypography.titleM, color = palette.textPrimary)
            Spacer(Modifier.height(8.dp))
            val themes = listOf(GpReadingTheme.LIGHT to "theme.light", GpReadingTheme.DARK to "theme.dark", GpReadingTheme.SEPIA to "theme.sepia")
            SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
                themes.forEachIndexed { idx, (th, key) ->
                    SegmentedButton(
                        selected = state.theme == th,
                        onClick = { onSetTheme(th) },
                        shape = SegmentedButtonDefaults.itemShape(idx, themes.size),
                        label = { Text(strings.t(key)) },
                    )
                }
            }

            if (state.theme == GpReadingTheme.DARK) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = if (strings.isTr) "Beyaz PDF sayfalarını tersine çevir" else "Invert white PDF pages",
                        style = GpTypography.body,
                        color = palette.textPrimary,
                        modifier = Modifier.weight(1f),
                    )
                    Switch(checked = state.darkPaperInvert, onCheckedChange = { onToggleDarkInvert() })
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = strings.t("settings.leftHanded"),
                    style = GpTypography.body,
                    color = palette.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                Switch(checked = state.leftHanded, onCheckedChange = { onToggleLeftHanded() })
            }
            Spacer(Modifier.height(GpSpacing.s4))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PageTextSheet(
    state: GpAppState,
    strings: GpStrings,
    onCopied: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = LocalGpPalette.current
    val clipboard = LocalClipboardManager.current
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = palette.surfaceRaised) {
        Column(modifier = Modifier.fillMaxWidth().padding(GpSpacing.s4)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (strings.isTr) "Sayfa ${state.activePageIndex + 1} Metni" else "Page ${state.activePageIndex + 1} Text",
                    style = GpTypography.titleM,
                    color = palette.textPrimary,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    enabled = state.pageTextPreview.isNotBlank(),
                    onClick = {
                        clipboard.setText(AnnotatedString(state.pageTextPreview))
                        onCopied(strings.t("mobile.textCopied"))
                        onDismiss()
                    },
                ) {
                    Icon(GpIcons.Copy, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (strings.isTr) "Kopyala" else "Copy All")
                }
            }
            Spacer(Modifier.height(12.dp))
            Surface(
                color = palette.surfaceOverlay,
                shape = RoundedCornerShape(12.dp),
                border = BorderStroke(1.dp, palette.border),
                modifier = Modifier.fillMaxWidth().heightIn(min = 140.dp, max = 380.dp),
            ) {
                SelectionContainer {
                    Text(
                        text = state.pageTextPreview.ifBlank { strings.t("viewer.noSelectableText") },
                        style = GpTypography.body,
                        color = palette.textPrimary,
                        modifier = Modifier.verticalScroll(rememberScrollState()).padding(12.dp),
                    )
                }
            }
            Spacer(Modifier.height(GpSpacing.s4))
        }
    }
}

@Composable
fun PasswordPromptDialog(
    state: GpAppState,
    strings: GpStrings,
    onSubmit: (String) -> Unit,
    onCancel: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var pw by remember { mutableStateOf("") }
    Dialog(onDismissRequest = onCancel) {
        Surface(color = palette.surfaceRaised, shape = RoundedCornerShape(16.dp)) {
            Column(modifier = Modifier.padding(GpSpacing.s4)) {
                Text(strings.t("mobile.passwordTitle"), style = GpTypography.titleM, color = palette.textPrimary)
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = pw,
                    onValueChange = { pw = it },
                    visualTransformation = PasswordVisualTransformation(),
                    isError = state.passwordInvalid,
                    supportingText = if (state.passwordInvalid) {
                        { Text(strings.t("mobile.passwordInvalid"), color = palette.danger) }
                    } else null,
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { onSubmit(pw) }),
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(12.dp))
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onCancel) { Text(strings.t("action.cancel")) }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = { onSubmit(pw) }) { Text(strings.t("action.openPdf")) }
                }
            }
        }
    }
}

@Composable
fun ErrorBanner(
    message: String,
    strings: GpStrings,
    onDismiss: () -> Unit,
    onOpenInOtherApp: (() -> Unit)?,
) {
    val palette = LocalGpPalette.current
    Surface(
        color = palette.danger.copy(alpha = 0.16f),
        modifier = Modifier.fillMaxWidth().zIndex(9f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = GpSpacing.s3, vertical = GpSpacing.s2),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = message,
                style = GpTypography.caption,
                color = palette.textPrimary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (onOpenInOtherApp != null) {
                TextButton(onClick = onOpenInOtherApp) {
                    Text(strings.t("mobile.openInOtherApp"), color = palette.accent)
                }
            }
            IconButton(onClick = onDismiss) {
                Icon(GpIcons.Close, contentDescription = strings.t("action.close"), tint = palette.textPrimary)
            }
        }
    }
}
