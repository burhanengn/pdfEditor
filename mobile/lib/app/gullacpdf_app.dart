import 'dart:async';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../engine/session_bridge.dart';
import '../engine/tile_cache.dart';
import '../features/editor/editor_chrome.dart';
import '../features/library/library_screen.dart';
import '../features/viewer/viewer_chrome.dart';
import '../l10n/gp_l10n.g.dart';
import '../platform/file_bridge.dart';
import '../theme/gp_tokens.g.dart';
import '../viewport/pdf_viewport.dart';
import 'session_state.dart';

final gpBridgeProvider = Provider<GpSessionBridge>((ref) => FrbSessionBridge());
final gpFileBridgeProvider = Provider<GpFileBridge>((ref) => GpFileBridge());

class GullacpdfApp extends ConsumerStatefulWidget {
  const GullacpdfApp({
    super.key,
    this.customBridge,
    this.customFileBridge,
  });

  final GpSessionBridge? customBridge;
  final GpFileBridge? customFileBridge;

  @override
  ConsumerState<GullacpdfApp> createState() => _GullacpdfAppState();
}

class _GullacpdfAppState extends ConsumerState<GullacpdfApp> {
  final GpViewportController _viewportCtrl = GpViewportController();
  final GpTileCache _tileCache = GpTileCache();
  StreamSubscription<GpOpenRequest>? _incomingSub;
  StreamSubscription<GpSearchBatch>? _searchSub;

  late final GpSessionBridge _bridge =
      widget.customBridge ?? ref.read(gpBridgeProvider);
  late final GpFileBridge _fileBridge =
      widget.customFileBridge ?? ref.read(gpFileBridgeProvider);

  @override
  void initState() {
    super.initState();
    _fileBridge.startListening();
    _incomingSub = _fileBridge.onIncomingOpenRequest.listen((req) {
      unawaited(_handleIncomingOpenRequest(req));
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      unawaited(_consumeInitialIntent());
    });
  }

  @override
  void dispose() {
    _incomingSub?.cancel();
    _searchSub?.cancel();
    _tileCache.clear();
    _viewportCtrl.dispose();
    super.dispose();
  }

  Future<void> _consumeInitialIntent() async {
    final req = await _fileBridge.getInitialOpenRequest();
    if (req != null) {
      await _handleIncomingOpenRequest(req);
    }
  }

  Future<void> _handleIncomingOpenRequest(GpOpenRequest req) async {
    final notifier = ref.read(gpSessionProvider.notifier);
    if (req.uris.isEmpty) return;

    notifier.setLoading(true);
    try {
      final work = await _fileBridge.copyToWorkFile(
        sourceUri: req.uris.first,
        displayName: req.displayName,
      );
      await _openWorkFile(
        path: work.workPath,
        displayName: work.displayName,
        sourceUri: req.sourceId,
        writable: req.writable,
      );
    } catch (err) {
      notifier.setLoading(false);
      notifier.setError(err.toString());
    }
  }

  Future<void> _openWorkFile({
    required String path,
    required String displayName,
    String? sourceUri,
    required bool writable,
    String? password,
  }) async {
    final notifier = ref.read(gpSessionProvider.notifier);
    final docId = 'doc_${DateTime.now().millisecondsSinceEpoch}';
    notifier.setLoading(true);

    try {
      final outcome = await _bridge.openDocumentFile(
        docId: docId,
        path: path,
        password: password,
      );
      if (outcome.status == 'needs-password' ||
          outcome.status == 'invalid-password') {
        notifier.promptForPassword(
          path: path,
          displayName: displayName,
          sourceUri: sourceUri,
          writable: writable,
          invalidAttempt: outcome.status == 'invalid-password',
        );
        return;
      }

      final prevDocId = ref.read(gpSessionProvider).docId;
      if (prevDocId != null && prevDocId != docId) {
        _tileCache.invalidateDoc(prevDocId);
        unawaited(_bridge.closeDocument(prevDocId));
      }

      notifier.setLoadedDocument(
        docId: docId,
        displayName: displayName,
        pages: outcome.pages,
        outline: outcome.outline,
        canCopyText: outcome.canCopyText,
        writable: writable,
        sourceUri: sourceUri,
        workFilePath: path,
      );
    } catch (err) {
      notifier.setLoading(false);
      notifier.setError(err.toString());
    }
  }

