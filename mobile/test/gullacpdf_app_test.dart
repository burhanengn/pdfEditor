import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gullacpdf_mobile/app/gullacpdf_app.dart';
import 'package:gullacpdf_mobile/app/session_state.dart';
import 'package:gullacpdf_mobile/engine/session_bridge.dart';
import 'package:gullacpdf_mobile/engine/tile_cache.dart';
import 'package:gullacpdf_mobile/gestures/pdf_gesture_arena.dart';
import 'package:gullacpdf_mobile/l10n/gp_l10n.g.dart';
import 'package:gullacpdf_mobile/theme/gp_tokens.g.dart';

class _FakeSessionBridge implements GpSessionBridge {
  int savedCount = 0;
  bool trimmed = false;

  @override
  Future<void> initialize() async {}

  @override
  Future<GpOpenDocOutcome> openDocumentFile({
    required String docId,
    required String path,
    String? password,
  }) async {
    return GpOpenDocOutcome(
      status: 'ok',
      pageCount: 2,
      canCopyText: true,
      pages: [
        GpPageMeta(
          id: '${docId}_p0',
          sourceDocId: docId,
          sourcePageIndex: 0,
          baseWidth: 595,
          baseHeight: 842,
          intrinsicRotation: 0,
        ),
        GpPageMeta(
          id: '${docId}_p1',
          sourceDocId: docId,
          sourcePageIndex: 1,
          baseWidth: 595,
          baseHeight: 842,
          intrinsicRotation: 0,
        ),
      ],
      outline: const [
        GpOutlineNode(id: 'o0', title: 'Introduction', pageIndex: 0),
        GpOutlineNode(id: 'o1', title: 'Results', pageIndex: 1),
      ],
    );
  }

  @override
  Future<GpOpenDocOutcome> openDocumentBytes({
    required String docId,
    required Uint8List bytes,
    String? password,
  }) =>
      openDocumentFile(docId: docId, path: 'memory.pdf', password: password);

  @override
  Future<void> closeDocument(String docId) async {}

  @override
  Future<GpTilePixels> renderTile({
    required String docId,
    required int pageIndex,
    required int tileX,
    required int tileY,
    required int tileWidthPx,
    required int tileHeightPx,
    required double scale,
    required int userRotation,
    required String theme,
    required bool darkPaperInvert,
    required int priorityTier,
    String? scope,
  }) async {
    final len = tileWidthPx * tileHeightPx * 4;
    final bytes = Uint8List(len);
    for (var i = 0; i < len; i += 4) {
      bytes[i] = 248;
      bytes[i + 1] = 250;
      bytes[i + 2] = 252;
      bytes[i + 3] = 255;
    }
    return GpTilePixels(width: tileWidthPx, height: tileHeightPx, rgba: bytes);
  }

  @override
  Future<void> cancelRenderScope(String scope) async {}

  @override
  Future<void> trimEngineMemory(int targetBytes) async {
    trimmed = true;
  }

  @override
  Future<String> extractPageText(String docId, int pageIndex) async =>
      'İstanbul Örnek PDF İçeriği Sayfa ${pageIndex + 1}';

  @override
  Stream<GpSearchBatch> searchDocument({
    required String docId,
    required String query,
    required bool matchCase,
    required bool wholeWord,
  }) async* {
    yield const GpSearchBatch(
      scannedPages: 2,
      totalPages: 2,
      done: true,
      hits: [
        GpSearchMatch(
          pageIndex: 0,
          matchIndexInPage: 0,
          snippet: 'İstanbul',
          rects: [Rect.fromLTWH(50, 100, 80, 16)],
        ),
      ],
    );
  }

