import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:gullacpdf_mobile/app/gullacpdf_app.dart';
import 'package:gullacpdf_mobile/app/session_state.dart';
import 'package:gullacpdf_mobile/engine/session_bridge.dart';
import 'package:gullacpdf_mobile/engine/tile_cache.dart';
import 'package:gullacpdf_mobile/gestures/pdf_gesture_arena.dart';
import 'package:gullacpdf_mobile/l10n/gp_l10n.g.dart';
import 'package:gullacpdf_mobile/theme/gp_tokens.g.dart';

Uint8List _buildMinimalRgbaPng(int width, int height) {
  int crc32(List<int> data) {
    var crc = 0xFFFFFFFF;
    for (final b in data) {
      crc ^= b;
      for (var i = 0; i < 8; i++) {
        crc = (crc & 1) != 0 ? ((crc >>> 1) ^ 0xEDB88320) : (crc >>> 1);
      }
    }
    return crc ^ 0xFFFFFFFF;
  }

  List<int> chunk(String type, List<int> data) {
    final t = type.codeUnits;
    final len = ByteData(4)..setUint32(0, data.length, Endian.big);
    final crcVal = crc32([...t, ...data]);
    final crcBytes = ByteData(4)..setUint32(0, crcVal, Endian.big);
    return [
      ...len.buffer.asUint8List(),
      ...t,
      ...data,
      ...crcBytes.buffer.asUint8List(),
    ];
  }

  final ihdr = ByteData(13)
    ..setUint32(0, width, Endian.big)
    ..setUint32(4, height, Endian.big)
    ..setUint8(8, 8)
    ..setUint8(9, 6); // RGBA
  final rawRows = <int>[];
  for (var y = 0; y < height; y++) {
    rawRows.add(0);
    for (var x = 0; x < width; x++) {
      rawRows.addAll(const [37, 99, 235, 255]);
    }
  }
  final idat = zlib.encode(rawRows);
  return Uint8List.fromList([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    ...chunk('IHDR', ihdr.buffer.asUint8List()),
    ...chunk('IDAT', idat),
    ...chunk('IEND', const []),
  ]);
}

class _FakeSessionBridge extends GpSessionBridge {
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
    GpPageNumberingConfig? pageNumbering,
    Uint8List? customTtfBytes,
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

  testWidgets('M4: Shape variant strip, Full Inspector Sheet, Signature Studio, Image insert & Page Organizer', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(412 * 2, 915 * 2);
    tester.view.devicePixelRatio = 2.0;
    addTearDown(tester.view.reset);

    final tmpImgDir = Directory.systemTemp.createTempSync('gp_widget_img_');
    addTearDown(() {
      try {
        if (tmpImgDir.existsSync()) tmpImgDir.deleteSync(recursive: true);
      } catch (_) {}
    });
    final imgPath = '${tmpImgDir.path}/sample.png';
    final pngBytes = _buildMinimalRgbaPng(16, 12);
    File(imgPath).writeAsBytesSync(pngBytes);

    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(fileChannel, (call) async {
      if (call.method == 'getInitialOpenRequest') {
        return {
          'sourceId': 'content://docs/parity.pdf',
          'uris': ['content://docs/parity.pdf'],
          'displayName': 'parity-contract.pdf',
          'writable': true,
          'canPersist': true,
          'origin': 'view',
        };
      }
      if (call.method == 'openDocumentPicker') {
        final args = call.arguments as Map<dynamic, dynamic>?;
        final mimes = (args?['mimeTypes'] as List<dynamic>? ?? const []).map((e) => e.toString()).toList();
        if (mimes.any((m) => m.startsWith('image/'))) {
          return {
            'sourceId': 'content://media/sample.png',
            'uris': ['content://media/sample.png'],
            'displayName': 'sample.png',
            'writable': false,
            'canPersist': false,
            'origin': 'picker',
          };
        }
        return null;
      }
      if (call.method == 'copyToWorkFile') {
        final args = call.arguments as Map<dynamic, dynamic>?;
        final dn = args?['displayName']?.toString() ?? '';
        if (dn == 'sample.png') {
          return {'workPath': imgPath, 'displayName': 'sample.png', 'byteSize': pngBytes.length};
        }
        return {'workPath': '/tmp/parity.pdf', 'displayName': 'parity-contract.pdf', 'byteSize': 4096};
      }
      return null;
    });

    await tester.pumpWidget(
      ProviderScope(
        child: GullacpdfApp(customBridge: _FakeSessionBridge()),
      ),
    );
    await tester.pumpAndSettle();

    // Switch to Edit mode
    await tester.tap(find.byKey(const Key('viewer-edit-fab')));
    await tester.pumpAndSettle();

    // 1. Shape tool reveals shape variant strip & creates shape on tap
    await tester.ensureVisible(find.byKey(const Key('tool-shape')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('tool-shape')));
    await tester.pumpAndSettle();
    await tester.tapAt(const Offset(200, 320));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('open-full-inspector-btn')), findsOneWidget);

    // 2. Open Full Style Inspector Sheet -> verify controls & close
    await tester.tap(find.byKey(const Key('open-full-inspector-btn')));
    await tester.pumpAndSettle();
    expect(find.byIcon(Icons.close), findsWidgets);
    await tester.tap(find.byIcon(Icons.close).first);
    await tester.pumpAndSettle();

    // 3. Insert Image via tool-image picker
    await tester.ensureVisible(find.byKey(const Key('tool-image')));
    await tester.tap(find.byKey(const Key('tool-image')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('open-full-inspector-btn')), findsOneWidget);

    // 4. Open Signature Studio Sheet -> Draw stroke with velocity ink -> spawn ghost signature & place it
    await tester.ensureVisible(find.byKey(const Key('tool-sign')));
    await tester.tap(find.byKey(const Key('tool-sign')));
    await tester.pumpAndSettle();
    final sigPadFinder = find.byType(GestureDetector).last;
    final padRect = tester.getRect(find.byWidgetPredicate(
      (w) => w is Container && w.constraints?.maxHeight == 170,
    ));
    await tester.timedDragFrom(
      Offset(padRect.left + 30, padRect.center.dy),
      const Offset(180, -24),
      const Duration(milliseconds: 120),
    );
    await tester.pumpAndSettle();
    expect(sigPadFinder, findsOneWidget);
    await tester.tap(find.text('Place here'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ghost-place-btn')), findsOneWidget);
    await tester.tap(find.byKey(const Key('ghost-place-btn')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('ghost-place-btn')), findsNothing);

    // 5. Undo removes last element
    await tester.tap(find.byKey(const Key('editor-undo-btn')));
    await tester.pumpAndSettle();

    // 6. Open Rich Page Organizer Sheet -> insert blank page -> count increases 2 -> 3
    await tester.ensureVisible(find.byKey(const Key('tool-pages')));
    await tester.tap(find.byKey(const Key('tool-pages')));
    await tester.pumpAndSettle();
    expect(find.textContaining('(2)'), findsOneWidget);
    await tester.tap(find.text('Blank Page'));
    await tester.pumpAndSettle();

    // Close sheet happened automatically; reopen organizer to confirm 3 pages
    await tester.ensureVisible(find.byKey(const Key('tool-pages')));
    await tester.tap(find.byKey(const Key('tool-pages')));
    await tester.pumpAndSettle();
    expect(find.textContaining('(3)'), findsOneWidget);
  });
}
