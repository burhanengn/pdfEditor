import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';

import '../engine/session_bridge.dart';
import '../engine/tile_cache.dart';
import '../features/editor/editor_chrome.dart';
import '../features/editor/element_inspector_sheet.dart';
import '../features/editor/page_organizer_sheet.dart';
import '../features/library/library_screen.dart';
import '../features/signature/signature_studio_sheet.dart';
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
  final Set<String> _analyzingPageKeys = <String>{};
  final Set<int> _extractedLinkPages = <int>{};
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
      _analyzingPageKeys.clear();
      _extractedLinkPages.clear();

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
      if (outcome.pages.isNotEmpty) {
        unawaited(_ensurePageAnalyzedAndLinks(0));
      }
    } catch (err) {
      notifier.setLoading(false);
      notifier.setError(err.toString());
    }
  }

  Future<void> _openFromPicker() async {
    try {
      final req = await _fileBridge.openDocumentPicker(allowMultiple: false);
      if (req != null) {
        await _handleIncomingOpenRequest(req);
      }
    } catch (err) {
      ref.read(gpSessionProvider.notifier).setError(err.toString());
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
    if (nextMode == GpAppMode.edit && appState.pages.isNotEmpty) {
      unawaited(_ensurePageAnalyzedAndLinks(appState.activePageIndex));
    }
    if (anchor != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _viewportCtrl.restoreAnchor(anchor, ref.read(gpSessionProvider).pages);
      });
    }
  }

  Future<void> _ensurePageAnalyzedAndLinks(int pageIndex) async {
    final state = ref.read(gpSessionProvider);
    if (state.docId == null ||
        pageIndex < 0 ||
        pageIndex >= state.pages.length) {
      return;
    }
    final page = state.pages[pageIndex];
    if (page.sourceDocId == 'blank') return;

    final key = '${page.sourceDocId}:${page.sourcePageIndex}:${page.id}';
    if (!state.pageAnalyses.containsKey(page.id) &&
        _analyzingPageKeys.add(key)) {
      try {
        final raw = await _bridge.analyzePageObjectsJson(
          docId: page.sourceDocId,
          pageIndex: page.sourcePageIndex,
          pageId: page.id,
        );
        if (!mounted || ref.read(gpSessionProvider).docId != state.docId) return;
        if (raw.trim().isNotEmpty && raw.trim() != '{}') {
          final parsed = GpPageAnalysis.fromJsonString(raw);
          ref.read(gpSessionProvider.notifier).setPageAnalysis(page.id, parsed);
        }
      } catch (_) {}
    }

    if (!state.pageLinks.containsKey(page.sourcePageIndex) &&
        _extractedLinkPages.add(page.sourcePageIndex)) {
      try {
        final links = await _bridge.extractPageLinks(
          docId: page.sourceDocId,
          pageIndex: page.sourcePageIndex,
        );
        if (!mounted || ref.read(gpSessionProvider).docId != state.docId) return;
        if (links.isNotEmpty) {
          ref
              .read(gpSessionProvider.notifier)
              .setPageLinks(page.sourcePageIndex, links);
        }
      } catch (_) {}
    }
  }

  Future<void> _rebuildCleanPreviewForPage(GpPageMeta page) async {
    if (page.sourceDocId == 'blank') return;
    final state = ref.read(gpSessionProvider);
    final notifier = ref.read(gpSessionProvider.notifier);
    final relevant = state.elements
        .where(
          (e) =>
              e.pageId == page.id &&
              (e.kind == 'textEdit' ||
                  e.kind == 'imageReplacement' ||
                  e.kind == 'shapeReplacement'),
        )
        .toList();

    final prevClean = state.cleanPreviewDocIds[page.id];
    if (relevant.isEmpty) {
      if (prevClean != null) {
        notifier.setCleanPreviewDocId(page.id, null);
        _tileCache.invalidateDoc(prevClean);
        unawaited(_bridge.closeDocument(prevClean));
      }
      return;
    }

    try {
      final cleanBytes = await _bridge.prepareCleanPagePreview(
        docId: page.sourceDocId,
        pageIndex: page.sourcePageIndex,
        elements: relevant,
      );
      if (!mounted || cleanBytes.isEmpty) return;
      final nextCleanId =
          'clean_${page.id}_${DateTime.now().microsecondsSinceEpoch}';
      await _bridge.openDocumentBytes(docId: nextCleanId, bytes: cleanBytes);
      if (!mounted) return;
      notifier.setCleanPreviewDocId(page.id, nextCleanId);
      if (prevClean != null) {
        _tileCache.invalidateDoc(prevClean);
        unawaited(_bridge.closeDocument(prevClean));
      }
    } catch (_) {}
  }

  void _editPdfTextBlock(int pageIndex, GpDetectedTextBlock block) {
    final state = ref.read(gpSessionProvider);
    if (pageIndex < 0 || pageIndex >= state.pages.length) return;
    final page = state.pages[pageIndex];
    final notifier = ref.read(gpSessionProvider.notifier);

    final existing = state.elements
        .where(
          (e) =>
              e.pageId == page.id &&
              !e.deleted &&
              e.kind == 'textEdit' &&
              e.sourceBlockId == block.id,
        )
        .firstOrNull;
    if (existing != null) {
      notifier.selectElement(existing.id);
      return;
    }

    final el = GpOverlayElement(
      id: 'te_${DateTime.now().microsecondsSinceEpoch}',
      pageId: page.id,
      kind: 'textEdit',
      x: block.x,
      y: block.y,
      width: math.max(96.0, block.width),
      height: math.max(18.0, block.height),
      text: block.text,
      originalText: block.text,
      sourceBlockId: block.id,
      fontSize: block.fontSize,
      fontFamily: block.fontFamily,
      bold: block.bold,
      italic: block.italic,
      colorValue: block.colorValue,
      lineHeight: block.lineHeight,
    );
    notifier.addElement(el);
    unawaited(_rebuildCleanPreviewForPage(page));
  }

  Future<void> _insertImageFromPicker(BuildContext modalCtx) async {
    final notifier = ref.read(gpSessionProvider.notifier);
    try {
      final req = await _fileBridge.pickImage(allowMultiple: false);
      if (req == null || req.uris.isEmpty) return;
      final work = await _fileBridge.copyToWorkFile(
        sourceUri: req.uris.first,
        displayName: req.displayName,
      );
      final bytes = await File(work.workPath).readAsBytes();
      if (bytes.isEmpty) return;

      var drawW = 180.0;
      var drawH = 120.0;
      try {
        if (bytes.length >= 24 &&
            bytes[0] == 0x89 &&
            bytes[1] == 0x50 &&
            bytes[2] == 0x4E &&
            bytes[3] == 0x47) {
          final pw = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
          final ph = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
          if (pw > 0 && ph > 0) {
            final aspect = pw / ph;
            drawW = math.min(240.0, math.max(64.0, pw.toDouble()));
            drawH = math.max(36.0, drawW / aspect);
          }
        } else {
          final codec = await ui.instantiateImageCodec(bytes).timeout(
                const Duration(milliseconds: 500),
              );
          final frame = await codec.getNextFrame().timeout(
                const Duration(milliseconds: 500),
              );
          final img = frame.image;
          if (img.width > 0 && img.height > 0) {
            final aspect = img.width / img.height;
            drawW = math.min(240.0, math.max(64.0, img.width.toDouble()));
            drawH = math.max(36.0, drawW / aspect);
          }
          img.dispose();
          codec.dispose();
        }
      } catch (_) {}

      final st = ref.read(gpSessionProvider);
      if (st.pages.isEmpty) return;
      final page =
          st.pages[st.activePageIndex.clamp(0, st.pages.length - 1)];
      final x = ((page.displayWidth - drawW) * 0.5).clamp(12.0, page.displayWidth - 24.0);
      final y = ((page.displayHeight - drawH) * 0.5).clamp(12.0, page.displayHeight - 24.0);
      final lower = work.displayName.toLowerCase();
      final mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg')
          ? 'image/jpeg'
          : (lower.endsWith('.webp') ? 'image/webp' : 'image/png');

      notifier.addElement(
        GpOverlayElement(
          id: 'img_${DateTime.now().microsecondsSinceEpoch}',
          pageId: page.id,
          kind: 'image',
          x: x,
          y: y,
          width: drawW,
          height: drawH,
          imageName: work.displayName,
          mimeType: mime,
          imageBytes: bytes,
        ),
      );
    } catch (err) {
      notifier.setError(err.toString());
    }
  }

  Future<void> _mergeExternalPdf() async {
    final notifier = ref.read(gpSessionProvider.notifier);
    try {
      final req = await _fileBridge.openDocumentPicker(allowMultiple: false);
      if (req == null || req.uris.isEmpty) return;
      final work = await _fileBridge.copyToWorkFile(
        sourceUri: req.uris.first,
        displayName: req.displayName,
      );
      final mergeDocId = 'merge_${DateTime.now().millisecondsSinceEpoch}';
      final outcome = await _bridge.openDocumentFile(
        docId: mergeDocId,
        path: work.workPath,
      );
      if (outcome.status == 'needs-password' ||
          outcome.status == 'invalid-password') {
        notifier.setError('Password-protected PDF cannot be merged directly.');
        return;
      }
      final remapped = [
        for (var i = 0; i < outcome.pages.length; i++)
          GpPageMeta(
            id: '${mergeDocId}_p$i',
            sourceDocId: mergeDocId,
            sourcePageIndex: outcome.pages[i].sourcePageIndex,
            baseWidth: outcome.pages[i].baseWidth,
            baseHeight: outcome.pages[i].baseHeight,
            intrinsicRotation: outcome.pages[i].intrinsicRotation,
            userRotation: outcome.pages[i].userRotation,
          ),
      ];
      notifier.mergeExternalPages(remapped);
    } catch (err) {
      notifier.setError(err.toString());
    }
  }

  Future<void> _splitExtractPages(
    BuildContext modalCtx,
    Set<int> indices,
    GpL10n l10n,
  ) async {
    final state = ref.read(gpSessionProvider);
    final notifier = ref.read(gpSessionProvider.notifier);
    final sorted = indices
        .where((i) => i >= 0 && i < state.pages.length)
        .toList()
      ..sort();
    if (sorted.isEmpty) return;

    notifier.setLoading(true);
    try {
      final selectedPages = [for (final i in sorted) state.pages[i]];
      final selectedIds = {for (final p in selectedPages) p.id};
      final selectedElements =
          state.elements.where((e) => selectedIds.contains(e.pageId)).toList();
      final dir = await getTemporaryDirectory();
      final outPath =
          '${dir.path}/extracted_${DateTime.now().millisecondsSinceEpoch}.pdf';
      await _bridge.compileAndSaveVerified(
        pages: selectedPages,
        elements: selectedElements,
        redactionsPage0: const [],
        outputPath: outPath,
        pageNumbering: state.pageNumbering,
        customTtfBytes: state.customTtfBytes,
      );
      final base = state.displayName
          .replaceAll(RegExp(r'\.pdf$', caseSensitive: false), '');
      await _fileBridge.createDocument(
        suggestedName: '$base-extracted.pdf',
        sourceWorkPath: outPath,
      );
      if (modalCtx.mounted) {
        ScaffoldMessenger.of(modalCtx).showSnackBar(
          SnackBar(content: Text('${l10n.t('mobile.splitPdf')} (${sorted.length})')),
        );
      }
    } catch (err) {
      notifier.setError(err.toString());
    } finally {
      notifier.setLoading(false);
    }
  }

  void _handleTapPdfLink(BuildContext modalCtx, GpPageLink link, GpL10n l10n) {
    final state = ref.read(gpSessionProvider);
    if (link.kind == 'goto' && link.destPageIndex != null) {
      _viewportCtrl.scrollToPage(link.destPageIndex!, state.pages);
      return;
    }
    final uri = link.uri;
    if (uri == null || uri.isEmpty) return;
    ScaffoldMessenger.of(modalCtx).showSnackBar(
      SnackBar(
        content: Text(uri),
        action: SnackBarAction(
          label: 'Copy',
          onPressed: () => Clipboard.setData(ClipboardData(text: uri)),
        ),
      ),
    );
  }

  void _refreshCleanPreviewIfNeeded(String? pageId) {
    if (pageId == null) return;
    final state = ref.read(gpSessionProvider);
    final page = state.pages.where((p) => p.id == pageId).firstOrNull;
    if (page != null) {
      unawaited(_rebuildCleanPreviewForPage(page));
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
      pageNumbering: state.pageNumbering,
      customTtfBytes: state.customTtfBytes,
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

  Future<void> _openSignatureGhostFlow(
    BuildContext modalCtx,
    GpL10n l10n,
  ) async {
    final notifier = ref.read(gpSessionProvider.notifier);
    final ghost = await showGpSignatureStudioSheet(
      context: modalCtx,
      appState: ref.read(gpSessionProvider),
      l10n: l10n,
      fileBridge: _fileBridge,
      onSaveToVault: notifier.saveSignatureToVault,
      onDeleteFromVault: notifier.deleteSignatureFromVault,
    );
    if (ghost == null) return;

    final state = ref.read(gpSessionProvider);
    final idx =
        state.activePageIndex.clamp(0, math.max(0, state.pages.length - 1)).toInt();
    final page = state.pages[idx];
    notifier.setGhostSignature(
      ghost.copyWith(
        centerPdf: Offset(page.displayWidth * 0.5, page.displayHeight * 0.5),
      ),
    );
  }

  void _commitGhostSignature({int? targetPageIdx, Offset? targetCenterPdf}) {
    final state = ref.read(gpSessionProvider);
    final ghost = state.ghostSignature;
    if (ghost == null || state.pages.isEmpty) return;
    final pIdx =
        (targetPageIdx ?? state.activePageIndex).clamp(0, state.pages.length - 1);
    final page = state.pages[pIdx];
    final center = targetCenterPdf ?? ghost.centerPdf;
    final vbW = ghost.viewBoxSize.width <= 0 ? 300.0 : ghost.viewBoxSize.width;
    final vbH = ghost.viewBoxSize.height <= 0 ? 180.0 : ghost.viewBoxSize.height;
    final left = center.dx - ghost.sizePdf.width * 0.5;
    final top = center.dy - ghost.sizePdf.height * 0.5;

    final scaledPts = <Offset>[];
    for (final stroke in ghost.strokes) {
      for (final pt in stroke) {
        scaledPts.add(
          Offset(
            left + (pt.dx / vbW) * ghost.sizePdf.width,
            top + (pt.dy / vbH) * ghost.sizePdf.height,
          ),
        );
      }
    }

    var svgPaths = ghost.svgPaths;
    if (svgPaths.isEmpty && ghost.imageBytes == null && ghost.strokes.isNotEmpty) {
      final hex = '#${(ghost.colorValue & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';
      svgPaths = [
        for (final s in ghost.strokes)
          if (s.length >= 2)
            GpSignatureSvgPath(
              d: 'M ${s.first.dx.toStringAsFixed(1)} ${s.first.dy.toStringAsFixed(1)} '
                  '${s.skip(1).map((p) => 'L ${p.dx.toStringAsFixed(1)} ${p.dy.toStringAsFixed(1)}').join(' ')}',
              fill: 'none',
              stroke: hex,
              strokeWidth: 2.2,
            ),
      ];
    }

    ref.read(gpSessionProvider.notifier).addElement(
          GpOverlayElement(
            id: 'sig_${DateTime.now().microsecondsSinceEpoch}',
            pageId: page.id,
            kind: 'signature',
            x: left,
            y: top,
            width: ghost.sizePdf.width,
            height: ghost.sizePdf.height,
            colorValue: ghost.colorValue,
            strokeWidth: 2.2,
            points: scaledPts,
            svgPaths: svgPaths,
            imageBytes: ghost.imageBytes,
            viewBoxWidth: vbW,
            viewBoxHeight: vbH,
            signatureId: ghost.signatureId,
            realisticInk: ghost.realisticInk,
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
                            } else if (doc.sourceId.startsWith('content://') ||
                                doc.sourceId.startsWith('file://')) {
                              try {
                                final work = await _fileBridge.copyToWorkFile(
                                  sourceUri: doc.sourceId,
                                  displayName: doc.displayName,
                                );
                                await _openWorkFile(
                                  path: work.workPath,
                                  displayName: work.displayName,
                                  sourceUri: doc.sourceId,
                                  writable: doc.writable,
                                );
                                return;
                              } catch (_) {
                                // Persistable permission revoked or moved; fall back to SAF picker.
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
            onPositionChanged: (pageIdx, zoom) {
              notifier.updateViewportPosition(pageIdx, zoom);
              unawaited(_ensurePageAnalyzedAndLinks(pageIdx));
            },
            onToggleImmersive: notifier.toggleImmersive,
            onAddOverlayElement: notifier.addElement,
            onSelectElement: notifier.selectElement,
            onUpdateOverlayElement: notifier.updateElement,
            onRequestEditPdfTextBlock: _editPdfTextBlock,
            onPlaceGhostAt: (pageIdx, pdfPt) => _commitGhostSignature(
              targetPageIdx: pageIdx,
              targetCenterPdf: pdfPt,
            ),
            onTapLink: (link) => _handleTapPdfLink(ctx, link, l10n),
            onEraseStrokeAt: (pt, pageIdx) {
              final p = appState.pages[pageIdx];
              final hitEl = appState.elements
                  .where((e) =>
                      e.pageId == p.id &&
                      !e.deleted &&
                      (e.kind == 'ink' || e.kind == 'path' || e.kind == 'highlight' || e.kind == 'shape' || e.kind == 'signature') &&
                      Rect.fromLTWH(e.x, e.y, e.width, e.height)
                          .inflate(10)
                          .contains(pt))
                  .firstOrNull;
              if (hitEl != null) {
                notifier.deleteElement(hitEl.id);
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
              !selectedEl.deleted &&
              appState.mode == GpAppMode.edit &&
              appState.ghostSignature == null)
            Positioned(
              left: 0,
              right: 0,
              bottom: 4,
              child: GpInlineSelectionBar(
                element: selectedEl,
                l10n: l10n,
                onUpdate: (u, {recordHistory = true}) =>
                    notifier.updateElement(u, recordHistory: recordHistory),
                onOpenFullInspector: () => unawaited(
                  showGpElementInspectorSheet(
                    context: ctx,
                    initialElement: selectedEl,
                    appState: ref.read(gpSessionProvider),
                    l10n: l10n,
                    fileBridge: _fileBridge,
                    onUpdate: (u) => notifier.updateElement(u, recordHistory: true),
                    onLoadCustomFont: (bytes, label) =>
                        notifier.setCustomFont(bytes, label),
                    onBringForward: () => notifier.bringForward(selectedEl.id),
                    onSendBackward: () => notifier.sendBackward(selectedEl.id),
                    onDuplicate: () => notifier.duplicateElement(selectedEl.id),
                    onToggleLock: () => notifier.toggleLockElement(selectedEl.id),
                    onApplyAcrossPages: (scope) =>
                        notifier.applyElementAcrossPages(selectedEl.id, scope: scope),
                    onDelete: () {
                      final pid = selectedEl.pageId;
                      notifier.deleteElement(selectedEl.id);
                      _refreshCleanPreviewIfNeeded(pid);
                    },
                  ),
                ),
                onDuplicate: () => notifier.duplicateElement(selectedEl.id),
                onDelete: () {
                  final pid = selectedEl.pageId;
                  notifier.deleteElement(selectedEl.id);
                  _refreshCleanPreviewIfNeeded(pid);
                },
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
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            appState.ghostSignature!.label,
                            style: GpTypography.label.copyWith(color: palette.textPrimary),
                          ),
                          Text(
                            l10n.t('mobile.tapToPlaceSig'),
                            style: GpTypography.caption.copyWith(color: palette.textSecondary),
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () => notifier.setGhostSignature(null),
                      child: Text(l10n.t('action.cancel')),
                    ),
                    FilledButton(
                      key: const Key('ghost-place-btn'),
                      onPressed: () => _commitGhostSignature(),
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
              bridge: _bridge,
              tileCache: _tileCache,
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
                    onCopyPageText: () async {
                      final docId = appState.docId;
                      if (docId == null || appState.pages.isEmpty) return;
                      final page = appState.pages[appState.activePageIndex];
                      final text = await _bridge.extractPageText(docId, page.sourcePageIndex);
                      if (!ctx.mounted) return;
                      await showGpPageTextSheet(
                        context: ctx,
                        appState: appState,
                        pageText: text,
                      );
                    },
                    onOpenSettings: () => unawaited(_openSettingsSheet(ctx, l10n)),
                    onSwitchToEdit: () => _switchModePreservingAnchor(GpAppMode.edit),
                  )
                : GpEditorTopBar(
                    appState: appState,
                    layoutSpec: layoutSpec,
                    l10n: l10n,
                    onDoneToViewer: () => _switchModePreservingAnchor(GpAppMode.view),
                    onUndo: () {
                      final activePgId = appState.pages.isEmpty
                          ? null
                          : appState.pages[appState.activePageIndex].id;
                      notifier.undo();
                      _refreshCleanPreviewIfNeeded(activePgId);
                    },
                    onRedo: () {
                      final activePgId = appState.pages.isEmpty
                          ? null
                          : appState.pages[appState.activePageIndex].id;
                      notifier.redo();
                      _refreshCleanPreviewIfNeeded(activePgId);
                    },
                    onDeleteSelected: () {
                      final activePgId = selectedEl?.pageId;
                      notifier.deleteSelectedElement();
                      _refreshCleanPreviewIfNeeded(activePgId);
                    },
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
                        final pg = appState.pages[idx];
                        return ListTile(
                          selected: active,
                          selectedTileColor: palette.accent.withValues(alpha: 0.14),
                          leading: SizedBox(
                            width: 34,
                            height: 46,
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: appState.docId == null
                                  ? null
                                  : GpPageThumbnailPreview(
                                      docId: appState.docId!,
                                      page: pg,
                                      themeName: appState.theme.name,
                                      darkPaperInvert: appState.darkPaperInvert,
                                      bridge: _bridge,
                                      tileCache: _tileCache,
                                    ),
                            ),
                          ),
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

          if (appState.mode == GpAppMode.edit &&
              appState.tool == GpEditorTool.shape)
            GpShapeVariantStrip(
              activeShapeType: appState.activeShapeType,
              activeStrokeColorValue: appState.activeStrokeColorValue,
              onSelectShape: (s) => notifier.setActiveShapeStyle(shapeType: s),
              onSelectColor: (c) =>
                  notifier.setActiveShapeStyle(strokeColorValue: c),
            ),

          if (appState.mode == GpAppMode.edit)
            GpEditorToolDock(
              activeTool: appState.tool,
              l10n: l10n,
              onSelectTool: notifier.setTool,
              onOpenSignaturePad: () => unawaited(_openSignatureGhostFlow(ctx, l10n)),
              onInsertImage: () => unawaited(_insertImageFromPicker(ctx)),
              onOpenOrganizeSheet: () => unawaited(
                showGpRichPageOrganizerSheet(
                  context: ctx,
                  appState: ref.read(gpSessionProvider),
                  l10n: l10n,
                  bridge: _bridge,
                  tileCache: _tileCache,
                  onRotatePageBy: notifier.rotatePageBy,
                  onMovePage: notifier.movePage,
                  onDuplicatePage: notifier.duplicatePageAt,
                  onInsertBlankAfter: (idx) => notifier.insertBlankPageAfter(idx),
                  onDeletePage: notifier.deletePageAt,
                  onBatchRotate: notifier.batchRotatePages,
                  onBatchDelete: notifier.batchDeletePages,
                  onSplitExtractPages: (indices) =>
                      _splitExtractPages(ctx, indices, l10n),
                  onMergePdf: _mergeExternalPdf,
                  onSavePageNumbering: notifier.setPageNumbering,
                  onJumpToPage: (idx) =>
                      _viewportCtrl.scrollToPage(idx, ref.read(gpSessionProvider).pages),
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
