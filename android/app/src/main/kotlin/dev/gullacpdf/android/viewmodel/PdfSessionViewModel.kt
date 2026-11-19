package dev.gullacpdf.android.viewmodel

import android.app.Application
import android.graphics.BitmapFactory
import androidx.compose.runtime.Immutable
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.gullacpdf.android.data.AndroidFileBridge
import dev.gullacpdf.android.data.GpOpenRequest
import dev.gullacpdf.android.data.PreferencesStore
import dev.gullacpdf.android.engine.DirectBufferPool
import dev.gullacpdf.android.engine.NativePdfBridge
import dev.gullacpdf.android.engine.TileBitmapCache
import dev.gullacpdf.android.engine.TileKey
import dev.gullacpdf.android.l10n.GpLocale
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpAppMode
import dev.gullacpdf.android.model.GpCleanElementMeta
import dev.gullacpdf.android.model.GpDetectedImageObj
import dev.gullacpdf.android.model.GpDetectedShapeObj
import dev.gullacpdf.android.model.GpDetectedTextBlock
import dev.gullacpdf.android.model.GpEditorTool
import dev.gullacpdf.android.model.GpExtractedFontInfo
import dev.gullacpdf.android.model.GpGhostSignature
import dev.gullacpdf.android.model.GpOutlineNode
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.GpPageAnalysis
import dev.gullacpdf.android.model.GpPageLink
import dev.gullacpdf.android.model.GpPageMeta
import dev.gullacpdf.android.model.GpPageNumberingConfig
import dev.gullacpdf.android.model.GpPoint
import dev.gullacpdf.android.model.GpRectF
import dev.gullacpdf.android.model.GpRecentDoc
import dev.gullacpdf.android.model.GpSavedSignature
import dev.gullacpdf.android.model.GpSearchMatch
import dev.gullacpdf.android.model.GpSheetKind
import dev.gullacpdf.android.theme.GpReadingTheme
import dev.gullacpdf.android.ui.text.GpTextEngine
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt

@Immutable
data class GpAppState(
    val docId: String? = null,
    val sourceUri: String? = null,
    val workFilePath: String? = null,
    val displayName: String = "",
    val writable: Boolean = false,
    val canCopyText: Boolean = true,
    val mode: GpAppMode = GpAppMode.VIEW,
    val tool: GpEditorTool = GpEditorTool.SELECT,
    val toolLocked: Boolean = false,
    val textPanelExpanded: Boolean = false,
    val theme: GpReadingTheme = GpReadingTheme.DARK,
    val darkPaperInvert: Boolean = false,
    val locale: GpLocale = GpLocale.EN,
    val leftHanded: Boolean = false,
    val pages: List<GpPageMeta> = emptyList(),
    val outline: List<GpOutlineNode> = emptyList(),
    val elements: List<GpOverlayElement> = emptyList(),
    val undoStack: List<List<GpOverlayElement>> = emptyList(),
    val redoStack: List<List<GpOverlayElement>> = emptyList(),
    val selectedElementId: String? = null,
    val selectedElementIds: Set<String> = emptySet(),
    val marqueeSelectMode: Boolean = false,
    val selectedPathVertexIndices: Set<Int> = emptySet(),
    val activePolylineId: String? = null,
    val activePolylinePrepend: Boolean = false,
    val pendingPolylinePageIndex: Int? = null,
    val pendingPolylineAnchor: GpPoint? = null,
    val activePageIndex: Int = 0,
    val zoom: Float = 1f,
    val dirty: Boolean = false,
    val isLoading: Boolean = false,
    val errorBanner: String? = null,
    val statusToast: String? = null,
    val passwordRequiredForPath: String? = null,
    val passwordInvalid: Boolean = false,
    val immersiveHidden: Boolean = false,
    val activeSheet: GpSheetKind = GpSheetKind.NONE,
    val splitOutlineVisible: Boolean = false,
    val searchQuery: String = "",
    val searchMatchCase: Boolean = false,
    val searchWholeWord: Boolean = false,
    val searchHits: List<GpSearchMatch> = emptyList(),
    val activeSearchIdx: Int = 0,
    val searchScanning: Boolean = false,
    val overwriteDontAskAgain: Boolean = false,
    val recentDocs: List<GpRecentDoc> = emptyList(),
    val ghostSignature: GpGhostSignature? = null,
    val recoverableAutosaveJson: String? = null,
    val activeShapeType: String = "rect",
    val activeStrokeColorValue: Int = 0xFF2563EB.toInt(),
    val activeFillColorValue: Int = 0x00000000,
    val activeStrokeWidth: Double = 2.5,
    val activeTextColorValue: Int = 0xFF0F172A.toInt(),
    val activeTextBgColorValue: Int = 0x00000000,
    val pageNumbering: GpPageNumberingConfig = GpPageNumberingConfig(),
    val customTtfBytes: ByteArray? = null,
    val customFontLabel: String? = null,
    val extractedFonts: Map<String, List<GpExtractedFontInfo>> = emptyMap(),
    val savedSignatures: List<GpSavedSignature> = emptyList(),
    val pageAnalyses: Map<String, GpPageAnalysis> = emptyMap(),
    val cleanPreviewDocIds: Map<String, String> = emptyMap(),
    /** cleanDocId -> what that clean preview already contains per element id. */
    val cleanPreviewMeta: Map<String, Map<String, GpCleanElementMeta>> = emptyMap(),
    /** Text element being edited directly on the page (caret + keyboard). */
    val inlineEditElementId: String? = null,
    val pageLinks: Map<Int, List<GpPageLink>> = emptyMap(),
    val pageTextPreview: String = "",
    val jumpToPageEvent: Pair<Int, Long>? = null,
) {
    val hasDocument: Boolean get() = docId != null && pages.isNotEmpty()
    val canUndo: Boolean get() = undoStack.isNotEmpty()
    val canRedo: Boolean get() = redoStack.isNotEmpty()
    val selectedElement: GpOverlayElement?
        get() = selectedElementId?.let { id -> elements.firstOrNull { it.id == id && !it.deleted } }
    val selectedElements: List<GpOverlayElement>
        get() = elements.filter { it.id in selectedElementIds && !it.deleted }
}

class PdfSessionViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = PreferencesStore(application)
    val fileBridge = AndroidFileBridge(application)
    val tileCache = TileBitmapCache(
        maxBytes = (Runtime.getRuntime().maxMemory() / 6L).toInt().coerceIn(32 * 1024 * 1024, 128 * 1024 * 1024)
    )
    private val previewBufferPool = DirectBufferPool(maxPoolSize = 2)

    private val _state = MutableStateFlow(
        GpAppState(
            locale = prefs.loadLocale(),
            theme = prefs.loadTheme(),
            darkPaperInvert = prefs.loadDarkInvert(),
            leftHanded = prefs.loadLeftHanded(),
            overwriteDontAskAgain = prefs.loadDontAskOverwrite(),
            recentDocs = prefs.loadRecents(),
            savedSignatures = prefs.loadSavedSignatures(),
            recoverableAutosaveJson = prefs.loadAutosave(),
        )
    )
    val state: StateFlow<GpAppState> = _state.asStateFlow()

    private val analyzingPageKeys = mutableSetOf<String>()
    private var fontLookupSource: Map<String, List<GpExtractedFontInfo>>? = null
    private var fontLookup: Map<String, GpExtractedFontInfo> = emptyMap()
    private var inlineHistoryPushed = false

    init {
        GpTextEngine.init(application)
    }

    /** Embedded fonts of all open documents keyed by font id (identity-stable per state). */
    private fun docFontLookup(st: GpAppState = _state.value): Map<String, GpExtractedFontInfo> {
        if (fontLookupSource !== st.extractedFonts) {
            fontLookupSource = st.extractedFonts
            fontLookup = buildMap { st.extractedFonts.values.forEach { list -> list.forEach { put(it.id, it) } } }
        }
        GpTextEngine.setCustomTtf(st.customTtfBytes)
        return fontLookup
    }

    /** Adds editor-exact layout data to an element's engine JSON. */
    private fun decorateForEngine(fonts: Map<String, GpExtractedFontInfo>): (GpOverlayElement, JSONObject) -> Unit =
        { el, json -> GpTextEngine.decorateExportJson(el, json, fonts) }

    /** What a clean preview built from [el] contains (compared later by the painter). */
    private fun cleanMetaFor(el: GpOverlayElement, fonts: Map<String, GpExtractedFontInfo>): GpCleanElementMeta = when {
        el.deleted -> GpCleanElementMeta(wholeBlock = true)
        el.movesInPlace() -> GpCleanElementMeta(placementSig = el.placementSignature())
        GpTextEngine.handles(el) -> {
            val strip = GpTextEngine.stripSignature(el, fonts)
            if (strip == null) GpCleanElementMeta(wholeBlock = true) else GpCleanElementMeta(strippedLines = strip)
        }
        else -> GpCleanElementMeta(wholeBlock = true)
    }

    private fun List<GpOverlayElement>.withoutStalePristineTextEdits(
        keepIds: Set<String>,
        inlineId: String? = null,
    ): List<GpOverlayElement> = filterNot {
        it.kind == "textEdit" && it.pristine && !it.deleted && it.id !in keepIds && it.id != inlineId
    }

    fun beginInlineEdit(id: String) {
        val el = _state.value.elements.firstOrNull { it.id == id && !it.deleted && it.isTextKind } ?: return
        inlineHistoryPushed = false
        _state.update {
            val nextIds = setOf(el.id)
            it.copy(
                elements = it.elements.withoutStalePristineTextEdits(nextIds, el.id),
                inlineEditElementId = el.id,
                selectedElementId = el.id,
                selectedElementIds = nextIds,
                selectedPathVertexIndices = emptySet(),
                textPanelExpanded = false,
            )
        }
    }

    fun endInlineEdit() {
        if (_state.value.inlineEditElementId != null) {
            _state.update { it.copy(inlineEditElementId = null) }
        }
    }

    /** Typing on the page: one undo step per editing session, live preview for every key. */
    fun inlineEditText(updated: GpOverlayElement) {
        val record = !inlineHistoryPushed
        inlineHistoryPushed = true
        updateElement(updated, recordHistory = record)
    }
    private val extractedImageBytes = HashMap<String, ByteArray>()
    private val extractedLinkPages = mutableSetOf<Int>()
    private val cleanPreviewGenByPage = HashMap<String, Long>()
    private var searchJob: Job? = null
    private var autosaveJob: Job? = null

    fun setLocale(locale: GpLocale) {
        prefs.saveLocale(locale)
        _state.update { it.copy(locale = locale) }
    }

    fun setTheme(theme: GpReadingTheme) {
        tileCache.clear()
        prefs.saveTheme(theme)
        _state.update { it.copy(theme = theme) }
    }

    fun toggleDarkPaperInvert() {
        tileCache.clear()
        val next = !_state.value.darkPaperInvert
        prefs.saveDarkInvert(next)
        _state.update { it.copy(darkPaperInvert = next) }
    }

    fun toggleLeftHanded() {
        val next = !_state.value.leftHanded
        prefs.saveLeftHanded(next)
        _state.update { it.copy(leftHanded = next) }
    }

    fun setDontAskOverwrite(value: Boolean) {
        prefs.saveDontAskOverwrite(value)
        _state.update { it.copy(overwriteDontAskAgain = value) }
    }

    fun setError(msg: String?) = _state.update { it.copy(errorBanner = msg) }
    fun clearStatusToast() = _state.update { it.copy(statusToast = null) }
    fun showToast(msg: String) = _state.update { it.copy(statusToast = msg) }

    fun discardRecoverableAutosave() {
        prefs.clearAutosave()
        _state.update { it.copy(recoverableAutosaveJson = null) }
    }

    fun toggleImmersive() {
        _state.update { it.copy(immersiveHidden = !it.immersiveHidden) }
    }

    fun toggleSplitOutline() {
        _state.update { it.copy(splitOutlineVisible = !it.splitOutlineVisible) }
    }

    fun setSheet(sheet: GpSheetKind) {
        _state.update { st ->
            st.copy(activeSheet = if (st.activeSheet == sheet) GpSheetKind.NONE else sheet)
        }
    }

    fun closeSheet() {
        _state.update { it.copy(activeSheet = GpSheetKind.NONE) }
    }

    fun setMode(next: GpAppMode) {
        _state.update { st ->
            val nextSelectedId = if (next == GpAppMode.VIEW) null else st.selectedElementId
            val nextSelectedIds = if (next == GpAppMode.VIEW) emptySet() else st.selectedElementIds
            val nextInline = if (next == GpAppMode.VIEW) null else st.inlineEditElementId
            st.copy(
                mode = next,
                tool = if (next == GpAppMode.VIEW) GpEditorTool.SELECT else st.tool,
                marqueeSelectMode = if (next == GpAppMode.VIEW) false else st.marqueeSelectMode,
                activeSheet = GpSheetKind.NONE,
                selectedElementId = nextSelectedId,
                selectedElementIds = nextSelectedIds,
                selectedPathVertexIndices = if (next == GpAppMode.VIEW) emptySet() else st.selectedPathVertexIndices,
                inlineEditElementId = nextInline,
                textPanelExpanded = if (next == GpAppMode.VIEW) false else st.textPanelExpanded,
                activePolylineId = if (next == GpAppMode.VIEW) null else st.activePolylineId,
                pendingPolylinePageIndex = null,
                pendingPolylineAnchor = null,
                elements = st.elements.withoutStalePristineTextEdits(nextSelectedIds, nextInline),
            )
        }
        if (next == GpAppMode.EDIT) {
            analyzePageIfNeeded(_state.value.activePageIndex)
        }
    }

    fun setTool(tool: GpEditorTool) {
        _state.update { st ->
            val keepSel = tool == GpEditorTool.SELECT || tool == GpEditorTool.TEXT
            val nextIds = if (keepSel) st.selectedElementIds else emptySet()
            val nextPrimary = if (keepSel) st.selectedElementId else null
            val nextInline = if (keepSel) st.inlineEditElementId else null
            st.copy(
                tool = tool,
                marqueeSelectMode = false,
                selectedElementId = nextPrimary,
                selectedElementIds = nextIds,
                selectedPathVertexIndices = if (tool == GpEditorTool.SELECT) st.selectedPathVertexIndices else emptySet(),
                inlineEditElementId = nextInline,
                elements = st.elements.withoutStalePristineTextEdits(nextIds, nextInline),
                activePolylineId = if (tool == GpEditorTool.LINE) st.activePolylineId else null,
                pendingPolylinePageIndex = if (tool == GpEditorTool.LINE) st.pendingPolylinePageIndex else null,
                pendingPolylineAnchor = if (tool == GpEditorTool.LINE) st.pendingPolylineAnchor else null,
                textPanelExpanded = if (tool != GpEditorTool.TEXT && st.selectedElement?.isTextKind != true) false else st.textPanelExpanded,
            )
        }
    }

    fun setMarqueeSelectMode(enabled: Boolean) {
        _state.update { st ->
            st.copy(
                tool = if (enabled) GpEditorTool.SELECT else st.tool,
                marqueeSelectMode = enabled,
            )
        }
    }

    fun toggleMarqueeSelectMode() {
        setMarqueeSelectMode(!_state.value.marqueeSelectMode)
    }

    fun setSelectedPathVertexIndices(indices: Set<Int>) {
        _state.update { st ->
            val sel = st.selectedElement
            val valid = if (sel != null && sel.kind == "path") {
                indices.filter { it in sel.points.indices }.toSet()
            } else {
                emptySet()
            }
            st.copy(
                selectedPathVertexIndices = valid,
                marqueeSelectMode = if (valid.isNotEmpty() && !st.toolLocked) false else st.marqueeSelectMode,
            )
        }
    }

    fun togglePathVertexIndex(index: Int) {
        _state.update { st ->
            val sel = st.selectedElement
            if (sel == null || sel.kind != "path" || index !in sel.points.indices) return@update st
            val next = if (index in st.selectedPathVertexIndices) {
                st.selectedPathVertexIndices - index
            } else {
                st.selectedPathVertexIndices + index
            }
            st.copy(selectedPathVertexIndices = next)
        }
    }

    fun toggleToolLocked() {
        _state.update { it.copy(toolLocked = !it.toolLocked) }
    }

    fun setTextPanelExpanded(expanded: Boolean) {
        _state.update { it.copy(textPanelExpanded = expanded) }
    }

    fun updateViewportPosition(pageIndex: Int, zoom: Float) {
        val st = _state.value
        if (st.activePageIndex != pageIndex || kotlin.math.abs(st.zoom - zoom) > 0.05f) {
            _state.update { it.copy(activePageIndex = pageIndex, zoom = zoom) }
        }
        extractLinksIfNeeded(pageIndex)
        if (st.mode == GpAppMode.EDIT) {
            analyzePageIfNeeded(pageIndex)
        }
    }

    fun jumpToPage(pageIndex: Int) {
        _state.update { st ->
            val clamped = pageIndex.coerceIn(0, (st.pages.size - 1).coerceAtLeast(0))
            st.copy(activePageIndex = clamped, jumpToPageEvent = clamped to System.nanoTime())
        }
    }

    fun consumeIncomingOpenRequest(req: GpOpenRequest) {
        if (req.uris.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, errorBanner = null) }
            try {
                val work = fileBridge.copyToWorkFile(req.uris.first(), req.displayName)
                openWorkFileInternal(
                    path = work.workPath,
                    displayName = work.displayName,
                    sourceUri = req.sourceId,
                    writable = req.writable,
                )
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, errorBanner = e.message ?: "Failed opening file") }
            }
        }
    }

    fun reopenRecent(doc: GpRecentDoc, onNeedPicker: () -> Unit) {
        viewModelScope.launch {
            if (doc.sourceId.startsWith("/")) {
                val f = File(doc.sourceId)
                if (f.exists()) {
                    _state.update { it.copy(isLoading = true) }
                    openWorkFileInternal(
                        path = doc.sourceId,
                        displayName = doc.displayName,
                        sourceUri = null,
                        writable = doc.writable,
                    )
                    return@launch
                }
            } else if (doc.sourceId.startsWith("content://") || doc.sourceId.startsWith("file://")) {
                try {
                    _state.update { it.copy(isLoading = true) }
                    val work = fileBridge.copyToWorkFile(doc.sourceId, doc.displayName)
                    openWorkFileInternal(
                        path = work.workPath,
                        displayName = work.displayName,
                        sourceUri = doc.sourceId,
                        writable = doc.writable,
                    )
                    return@launch
                } catch (_: Exception) {
                    _state.update { it.copy(isLoading = false) }
                }
            }
            onNeedPicker()
        }
    }

    fun createBlankDocument() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, errorBanner = null) }
            try {
                val blankFile = File(getApplication<Application>().cacheDir, "work/blank_${System.currentTimeMillis()}.pdf")
                blankFile.parentFile?.mkdirs()
                val blankPage = GpPageMeta(
                    id = "blank_p0",
                    sourceDocId = "blank",
                    sourcePageIndex = 0,
                    baseWidth = 595.0,
                    baseHeight = 842.0,
                    intrinsicRotation = 0,
                )
                val out = NativePdfBridge.compileAndSaveVerified(
                    context = getApplication(),
                    pages = listOf(blankPage),
                    elements = emptyList(),
                    outputPath = blankFile.absolutePath,
                    pageNumbering = null,
                    customTtfBytes = null,
                )
                if (!out.ok) throw IllegalStateException(out.error ?: "Failed creating blank PDF")
                openWorkFileInternal(
                    path = blankFile.absolutePath,
                    displayName = "Blank-Document.pdf",
                    sourceUri = null,
                    writable = false,
                    openInEditMode = true,
                )
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, errorBanner = e.message ?: "Failed creating blank PDF") }
            }
        }
    }

    fun submitPassword(pw: String) {
        val st = _state.value
        val path = st.passwordRequiredForPath ?: return
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            openWorkFileInternal(
                path = path,
                displayName = st.displayName,
                sourceUri = st.sourceUri,
                writable = st.writable,
                password = pw,
            )
        }
    }

    fun clearPasswordPrompt() {
        _state.update { it.copy(passwordRequiredForPath = null, passwordInvalid = false, isLoading = false) }
    }

    private suspend fun openWorkFileInternal(
        path: String,
        displayName: String,
        sourceUri: String?,
        writable: Boolean,
        password: String? = null,
        openInEditMode: Boolean = false,
    ) {
        val docId = "doc_${System.currentTimeMillis()}"
        try {
            val outcome = NativePdfBridge.openDocumentFile(docId, path, password)
            if (outcome.status == "needs-password" || outcome.status == "invalid-password") {
                _state.update {
                    it.copy(
                        isLoading = false,
                        passwordRequiredForPath = path,
                        displayName = displayName,
                        sourceUri = sourceUri,
                        writable = writable,
                        passwordInvalid = outcome.status == "invalid-password",
                    )
                }
                return
            }
            if (!outcome.ok || outcome.pages.isEmpty()) {
                _state.update {
                    it.copy(
                        isLoading = false,
                        errorBanner = outcome.error ?: "Unable to open PDF document",
                    )
                }
                return
            }

            val prevDoc = _state.value.docId
            if (prevDoc != null && prevDoc != docId) {
                tileCache.invalidateDoc(prevDoc)
                NativePdfBridge.closeDocument(prevDoc)
            }
            analyzingPageKeys.clear()
            extractedLinkPages.clear()
            extractedImageBytes.clear()
            searchJob?.cancel()

            val nextRecents = (listOf(
                GpRecentDoc(
                    sourceId = sourceUri ?: path,
                    displayName = displayName,
                    lastOpenedMs = System.currentTimeMillis(),
                    lastPageIndex = 0,
                    lastZoom = 1.0,
                    writable = writable,
                )
            ) + _state.value.recentDocs.filter { it.sourceId != (sourceUri ?: path) }).take(20)
            prefs.saveRecents(nextRecents)

            _state.update {
                it.copy(
                    docId = docId,
                    sourceUri = sourceUri,
                    workFilePath = path,
                    displayName = displayName,
                    writable = writable,
                    canCopyText = outcome.canCopyText,
                    mode = if (openInEditMode) GpAppMode.EDIT else GpAppMode.VIEW,
                    tool = GpEditorTool.SELECT,
                    textPanelExpanded = false,
                    pages = outcome.pages,
                    outline = outcome.outline,
                    elements = emptyList(),
                    undoStack = emptyList(),
                    redoStack = emptyList(),
                    selectedElementId = null,
                    selectedElementIds = emptySet(),
                    marqueeSelectMode = false,
                    selectedPathVertexIndices = emptySet(),
                    activePolylineId = null,
                    pendingPolylinePageIndex = null,
                    pendingPolylineAnchor = null,
                    activePageIndex = 0,
                    zoom = 1f,
                    dirty = false,
                    isLoading = false,
                    errorBanner = null,
                    passwordRequiredForPath = null,
                    passwordInvalid = false,
                    activeSheet = GpSheetKind.NONE,
                    searchQuery = "",
                    searchHits = emptyList(),
                    activeSearchIdx = 0,
                    searchScanning = false,
                    recentDocs = nextRecents,
                    ghostSignature = null,
                    pageNumbering = GpPageNumberingConfig(),
                    customTtfBytes = it.customTtfBytes,
                    customFontLabel = it.customFontLabel,
                    extractedFonts = emptyMap(),
                    pageAnalyses = emptyMap(),
                    cleanPreviewDocIds = emptyMap(),
                    cleanPreviewMeta = emptyMap(),
                    inlineEditElementId = null,
                    pageLinks = emptyMap(),
                )
            }
            viewModelScope.launch {
                val fonts = NativePdfBridge.extractEmbeddedFonts(getApplication(), docId)
                if (_state.value.docId == docId && fonts.isNotEmpty()) {
                    _state.update { cur -> cur.copy(extractedFonts = cur.extractedFonts + (docId to fonts)) }
                }
            }
            analyzePageIfNeeded(0)
        } catch (e: Exception) {
            _state.update { it.copy(isLoading = false, errorBanner = e.message ?: "Failed loading PDF") }
        }
    }

    fun closeToLibrary() {
        val id = _state.value.docId
        val cleanIds = _state.value.cleanPreviewDocIds.values.toList()
        searchJob?.cancel()
        extractedImageBytes.clear()
        tileCache.clear()
        viewModelScope.launch {
            if (id != null) NativePdfBridge.closeDocument(id)
            for (cid in cleanIds) NativePdfBridge.closeDocument(cid)
        }
        _state.update { st ->
            GpAppState(
                locale = st.locale,
                theme = st.theme,
                darkPaperInvert = st.darkPaperInvert,
                leftHanded = st.leftHanded,
                overwriteDontAskAgain = st.overwriteDontAskAgain,
                recentDocs = st.recentDocs,
                savedSignatures = st.savedSignatures,
            )
        }
    }

    fun extractLinksIfNeeded(pageIndex: Int) {
        val st = _state.value
        if (st.docId == null || pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        if (page.sourceDocId == "blank") return
        if (!st.pageLinks.containsKey(page.sourcePageIndex) && extractedLinkPages.add(page.sourcePageIndex)) {
            viewModelScope.launch {
                val links = NativePdfBridge.extractPageLinks(page.sourceDocId, page.sourcePageIndex)
                if (_state.value.docId != st.docId) return@launch
                if (links.isNotEmpty()) {
                    _state.update { cur -> cur.copy(pageLinks = cur.pageLinks + (page.sourcePageIndex to links)) }
                }
            }
        }
    }

    fun analyzePageIfNeeded(pageIndex: Int) {
        val st = _state.value
        if (st.docId == null || pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        if (page.sourceDocId == "blank") return

        extractLinksIfNeeded(pageIndex)

        val key = "${page.sourceDocId}:${page.sourcePageIndex}:${page.id}"
        if (!st.pageAnalyses.containsKey(page.id) && analyzingPageKeys.add(key)) {
            viewModelScope.launch {
                val raw = NativePdfBridge.analyzePageObjectsJson(page.sourceDocId, page.sourcePageIndex, page.id)
                if (_state.value.docId != st.docId) return@launch
                if (raw.isNotBlank() && raw.trim() != "{}") {
                    val parsed = GpPageAnalysis.fromJsonString(raw)
                    _state.update { cur -> cur.copy(pageAnalyses = cur.pageAnalyses + (page.id to parsed)) }
                } else {
                    analyzingPageKeys.remove(key)
                }
            }
        }
    }

    fun extractActivePageTextAndOpenSheet() {
        val st = _state.value
        val docId = st.docId ?: return
        if (st.pages.isEmpty()) return
        val page = st.pages[st.activePageIndex.coerceIn(0, st.pages.size - 1)]
        viewModelScope.launch {
            val txt = NativePdfBridge.extractPageText(page.sourceDocId.takeIf { it != "blank" } ?: docId, page.sourcePageIndex)
            _state.update { it.copy(pageTextPreview = txt, activeSheet = GpSheetKind.PAGE_TEXT) }
        }
    }

    private fun rebuildCleanPreviewForPage(pageId: String?) {
        if (pageId == null) return
        val st = _state.value
        val page = st.pages.firstOrNull { it.id == pageId } ?: return
        if (page.sourceDocId == "blank") return
        val analysis = st.pageAnalyses[page.id]
        val relevant = st.elements.filter {
            it.pageId == page.id && it.isPdfSourceKind && !it.staysInPdfRaster(analysis)
        }
        val previewTransparentBg = st.elements.any {
            !it.deleted && it.pageId == page.id && it.behindContent && !it.staysInPdfRaster(analysis) && !it.movesInPlace()
        }
        val fonts = docFontLookup(st)
        val meta = relevant.associate { it.id to cleanMetaFor(it, fonts) }
        val gen = (cleanPreviewGenByPage[page.id] ?: 0L) + 1L
        cleanPreviewGenByPage[page.id] = gen
        val prevClean = st.cleanPreviewDocIds[page.id]
        val density = getApplication<Application>().resources.displayMetrics.density
        val themeKey = st.theme.engineKey
        val darkInvert = st.darkPaperInvert
        viewModelScope.launch {
            if (cleanPreviewGenByPage[page.id] != gen || _state.value.docId != st.docId) return@launch
            if (relevant.isEmpty()) {
                if (prevClean != null) {
                    _state.update { cur -> cur.copy(cleanPreviewDocIds = cur.cleanPreviewDocIds - page.id) }
                    closeCleanDocsLater(listOf(prevClean))
                }
                return@launch
            }
            val bytes = NativePdfBridge.prepareCleanPagePreview(
                page.sourceDocId,
                page.sourcePageIndex,
                relevant,
                decorateForEngine(fonts),
            ) ?: return@launch
            if (bytes.isEmpty() || cleanPreviewGenByPage[page.id] != gen || _state.value.docId != st.docId) return@launch
            val nextCleanId = "clean_${page.id}_${System.nanoTime()}"
            val res = NativePdfBridge.openDocumentBytes(nextCleanId, bytes)
            if (res.ok) {
                if (cleanPreviewGenByPage[page.id] != gen || _state.value.docId != st.docId) {
                    NativePdfBridge.closeDocument(nextCleanId)
                    return@launch
                }
                // Pre-seed preview bitmap BEFORE swapping cleanPreviewDocIds to eliminate any zoom/swap flicker.
                val previewScale = 0.45 * density
                val pw = (page.displayWidth * previewScale).roundToInt().coerceIn(140, 640)
                val ph = (page.displayHeight * previewScale).roundToInt().coerceIn(160, 900)
                val actualScale = pw.toDouble() / max(1.0, page.displayWidth)
                val previewBmp = NativePdfBridge.renderTileBitmap(
                    docId = nextCleanId,
                    pageIndex = 0,
                    tileX = 0,
                    tileY = 0,
                    tileWidthPx = pw,
                    tileHeightPx = ph,
                    scale = actualScale,
                    userRotation = page.userRotation,
                    theme = themeKey,
                    darkPaperInvert = darkInvert,
                    priorityTier = 1,
                    scope = "preview:$nextCleanId",
                    bufferPool = previewBufferPool,
                    transparentBg = previewTransparentBg,
                )
                if (cleanPreviewGenByPage[page.id] != gen || _state.value.docId != st.docId) {
                    previewBmp?.recycle()
                    NativePdfBridge.closeDocument(nextCleanId)
                    return@launch
                }
                if (previewBmp != null) {
                    tileCache.put(
                        TileKey(
                            docId = nextCleanId,
                            pageIndex = 0,
                            tileX = 0,
                            tileY = 0,
                            scaleBucket = "preview",
                            rotation = page.userRotation,
                            themeKey = themeKey,
                            isPreview = true,
                            transparentBg = previewTransparentBg,
                        ),
                        previewBmp,
                    )
                }
                val staleClean = _state.value.cleanPreviewDocIds[page.id]
                _state.update { cur ->
                    cur.copy(
                        cleanPreviewDocIds = cur.cleanPreviewDocIds + (page.id to nextCleanId),
                        cleanPreviewMeta = cur.cleanPreviewMeta + (nextCleanId to meta),
                    )
                }
                val toClose = listOfNotNull(prevClean, staleClean).distinct().filter { it != nextCleanId }
                closeCleanDocsLater(toClose)
            }
        }
    }

    /**
     * Stale clean previews stay open briefly: the viewport keeps painting the last fully rendered
     * document until the new one has sharp tiles, so swaps never flash a blurry preview.
     */
    private fun closeCleanDocsLater(ids: List<String>) {
        if (ids.isEmpty()) return
        viewModelScope.launch {
            delay(2500L)
            val st = _state.value
            val live = st.cleanPreviewDocIds.values.toSet()
            val toClose = ids.filter { it !in live }
            if (toClose.isEmpty()) return@launch
            _state.update { cur -> cur.copy(cleanPreviewMeta = cur.cleanPreviewMeta - toClose.toSet()) }
            for (cid in toClose) {
                tileCache.invalidateDoc(cid)
                NativePdfBridge.closeDocument(cid)
            }
        }
    }

    private fun findMatchedEmbeddedFont(
        docId: String,
        block: GpDetectedTextBlock,
    ): GpExtractedFontInfo? {
        val list = _state.value.extractedFonts[docId].orEmpty()
        if (list.isEmpty()) return null
        fun norm(s: String): String =
            s.replace(Regex("""^[A-Za-z]{6}\+"""), "")
                .replace(Regex("""[-_,]?(BoldItalic|BoldOblique|Italic|Oblique|Bold|Regular|Medium|SemiBold|DemiBold|Light|Thin|Black|MT|PSMT|PS|Std|Pro)$""", RegexOption.IGNORE_CASE), "")
                .replace(Regex("""[^A-Za-z0-9]"""), "")
                .lowercase()
        val candidates = listOf(block.rawFontName, block.originalFontName, block.fontFamily)
            .map(::norm)
            .filter { it.isNotEmpty() }
            .distinct()
        for (c in candidates) {
            list.firstOrNull { ef ->
                c == norm(ef.baseKey) || c == norm(ef.cleanName) || c == norm(ef.displayName)
            }?.let { return it }
        }
        for (c in candidates) {
            if (c.length < 3) continue
            list.firstOrNull { ef ->
                val keys = listOf(norm(ef.baseKey), norm(ef.cleanName), norm(ef.displayName)).filter { it.length >= 3 }
                keys.any { k -> c.startsWith(k) || k.startsWith(c) }
            }?.let { return it }
        }
        return null
    }

    private var promotedIdSeq = 0L
    private fun nextIdToken(): String {
        promotedIdSeq += 1L
        return "${System.nanoTime()}_$promotedIdSeq"
    }

    private fun buildPromotedTextElement(
        st: GpAppState,
        page: GpPageMeta,
        block: GpDetectedTextBlock,
    ): GpOverlayElement {
        val matched = findMatchedEmbeddedFont(page.sourceDocId, block)
        val rawOrOrigName = block.originalFontName.ifEmpty { block.rawFontName.ifEmpty { block.fontFamily } }
        val fontWarning: String? = when {
            block.fontSource == "missing" && (matched == null || !matched.hasAnyTtf) ->
                "missing:$rawOrOrigName"
            matched != null && !matched.unicodeUsable ->
                "subset:${matched.cleanName.ifEmpty { rawOrOrigName }}"
            block.fontSource != "builtin" && matched == null ->
                "missing:$rawOrOrigName"
            else -> null
        }
        val resolvedFontFamily = when {
            matched != null && matched.hasAnyTtf -> matched.displayName.ifEmpty { block.fontFamily }
            else -> block.fallbackFontFamily.ifEmpty { block.fontFamily }
        }
        // Keep the PDF's exact size: rounding (e.g. 12.45 -> 12.5) visibly rescales every glyph.
        val exactFontSize = block.fontSize.coerceIn(1.0, 400.0)
        val paraWidth = block.paragraphWidth ?: block.width
        val boxWidth = if (block.align == "justify" || block.text.contains('\n')) {
            max(20.0, block.width)
        } else {
            max(24.0, block.width + 4.0)
        }
        return GpOverlayElement(
            id = "te_${nextIdToken()}",
            pageId = page.id,
            kind = "textEdit",
            x = block.x,
            y = block.y,
            width = boxWidth,
            height = max(14.0, block.height),
            origX = block.x,
            origY = block.y,
            origWidth = block.width,
            origHeight = block.height,
            baselineOffset = block.baselineOffset.takeIf { it > 0.0 },
            paragraphWidth = paraWidth,
            text = block.text,
            runs = block.runs,
            originalText = block.text,
            sourceBlockId = block.id,
            fontSize = exactFontSize,
            fontFamily = resolvedFontFamily,
            bold = block.bold,
            italic = block.italic,
            align = block.align.ifEmpty { "left" },
            colorValue = block.colorValue,
            lineHeight = block.lineHeight,
            letterSpacing = block.letterSpacing,
            horizontalScale = block.horizontalScale.coerceIn(0.4, 2.5),
            embeddedFontId = matched?.takeIf { it.hasAnyTtf }?.id,
            fontWarning = fontWarning,
            pristine = true,
            origLines = block.lines,
            originalRuns = block.runs,
            origBoxWidth = boxWidth,
        ).let { it.copy(origStyleKey = it.styleKey()) }
    }

    private fun buildPromotedShapeElement(
        page: GpPageMeta,
        shape: GpDetectedShapeObj,
    ): GpOverlayElement {
        val w = max(6.0, shape.width)
        val h = max(6.0, shape.height)
        return GpOverlayElement(
            id = "sr_${nextIdToken()}",
            pageId = page.id,
            kind = "shapeReplacement",
            x = shape.x,
            y = shape.y,
            width = w,
            height = h,
            origX = shape.x,
            origY = shape.y,
            origWidth = w,
            origHeight = h,
            origOpacity = shape.opacity,
            opacity = shape.opacity,
            behindContent = shape.behindContent,
            isBackgroundLayer = shape.isBackgroundLayer,
            zIndex = if (shape.behindContent) 1 else shape.zOrder.takeIf { it > 0 } ?: 7,
            sourceBlockId = shape.id,
            svgPath = shape.svgPath,
            viewBoxWidth = w,
            viewBoxHeight = h,
            fillColorValue = shape.fillColorValue,
            colorValue = shape.strokeColorValue,
            strokeWidth = if ((shape.strokeColorValue ushr 24) == 0) 0.0 else shape.strokeWidth.coerceAtLeast(0.5),
            pristine = true,
        ).let { it.copy(origStyleKey = it.styleKey()) }
    }

    private fun buildPromotedImageElement(
        page: GpPageMeta,
        img: GpDetectedImageObj,
    ): GpOverlayElement {
        val w = max(8.0, img.width)
        val h = max(8.0, img.height)
        val cacheKey = "${page.sourceDocId}:${page.sourcePageIndex}:${img.id}"
        return GpOverlayElement(
            id = "ir_${nextIdToken()}",
            pageId = page.id,
            kind = "imageReplacement",
            x = img.x,
            y = img.y,
            width = w,
            height = h,
            rotationDeg = img.rotation,
            opacity = img.opacity,
            origX = img.x,
            origY = img.y,
            origWidth = w,
            origHeight = h,
            origRotationDeg = img.rotation,
            origOpacity = img.opacity,
            origFlipX = img.flipX,
            origFlipY = img.flipY,
            flipX = img.flipX,
            flipY = img.flipY,
            behindContent = img.behindContent,
            isBackgroundLayer = img.isBackgroundLayer,
            zIndex = if (img.behindContent) 1 else img.zOrder.takeIf { it > 0 } ?: 6,
            sourceBlockId = img.id,
            imageName = "${img.id}.png",
            mimeType = "image/png",
            imageBytes = extractedImageBytes[cacheKey],
            pristine = true,
        ).let { it.copy(origStyleKey = it.styleKey()) }
    }

    fun editPdfTextBlock(pageIndex: Int, block: GpDetectedTextBlock) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        val existing = st.elements.firstOrNull {
            it.pageId == page.id && !it.deleted && it.kind == "textEdit" && it.sourceBlockId == block.id
        }
        if (existing != null) {
            val nextIds = setOf(existing.id)
            _state.update {
                it.copy(
                    elements = it.elements.withoutStalePristineTextEdits(nextIds, it.inlineEditElementId),
                    selectedElementId = existing.id,
                    selectedElementIds = nextIds,
                    selectedPathVertexIndices = emptySet(),
                    textPanelExpanded = false,
                )
            }
            return
        }
        val rawOrOrigName = block.originalFontName.ifEmpty { block.rawFontName.ifEmpty { block.fontFamily } }
        val el = buildPromotedTextElement(st, page, block)
        val fontWarning = el.fontWarning
        addElement(el, autoReturnToSelect = true)
        if (fontWarning != null) {
            val l10n = GpStrings(st.locale)
            val toast = if (fontWarning.startsWith("missing:")) {
                l10n.t("mobile.fontMissingWarning").replace("{name}", rawOrOrigName)
            } else {
                l10n.t("mobile.fontSubsetWarning")
            }
            _state.update { it.copy(statusToast = toast) }
        }
        rebuildCleanPreviewForPage(page.id)
    }

    fun editPdfShapeObject(pageIndex: Int, shape: GpDetectedShapeObj) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        val existing = st.elements.firstOrNull {
            it.pageId == page.id && !it.deleted && it.kind == "shapeReplacement" && it.sourceBlockId == shape.id
        }
        if (existing != null) {
            val nextIds = setOf(existing.id)
            _state.update {
                it.copy(
                    elements = it.elements.withoutStalePristineTextEdits(nextIds, it.inlineEditElementId),
                    selectedElementId = existing.id,
                    selectedElementIds = nextIds,
                    selectedPathVertexIndices = emptySet(),
                    textPanelExpanded = false,
                )
            }
            return
        }
        val el = buildPromotedShapeElement(page, shape)
        addElement(el, autoReturnToSelect = true)
        _state.update { it.copy(statusToast = GpStrings(it.locale).t("mobile.pdfShapeSelected")) }
        rebuildCleanPreviewForPage(page.id)
    }

    fun editPdfImageObject(pageIndex: Int, img: GpDetectedImageObj) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        val existing = st.elements.firstOrNull {
            it.pageId == page.id && !it.deleted && it.kind == "imageReplacement" && it.sourceBlockId == img.id
        }
        if (existing != null) {
            val nextIds = setOf(existing.id)
            _state.update {
                it.copy(
                    elements = it.elements.withoutStalePristineTextEdits(nextIds, it.inlineEditElementId),
                    selectedElementId = existing.id,
                    selectedElementIds = nextIds,
                    selectedPathVertexIndices = emptySet(),
                    textPanelExpanded = false,
                )
            }
            return
        }
        // Select instantly: a pristine image keeps rendering from the PDF raster, so its pixels are
        // only needed once the user moves/resizes/exports it. Extraction runs in the background.
        val el = buildPromotedImageElement(page, img)
        addElement(el, autoReturnToSelect = true)
        _state.update { it.copy(statusToast = GpStrings(it.locale).t("mobile.pdfImageSelected")) }
        if (el.imageBytes == null) {
            viewModelScope.launch {
                ensureSourceImageBytes(page, img.id)
            }
        }
    }

    /** Extracts (once) the original pixels of a PDF image and attaches them to every snapshot. */
    private suspend fun ensureSourceImageBytes(page: GpPageMeta, imageId: String): ByteArray? {
        val cacheKey = "${page.sourceDocId}:${page.sourcePageIndex}:$imageId"
        extractedImageBytes[cacheKey]?.let { return it }
        val docAtStart = _state.value.docId
        val bytes = NativePdfBridge.extractPageImagePng(page.sourceDocId, page.sourcePageIndex, imageId)
            ?.takeIf { it.isNotEmpty() } ?: return null
        if (_state.value.docId != docAtStart) return null
        extractedImageBytes[cacheKey] = bytes
        fun patch(list: List<GpOverlayElement>): List<GpOverlayElement> = list.map {
            if (it.kind == "imageReplacement" && it.pageId == page.id && it.sourceBlockId == imageId && it.imageBytes == null) {
                it.copy(imageBytes = bytes)
            } else {
                it
            }
        }
        _state.update { st ->
            st.copy(
                elements = patch(st.elements),
                undoStack = st.undoStack.map(::patch),
                redoStack = st.redoStack.map(::patch),
            )
        }
        return bytes
    }

    fun addElement(el: GpOverlayElement, autoReturnToSelect: Boolean = false) {
        _state.update { st ->
            val nextUndo = if (el.pristine) st.undoStack else (st.undoStack + listOf(st.elements)).takeLast(60)
            val shouldSwitchSelect = autoReturnToSelect && !st.toolLocked
            val nextIds = setOf(el.id)
            st.copy(
                elements = st.elements.withoutStalePristineTextEdits(nextIds, null) + el,
                undoStack = nextUndo,
                redoStack = if (el.pristine) st.redoStack else emptyList(),
                selectedElementId = el.id,
                selectedElementIds = nextIds,
                selectedPathVertexIndices = emptySet(),
                marqueeSelectMode = if (shouldSwitchSelect) false else st.marqueeSelectMode,
                tool = if (shouldSwitchSelect) GpEditorTool.SELECT else st.tool,
                textPanelExpanded = false, // Mandatory Fix 6: Always collapsed by default!
                // Selecting an existing PDF object is not an edit until it is actually changed.
                dirty = st.dirty || !el.pristine,
            )
        }
        scheduleAutosave()
    }

    fun updateElement(incoming: GpOverlayElement, recordHistory: Boolean = true) {
        val stBefore = _state.value
        val prevEl = stBefore.elements.firstOrNull { it.id == incoming.id }
        // Any real change to a promoted PDF object lifts it out of the original raster.
        val updated = if (prevEl != null) incoming.withPristineResolvedAgainst(prevEl) else incoming
        if (prevEl != null && prevEl == updated) return
        val analysis = stBefore.pageAnalyses[updated.pageId]
        val wasRaster = prevEl?.staysInPdfRaster(analysis) == true
        val nowRaster = updated.staysInPdfRaster(analysis)
        val fonts = docFontLookup(stBefore)
        val previewStateChanged = prevEl != null && (
            wasRaster != nowRaster ||
                (updated.isPdfSourceKind &&
                    (prevEl.deleted != updated.deleted || prevEl.behindContent != updated.behindContent)) ||
                (updated.isPdfSourceKind && !nowRaster && cleanMetaFor(prevEl, fonts) != cleanMetaFor(updated, fonts))
            )
        _state.update { st ->
            val nextList = st.elements.map { if (it.id == updated.id) updated else it }
            val nextUndo = if (recordHistory) (st.undoStack + listOf(st.elements)).takeLast(60) else st.undoStack
            st.copy(
                elements = nextList,
                undoStack = nextUndo,
                redoStack = if (recordHistory) emptyList() else st.redoStack,
                dirty = st.dirty || !updated.pristine,
            )
        }
        if (previewStateChanged) {
            rebuildCleanPreviewForPage(updated.pageId)
        }
        if (recordHistory) scheduleAutosave()
    }

    fun selectElement(id: String?, expandTextIfSame: Boolean = false) {
        _state.update { st ->
            val targetEl = id?.let { eid -> st.elements.firstOrNull { it.id == eid && !it.deleted } }
            val keepExpanded = if (expandTextIfSame && targetEl?.isTextKind == true) {
                true
            } else {
                false
            }
            val nextIds = if (id != null) setOf(id) else emptySet()
            val nextInline = if (id == st.inlineEditElementId) st.inlineEditElementId else null
            val nextVertices = if (id == st.selectedElementId && st.selectedElementIds.size <= 1) {
                st.selectedPathVertexIndices
            } else {
                emptySet()
            }
            st.copy(
                elements = st.elements.withoutStalePristineTextEdits(nextIds, nextInline),
                selectedElementId = id,
                selectedElementIds = nextIds,
                selectedPathVertexIndices = nextVertices,
                textPanelExpanded = keepExpanded,
                inlineEditElementId = nextInline,
            )
        }
    }

    fun selectElementsInRect(pageIndex: Int, rectPdf: GpRectF, additive: Boolean = false) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        val existingOnPage = st.elements.filter { it.pageId == page.id }
        val activeForeground = existingOnPage.filter {
            !it.deleted && !it.behindContent && !it.isBackgroundLayer && !it.locked
        }
        val promotedOrDeletedIds = existingOnPage.mapNotNullTo(HashSet()) {
            it.sourceBlockId.takeIf { sid -> sid.isNotEmpty() }
        }

        val hitIds = linkedSetOf<String>()
        if (additive) hitIds.addAll(st.selectedElementIds)

        fun rectIntersects(a: GpRectF, b: GpRectF): Boolean =
            a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top

        for (el in activeForeground) {
            val elRect = computeElementVisualBounds(el)
            if (rectIntersects(elRect, rectPdf)) {
                hitIds.add(el.id)
            }
        }

        val newlyPromoted = mutableListOf<GpOverlayElement>()
        val imagesToExtract = mutableListOf<String>()
        val analysis = st.pageAnalyses[page.id]
        if (analysis != null) {
            for (blk in analysis.textBlocks) {
                if (blk.id in promotedOrDeletedIds) continue
                if (rectIntersects(blk.rect, rectPdf)) {
                    val el = buildPromotedTextElement(st, page, blk)
                    newlyPromoted.add(el)
                    hitIds.add(el.id)
                    promotedOrDeletedIds.add(blk.id)
                }
            }
            for (img in analysis.images) {
                if (img.id in promotedOrDeletedIds || img.behindContent || img.isBackgroundLayer) continue
                if (rectIntersects(img.rect, rectPdf)) {
                    val el = buildPromotedImageElement(page, img)
                    newlyPromoted.add(el)
                    hitIds.add(el.id)
                    promotedOrDeletedIds.add(img.id)
                    if (el.imageBytes == null) imagesToExtract.add(img.id)
                }
            }
            val pageArea = max(1.0, page.displayWidth * page.displayHeight)
            for (shp in analysis.shapes) {
                if (shp.id in promotedOrDeletedIds || shp.behindContent || shp.isBackgroundLayer) continue
                val areaRatio = (shp.width * shp.height) / pageArea
                if (areaRatio >= 0.85) continue
                if (rectIntersects(shp.rect, rectPdf)) {
                    val el = buildPromotedShapeElement(page, shp)
                    newlyPromoted.add(el)
                    hitIds.add(el.id)
                    promotedOrDeletedIds.add(shp.id)
                }
            }
        }

        val finalIds = hitIds.toSet()
        _state.update { cur ->
            val cleaned = (cur.elements + newlyPromoted).withoutStalePristineTextEdits(finalIds, null)
            cur.copy(
                elements = cleaned,
                selectedElementId = finalIds.firstOrNull(),
                selectedElementIds = finalIds,
                selectedPathVertexIndices = emptySet(),
                marqueeSelectMode = if (finalIds.isNotEmpty() && !cur.toolLocked) false else cur.marqueeSelectMode,
                textPanelExpanded = false,
                inlineEditElementId = null,
            )
        }
        for (imgId in imagesToExtract) {
            viewModelScope.launch {
                ensureSourceImageBytes(page, imgId)
            }
        }
    }

    fun deleteElements(ids: Set<String>) {
        if (ids.isEmpty()) return
        val targets = _state.value.elements.filter { it.id in ids }
        if (targets.isEmpty()) return
        _state.update { st ->
            val nextList = st.elements.mapNotNull { el ->
                if (el.id !in ids) {
                    el
                } else if (el.kind == "textEdit" || el.kind == "imageReplacement" || el.kind == "shapeReplacement") {
                    el.copy(deleted = true)
                } else {
                    null
                }
            }
            val nextUndo = (st.undoStack + listOf(st.elements)).takeLast(60)
            val remainingSelected = st.selectedElementIds - ids
            val nextPrimary = if (st.selectedElementId in ids) remainingSelected.firstOrNull() else st.selectedElementId
            val nextVertices = if (st.selectedElementId in ids) emptySet() else st.selectedPathVertexIndices
            st.copy(
                elements = nextList,
                undoStack = nextUndo,
                redoStack = emptyList(),
                selectedElementId = nextPrimary,
                selectedElementIds = remainingSelected,
                selectedPathVertexIndices = nextVertices,
                activePolylineId = if (st.activePolylineId in ids) null else st.activePolylineId,
                textPanelExpanded = if (st.selectedElementId in ids) false else st.textPanelExpanded,
                inlineEditElementId = if (st.inlineEditElementId in ids) null else st.inlineEditElementId,
                dirty = true,
            )
        }
        for (pid in targets.map { it.pageId }.distinct()) {
            rebuildCleanPreviewForPage(pid)
        }
        scheduleAutosave()
    }

    fun deleteElement(id: String) = deleteElements(setOf(id))

    fun deleteSelectedElement() {
        val st = _state.value
        val ids = st.selectedElementIds.ifEmpty {
            listOfNotNull(st.selectedElementId).toSet()
        }
        if (ids.isEmpty()) return
        deleteElements(ids)
    }

    fun togglePathVerticesSmooth(elementId: String, indices: Set<Int>, forceValue: Boolean? = null) {
        val el = _state.value.elements.firstOrNull { it.id == elementId && !it.deleted && it.kind == "path" } ?: return
        if (el.points.isEmpty()) return
        val next = computeToggledPathVertices(el, indices, forceValue)
        updateElement(next, recordHistory = true)
    }

    fun deletePathVertices(elementId: String, indices: Set<Int>) {
        val el = _state.value.elements.firstOrNull { it.id == elementId && !it.deleted && it.kind == "path" } ?: return
        if (indices.isEmpty()) return
        val remaining = el.points.filterIndexed { idx, _ -> idx !in indices }
        if (remaining.size < 2) {
            deleteElement(elementId)
            return
        }
        updateElement(el.withUpdatedPoints(remaining), recordHistory = true)
        _state.update { it.copy(selectedPathVertexIndices = emptySet()) }
    }

    fun moveSelectedElementsBy(
        pageId: String,
        ids: Set<String>,
        dxPdf: Double,
        dyPdf: Double,
        recordHistory: Boolean = true,
    ) {
        if (ids.isEmpty() || (kotlin.math.abs(dxPdf) < 1e-6 && kotlin.math.abs(dyPdf) < 1e-6)) return
        val stBefore = _state.value
        val analysis = stBefore.pageAnalyses[pageId]
        var anyMoved = false
        var rasterChanged = false
        val nextElements = stBefore.elements.map { el ->
            if (el.id !in ids || el.pageId != pageId || el.deleted || el.locked) {
                el
            } else {
                anyMoved = true
                val shiftedPts = if (el.points.isNotEmpty()) {
                    el.points.map { it.copy(x = it.x + dxPdf.toFloat(), y = it.y + dyPdf.toFloat()) }
                } else {
                    el.points
                }
                val shifted = el.copy(
                    x = el.x + dxPdf,
                    y = el.y + dyPdf,
                    points = shiftedPts,
                ).withPristineResolvedAgainst(el)
                if (el.staysInPdfRaster(analysis) != shifted.staysInPdfRaster(analysis)) {
                    rasterChanged = true
                }
                shifted
            }
        }
        if (!anyMoved) return
        _state.update { st ->
            val nextUndo = if (recordHistory) (st.undoStack + listOf(st.elements)).takeLast(60) else st.undoStack
            st.copy(
                elements = nextElements,
                undoStack = nextUndo,
                redoStack = if (recordHistory) emptyList() else st.redoStack,
                dirty = true,
            )
        }
        if (rasterChanged) rebuildCleanPreviewForPage(pageId)
        scheduleAutosave()
    }

    fun alignSelectedElements(action: String) {
        val stBefore = _state.value
        val selected = stBefore.elements.filter { it.id in stBefore.selectedElementIds && !it.deleted && !it.locked }
        val deltas = computeAlignedDeltas(selected, action)
        if (deltas.isEmpty()) return
        val affectedPages = linkedSetOf<String>()
        val nextElements = stBefore.elements.map { el ->
            val d = deltas[el.id] ?: return@map el
            val (dx, dy) = d
            if (kotlin.math.abs(dx) < 1e-6 && kotlin.math.abs(dy) < 1e-6) return@map el
            val shiftedPts = if (el.points.isNotEmpty()) {
                el.points.map { it.copy(x = it.x + dx.toFloat(), y = it.y + dy.toFloat()) }
            } else {
                el.points
            }
            val shifted = el.copy(
                x = el.x + dx,
                y = el.y + dy,
                points = shiftedPts,
            ).withPristineResolvedAgainst(el)
            val analysis = stBefore.pageAnalyses[el.pageId]
            if (el.staysInPdfRaster(analysis) != shifted.staysInPdfRaster(analysis)) {
                affectedPages.add(el.pageId)
            }
            shifted
        }
        if (nextElements == stBefore.elements) return
        _state.update { st ->
            val nextUndo = (st.undoStack + listOf(st.elements)).takeLast(60)
            st.copy(
                elements = nextElements,
                undoStack = nextUndo,
                redoStack = emptyList(),
                dirty = true,
            )
        }
        for (pid in affectedPages) {
            rebuildCleanPreviewForPage(pid)
        }
        scheduleAutosave()
    }

    fun eraseAt(pdfPt: GpPoint, pageIndex: Int) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        val hit = st.elements.lastOrNull { e ->
            e.pageId == page.id && !e.deleted &&
                (e.kind == "ink" || e.kind == "path" || e.kind == "highlight" || e.kind == "shape" || e.kind == "signature") &&
                pdfPt.x >= e.x - 10 && pdfPt.x <= e.x + e.width + 10 &&
                pdfPt.y >= e.y - 10 && pdfPt.y <= e.y + e.height + 10
        }
        if (hit != null) deleteElement(hit.id)
    }

    // --- Mandatory Fix 5: Point-to-Point Polyline & Vertex Chaining ---
    fun handleLineModeTap(pageIndex: Int, pdfPt: GpPoint, snapRadiusPdf: Float) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]

        // Case 1: Active polyline in progress -> append (or prepend) next vertex!
        val activePolyId = st.activePolylineId
        if (activePolyId != null) {
            val poly = st.elements.firstOrNull { it.id == activePolyId && !it.deleted && it.pageId == page.id }
            if (poly != null) {
                val pts = poly.points
                // Close polygon if tapping near opposite open endpoint with >= 3 vertices
                if (!poly.closed && pts.size >= 3) {
                    val closeTarget = if (st.activePolylinePrepend) pts.last() else pts.first()
                    if (hypot(pdfPt.x - closeTarget.x, pdfPt.y - closeTarget.y) <= snapRadiusPdf) {
                        val closedPoly = poly.withUpdatedPoints(pts, closed = true)
                        updateElement(closedPoly, recordHistory = true)
                        finishPolylineChaining()
                        return
                    }
                }
                val updated = poly.withAppendedPoint(pdfPt, prepend = st.activePolylinePrepend)
                updateElement(updated, recordHistory = true)
                _state.update { it.copy(selectedElementId = updated.id) }
                return
            }
        }

        // Case 2: Second tap after pending anchor P0 -> create segment P0 -> P1 and keep chaining!
        val pendingAnchor = st.pendingPolylineAnchor
        val pendingPg = st.pendingPolylinePageIndex
        if (pendingAnchor != null && pendingPg == pageIndex) {
            val initPts = listOf(pendingAnchor, pdfPt)
            val newPoly = GpOverlayElement(
                id = "line_${System.nanoTime()}",
                pageId = page.id,
                kind = "path",
                x = 0.0,
                y = 0.0,
                width = 12.0,
                height = 12.0,
                colorValue = st.activeStrokeColorValue,
                fillColorValue = 0x00000000,
                strokeWidth = st.activeStrokeWidth,
                smooth = false,
                closed = false,
                points = initPts,
            ).withUpdatedPoints(initPts, closed = false)

            val nextUndo = (st.undoStack + listOf(st.elements)).takeLast(60)
            val nextIds = setOf(newPoly.id)
            _state.update {
                it.copy(
                    elements = st.elements.withoutStalePristineTextEdits(nextIds, null) + newPoly,
                    undoStack = nextUndo,
                    redoStack = emptyList(),
                    selectedElementId = newPoly.id,
                    selectedElementIds = nextIds,
                    selectedPathVertexIndices = emptySet(),
                    activePolylineId = newPoly.id,
                    activePolylinePrepend = false,
                    pendingPolylinePageIndex = null,
                    pendingPolylineAnchor = null,
                    dirty = true,
                )
            }
            scheduleAutosave()
            return
        }

        // Case 3: No active chain -> check if tapping an endpoint or corner vertex of an existing line!
        val pagePaths = st.elements.filter { it.pageId == page.id && !it.deleted && it.kind == "path" && it.points.isNotEmpty() }.reversed()
        for (path in pagePaths) {
            val pts = path.points
            if (!path.closed) {
                val endPt = pts.last()
                if (hypot(pdfPt.x - endPt.x, pdfPt.y - endPt.y) <= snapRadiusPdf) {
                    val nextIds = setOf(path.id)
                    _state.update {
                        it.copy(
                            elements = it.elements.withoutStalePristineTextEdits(nextIds, null),
                            selectedElementId = path.id,
                            selectedElementIds = nextIds,
                            selectedPathVertexIndices = emptySet(),
                            activePolylineId = path.id,
                            activePolylinePrepend = false,
                            pendingPolylinePageIndex = null,
                            pendingPolylineAnchor = null,
                        )
                    }
                    return
                }
                val startPt = pts.first()
                if (hypot(pdfPt.x - startPt.x, pdfPt.y - startPt.y) <= snapRadiusPdf) {
                    val nextIds = setOf(path.id)
                    _state.update {
                        it.copy(
                            elements = it.elements.withoutStalePristineTextEdits(nextIds, null),
                            selectedElementId = path.id,
                            selectedElementIds = nextIds,
                            selectedPathVertexIndices = emptySet(),
                            activePolylineId = path.id,
                            activePolylinePrepend = true,
                            pendingPolylinePageIndex = null,
                            pendingPolylineAnchor = null,
                        )
                    }
                    return
                }
            }
            // Any interior corner or closed vertex -> snap anchor directly to that exact corner!
            for (v in pts) {
                if (hypot(pdfPt.x - v.x, pdfPt.y - v.y) <= snapRadiusPdf) {
                    _state.update {
                        it.copy(
                            pendingPolylinePageIndex = pageIndex,
                            pendingPolylineAnchor = v,
                            activePolylineId = null,
                            activePolylinePrepend = false,
                        )
                    }
                    return
                }
            }
        }

        // Case 4: Tap 1 on blank area -> place starting vertex anchor!
        _state.update {
            it.copy(
                elements = it.elements.withoutStalePristineTextEdits(emptySet(), null),
                pendingPolylinePageIndex = pageIndex,
                pendingPolylineAnchor = pdfPt,
                activePolylineId = null,
                activePolylinePrepend = false,
                selectedElementId = null,
                selectedElementIds = emptySet(),
                selectedPathVertexIndices = emptySet(),
            )
        }
    }

    fun startDraggingFirstLineSegment(pageIndex: Int, startPdf: GpPoint, endPdf: GpPoint) {
        val st = _state.value
        if (pageIndex < 0 || pageIndex >= st.pages.size) return
        val page = st.pages[pageIndex]
        val pts = listOf(startPdf, endPdf)
        val el = GpOverlayElement(
            id = "line_${System.nanoTime()}",
            pageId = page.id,
            kind = "path",
            x = 0.0,
            y = 0.0,
            width = 12.0,
            height = 12.0,
            colorValue = st.activeStrokeColorValue,
            strokeWidth = st.activeStrokeWidth,
            smooth = false,
            closed = false,
            points = pts,
        ).withUpdatedPoints(pts, closed = false)
        addElement(el, autoReturnToSelect = false)
        _state.update {
            it.copy(
                activePolylineId = el.id,
                activePolylinePrepend = false,
                pendingPolylinePageIndex = null,
                pendingPolylineAnchor = null,
            )
        }
    }

    fun undoPolylineVertex() {
        val st = _state.value
        if (st.pendingPolylineAnchor != null) {
            _state.update { it.copy(pendingPolylineAnchor = null, pendingPolylinePageIndex = null) }
            return
        }
        val activeId = st.activePolylineId ?: return
        val poly = st.elements.firstOrNull { it.id == activeId && !it.deleted } ?: return
        if (poly.points.size <= 2) {
            val anchor = if (st.activePolylinePrepend) poly.points.last() else poly.points.first()
            val pIdx = st.pages.indexOfFirst { it.id == poly.pageId }.takeIf { it >= 0 }
            deleteElement(poly.id)
            _state.update {
                it.copy(
                    activePolylineId = null,
                    pendingPolylinePageIndex = pIdx,
                    pendingPolylineAnchor = anchor,
                )
            }
        } else {
            val trimmed = if (st.activePolylinePrepend) poly.points.drop(1) else poly.points.dropLast(1)
            updateElement(poly.withUpdatedPoints(trimmed), recordHistory = true)
        }
    }

    fun finishPolylineChaining() {
        _state.update { st ->
            st.copy(
                activePolylineId = null,
                activePolylinePrepend = false,
                pendingPolylinePageIndex = null,
                pendingPolylineAnchor = null,
                tool = if (!st.toolLocked && st.tool == GpEditorTool.LINE) GpEditorTool.SELECT else st.tool,
            )
        }
    }

    fun duplicateElement(id: String) {
        val src = _state.value.elements.firstOrNull { it.id == id && !it.deleted } ?: return
        val dup = src.cloneForPage("dup_${System.nanoTime()}", src.pageId)
            .copy(
                pristine = false,
                x = src.x + 18.0,
                y = src.y + 18.0,
                zIndex = src.zIndex + 1,
                points = src.points.map { it.copy(x = it.x + 18f, y = it.y + 18f) },
            )
        addElement(dup)
    }

    fun bringForward(id: String) {
        val src = _state.value.elements.firstOrNull { it.id == id } ?: return
        val maxZ = _state.value.elements.maxOfOrNull { it.zIndex } ?: 0
        updateElement(src.copy(zIndex = maxOf(src.zIndex + 1, maxZ + 1)))
    }

    fun sendBackward(id: String) {
        val src = _state.value.elements.firstOrNull { it.id == id } ?: return
        val minZ = _state.value.elements.minOfOrNull { it.zIndex } ?: 0
        updateElement(src.copy(zIndex = minOf(src.zIndex - 1, minZ - 1)))
    }

    fun toggleLockElement(id: String) {
        val src = _state.value.elements.firstOrNull { it.id == id } ?: return
        updateElement(src.copy(locked = !src.locked))
    }

    fun applyElementAcrossPages(id: String, scope: String = "all") {
        val st = _state.value
        val src = st.elements.firstOrNull { it.id == id } ?: return
        if (st.pages.size <= 1) return
        val toAdd = mutableListOf<GpOverlayElement>()
        val now = System.nanoTime()
        st.pages.forEachIndexed { idx, p ->
            if (p.id == src.pageId) return@forEachIndexed
            if (scope == "excludeFirst" && idx == 0) return@forEachIndexed
            if (scope == "odd" && ((idx + 1) % 2 == 0)) return@forEachIndexed
            if (scope == "even" && ((idx + 1) % 2 == 1)) return@forEachIndexed
            toAdd.add(src.cloneForPage("${src.id}_rep_${idx}_$now", p.id).copy(pristine = false))
        }
        if (toAdd.isNotEmpty()) {
            _state.update { cur ->
                val nextUndo = (cur.undoStack + listOf(cur.elements)).takeLast(60)
                cur.copy(
                    elements = cur.elements + toAdd,
                    undoStack = nextUndo,
                    redoStack = emptyList(),
                    dirty = true,
                )
            }
            scheduleAutosave()
        }
    }

    fun undo() {
        val before = _state.value.elements
        _state.update { st ->
            if (st.undoStack.isEmpty()) return@update st
            val prev = st.undoStack.last()
            st.copy(
                elements = prev,
                undoStack = st.undoStack.dropLast(1),
                redoStack = st.redoStack + listOf(st.elements),
                selectedElementId = null,
                selectedElementIds = emptySet(),
                selectedPathVertexIndices = emptySet(),
                textPanelExpanded = false,
                activePolylineId = null,
                inlineEditElementId = null,
                dirty = true,
            )
        }
        val after = _state.value.elements
        val affectedPages = (before.map { it.pageId } + after.map { it.pageId }).distinct()
        for (pid in affectedPages) {
            rebuildCleanPreviewForPage(pid)
        }
        scheduleAutosave()
    }

    fun redo() {
        val before = _state.value.elements
        _state.update { st ->
            if (st.redoStack.isEmpty()) return@update st
            val next = st.redoStack.last()
            st.copy(
                elements = next,
                undoStack = st.undoStack + listOf(st.elements),
                redoStack = st.redoStack.dropLast(1),
                selectedElementId = null,
                selectedElementIds = emptySet(),
                selectedPathVertexIndices = emptySet(),
                textPanelExpanded = false,
                activePolylineId = null,
                inlineEditElementId = null,
                dirty = true,
            )
        }
        val after = _state.value.elements
        val affectedPages = (before.map { it.pageId } + after.map { it.pageId }).distinct()
        for (pid in affectedPages) {
            rebuildCleanPreviewForPage(pid)
        }
        scheduleAutosave()
    }

    fun setActiveShapeStyle(
        shapeType: String? = null,
        strokeColorValue: Int? = null,
        fillColorValue: Int? = null,
        strokeWidth: Double? = null,
    ) {
        _state.update { st ->
            st.copy(
                activeShapeType = shapeType ?: st.activeShapeType,
                activeStrokeColorValue = strokeColorValue ?: st.activeStrokeColorValue,
                activeFillColorValue = fillColorValue ?: st.activeFillColorValue,
                activeStrokeWidth = strokeWidth ?: st.activeStrokeWidth,
            )
        }
    }

    fun setActiveTextColors(colorValue: Int? = null, bgColorValue: Int? = null) {
        _state.update { st ->
            st.copy(
                activeTextColorValue = colorValue ?: st.activeTextColorValue,
                activeTextBgColorValue = bgColorValue ?: st.activeTextBgColorValue,
            )
        }
    }

    fun setGhostSignature(ghost: GpGhostSignature?) {
        _state.update { it.copy(ghostSignature = ghost, activeSheet = GpSheetKind.NONE) }
    }

    fun commitGhostSignature(targetPageIdx: Int? = null, targetCenterPdf: GpPoint? = null) {
        val st = _state.value
        val ghost = st.ghostSignature ?: return
        if (st.pages.isEmpty()) return
        val pIdx = (targetPageIdx ?: st.activePageIndex).coerceIn(0, st.pages.size - 1)
        val page = st.pages[pIdx]
        val center = targetCenterPdf ?: ghost.centerPdf
        val vbW = if (ghost.viewBoxW <= 0f) 300f else ghost.viewBoxW
        val vbH = if (ghost.viewBoxH <= 0f) 170f else ghost.viewBoxH
        val left = (center.x - ghost.sizePdfW * 0.5f).toDouble()
        val top = (center.y - ghost.sizePdfH * 0.5f).toDouble()

        val scaledPts = buildList {
            for (s in ghost.strokes) {
                for (pt in s) {
                    add(GpPoint((left + (pt.x / vbW) * ghost.sizePdfW).toFloat(), (top + (pt.y / vbH) * ghost.sizePdfH).toFloat()))
                }
            }
        }
        var svgPaths = ghost.svgPaths
        if (svgPaths.isEmpty() && ghost.imageBytes == null && ghost.strokes.isNotEmpty()) {
            val hex = String.format("#%06x", ghost.colorValue and 0xFFFFFF)
            svgPaths = ghost.strokes.filter { it.size >= 2 }.map { s ->
                val d = "M %.1f %.1f %s".format(
                    s.first().x,
                    s.first().y,
                    s.drop(1).joinToString(" ") { "L %.1f %.1f".format(it.x, it.y) },
                )
                dev.gullacpdf.android.model.GpSignatureSvgPath(d = d, fill = "none", stroke = hex, strokeWidth = 2.2)
            }
        }
        val el = GpOverlayElement(
            id = "sig_${System.nanoTime()}",
            pageId = page.id,
            kind = "signature",
            x = left,
            y = top,
            width = ghost.sizePdfW.toDouble(),
            height = ghost.sizePdfH.toDouble(),
            colorValue = ghost.colorValue,
            strokeWidth = 2.2,
            points = scaledPts,
            svgPaths = svgPaths,
            imageBytes = ghost.imageBytes,
            viewBoxWidth = vbW.toDouble(),
            viewBoxHeight = vbH.toDouble(),
            signatureId = ghost.signatureId,
            realisticInk = ghost.realisticInk,
        )
        addElement(el, autoReturnToSelect = true)
        _state.update { it.copy(ghostSignature = null) }
    }

    fun saveSignatureToVault(sig: GpSavedSignature) {
        val next = (listOf(sig) + _state.value.savedSignatures.filter { it.id != sig.id }).take(20)
        prefs.saveSavedSignatures(next)
        _state.update { it.copy(savedSignatures = next) }
    }

    fun deleteSignatureFromVault(id: String) {
        val next = _state.value.savedSignatures.filterNot { it.id == id }
        prefs.saveSavedSignatures(next)
        _state.update { it.copy(savedSignatures = next) }
    }

    fun insertImageFromUri(uriStr: String, displayName: String?) {
        viewModelScope.launch {
            try {
                val work = fileBridge.copyToWorkFile(uriStr, displayName)
                val bytes = File(work.workPath).readBytes()
                if (bytes.isEmpty()) return@launch
                val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
                var drawW = 180.0
                var drawH = 120.0
                if (opts.outWidth > 0 && opts.outHeight > 0) {
                    val aspect = opts.outWidth.toDouble() / opts.outHeight.toDouble()
                    drawW = opts.outWidth.toDouble().coerceIn(64.0, 240.0)
                    drawH = (drawW / aspect).coerceAtLeast(36.0)
                }
                val st = _state.value
                if (st.pages.isEmpty()) return@launch
                val page = st.pages[st.activePageIndex.coerceIn(0, st.pages.size - 1)]
                val x = ((page.displayWidth - drawW) * 0.5).coerceIn(12.0, (page.displayWidth - 24.0).coerceAtLeast(12.0))
                val y = ((page.displayHeight - drawH) * 0.5).coerceIn(12.0, (page.displayHeight - 24.0).coerceAtLeast(12.0))
                val lower = work.displayName.lowercase()
                val mime = when {
                    lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
                    lower.endsWith(".webp") -> "image/webp"
                    else -> "image/png"
                }
                addElement(
                    GpOverlayElement(
                        id = "img_${System.nanoTime()}",
                        pageId = page.id,
                        kind = "image",
                        x = x,
                        y = y,
                        width = drawW,
                        height = drawH,
                        imageName = work.displayName,
                        mimeType = mime,
                        imageBytes = bytes,
                    ),
                    autoReturnToSelect = true,
                )
            } catch (e: Exception) {
                _state.update { it.copy(errorBanner = e.message ?: "Failed inserting image") }
            }
        }
    }

    fun loadCustomFontFromUri(uriStr: String, displayName: String?) {
        viewModelScope.launch {
            try {
                val work = fileBridge.copyToWorkFile(uriStr, displayName)
                val bytes = File(work.workPath).readBytes()
                if (bytes.isEmpty()) return@launch
                _state.update { st ->
                    val sel = st.selectedElement
                    val nextElements = if (sel != null && sel.isTextKind) {
                        st.elements.map { if (it.id == sel.id) it.copy(fontFamily = "Custom") else it }
                    } else {
                        st.elements
                    }
                    st.copy(
                        customTtfBytes = bytes,
                        customFontLabel = work.displayName,
                        elements = nextElements,
                        dirty = true,
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(errorBanner = e.message ?: "Failed loading custom font") }
            }
        }
    }

    fun mergeExternalPdfFromUri(uriStr: String, displayName: String?) {
        viewModelScope.launch {
            try {
                val work = fileBridge.copyToWorkFile(uriStr, displayName)
                val mergeDocId = "merge_${System.currentTimeMillis()}"
                val outcome = NativePdfBridge.openDocumentFile(mergeDocId, work.workPath)
                if (!outcome.ok || outcome.pages.isEmpty()) {
                    _state.update { it.copy(errorBanner = outcome.error ?: "Cannot merge selected PDF") }
                    return@launch
                }
                val remapped = outcome.pages.mapIndexed { idx, p ->
                    p.copy(id = "${mergeDocId}_p$idx", sourceDocId = mergeDocId)
                }
                _state.update { it.copy(pages = it.pages + remapped, dirty = true) }
                scheduleAutosave()
            } catch (e: Exception) {
                _state.update { it.copy(errorBanner = e.message ?: "Merge failed") }
            }
        }
    }

    // --- Page Operations ---
    fun rotatePageBy(pageIndex: Int, deltaDeg: Int) {
        _state.update { st ->
            if (pageIndex < 0 || pageIndex >= st.pages.size) return@update st
            val nextPages = st.pages.mapIndexed { idx, p ->
                if (idx == pageIndex) p.copy(userRotation = ((p.userRotation + deltaDeg) % 360 + 360) % 360) else p
            }
            st.copy(pages = nextPages, dirty = true)
        }
        scheduleAutosave()
    }

    fun movePage(from: Int, to: Int) {
        _state.update { st ->
            if (from !in st.pages.indices || to !in st.pages.indices || from == to) return@update st
            val list = st.pages.toMutableList()
            val moved = list.removeAt(from)
            list.add(to, moved)
            st.copy(pages = list, activePageIndex = to, dirty = true)
        }
        scheduleAutosave()
    }

    fun duplicatePageAt(index: Int) {
        _state.update { st ->
            if (index !in st.pages.indices) return@update st
            val src = st.pages[index]
            val newId = "${src.id}_dup_${System.nanoTime()}"
            val dupPage = src.copy(id = newId)
            val nextPages = st.pages.toMutableList().apply { add(index + 1, dupPage) }
            val dupEls = st.elements.filter { it.pageId == src.id }.map {
                it.cloneForPage("${it.id}_dp_${System.nanoTime()}", newId)
            }
            st.copy(pages = nextPages, elements = st.elements + dupEls, activePageIndex = index + 1, dirty = true)
        }
        scheduleAutosave()
    }

    fun insertBlankPageAfter(index: Int) {
        _state.update { st ->
            val insertAt = (index + 1).coerceIn(0, st.pages.size)
            val blank = GpPageMeta(
                id = "blank_${System.nanoTime()}",
                sourceDocId = "blank",
                sourcePageIndex = 0,
                baseWidth = 595.0,
                baseHeight = 842.0,
                intrinsicRotation = 0,
            )
            val nextPages = st.pages.toMutableList().apply { add(insertAt, blank) }
            st.copy(pages = nextPages, activePageIndex = insertAt, dirty = true)
        }
        scheduleAutosave()
    }

    fun deletePageAt(index: Int) {
        _state.update { st ->
            if (st.pages.size <= 1 || index !in st.pages.indices) return@update st
            val removed = st.pages[index]
            val nextPages = st.pages.filterIndexed { i, _ -> i != index }
            st.copy(
                pages = nextPages,
                elements = st.elements.filterNot { it.pageId == removed.id },
                activePageIndex = index.coerceIn(0, nextPages.size - 1),
                dirty = true,
            )
        }
        scheduleAutosave()
    }

    fun batchRotatePages(indices: Set<Int>, deltaDeg: Int) {
        if (indices.isEmpty()) return
        _state.update { st ->
            val next = st.pages.mapIndexed { idx, p ->
                if (indices.contains(idx)) p.copy(userRotation = ((p.userRotation + deltaDeg) % 360 + 360) % 360) else p
            }
            st.copy(pages = next, dirty = true)
        }
        scheduleAutosave()
    }

    fun batchDeletePages(indices: Set<Int>) {
        _state.update { st ->
            if (indices.isEmpty() || st.pages.size - indices.size < 1) return@update st
            val removedIds = indices.mapNotNull { st.pages.getOrNull(it)?.id }.toSet()
            val nextPages = st.pages.filterIndexed { i, _ -> !indices.contains(i) }
            st.copy(
                pages = nextPages,
                elements = st.elements.filterNot { removedIds.contains(it.pageId) },
                activePageIndex = st.activePageIndex.coerceIn(0, nextPages.size - 1),
                dirty = true,
            )
        }
        scheduleAutosave()
    }

    fun setPageNumbering(config: GpPageNumberingConfig) {
        _state.update { it.copy(pageNumbering = config, dirty = true) }
        scheduleAutosave()
    }

    // --- Search ---
    fun startStreamingSearch(query: String, matchCase: Boolean = _state.value.searchMatchCase, wholeWord: Boolean = _state.value.searchWholeWord) {
        val docId = _state.value.docId ?: return
        val pages = _state.value.pages
        searchJob?.cancel()
        _state.update {
            it.copy(
                searchQuery = query,
                searchMatchCase = matchCase,
                searchWholeWord = wholeWord,
                searchHits = emptyList(),
                activeSearchIdx = 0,
                searchScanning = query.trim().isNotEmpty(),
            )
        }
        if (query.trim().isEmpty()) return
        searchJob = viewModelScope.launch {
            var jumped = false
            for (idx in pages.indices) {
                val p = pages[idx]
                if (p.sourceDocId == "blank") continue
                val pageHits = NativePdfBridge.searchPage(p.sourceDocId, p.sourcePageIndex, query, matchCase, wholeWord)
                    .map { it.copy(pageIndex = idx) }
                if (pageHits.isNotEmpty()) {
                    _state.update { st ->
                        val nextHits = st.searchHits + pageHits
                        st.copy(
                            searchHits = nextHits,
                            jumpToPageEvent = if (!jumped) {
                                jumped = true
                                pageHits.first().pageIndex to System.nanoTime()
                            } else {
                                st.jumpToPageEvent
                            },
                        )
                    }
                }
            }
            _state.update { it.copy(searchScanning = false) }
        }
    }

    fun stepSearchResult(delta: Int) {
        _state.update { st ->
            if (st.searchHits.isEmpty()) return@update st
            val n = st.searchHits.size
            val next = ((st.activeSearchIdx + delta) % n + n) % n
            st.copy(
                activeSearchIdx = next,
                jumpToPageEvent = st.searchHits[next].pageIndex to System.nanoTime(),
            )
        }
    }

    // --- Compile / Export / Save / Split ---
    suspend fun compileToTempFile(
        pagesOverride: List<GpPageMeta>? = null,
        elementsOverride: List<GpOverlayElement>? = null,
    ): String {
        val st0 = _state.value
        // Modified PDF images need their original pixels before they can be re-drawn.
        for (el in (elementsOverride ?: st0.elements)) {
            if (el.kind == "imageReplacement" && !el.deleted && !el.pristine && !el.movesInPlace() && el.imageBytes == null) {
                val page = st0.pages.firstOrNull { it.id == el.pageId } ?: continue
                ensureSourceImageBytes(page, el.sourceBlockId)
            }
        }
        val st = _state.value
        val latestById = st.elements.associateBy { it.id }
        val compileElements = (elementsOverride ?: st.elements)
            .map { el -> if (el.kind == "imageReplacement" && el.imageBytes == null) latestById[el.id] ?: el else el }
            // Selected-but-untouched PDF objects are left exactly as they are in the original file
            // (no strip + redraw), which keeps fonts, kerning, word spacing and image encoding intact.
            .filterNot { it.isPdfSourceKind && it.staysInPdfRaster(st.pageAnalyses[it.pageId]) }
        val outFile = File(getApplication<Application>().cacheDir, "work/compiled_${System.currentTimeMillis()}.pdf")
        outFile.parentFile?.mkdirs()
        val res = NativePdfBridge.compileAndSaveVerified(
            context = getApplication(),
            pages = pagesOverride ?: st.pages,
            elements = compileElements,
            outputPath = outFile.absolutePath,
            pageNumbering = st.pageNumbering,
            customTtfBytes = st.customTtfBytes,
            embeddedFonts = st.extractedFonts.values.flatten(),
            decorate = decorateForEngine(docFontLookup(st)),
        )
        if (!res.ok) throw IllegalStateException(res.error ?: "PDF compilation failed")
        return res.outputPath
    }

    fun prepareSplitExtract(indices: Set<Int>, onReadyTempFile: (String, String) -> Unit) {
        val st = _state.value
        val sorted = indices.filter { it in st.pages.indices }.sorted()
        if (sorted.isEmpty()) return
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val selPages = sorted.map { st.pages[it] }
                val selIds = selPages.map { it.id }.toSet()
                val selEls = st.elements.filter { selIds.contains(it.pageId) }
                val outPath = compileToTempFile(selPages, selEls)
                val base = st.displayName.replace(Regex("""\.pdf$""", RegexOption.IGNORE_CASE), "")
                _state.update { it.copy(isLoading = false) }
                onReadyTempFile(outPath, "$base-extracted.pdf")
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, errorBanner = e.message) }
            }
        }
    }

    fun overwriteOriginal(onFallbackSaveCopy: (String, String) -> Unit) {
        val st = _state.value
        val targetUri = st.sourceUri
        if (!st.writable || targetUri == null) {
            prepareSaveCopy(onFallbackSaveCopy)
            return
        }
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val compiledPath = compileToTempFile()
                fileBridge.writeFileToUri(compiledPath, targetUri)
                prefs.clearAutosave()
                _state.update {
                    it.copy(
                        isLoading = false,
                        dirty = false,
                        recoverableAutosaveJson = null,
                        statusToast = if (it.locale == GpLocale.TR) "Kaydedildi" else "Saved",
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, errorBanner = e.message ?: "Save failed") }
            }
        }
    }

    fun prepareSaveCopy(onLaunchCreateDocument: (compiledWorkPath: String, suggestedName: String) -> Unit) {
        val st = _state.value
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                val compiledPath = compileToTempFile()
                val base = st.displayName.replace(Regex("""\.pdf$""", RegexOption.IGNORE_CASE), "")
                val suffix = if (st.locale == GpLocale.TR) "düzenlendi" else "edited"
                _state.update { it.copy(isLoading = false) }
                onLaunchCreateDocument(compiledPath, "$base-$suffix.pdf")
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, errorBanner = e.message ?: "Export failed") }
            }
        }
    }

    fun finishSaveCopyToUri(compiledPath: String, targetUriStr: String) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true) }
            try {
                fileBridge.writeFileToUri(compiledPath, targetUriStr)
                prefs.clearAutosave()
                _state.update {
                    it.copy(
                        isLoading = false,
                        dirty = false,
                        recoverableAutosaveJson = null,
                        statusToast = if (it.locale == GpLocale.TR) "Kopya kaydedildi" else "Saved copy",
                    )
                }
            } catch (e: Exception) {
                _state.update { it.copy(isLoading = false, errorBanner = e.message ?: "Save failed") }
            }
        }
    }

    private fun scheduleAutosave() {
        autosaveJob?.cancel()
        autosaveJob = viewModelScope.launch {
            delay(2000L)
            val st = _state.value
            if (!st.hasDocument || !st.dirty) return@launch
            val payload = JSONObject().apply {
                put("displayName", st.displayName)
                put("workFilePath", st.workFilePath)
                put("sourceUri", st.sourceUri)
                put("activePageIndex", st.activePageIndex)
                put("zoom", st.zoom.toDouble())
                put("elements", JSONArray().apply { st.elements.forEach { put(it.toCoreJson()) } })
                put("savedAtMs", System.currentTimeMillis())
            }.toString()
            prefs.saveAutosave(payload)
        }
    }

    override fun onCleared() {
        super.onCleared()
        tileCache.clear()
    }
}

