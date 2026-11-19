package dev.gullacpdf.android

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.graphics.Color as AndroidColor
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.add
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.dp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpAppMode
import dev.gullacpdf.android.model.GpEditorTool
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpSheetKind
import dev.gullacpdf.android.theme.GpReadingTheme
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.GullacTheme
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.ui.editor.CollapsibleBottomTextPanel
import dev.gullacpdf.android.ui.editor.CompactElementSelectionBar
import dev.gullacpdf.android.ui.editor.CanvasContextMenu
import dev.gullacpdf.android.ui.editor.CanvasMenuActions
import dev.gullacpdf.android.ui.editor.CropModeBar
import dev.gullacpdf.android.ui.editor.EditorToolDock
import dev.gullacpdf.android.ui.editor.EditorTopBar
import dev.gullacpdf.android.ui.editor.ElementInspectorSheet
import dev.gullacpdf.android.ui.editor.InlineTextKeyboardBridge
import dev.gullacpdf.android.ui.editor.MultiSelectAlignBar
import dev.gullacpdf.android.ui.editor.PolylineChainingBar
import dev.gullacpdf.android.ui.editor.ShapeVariantStrip
import dev.gullacpdf.android.ui.library.LibraryScreen
import dev.gullacpdf.android.ui.organizer.PageNumberingSheet
import dev.gullacpdf.android.ui.organizer.PageOrganizerSheet
import dev.gullacpdf.android.ui.signature.SignatureStudioSheet
import dev.gullacpdf.android.ui.viewer.ErrorBanner
import dev.gullacpdf.android.ui.viewer.NavigatorSheet
import dev.gullacpdf.android.ui.viewer.PageTextSheet
import dev.gullacpdf.android.ui.viewer.PasswordPromptDialog
import dev.gullacpdf.android.ui.viewer.SaveWorkflowSheet
import dev.gullacpdf.android.ui.viewer.SettingsSheet
import dev.gullacpdf.android.ui.viewer.ViewerSearchStrip
import dev.gullacpdf.android.ui.viewer.ViewerTopBar
import dev.gullacpdf.android.ui.viewport.PdfViewport
import dev.gullacpdf.android.ui.viewport.PdfViewportController
import dev.gullacpdf.android.viewmodel.PdfSessionViewModel
import kotlinx.coroutines.launch
import java.io.File

class MainActivity : ComponentActivity() {
    private val viewModel: PdfSessionViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        if (savedInstanceState == null) {
            viewModel.fileBridge.extractOpenRequest(intent)?.let { req ->
                viewModel.consumeIncomingOpenRequest(req)
            }
        }