  Future<void> _openFromPicker() async {
    final req = await _fileBridge.openDocumentPicker(allowMultiple: false);
    if (req != null) {
      await _handleIncomingOpenRequest(req);
    }
  }

  Future<void> _createBlankDocument() async {
    final notifier = ref.read(gpSessionProvider.notifier);
    final dir = await getTemporaryDirectory();
    final workPath =
        '${dir.path}/blank_${DateTime.now().millisecondsSinceEpoch}.pdf';
    const blankPage = GpPageMeta(
      id: 'blank_p0',
      sourceDocId: 'blank',
      sourcePageIndex: 0,
      baseWidth: 595,
      baseHeight: 842,
      intrinsicRotation: 0,
    );
    notifier.setLoading(true);
    try {
      await _bridge.compileAndSaveVerified(
        pages: const [blankPage],
        elements: const [],
        redactionsPage0: const [],
        outputPath: workPath,
      );
      await _openWorkFile(
        path: workPath,
        displayName: 'Blank-Document.pdf',
        writable: false,
      );
      ref.read(gpSessionProvider.notifier).setMode(GpAppMode.edit);
    } catch (err) {
      notifier.setLoading(false);
      notifier.setError(err.toString());
    }
  }

  void _switchModePreservingAnchor(GpAppMode nextMode) {
    final appState = ref.read(gpSessionProvider);
    final anchor = _viewportCtrl.captureAnchor(appState.pages);
    ref.read(gpSessionProvider.notifier).setMode(nextMode);
    if (anchor != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _viewportCtrl.restoreAnchor(anchor, ref.read(gpSessionProvider).pages);
      });
    }
  }

  void _startStreamingSearch(String query) {
    final state = ref.read(gpSessionProvider);
    final docId = state.docId;
    if (docId == null) return;
    _searchSub?.cancel();
    ref.read(gpSessionProvider.notifier).startSearch(query);
    if (query.trim().isEmpty) return;

    _searchSub = _bridge
        .searchDocument(
          docId: docId,
          query: query,
          matchCase: state.searchMatchCase,
          wholeWord: state.searchWholeWord,
        )
        .listen(
          (batch) {
            ref
                .read(gpSessionProvider.notifier)
                .appendSearchHits(batch.hits, done: batch.done);
            if (batch.hits.isNotEmpty &&
                ref.read(gpSessionProvider).searchHits.length ==
                    batch.hits.length) {
              _viewportCtrl.scrollToPage(
                batch.hits.first.pageIndex,
                ref.read(gpSessionProvider).pages,
              );
            }
          },
          onError: (_) {
            ref
                .read(gpSessionProvider.notifier)
                .appendSearchHits(const [], done: true);
          },
        );
  }

  Future<String> _compileVerifiedTempPdf() async {
    final state = ref.read(gpSessionProvider);
    final dir = await getTemporaryDirectory();
    final outPath =
        '${dir.path}/compiled_${DateTime.now().millisecondsSinceEpoch}.pdf';
    await _bridge.compileAndSaveVerified(
      pages: state.pages,
      elements: state.elements,
      redactionsPage0: const [],
      outputPath: outPath,
    );
    return outPath;
  }

  Future<void> _saveAsCopy() async {
    final state = ref.read(gpSessionProvider);
    final notifier = ref.read(gpSessionProvider.notifier);
    notifier.setLoading(true);
    try {
      final compiledPath = await _compileVerifiedTempPdf();
      final base = state.displayName.replaceAll(RegExp(r'\.pdf$', caseSensitive: false), '');
      final suffix = state.locale == GpLocale.tr ? 'düzenlendi' : 'edited';
      final suggested = '$base-$suffix.pdf';
      await _fileBridge.createDocument(
        suggestedName: suggested,
        sourceWorkPath: compiledPath,
      );
      final redacts = state.elements.where((e) => e.isRedact).length;
      notifier.markSaved(verifiedRedactions: redacts);
    } catch (err) {
      notifier.setError(err.toString());
    } finally {
      notifier.setLoading(false);
    }
  }

  Future<void> _overwriteOriginal() async {
    final state = ref.read(gpSessionProvider);
    final targetUri = state.sourceUri;
    if (!state.writable || targetUri == null) {
      await _saveAsCopy();
      return;
    }
    final notifier = ref.read(gpSessionProvider.notifier);
    notifier.setLoading(true);
    try {
      final compiledPath = await _compileVerifiedTempPdf();
      await _fileBridge.saveToUri(
        sourceWorkPath: compiledPath,
        targetUri: targetUri,
      );
      final redacts = state.elements.where((e) => e.isRedact).length;
      notifier.markSaved(verifiedRedactions: redacts);
    } catch (err) {
      notifier.setError(err.toString());
    } finally {
      notifier.setLoading(false);
    }
  }

  Future<void> _shareCurrentPdf() async {
    final state = ref.read(gpSessionProvider);
    final notifier = ref.read(gpSessionProvider.notifier);
    notifier.setLoading(true);
    try {
      final pathToShare =
          state.dirty ? await _compileVerifiedTempPdf() : state.workFilePath;
      if (pathToShare != null) {
        await _fileBridge.shareFile(
          sourceWorkPath: pathToShare,
          displayName: state.displayName,
        );
      }
    } catch (err) {
      notifier.setError(err.toString());
    } finally {
      notifier.setLoading(false);
    }
  }

  Future<void> _printCurrentPdf() async {
    final state = ref.read(gpSessionProvider);
    final pathToPrint =
        state.dirty ? await _compileVerifiedTempPdf() : state.workFilePath;
    if (pathToPrint != null) {
      await _fileBridge.printPdf(
        sourceWorkPath: pathToPrint,
        displayName: state.displayName,
      );
    }
  }

  Future<void> _openSettingsSheet(BuildContext context, GpL10n l10n) async {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: palette.surfaceRaised,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
      ),
      builder: (ctx) {
        return Consumer(
          builder: (ctx, sheetRef, _) {
            final st = sheetRef.watch(gpSessionProvider);
            final notif = sheetRef.read(gpSessionProvider.notifier);
            return SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(GpSpacing.s4),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      l10n.t('settings.language'),
                      style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                    ),
                    const SizedBox(height: GpSpacing.s2),
                    SegmentedButton<GpLocale>(
                      segments: [
                        ButtonSegment(value: GpLocale.en, label: Text(l10n.t('settings.languageEn'))),
                        ButtonSegment(value: GpLocale.tr, label: Text(l10n.t('settings.languageTr'))),
                      ],
                      selected: {st.locale},
                      onSelectionChanged: (s) => notif.setLocale(s.first),
                    ),
                    const SizedBox(height: GpSpacing.s4),
                    Text(
                      'Theme',
                      style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                    ),
                    const SizedBox(height: GpSpacing.s2),
                    SegmentedButton<GpReadingTheme>(
                      segments: [
                        ButtonSegment(value: GpReadingTheme.light, label: Text(l10n.t('theme.light'))),
                        ButtonSegment(value: GpReadingTheme.dark, label: Text(l10n.t('theme.dark'))),
                        ButtonSegment(value: GpReadingTheme.sepia, label: Text(l10n.t('theme.sepia'))),
                      ],
                      selected: {st.theme},
                      onSelectionChanged: (s) {
                        _tileCache.clear();
                        notif.setTheme(s.first);
                      },
                    ),
                    if (st.theme == GpReadingTheme.dark)
                      SwitchListTile(
                        value: st.darkPaperInvert,
                        onChanged: (_) {
                          _tileCache.clear();
                          notif.toggleDarkPaperInvert();
                        },
                        title: Text(
                          'Invert white PDF pages',
                          style: GpTypography.body.copyWith(color: palette.textPrimary),
                        ),
                      ),
                    SwitchListTile(
                      value: st.leftHanded,
                      onChanged: (_) => notif.toggleLeftHanded(),
                      title: Text(
                        l10n.t('settings.leftHanded'),
                        style: GpTypography.body.copyWith(color: palette.textPrimary),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _openSignatureGhostFlow(GpL10n l10n) async {
    final strokes = await showGpSignaturePadSheet(context, l10n);
    if (strokes == null || strokes.isEmpty) return;

    final state = ref.read(gpSessionProvider);
    final idx =
        state.activePageIndex.clamp(0, math.max(0, state.pages.length - 1)).toInt();
    final page = state.pages[idx];
    ref.read(gpSessionProvider.notifier).setGhostSignature(
          GpGhostSignature(
            label: l10n.t('mobile.tool.signature'),
            strokes: strokes,
            centerPdf: Offset(page.displayWidth * 0.5, page.displayHeight * 0.5),
            sizePdf: const Size(160, 72),
          ),
        );
  }

  void _commitGhostSignature() {
    final state = ref.read(gpSessionProvider);
    final ghost = state.ghostSignature;
    if (ghost == null || state.pages.isEmpty) return;
    final page = state.pages[state.activePageIndex.clamp(0, state.pages.length - 1)];

    // Normalize pad coordinates (300x180) into ghost PDF bounds cleanly.
    final scaledPts = <Offset>[];
    for (final stroke in ghost.strokes) {
      for (final pt in stroke) {
        scaledPts.add(
          Offset(
            ghost.centerPdf.dx - ghost.sizePdf.width * 0.5 + (pt.dx / 300.0) * ghost.sizePdf.width,
            ghost.centerPdf.dy - ghost.sizePdf.height * 0.5 + (pt.dy / 180.0) * ghost.sizePdf.height,
          ),
        );
      }
    }

    ref.read(gpSessionProvider.notifier).addElement(
          GpOverlayElement(
            id: 'sig_${DateTime.now().microsecondsSinceEpoch}',
            pageId: page.id,
            kind: 'ink',
            x: ghost.centerPdf.dx - ghost.sizePdf.width * 0.5,
            y: ghost.centerPdf.dy - ghost.sizePdf.height * 0.5,
            width: ghost.sizePdf.width,
            height: ghost.sizePdf.height,
            colorValue: 0xFF1D4ED8,
            strokeWidth: 2.2,
            points: scaledPts,
          ),
        );
    ref.read(gpSessionProvider.notifier).setGhostSignature(null);
  }

  @override
  Widget build(BuildContext context) {
    final appState = ref.watch(gpSessionProvider);
    final notifier = ref.read(gpSessionProvider.notifier);
    final l10n = GpL10n(appState.locale);
    final palette = GpPalette.forTheme(appState.theme);
    final brightness =
        appState.theme == GpReadingTheme.light ? Brightness.light : Brightness.dark;

    return MaterialApp(
      title: l10n.t('app.name'),
      debugShowCheckedModeBanner: false,
      locale: Locale(appState.locale.name),
      supportedLocales: const [Locale('en'), Locale('tr')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        brightness: brightness,
        useMaterial3: true,
        colorSchemeSeed: palette.accent,
        scaffoldBackgroundColor: palette.surface,
        extensions: [palette],
      ),
      home: Builder(
        builder: (ctx) {
          final layoutSpec = GpLayoutSpec.fromMediaQuery(MediaQuery.of(ctx));

          return CallbackShortcuts(
            bindings: {
              const SingleActivator(LogicalKeyboardKey.keyZ, control: true): notifier.undo,
              const SingleActivator(LogicalKeyboardKey.keyY, control: true): notifier.redo,
              const SingleActivator(LogicalKeyboardKey.keyS, control: true): () {
                if (appState.hasDocument) {
                  unawaited(
                    showGpSaveWorkflowSheet(
                      context: ctx,
                      appState: appState,
                      l10n: l10n,
                      onSaveAsCopy: _saveAsCopy,
                      onOverwriteOriginal: _overwriteOriginal,
                      onSetDontAsk: notifier.setDontAskOverwriteAgain,
                      onShare: _shareCurrentPdf,
                    ),
                  );
                }
              },
              const SingleActivator(LogicalKeyboardKey.keyF, control: true): () {
                if (appState.hasDocument) notifier.setSheet(GpSheetKind.search);
              },
              const SingleActivator(LogicalKeyboardKey.keyE): () {
                if (appState.hasDocument) {
                  _switchModePreservingAnchor(
                    appState.mode == GpAppMode.view ? GpAppMode.edit : GpAppMode.view,
                  );
                }
              },
            },
            child: Focus(
              autofocus: true,
              child: !appState.hasDocument
                  ? Stack(
                      children: [
                        GpLibraryScreen(
                          appState: appState,
                          layoutSpec: layoutSpec,
                          l10n: l10n,
                          onOpenPicker: _openFromPicker,
                          onCreateBlankPdf: _createBlankDocument,
                          onReopenRecent: (doc) async {
                            if (doc.sourceId.startsWith('/') || doc.sourceId.contains(':\\')) {
                              if (File(doc.sourceId).existsSync()) {
                                await _openWorkFile(
                                  path: doc.sourceId,
                                  displayName: doc.displayName,
                                  writable: doc.writable,
                                );
                                return;
                              }
                            }
                            await _openFromPicker();
                          },
                          onOpenDefaultAppSettings: _fileBridge.openDefaultAppSettings,
                          onSetLocale: notifier.setLocale,
                          onSetTheme: notifier.setTheme,
                          onDiscardRecovery: notifier.discardRecoverableAutosave,
                        ),
                        if (appState.passwordRequiredForPath != null)
                          _GpPasswordDialogOverlay(
                            appState: appState,
                            l10n: l10n,
                            onSubmitPassword: (pw) => _openWorkFile(
                              path: appState.passwordRequiredForPath!,
                              displayName: appState.displayName,
                              sourceUri: appState.sourceUri,
                              writable: appState.writable,
                              password: pw,
                            ),
                            onCancel: notifier.clearPasswordPrompt,
                          ),
                        if (appState.errorBanner != null)
                          _GpErrorBanner(
                            message: appState.errorBanner!,
                            l10n: l10n,
                            onDismiss: () => notifier.setError(null),
                            onOpenInOtherApp: appState.workFilePath == null
                                ? null
                                : () => _fileBridge.openInOtherApp(
                                      sourceWorkPath: appState.workFilePath!,
                                      displayName: appState.displayName,
                                    ),
                          ),
                      ],
                    )
                  : _buildWorkspace(ctx, appState, layoutSpec, l10n, notifier),
            ),
          );
        },
      ),
    );
  }

  Widget _buildWorkspace(
    BuildContext ctx,
    GpAppState appState,
    GpLayoutSpec layoutSpec,
    GpL10n l10n,
    GpSessionNotifier notifier,
  ) {
    final palette = GpPalette.forTheme(appState.theme);
    final selectedEl = appState.selectedElementId == null
        ? null
        : appState.elements
            .where((e) => e.id == appState.selectedElementId)
            .firstOrNull;

    final viewportWidget = Expanded(
      child: Stack(
        children: [
          PdfViewport(
            appState: appState,
            bridge: _bridge,
            tileCache: _tileCache,
            controller: _viewportCtrl,
            onPositionChanged: notifier.updateViewportPosition,
            onToggleImmersive: notifier.toggleImmersive,
            onAddOverlayElement: notifier.addElement,
            onSelectElement: notifier.selectElement,
            onEraseStrokeAt: (pt, pageIdx) {
              final p = appState.pages[pageIdx];
              final hitEl = appState.elements
                  .where((e) =>
                      e.pageId == p.id &&
                      e.kind == 'ink' &&
                      Rect.fromLTWH(e.x, e.y, e.width, e.height)
                          .inflate(10)
                          .contains(pt))
                  .firstOrNull;
              if (hitEl != null) {
                notifier.selectElement(hitEl.id);
                notifier.deleteSelectedElement();
              }
            },
          ),

          if (appState.mode == GpAppMode.view &&
              !appState.immersiveHidden &&
              !layoutSpec.isTabletOrDesktop)
            Positioned(
              bottom: GpSpacing.s4 + MediaQuery.paddingOf(ctx).bottom,
              left: appState.leftHanded ? GpSpacing.s4 : null,
              right: appState.leftHanded ? null : GpSpacing.s4,
              child: FloatingActionButton.extended(
                key: const Key('viewer-edit-fab'),
                onPressed: () => _switchModePreservingAnchor(GpAppMode.edit),
                backgroundColor: palette.accent,
                foregroundColor: palette.accentForeground,
                icon: const Icon(Icons.edit_outlined),
                label: Text(l10n.t('action.editPdf')),
              ),
            ),

          if (selectedEl != null &&
              selectedEl.kind == 'textAdd' &&
              appState.mode == GpAppMode.edit)
            Positioned(
              left: 0,
              right: 0,
              bottom: 4,
              child: GpInlineTextInspectorBar(
                element: selectedEl,
                onUpdate: (u) => notifier.updateElement(u, recordHistory: false),
                onClose: () => notifier.selectElement(null),
              ),
            ),

          if (appState.ghostSignature != null)
            Positioned(
              left: GpSpacing.s4,
              right: GpSpacing.s4,
              bottom: GpSpacing.s4,
              child: Container(
                padding: const EdgeInsets.all(GpSpacing.s3),
                decoration: BoxDecoration(
                  color: palette.surfaceOverlay,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: palette.accent),
                  boxShadow: const [BoxShadow(blurRadius: 12, color: Color(0x44000000))],
                ),
                child: Row(
                  children: [
                    Icon(Icons.gesture, color: palette.accent),
                    const SizedBox(width: GpSpacing.s2),
                    Expanded(
                      child: Text(
                        l10n.t('mobile.tool.signature'),
                        style: GpTypography.body.copyWith(color: palette.textPrimary),
                      ),
                    ),
                    TextButton(
                      onPressed: () => notifier.setGhostSignature(null),
                      child: Text(l10n.t('action.cancel')),
                    ),
                    FilledButton(
                      key: const Key('ghost-place-btn'),
                      onPressed: _commitGhostSignature,
                      style: FilledButton.styleFrom(
                        backgroundColor: palette.accent,
                        minimumSize: const Size(108, GpComponents.touchTargetMin),
                      ),
                      child: Text(l10n.t('mobile.placeGhost')),
                    ),
                  ],
                ),
              ),
            ),

          if (appState.activeSheet == GpSheetKind.navigator && !layoutSpec.isTabletOrDesktop)
            GpNavigatorSheet(
              appState: appState,
              l10n: l10n,
              onSelectPage: (idx) => _viewportCtrl.scrollToPage(idx, appState.pages),
              onClose: notifier.closeSheet,
            ),
        ],
      ),
    );

    final showTabletSidebar =
        layoutSpec.isTabletOrDesktop && (appState.splitOutlineVisible || layoutSpec.isFoldSplit);

    return Scaffold(
      backgroundColor: palette.surface,
      body: Column(
        children: [
          if (!appState.immersiveHidden || appState.mode == GpAppMode.edit)
            appState.mode == GpAppMode.view
                ? GpViewerTopBar(
                    appState: appState,
                    layoutSpec: layoutSpec,
                    l10n: l10n,
                    onBackToLibrary: () {
                      final id = appState.docId;
                      if (id != null) unawaited(_bridge.closeDocument(id));
                      _tileCache.clear();
                      notifier.resetToLibrary();
                    },
                    onToggleNavigator: () {
                      if (layoutSpec.isTabletOrDesktop) {
                        notifier.toggleSplitOutline();
                      } else {
                        notifier.setSheet(GpSheetKind.navigator);
                      }
                    },
                    onToggleSearch: () => notifier.setSheet(GpSheetKind.search),
                    onOpenSaveSheet: () => unawaited(
                      showGpSaveWorkflowSheet(
                        context: ctx,
                        appState: appState,
                        l10n: l10n,
                        onSaveAsCopy: _saveAsCopy,
                        onOverwriteOriginal: _overwriteOriginal,
                        onSetDontAsk: notifier.setDontAskOverwriteAgain,
                        onShare: _shareCurrentPdf,
                      ),
                    ),
                    onShare: _shareCurrentPdf,
                    onPrint: _printCurrentPdf,
                    onOpenSettings: () => unawaited(_openSettingsSheet(ctx, l10n)),
                    onSwitchToEdit: () => _switchModePreservingAnchor(GpAppMode.edit),
                  )
                : GpEditorTopBar(
                    appState: appState,
                    layoutSpec: layoutSpec,
                    l10n: l10n,
                    onDoneToViewer: () => _switchModePreservingAnchor(GpAppMode.view),
                    onUndo: notifier.undo,
                    onRedo: notifier.redo,
                    onDeleteSelected: notifier.deleteSelectedElement,
                    onSave: () => unawaited(
                      showGpSaveWorkflowSheet(
                        context: ctx,
                        appState: appState,
                        l10n: l10n,
                        onSaveAsCopy: _saveAsCopy,
                        onOverwriteOriginal: _overwriteOriginal,
                        onSetDontAsk: notifier.setDontAskOverwriteAgain,
                        onShare: _shareCurrentPdf,
                      ),
                    ),
                  ),

          if (appState.activeSheet == GpSheetKind.search)
            GpViewerSearchBar(
              appState: appState,
              l10n: l10n,
              onQuerySubmit: _startStreamingSearch,
              onStepResult: (delta) {
                notifier.stepSearchResult(delta);
                final updated = ref.read(gpSessionProvider);
                if (updated.searchHits.isNotEmpty) {
                  _viewportCtrl.scrollToPage(
                    updated.searchHits[updated.activeSearchIdx].pageIndex,
                    updated.pages,
                  );
                }
              },
              onClose: notifier.closeSheet,
            ),

          if (appState.errorBanner != null)
            _GpErrorBanner(
              message: appState.errorBanner!,
              l10n: l10n,
              onDismiss: () => notifier.setError(null),
              onOpenInOtherApp: appState.workFilePath == null
                  ? null
                  : () => _fileBridge.openInOtherApp(
                        sourceWorkPath: appState.workFilePath!,
                        displayName: appState.displayName,
                      ),
            ),

          Expanded(
            child: Row(
              children: [
                if (showTabletSidebar)
                  Container(
                    width: layoutSpec.layoutClass == GpLayoutClass.expanded ? 260 : 210,
                    decoration: BoxDecoration(
                      color: palette.surfaceRaised,
                      border: Border(right: BorderSide(color: palette.borderSubtle)),
                    ),
                    child: ListView.builder(
                      padding: const EdgeInsets.all(GpSpacing.s2),
                      itemCount: appState.pages.length,
                      itemBuilder: (_, idx) {
                        final active = idx == appState.activePageIndex;
                        return ListTile(
                          selected: active,
                          selectedTileColor: palette.accent.withValues(alpha: 0.14),
                          title: Text(
                            '${l10n.t('nav.pages')} ${idx + 1}',
                            style: GpTypography.body.copyWith(color: palette.textPrimary),
                          ),
                          onTap: () => _viewportCtrl.scrollToPage(idx, appState.pages),
                        );
                      },
                    ),
                  ),
                viewportWidget,
              ],
            ),
          ),

          if (appState.mode == GpAppMode.edit)
            GpEditorToolDock(
              activeTool: appState.tool,
              l10n: l10n,
              onSelectTool: notifier.setTool,
              onOpenSignaturePad: () => unawaited(_openSignatureGhostFlow(l10n)),
              onOpenOrganizeSheet: () => unawaited(
                showGpPageOrganizeSheet(
                  context: ctx,
                  appState: appState,
                  l10n: l10n,
                  onRotatePage: notifier.rotatePageClockwise,
                  onMovePage: notifier.movePage,
                  onDeletePage: notifier.deletePageAt,
                  onMergePdf: _openFromPicker,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _GpPasswordDialogOverlay extends StatefulWidget {
  const _GpPasswordDialogOverlay({
    required this.appState,
    required this.l10n,
    required this.onSubmitPassword,
    required this.onCancel,
  });

  final GpAppState appState;
  final GpL10n l10n;
  final void Function(String password) onSubmitPassword;
  final VoidCallback onCancel;

  @override
  State<_GpPasswordDialogOverlay> createState() => _GpPasswordDialogOverlayState();
}

class _GpPasswordDialogOverlayState extends State<_GpPasswordDialogOverlay> {
  final TextEditingController _pwCtrl = TextEditingController();

  @override
  void dispose() {
    _pwCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    return Material(
      color: const Color(0x88000000),
      child: Center(
        child: Container(
          width: 340,
          padding: const EdgeInsets.all(GpSpacing.s4),
          decoration: BoxDecoration(
            color: palette.surfaceRaised,
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                widget.l10n.t('mobile.passwordTitle'),
                style: GpTypography.titleM.copyWith(color: palette.textPrimary),
              ),
              const SizedBox(height: GpSpacing.s3),
              TextField(
                controller: _pwCtrl,
                obscureText: true,
                autofocus: true,
                decoration: InputDecoration(
                  errorText: widget.appState.passwordInvalid
                      ? widget.l10n.t('mobile.passwordInvalid')
                      : null,
                  border: const OutlineInputBorder(),
                ),
                onSubmitted: widget.onSubmitPassword,
              ),
              const SizedBox(height: GpSpacing.s3),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  TextButton(
                    onPressed: widget.onCancel,
                    child: Text(widget.l10n.t('action.cancel')),
                  ),
                  const SizedBox(width: GpSpacing.s2),
                  FilledButton(
                    onPressed: () => widget.onSubmitPassword(_pwCtrl.text),
                    child: Text(widget.l10n.t('action.openPdf')),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GpErrorBanner extends StatelessWidget {
  const _GpErrorBanner({
    required this.message,
    required this.l10n,
    required this.onDismiss,
    this.onOpenInOtherApp,
  });

  final String message;
  final GpL10n l10n;
  final VoidCallback onDismiss;
  final VoidCallback? onOpenInOtherApp;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    return Material(
      color: palette.danger.withValues(alpha: 0.16),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: GpSpacing.s3, vertical: GpSpacing.s2),
          child: Row(
            children: [
              Icon(Icons.error_outline, color: palette.danger),
              const SizedBox(width: GpSpacing.s2),
              Expanded(
                child: Text(
                  message,
                  style: GpTypography.caption.copyWith(color: palette.textPrimary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (onOpenInOtherApp != null)
                TextButton(
                  onPressed: onOpenInOtherApp,
                  child: Text(l10n.t('mobile.openInOtherApp')),
                ),
              IconButton(onPressed: onDismiss, icon: const Icon(Icons.close)),
            ],
          ),
        ),
      ),
    );
  }
}