internal fun computeElementVisualBounds(el: GpOverlayElement): GpRectF {
    if ((el.kind == "path" || el.kind == "ink") && el.points.isNotEmpty() && kotlin.math.abs(el.rotationDeg) <= 0.01) {
        return GpRectF(
            el.points.minOf { it.x },
            el.points.minOf { it.y },
            el.points.maxOf { it.x },
            el.points.maxOf { it.y },
        )
    }
    if (kotlin.math.abs(el.rotationDeg) <= 0.01) {
        return GpRectF.fromLTWH(el.x.toFloat(), el.y.toFloat(), el.width.toFloat(), el.height.toFloat())
    }
    val cx = el.x + el.width * 0.5
    val cy = el.y + el.height * 0.5
    val hw = el.width * 0.5
    val hh = el.height * 0.5
    val rad = Math.toRadians(el.rotationDeg)
    val cosA = kotlin.math.abs(kotlin.math.cos(rad))
    val sinA = kotlin.math.abs(kotlin.math.sin(rad))
    val rhw = hw * cosA + hh * sinA
    val rhh = hw * sinA + hh * cosA
    return GpRectF((cx - rhw).toFloat(), (cy - rhh).toFloat(), (cx + rhw).toFloat(), (cy + rhh).toFloat())
}

internal fun computeAlignedDeltas(
    elements: List<GpOverlayElement>,
    action: String,
): Map<String, Pair<Double, Double>> {
    if (elements.size < 2) return emptyMap()
    val boxes = elements.map { it to computeElementVisualBounds(it) }
    val out = LinkedHashMap<String, Pair<Double, Double>>(elements.size)

    if (action == "distribute-h" || action == "distribute-v") {
        if (boxes.size < 3) return emptyMap()
        if (action == "distribute-h") {
            val sorted = boxes.sortedBy { it.second.left }
            val minX = sorted.first().second.left.toDouble()
            val maxX = sorted.last().second.right.toDouble()
            val totalW = sorted.sumOf { it.second.width.toDouble() }
            val gap = (maxX - minX - totalW) / (sorted.size - 1)
            var cursor = minX
            for ((el, bbox) in sorted) {
                out[el.id] = (cursor - bbox.left.toDouble()) to 0.0
                cursor += bbox.width.toDouble() + gap
            }
        } else {
            val sorted = boxes.sortedBy { it.second.top }
            val minY = sorted.first().second.top.toDouble()
            val maxY = sorted.last().second.bottom.toDouble()
            val totalH = sorted.sumOf { it.second.height.toDouble() }
            val gap = (maxY - minY - totalH) / (sorted.size - 1)
            var cursor = minY
            for ((el, bbox) in sorted) {
                out[el.id] = 0.0 to (cursor - bbox.top.toDouble())
                cursor += bbox.height.toDouble() + gap
            }
        }
        return out
    }

    val groupLeft = boxes.minOf { it.second.left.toDouble() }
    val groupRight = boxes.maxOf { it.second.right.toDouble() }
    val groupCenterX = (groupLeft + groupRight) * 0.5
    val groupTop = boxes.minOf { it.second.top.toDouble() }
    val groupBottom = boxes.maxOf { it.second.bottom.toDouble() }
    val groupCenterY = (groupTop + groupBottom) * 0.5

    for ((el, bbox) in boxes) {
        val left = bbox.left.toDouble()
        val right = bbox.right.toDouble()
        val top = bbox.top.toDouble()
        val bottom = bbox.bottom.toDouble()
        val (dx, dy) = when (action) {
            "left" -> (groupLeft - left) to 0.0
            "center-h" -> (groupCenterX - (left + right) * 0.5) to 0.0
            "right" -> (groupRight - right) to 0.0
            "top" -> 0.0 to (groupTop - top)
            "center-v" -> 0.0 to (groupCenterY - (top + bottom) * 0.5)
            "bottom" -> 0.0 to (groupBottom - bottom)
            else -> 0.0 to 0.0
        }
        out[el.id] = dx to dy
    }
    return out
}

internal fun computeToggledPathVertices(
    el: GpOverlayElement,
    indices: Set<Int>,
    forceValue: Boolean? = null,
): GpOverlayElement {
    if (el.points.isEmpty()) return el
    val targets = indices.filter { it in el.points.indices }.toSet().ifEmpty { el.points.indices.toSet() }
    val allAlreadySmooth = targets.all { idx -> el.points[idx].smooth ?: el.smooth }
    val targetSmooth = forceValue ?: !allAlreadySmooth
    val nextPoints = el.points.mapIndexed { idx, pt ->
        if (idx in targets) pt.copy(smooth = targetSmooth) else pt
    }
    val nextGlobalSmooth = if (targets.size == el.points.size) targetSmooth else el.smooth
    return el.withUpdatedPoints(nextPoints).copy(smooth = nextGlobalSmooth)
}