  @override
  Future<int> compileAndSaveVerified({
    required List<GpPageMeta> pages,
    required List<GpOverlayElement> elements,
    required List<Rect> redactionsPage0,
    required String outputPath,
  }) async {
    savedCount++;
    return pages.length;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const fileChannel = MethodChannel('dev.gullacpdf/file_bridge');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(fileChannel, null);
  });

  test('M0.1 & M0.3: Design tokens enforce >=44px touch targets, >=12px text, EN default & TR auto-detect, TileCache LRU trim', () async {
    expect(GpComponents.touchTargetMin, greaterThanOrEqualTo(44.0));
    expect(GpTypography.caption.fontSize, greaterThanOrEqualTo(12.0));
    expect(GpL10n.detectFromLanguageCode('tr_TR'), GpLocale.tr);
    expect(GpL10n.detectFromLanguageCode('en_US'), GpLocale.en);
    expect(const GpL10n(GpLocale.tr).t('action.saveAsCopy'), 'Kopya olarak kaydet');

    final cache = GpTileCache(budgetBytes: 256 * 256 * 4 * 2); // room for 2 tiles
    final px = Uint8List.fromList(List.filled(256 * 256 * 4, 255));

    for (var i = 0; i < 4; i++) {
      final img = await decodePremultipliedRgbaImage(rgba: px, width: 256, height: 256);
      cache.put(
        GpTileKey(
          docId: 'd',
          pageIndex: i,
          tileX: 0,
          tileY: 0,
          scaleBucket: '1.00',
          rotation: 0,
          themeKey: 'dark',
          isPreview: i == 0,
        ),
        img,
        width: 256,
        height: 256,
      );
    }

    expect(cache.totalBytes, lessThanOrEqualTo(cache.budgetBytes));
    cache.activePageIndex = 0;
    cache.trim(critical: true);
    expect(cache.entryCount, 1); // Active preview kept cleanly
    cache.clear();
    expect(cache.totalBytes, 0);
  });

  test('M0.3: GestureController cancels drawing on 2nd finger down & keeps focal drift < 2px', () {
    final ctrl = GpGestureController();
    var cancelledStroke = false;
    var lastZoom = 1.0;
    var lastScroll = Offset.zero;

    ctrl.handlePointerDown(
      event: const PointerDownEvent(pointer: 1, position: Offset(100, 200)),
      currentZoom: 1.0,
      currentScroll: Offset.zero,
      drawingToolActive: true,
      onCancelActiveToolStroke: () => cancelledStroke = true,
      onBeginToolStroke: (_, __, ___) {},
      onStopInertia: () {},
    );
    expect(ctrl.activeKind, GpActiveGestureKind.drawStroke);

    // 2nd finger down must cancel single-finger draw and switch to pinch
    ctrl.handlePointerDown(
      event: const PointerDownEvent(pointer: 2, position: Offset(200, 200)),
      currentZoom: 1.0,
      currentScroll: Offset.zero,
      drawingToolActive: true,
      onCancelActiveToolStroke: () => cancelledStroke = true,
      onBeginToolStroke: (_, __, ___) {},
      onStopInertia: () {},
    );
    expect(cancelledStroke, isTrue);
    expect(ctrl.activeKind, GpActiveGestureKind.pinch);

    // Pinch 2x outward symmetrically around midpoint (150, 200)
    ctrl.handlePointerMove(
      event: const PointerMoveEvent(pointer: 1, position: Offset(50, 200)),
      currentZoom: lastZoom,
      currentScroll: lastScroll,
      onViewportTransform: (z, s) {
        lastZoom = z;
        lastScroll = s;
      },
      onUpdateToolStroke: (_, __) {},
    );
    ctrl.handlePointerMove(
      event: const PointerMoveEvent(pointer: 2, position: Offset(250, 200)),
      currentZoom: lastZoom,
      currentScroll: lastScroll,
      onViewportTransform: (z, s) {
        lastZoom = z;
        lastScroll = s;
      },
      onUpdateToolStroke: (_, __) {},
    );
    expect(lastZoom, greaterThan(1.4));
    expect(ctrl.lastPinchFocalOffsetDistance, lessThan(2.0));
  });

  testWidgets('M1.1–M2.1: Incoming Open With opens directly in Viewer mode -> single-tap Edit -> K7 Save sheet', (tester) async {
    tester.view.physicalSize = const Size(390 * 2, 844 * 2);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(fileChannel, (call) async {
      if (call.method == 'getInitialOpenRequest') {
        return {
          'sourceId': 'content://com.android.providers.downloads/document/42',
          'uris': ['content://com.android.providers.downloads/document/42'],
          'displayName': 'rapor.pdf',
          'sizeBytes': 2048,
          'writable': false,
          'canPersist': false,
          'origin': 'view',
        };
      }
      if (call.method == 'copyToWorkFile') {
        return {
          'workPath': '/tmp/work_rapor.pdf',
          'displayName': 'rapor.pdf',
          'byteSize': 2048,
        };
      }
      if (call.method == 'createDocument') {
        return {'uri': 'content://docs/rapor-edited.pdf', 'displayName': 'rapor-edited.pdf'};
      }
      return null;
    });

    final fakeBridge = _FakeSessionBridge();
    await tester.pumpWidget(
      ProviderScope(
        child: GullacpdfApp(customBridge: fakeBridge),
      ),
    );
    await tester.pumpAndSettle();

    // Opened directly into Viewer mode (NOT Library screen!), filename visible, zero overflow!
    expect(find.text('rapor.pdf'), findsOneWidget);
    expect(find.byKey(const Key('viewer-edit-fab')), findsOneWidget);

    // Search works cleanly
    await tester.tap(find.byKey(const Key('viewer-search-btn')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(const Key('viewer-search-input')), 'istanbul');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    await tester.pumpAndSettle();
    expect(find.text('1/1'), findsOneWidget);

    // Single-tap "Edit" switches to Editor mode preserving touch targets >= 44x44
    await tester.tap(find.byKey(const Key('viewer-edit-fab')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('editor-done-btn')), findsOneWidget);
    expect(find.byKey(const Key('tool-text')), findsOneWidget);

    final toolBox = tester.getSize(find.byKey(const Key('tool-text')));
    expect(toolBox.width, greaterThanOrEqualTo(44.0));
    expect(toolBox.height, greaterThanOrEqualTo(44.0));

    // Tap Text tool -> tap viewport -> adds EditableText element
    await tester.tap(find.byKey(const Key('tool-text')));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(180, 320));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('editable-text-field')), findsOneWidget);

    // K7 Save sheet defaults to "Save as copy" and displays read-only fallback note
    await tester.tap(find.byKey(const Key('editor-save-btn')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('k7-save-copy-btn')), findsOneWidget);
    expect(find.byKey(const Key('k7-overwrite-btn')), findsNothing);
  });

  testWidgets('M1.2: Tablet 768x1024 renders top Edit CTA and collapsible split sidebar without overflow', (tester) async {
    tester.view.physicalSize = const Size(768 * 2, 1024 * 2);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(fileChannel, (call) async {
      if (call.method == 'getInitialOpenRequest') {
        return {
          'sourceId': 'content://docs/tablet.pdf',
          'uris': ['content://docs/tablet.pdf'],
          'displayName': 'tablet-contract.pdf',
          'writable': true,
          'canPersist': true,
          'origin': 'view',
        };
      }
      if (call.method == 'copyToWorkFile') {
        return {
          'workPath': '/tmp/tablet.pdf',
          'displayName': 'tablet-contract.pdf',
          'byteSize': 4096,
        };
      }
      return null;
    });

    await tester.pumpWidget(
      ProviderScope(
        child: GullacpdfApp(customBridge: _FakeSessionBridge()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('viewer-edit-pdf-btn')), findsOneWidget);
    await tester.tap(find.byKey(const Key('viewer-pages-btn')));
    await tester.pumpAndSettle();
    expect(find.text('Pages 1'), findsOneWidget);
    expect(find.text('Pages 2'), findsOneWidget);
  });
}