        setContent {
            val state by viewModel.state.collectAsStateWithLifecycle()
            LaunchedEffect(state.theme, state.mode, state.hasDocument) {
                val isDark = state.theme == GpReadingTheme.DARK
                val statusStyle = if (isDark) {
                    SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                } else {
                    SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                }
                val viewerEdgeToEdge = state.hasDocument && state.mode == GpAppMode.VIEW
                val navStyle = if (isDark || viewerEdgeToEdge) {
                    SystemBarStyle.dark(AndroidColor.TRANSPARENT)
                } else {
                    SystemBarStyle.light(AndroidColor.TRANSPARENT, AndroidColor.TRANSPARENT)
                }
                enableEdgeToEdge(statusBarStyle = statusStyle, navigationBarStyle = navStyle)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    window.isNavigationBarContrastEnforced = false
                }
            }
            GullacTheme(readingTheme = state.theme) {
                GullacRootScreen(
                    activity = this,
                    vm = viewModel,
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        viewModel.fileBridge.extractOpenRequest(intent)?.let { req ->
            viewModel.consumeIncomingOpenRequest(req)
        }
    }
}

private enum class ImagePickPurpose { INSERT_IMAGE, SIGNATURE_UPLOAD }

@Composable
private fun GullacRootScreen(
    activity: ComponentActivity,
    vm: PdfSessionViewModel,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val strings = remember(state.locale) { GpStrings(state.locale) }
    val palette = LocalGpPalette.current
    val scope = rememberCoroutineScope()
    val uriHandler = LocalUriHandler.current
    val snackbarHostState = remember { SnackbarHostState() }
    val viewportController = remember { PdfViewportController() }

    var pendingCompiledExportPath by remember { mutableStateOf<String?>(null) }
    var imagePickPurpose by remember { mutableStateOf(ImagePickPurpose.INSERT_IMAGE) }
    var uploadedSigBytes by remember { mutableStateOf<ByteArray?>(null) }

    // Toast feedback synchronization
    LaunchedEffect(state.statusToast) {
        val msg = state.statusToast ?: return@LaunchedEffect
        snackbarHostState.showSnackbar(msg)
        vm.clearStatusToast()
    }

    // System SAF launchers (zero external storage permissions)
    val openPdfLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            vm.fileBridge.buildRequestFromPickedUris(listOf(uri), ".pdf")?.let { req ->
                vm.consumeIncomingOpenRequest(req)
            }
        }
    }

    val mergePdfLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            val req = vm.fileBridge.buildRequestFromPickedUris(listOf(uri), ".pdf")
            vm.mergeExternalPdfFromUri(uri.toString(), req?.displayName)
        }
    }

    val openImageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            if (imagePickPurpose == ImagePickPurpose.INSERT_IMAGE) {
                val req = vm.fileBridge.buildRequestFromPickedUris(listOf(uri), ".png")
                vm.insertImageFromUri(uri.toString(), req?.displayName)
            } else {
                scope.launch {
                    try {
                        val req = vm.fileBridge.buildRequestFromPickedUris(listOf(uri), ".png")
                        val copied = vm.fileBridge.copyToWorkFile(uri.toString(), req?.displayName)
                        uploadedSigBytes = File(copied.workPath).readBytes()
                    } catch (e: Exception) {
                        vm.setError(e.message ?: "Failed loading signature image")
                    }
                }
            }
        }
    }

    val openFontLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri: Uri? ->
        if (uri != null) {
            val req = vm.fileBridge.buildRequestFromPickedUris(listOf(uri), ".ttf")
            vm.loadCustomFontFromUri(uri.toString(), req?.displayName)
        }
    }

    val createPdfLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/pdf"),
    ) { destUri: Uri? ->
        val srcPath = pendingCompiledExportPath
        pendingCompiledExportPath = null
        if (destUri != null && srcPath != null) {
            vm.finishSaveCopyToUri(srcPath, destUri.toString())
        }
    }

    fun launchSaveAsCopy() {
        vm.prepareSaveCopy { compiledPath, suggestedName ->
            pendingCompiledExportPath = compiledPath
            createPdfLauncher.launch(suggestedName)
        }
    }

    fun launchSharePdf() {
        scope.launch {
            try {
                val compiled = vm.compileToTempFile()
                vm.fileBridge.sharePdf(activity, compiled, state.displayName.ifEmpty { "document.pdf" })
            } catch (e: Exception) {
                vm.setError(e.message ?: "Share failed")
            }
        }
    }

    fun launchPrintPdf() {
        scope.launch {
            try {
                val compiled = vm.compileToTempFile()
                vm.fileBridge.printPdf(activity, compiled, state.displayName.ifEmpty { "document.pdf" })
            } catch (e: Exception) {
                vm.setError(e.message ?: "Print failed")
            }
        }
    }

    fun launchOpenInOtherApp() {
        if (!state.hasDocument) return
        scope.launch {
            try {
                val hasEdits = state.dirty || state.elements.any { !it.deleted } || state.pageNumbering.enabled
                val targetPath = if (hasEdits || state.workFilePath == null) {
                    vm.compileToTempFile()
                } else {
                    state.workFilePath!!
                }
                vm.fileBridge.openInOtherApp(activity, targetPath, state.displayName.ifEmpty { "document.pdf" })
            } catch (e: Exception) {
                vm.setError(e.message ?: "Cannot open in another app")
            }
        }
    }

    // Structured Android Back button handling
    BackHandler(enabled = state.hasDocument || state.activeSheet != GpSheetKind.NONE || state.inlineEditElementId != null) {
        when {
            state.contextMenu != null -> vm.dismissContextMenu()
            state.cropElementId != null -> vm.finishCrop(apply = false)
            state.inlineEditElementId != null -> vm.endInlineEdit()
            state.activeSheet != GpSheetKind.NONE -> vm.closeSheet()
            state.ghostSignature != null -> vm.setGhostSignature(null)
            state.activePolylineId != null || state.pendingPolylineAnchor != null -> vm.finishPolylineChaining()
            state.mode == GpAppMode.EDIT -> vm.setMode(GpAppMode.VIEW)
            state.hasDocument -> vm.closeToLibrary()
        }
    }

    Scaffold(
        containerColor = palette.surface,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
    ) { _ ->
        BoxWithConstraints(modifier = Modifier.fillMaxSize().background(palette.surface)) {
            val isTabletOrWide = maxWidth >= 600.dp

            if (!state.hasDocument) {
                Box(modifier = Modifier.fillMaxSize()) {
                    LibraryScreen(
                        state = state,
                        strings = strings,
                        onOpenPicker = { openPdfLauncher.launch(arrayOf("application/pdf")) },
                        onCreateBlankPdf = { vm.createBlankDocument() },
                        onReopenRecent = { doc ->
                            vm.reopenRecent(doc) {
                                openPdfLauncher.launch(arrayOf("application/pdf"))
                            }
                        },
                        onOpenDefaultAppSettings = { vm.fileBridge.openDefaultAppSettings(activity) },
                        onSetLocale = { vm.setLocale(it) },
                        onCycleTheme = {
                            val next = when (state.theme) {
                                GpReadingTheme.LIGHT -> GpReadingTheme.DARK
                                GpReadingTheme.DARK -> GpReadingTheme.SEPIA
                                GpReadingTheme.SEPIA -> GpReadingTheme.LIGHT
                            }
                            vm.setTheme(next)
                        },
                        onDiscardRecovery = { vm.discardRecoverableAutosave() },
                    )
                    state.errorBanner?.let { err ->
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopCenter)
                                .statusBarsPadding()
                                .padding(top = 56.dp),
                        ) {
                            ErrorBanner(
                                message = err,
                                strings = strings,
                                onDismiss = { vm.setError(null) },
                                onOpenInOtherApp = null,
                            )
                        }
                    }
                }
            } else {
                // MANDATORY FIX 1: Header & toolbars live OUTSIDE the viewport column weight(1f).clipToBounds()
                // so PDF pages physically CANNOT overlap the document header or search strip!
                Column(modifier = Modifier.fillMaxSize()) {
                    AnimatedVisibility(
                        visible = !(state.mode == GpAppMode.VIEW && state.immersiveHidden),
                        enter = expandVertically() + fadeIn(),
                        exit = shrinkVertically() + fadeOut(),
                    ) {
                        Column {
                            if (state.mode == GpAppMode.VIEW) {
                                ViewerTopBar(
                                    state = state,
                                    strings = strings,
                                    isTabletOrWide = isTabletOrWide,
                                    onBackToLibrary = { vm.closeToLibrary() },
                                    onToggleNavigator = {
                                        if (isTabletOrWide) vm.toggleSplitOutline()
                                        else vm.setSheet(GpSheetKind.NAVIGATOR)
                                    },
                                    onToggleSearch = {
                                        val next = if (state.activeSheet == GpSheetKind.SEARCH) GpSheetKind.NONE else GpSheetKind.SEARCH
                                        vm.setSheet(next)
                                    },
                                    onOpenSaveSheet = { vm.setSheet(GpSheetKind.SAVE_WORKFLOW) },
                                    onShare = ::launchSharePdf,
                                    onPrint = ::launchPrintPdf,
                                    onOpenWith = ::launchOpenInOtherApp,
                                    onCopyPageText = { vm.extractActivePageTextAndOpenSheet() },
                                    onOpenSettings = { vm.setSheet(GpSheetKind.SETTINGS) },
                                    onSwitchToEdit = { vm.setMode(GpAppMode.EDIT) },
                                )
                                AnimatedVisibility(visible = state.activeSheet == GpSheetKind.SEARCH) {
                                    ViewerSearchStrip(
                                        state = state,
                                        strings = strings,
                                        onQuerySubmit = { q -> vm.startStreamingSearch(q) },
                                        onStepResult = { d -> vm.stepSearchResult(d) },
                                        onClose = {
                                            vm.startStreamingSearch("")
                                            vm.closeSheet()
                                        },
                                    )
                                }
                            } else {
                                EditorTopBar(
                                    state = state,
                                    strings = strings,
                                    isTabletOrWide = isTabletOrWide,
                                    onDoneToViewer = { vm.setMode(GpAppMode.VIEW) },
                                    onUndo = { vm.undo() },
                                    onRedo = { vm.redo() },
                                    onDeleteSelected = { vm.deleteSelectedElement() },
                                    onSave = { vm.setSheet(GpSheetKind.SAVE_WORKFLOW) },
                                    onShare = ::launchSharePdf,
                                    onPrint = ::launchPrintPdf,
                                    onOpenWith = ::launchOpenInOtherApp,
                                )
                            }

                            state.errorBanner?.let { err ->
                                ErrorBanner(
                                    message = err,
                                    strings = strings,
                                    onDismiss = { vm.setError(null) },
                                    onOpenInOtherApp = if (state.workFilePath != null) ::launchOpenInOtherApp else null,
                                )
                            }
                        }
                    }

                    // Clipped Workspace Region (Split Outline Sidebar on Tablet + PDF Viewport)
                    Row(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .clipToBounds(),
                    ) {
                        if (isTabletOrWide && state.splitOutlineVisible && state.mode == GpAppMode.VIEW) {
                            Surface(
                                color = palette.surfaceRaised,
                                modifier = Modifier.width(260.dp).fillMaxHeight(),
                            ) {
                                Column {
                                    Row(
                                        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(strings.t("nav.outline"), style = GpTypography.label, color = palette.textPrimary, modifier = Modifier.weight(1f))
                                        IconButton(onClick = { vm.toggleSplitOutline() }, modifier = Modifier.size(32.dp)) {
                                            Icon(GpIcons.Close, contentDescription = null, tint = palette.textSecondary, modifier = Modifier.size(16.dp))
                                        }
                                    }
                                    HorizontalDivider(color = palette.borderSubtle)
                                    LazyColumn(contentPadding = PaddingValues(8.dp)) {
                                        if (state.outline.isEmpty()) {
                                            items(state.pages.indices.toList()) { idx ->
                                                Row(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .clickable { vm.jumpToPage(idx) }
                                                        .padding(horizontal = 10.dp, vertical = 8.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                ) {
                                                    Text(
                                                        text = "${strings.t("nav.pages")} ${idx + 1}",
                                                        style = GpTypography.body,
                                                        color = if (idx == state.activePageIndex) palette.accent else palette.textPrimary,
                                                    )
                                                }
                                            }
                                        } else {
                                            items(state.outline) { node ->
                                                Row(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .clickable(enabled = node.pageIndex != null) {
                                                            node.pageIndex?.let { vm.jumpToPage(it) }
                                                        }
                                                        .padding(horizontal = 10.dp, vertical = 9.dp),
                                                    verticalAlignment = Alignment.CenterVertically,
                                                ) {
                                                    Text(node.title, style = GpTypography.body, color = palette.textPrimary, modifier = Modifier.weight(1f))
                                                    node.pageIndex?.let {
                                                        Text("${it + 1}", style = GpTypography.numeric, color = palette.textSecondary)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            VerticalDivider(color = palette.borderSubtle)
                        }

                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight()
                                .clipToBounds(),
                        ) {
                            PdfViewport(
                                state = state,
                                tileCache = vm.tileCache,
                                controller = viewportController,
                                onPositionChanged = { pageIdx, z -> vm.updateViewportPosition(pageIdx, z) },
                                onToggleImmersive = { vm.toggleImmersive() },
                                onAddElement = { el, autoSelect -> vm.addElement(el, autoSelect) },
                                onUpdateElement = { el, record -> vm.updateElement(el, record) },
                                onSelectElement = { id, expandText -> vm.selectElement(id, expandText) },
                                onEraseAt = { pt, pageIdx -> vm.eraseAt(pt, pageIdx) },
                                onEditPdfTextBlock = { pageIdx, blk -> vm.editPdfTextBlock(pageIdx, blk) },
                                onEditPdfImageObject = { pageIdx, img -> vm.editPdfImageObject(pageIdx, img) },
                                onEditPdfShapeObject = { pageIdx, shp -> vm.editPdfShapeObject(pageIdx, shp) },
                                onBeginInlineEdit = { id -> vm.beginInlineEdit(id) },
                                onSelectElementsInRect = { pageIdx, rectPdf, additive -> vm.selectElementsInRect(pageIdx, rectPdf, additive) },
                                onSetSelectedPathVertexIndices = { indices -> vm.setSelectedPathVertexIndices(indices) },
                                onTogglePathVertexIndex = { idx -> vm.togglePathVertexIndex(idx) },
                                onMoveSelectedElementsBy = { pageId, ids, dx, dy -> vm.moveSelectedElementsBy(pageId, ids, dx, dy) },
                                onLongPress = { req -> vm.openContextMenu(req) },
                                onCropUpdate = { el -> vm.updateCrop(el) },
                                onCropFinish = { vm.finishCrop(apply = true) },
                                onLineModeTap = { pageIdx, pt, snapRadius -> vm.handleLineModeTap(pageIdx, pt, snapRadius) },
                                onLineModeDragSegment = { pageIdx, p0, p1 -> vm.startDraggingFirstLineSegment(pageIdx, p0, p1) },
                                onPlaceGhostAt = { pageIdx, pt -> vm.commitGhostSignature(pageIdx, pt) },
                                onTapLink = { link ->
                                    if (link.destPageIndex != null) {
                                        vm.jumpToPage(link.destPageIndex)
                                    } else if (!link.uri.isNullOrEmpty() &&
                                        (link.uri.startsWith("http://", ignoreCase = true) ||
                                            link.uri.startsWith("https://", ignoreCase = true) ||
                                            link.uri.startsWith("mailto:", ignoreCase = true))
                                    ) {
                                        try {
                                            uriHandler.openUri(link.uri)
                                        } catch (_: Exception) {}
                                    }
                                },
                                modifier = Modifier.fillMaxSize(),
                            )

                            // Long-press context menu (touch equivalent of the web right-click menu)
                            val menuReq = state.contextMenu
                            if (menuReq != null && state.mode == GpAppMode.EDIT) {
                                CanvasContextMenu(
                                    request = menuReq,
                                    element = menuReq.elementId?.let { id -> state.elements.firstOrNull { it.id == id && !it.deleted } },
                                    hasClipboard = state.clipboardElement != null,
                                    pageCount = state.pages.size,
                                    strings = strings,
                                    actions = CanvasMenuActions(
                                        onCopy = { vm.copyElement(it) },
                                        onCut = { vm.cutElement(it) },
                                        onPaste = { pIdx, x, y ->
                                            vm.pasteClipboard(pIdx, if (x != null && y != null) GpPoint(x, y) else null)
                                        },
                                        onDuplicate = { vm.duplicateElement(it) },
                                        onDelete = { vm.deleteElement(it) },
                                        onEditText = { id ->
                                            val len = state.elements.firstOrNull { it.id == id }?.text?.length ?: 0
                                            vm.beginInlineEdit(id)
                                            viewportController.requestInlineCaret(len)
                                        },
                                        onFormatText = { id -> vm.selectElement(id); vm.setTextPanelExpanded(true) },
                                        onCrop = { vm.beginCrop(it) },
                                        onFlip = { id, h -> vm.flipElement(id, h) },
                                        onRotate = { id, deg -> vm.rotateElementBy(id, deg) },
                                        onBringFront = { vm.bringForward(it) },
                                        onSendBack = { vm.sendBackward(it) },
                                        onToggleLock = { vm.toggleLockElement(it) },
                                        onApplyAllPages = { vm.applyElementAcrossPages(it, "all") },
                                        onProperties = { id -> vm.selectElement(id); vm.setSheet(GpSheetKind.ELEMENT_INSPECTOR) },
                                        onAddTextAt = { pIdx, x, y -> vm.addTextAt(pIdx, x, y) },
                                        onAddShapeAt = { pIdx, x, y -> vm.addShapeAt(pIdx, x, y) },
                                        onInsertImage = {
                                            imagePickPurpose = ImagePickPurpose.INSERT_IMAGE
                                            openImageLauncher.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/*"))
                                        },
                                        onAddSignature = { vm.setSheet(GpSheetKind.SIGNATURE_STUDIO) },
                                        onBoxSelect = { vm.setMarqueeSelectMode(true) },
                                        onRotatePage = { pIdx -> vm.rotatePageBy(pIdx, 90) },
                                    ),
                                    onDismiss = { vm.dismissContextMenu() },
                                )
                            }

                            // On-page text editing: invisible keyboard target (caret is painted by the viewport).
                            val inlineEl = state.inlineEditElementId?.let { id ->
                                state.elements.firstOrNull { it.id == id && !it.deleted }
                            }
                            if (inlineEl != null && state.mode == GpAppMode.EDIT) {
                                InlineTextKeyboardBridge(
                                    element = inlineEl,
                                    controller = viewportController,
                                    onTextChange = { vm.inlineEditText(it) },
                                )
                            }

                            // Ghost signature Tap-to-Place banner
                            val ghost = state.ghostSignature
                            if (ghost != null) {
                                Surface(
                                    color = palette.surfaceOverlay.copy(alpha = 0.96f),
                                    shape = RoundedCornerShape(14.dp),
                                    border = BorderStroke(1.5.dp, palette.accent),
                                    shadowElevation = 8.dp,
                                    modifier = Modifier
                                        .align(Alignment.TopCenter)
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(
                                            text = strings.t("mobile.tapToPlaceSig"),
                                            style = GpTypography.label,
                                            color = palette.textPrimary,
                                            modifier = Modifier.weight(1f),
                                        )
                                        TextButton(onClick = { vm.setGhostSignature(null) }) {
                                            Text(strings.t("action.cancel"), color = palette.textSecondary)
                                        }
                                        Button(
                                            onClick = { vm.commitGhostSignature() },
                                            colors = ButtonDefaults.buttonColors(containerColor = palette.accent),
                                            modifier = Modifier.height(34.dp),
                                            contentPadding = PaddingValues(horizontal = 12.dp),
                                        ) {
                                            Text(strings.t("mobile.placeGhost"), style = GpTypography.caption)
                                        }
                                    }
                                }
                            }

                            // Bottom dark gradient scrim behind transparent system navigation bar in Viewer mode
                            if (state.mode == GpAppMode.VIEW) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.BottomCenter)
                                        .fillMaxWidth()
                                        .windowInsetsBottomHeight(WindowInsets.navigationBars.add(WindowInsets(bottom = 44.dp)))
                                        .background(
                                            // Black scrim so the system navigation buttons/handle stay
                                            // legible over any page colour (white, black or photo).
                                            Brush.verticalGradient(
                                                0.0f to Color.Transparent,
                                                0.30f to Color.Black.copy(alpha = 0.30f),
                                                0.62f to Color.Black.copy(alpha = 0.62f),
                                                1.0f to Color.Black.copy(alpha = 0.86f),
                                            )
                                        ),
                                )
                            }

                            // Mobile Viewer -> Edit FAB
                            if (state.mode == GpAppMode.VIEW && !isTabletOrWide && !state.immersiveHidden) {
                                FloatingActionButton(
                                    onClick = { vm.setMode(GpAppMode.EDIT) },
                                    containerColor = palette.accent,
                                    contentColor = palette.accentForeground,
                                    modifier = Modifier
                                        .align(if (state.leftHanded) Alignment.BottomStart else Alignment.BottomEnd)
                                        .navigationBarsPadding()
                                        .padding(16.dp),
                                ) {
                                    Icon(GpIcons.Edit, contentDescription = strings.t("action.editPdf"))
                                }
                            }
                        }
                    }

                    // Interactive crop replaces every other editor bar until applied or cancelled.
                    if (state.mode == GpAppMode.EDIT && state.cropElementId != null) {
                        val cropEl = state.elements.firstOrNull { it.id == state.cropElementId }
                        CropModeBar(
                            strings = strings,
                            canReset = cropEl?.cropRect != null,
                            onCancel = { vm.finishCrop(apply = false) },
                            onReset = { vm.resetCrop() },
                            onDone = { vm.finishCrop(apply = true) },
                        )
                    }
                    // Bottom Editor Contextual Bars + Collapsible Text Panel + Primary Tool Dock
                    if (state.mode == GpAppMode.EDIT && state.cropElementId == null) {
                        Column(modifier = Modifier.fillMaxWidth()) {
                            val selected = state.selectedElement

                            when {
                                state.tool == GpEditorTool.SHAPE -> {
                                    ShapeVariantStrip(
                                        activeShapeType = state.activeShapeType,
                                        activeStrokeColor = state.activeStrokeColorValue,
                                        activeFillColor = state.activeFillColorValue,
                                        strings = strings,
                                        onSelectShape = { s -> vm.setActiveShapeStyle(shapeType = s) },
                                        onSelectStrokeColor = { c -> vm.setActiveShapeStyle(strokeColorValue = c) },
                                        onSelectFillColor = { c -> vm.setActiveShapeStyle(fillColorValue = c) },
                                    )
                                }
                                state.tool == GpEditorTool.LINE -> {
                                    PolylineChainingBar(
                                        state = state,
                                        strings = strings,
                                        onUndoVertex = { vm.undoPolylineVertex() },
                                        onFinish = { vm.finishPolylineChaining() },
                                    )
                                }
                                state.selectedElementIds.size >= 2 -> {
                                    MultiSelectAlignBar(
                                        selectedCount = state.selectedElementIds.size,
                                        strings = strings,
                                        onAlign = { action -> vm.alignSelectedElements(action) },
                                        onDelete = { vm.deleteSelectedElement() },
                                        onClose = { vm.selectElement(null) },
                                    )
                                }
                                selected != null && selected.isTextKind -> {
                                    // MANDATORY FIX 6: Collapsed by default -> ONLY upward chevron (`^`) pill until tapped!
                                    CollapsibleBottomTextPanel(
                                        element = selected,
                                        expanded = state.textPanelExpanded,
                                        strings = strings,
                                        onToggleExpanded = { exp -> vm.setTextPanelExpanded(exp) },
                                        onUpdate = { el, rec -> vm.updateElement(el, rec) },
                                        onOpenFullInspector = { vm.setSheet(GpSheetKind.ELEMENT_INSPECTOR) },
                                        onDuplicate = { vm.duplicateElement(selected.id) },
                                        onDelete = { vm.deleteSelectedElement() },
                                        customTtfBytes = state.customTtfBytes,
                                        customFontLabel = state.customFontLabel,
                                        extractedFonts = state.pages.getOrNull(state.activePageIndex)?.let { p ->
                                            state.extractedFonts[p.sourceDocId].orEmpty()
                                        }.orEmpty(),
                                        onPickCustomFont = { openFontLauncher.launch(arrayOf("font/ttf", "application/x-font-ttf", "application/octet-stream", "*/*")) },
                                    )
                                }
                                selected != null -> {
                                    CompactElementSelectionBar(
                                        element = selected,
                                        strings = strings,
                                        onUpdate = { el, rec -> vm.updateElement(el, rec) },
                                        onOpenFullInspector = { vm.setSheet(GpSheetKind.ELEMENT_INSPECTOR) },
                                        onDuplicate = { vm.duplicateElement(selected.id) },
                                        onDelete = { vm.deleteSelectedElement() },
                                        onClose = { vm.selectElement(null) },
                                        onCrop = if (selected.kind == "image" || selected.kind == "imageReplacement") {
                                            { vm.beginCrop(selected.id) }
                                        } else null,
                                        selectedVertexIndices = state.selectedPathVertexIndices,
                                        marqueeSelectMode = state.marqueeSelectMode,
                                        onToggleMarqueeSelect = { vm.toggleMarqueeSelectMode() },
                                        onToggleVerticesSmooth = { force ->
                                            vm.togglePathVerticesSmooth(selected.id, state.selectedPathVertexIndices, force)
                                        },
                                        onDeleteSelectedVertices = {
                                            vm.deletePathVertices(selected.id, state.selectedPathVertexIndices)
                                        },
                                    )
                                }
                            }

                            EditorToolDock(
                                activeTool = state.tool,
                                toolLocked = state.toolLocked,
                                strings = strings,
                                onSelectTool = { t -> vm.setTool(t) },
                                onToggleToolLock = { vm.toggleToolLocked() },
                                onOpenSignatureStudio = { vm.setSheet(GpSheetKind.SIGNATURE_STUDIO) },
                                onInsertImage = {
                                    imagePickPurpose = ImagePickPurpose.INSERT_IMAGE
                                    openImageLauncher.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/*"))
                                },
                                onOpenOrganizeSheet = { vm.setSheet(GpSheetKind.ORGANIZE) },
                                marqueeSelectMode = state.marqueeSelectMode,
                                onToggleMarqueeSelect = { vm.toggleMarqueeSelectMode() },
                            )
                        }
                    }
                }
            }

            // Loading HUD
            if (state.isLoading) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0x66000000))
                        .clickable(enabled = true) {},
                    contentAlignment = Alignment.Center,
                ) {
                    Surface(
                        color = palette.surfaceRaised,
                        shape = RoundedCornerShape(16.dp),
                        shadowElevation = 8.dp,
                    ) {
                        Column(
                            modifier = Modifier.padding(horizontal = 24.dp, vertical = 20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            CircularProgressIndicator(color = palette.accent, modifier = Modifier.size(34.dp))
                            Spacer(Modifier.height(10.dp))
                            Text(
                                text = strings.t("status.loading"),
                                style = GpTypography.label,
                                color = palette.textPrimary,
                            )
                        }
                    }
                }
            }
        }
    }

    // Active Sheets & Dialogs
    when (state.activeSheet) {
        GpSheetKind.NAVIGATOR -> NavigatorSheet(
            state = state,
            strings = strings,
            tileCache = vm.tileCache,
            onSelectPage = { p -> vm.jumpToPage(p) },
            onDismiss = { vm.closeSheet() },
        )

        GpSheetKind.SAVE_WORKFLOW -> SaveWorkflowSheet(
            state = state,
            strings = strings,
            onSaveAsCopy = ::launchSaveAsCopy,
            onOverwriteOriginal = { vm.overwriteOriginal { p, name -> pendingCompiledExportPath = p; createPdfLauncher.launch(name) } },
            onSetDontAsk = { vm.setDontAskOverwrite(it) },
            onShare = ::launchSharePdf,
            onDismiss = { vm.closeSheet() },
        )

        GpSheetKind.SETTINGS -> SettingsSheet(
            state = state,
            strings = strings,
            onSetLocale = { vm.setLocale(it) },
            onSetTheme = { vm.setTheme(it) },
            onToggleDarkInvert = { vm.toggleDarkPaperInvert() },
            onToggleLeftHanded = { vm.toggleLeftHanded() },
            onDismiss = { vm.closeSheet() },
        )

        GpSheetKind.PAGE_TEXT -> PageTextSheet(
            state = state,
            strings = strings,
            onCopied = { msg -> vm.showToast(msg) },
            onDismiss = { vm.closeSheet() },
        )

        GpSheetKind.ELEMENT_INSPECTOR -> {
            val sel = state.selectedElement
            if (sel != null) {
                ElementInspectorSheet(
                    element = sel,
                    state = state,
                    strings = strings,
                    onUpdate = { next -> vm.updateElement(next, true) },
                    onPickCustomFont = { openFontLauncher.launch(arrayOf("*/*")) },
                    onBringForward = { vm.bringForward(sel.id) },
                    onSendBackward = { vm.sendBackward(sel.id) },
                    onDuplicate = { vm.duplicateElement(sel.id); vm.closeSheet() },
                    onToggleLock = { vm.toggleLockElement(sel.id) },
                    onStartCrop = { vm.beginCrop(sel.id) },
                    onApplyAllPages = { sc -> vm.applyElementAcrossPages(sel.id, sc); vm.closeSheet() },
                    onDelete = { vm.deleteSelectedElement(); vm.closeSheet() },
                    onDismiss = { vm.closeSheet() },
                    selectedVertexIndices = state.selectedPathVertexIndices,
                    onToggleVerticesSmooth = { force ->
                        vm.togglePathVerticesSmooth(sel.id, state.selectedPathVertexIndices, force)
                    },
                    onDeleteSelectedVertices = {
                        vm.deletePathVertices(sel.id, state.selectedPathVertexIndices)
                    },
                )
            } else {
                vm.closeSheet()
            }
        }

        GpSheetKind.SIGNATURE_STUDIO -> SignatureStudioSheet(
            state = state,
            strings = strings,
            uploadedImageBytes = uploadedSigBytes,
            onPickUploadImage = {
                imagePickPurpose = ImagePickPurpose.SIGNATURE_UPLOAD
                openImageLauncher.launch(arrayOf("image/png", "image/jpeg", "image/webp", "image/*"))
            },
            onClearUploadedImage = { uploadedSigBytes = null },
            onPlaceGhost = { ghost -> vm.setGhostSignature(ghost) },
            onSaveToVault = { sig ->
                vm.saveSignatureToVault(sig)
                vm.showToast(if (strings.isTr) "İmza kasaya kaydedildi" else "Saved to signature vault")
            },
            onDeleteFromVault = { id -> vm.deleteSignatureFromVault(id) },
            onDismiss = { vm.closeSheet() },
        )

        GpSheetKind.ORGANIZE -> PageOrganizerSheet(
            state = state,
            strings = strings,
            tileCache = vm.tileCache,
            onJumpToPage = { p -> vm.jumpToPage(p) },
            onAddBlankPageAfter = { p -> vm.insertBlankPageAfter(p) },
            onMergeExternalPdf = { mergePdfLauncher.launch(arrayOf("application/pdf")) },
            onOpenPageNumbering = { vm.setSheet(GpSheetKind.PAGE_NUMBERING) },
            onRotatePage = { idx, deg -> vm.rotatePageBy(idx, deg) },
            onMovePage = { f, t -> vm.movePage(f, t) },
            onDuplicatePage = { idx -> vm.duplicatePageAt(idx) },
            onDeletePage = { idx -> vm.deletePageAt(idx) },
            onBatchRotate = { set, deg -> vm.batchRotatePages(set, deg) },
            onBatchDelete = { set -> vm.batchDeletePages(set) },
            onSplitExtract = { set ->
                vm.closeSheet()
                vm.prepareSplitExtract(set) { compiledPath, suggestedName ->
                    pendingCompiledExportPath = compiledPath
                    createPdfLauncher.launch(suggestedName)
                }
            },
            onDismiss = { vm.closeSheet() },
        )

        GpSheetKind.PAGE_NUMBERING -> PageNumberingSheet(
            config = state.pageNumbering,
            totalPages = state.pages.size,
            strings = strings,
            onUpdate = { cfg -> vm.setPageNumbering(cfg) },
            onDismiss = { vm.setSheet(GpSheetKind.ORGANIZE) },
        )

        GpSheetKind.NONE, GpSheetKind.SEARCH -> {}
    }

    if (state.passwordRequiredForPath != null) {
        PasswordPromptDialog(
            state = state,
            strings = strings,
            onSubmit = { pw -> vm.submitPassword(pw) },
            onCancel = { vm.clearPasswordPrompt() },
        )
    }
}
