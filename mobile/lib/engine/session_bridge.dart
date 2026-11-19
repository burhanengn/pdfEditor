import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_rust_bridge/flutter_rust_bridge_for_generated.dart';

import '../app/session_state.dart';
import '../src/rust/api/session.dart' as rust_api;
import '../src/rust/frb_generated.dart';

class GpOpenDocOutcome {
  const GpOpenDocOutcome({
    required this.status,
    required this.pageCount,
    required this.pages,
    required this.canCopyText,
    required this.outline,
  });

  final String status; // ok | needs-password | invalid-password
  final int pageCount;
  final List<GpPageMeta> pages;
  final bool canCopyText;
  final List<GpOutlineNode> outline;
}

class GpTilePixels {
  const GpTilePixels({
    required this.width,
    required this.height,
    required this.rgba,
  });

  final int width;
  final int height;
  final Uint8List rgba;
}

class GpSearchBatch {
  const GpSearchBatch({
    required this.scannedPages,
    required this.totalPages,
    required this.done,
    required this.hits,
  });

  final int scannedPages;
  final int totalPages;
  final bool done;
  final List<GpSearchMatch> hits;
}

abstract class GpSessionBridge {
  Future<void> initialize();
  Future<GpOpenDocOutcome> openDocumentFile({
    required String docId,
    required String path,
    String? password,
  });
  Future<GpOpenDocOutcome> openDocumentBytes({
    required String docId,
    required Uint8List bytes,
    String? password,
  });
  Future<void> closeDocument(String docId);
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
  });
  Future<void> cancelRenderScope(String scope);
  Future<void> trimEngineMemory(int targetBytes);
  Future<String> extractPageText(String docId, int pageIndex);
  Future<String> analyzePageObjectsJson({
    required String docId,
    required int pageIndex,
    required String pageId,
  }) async =>
      '{}';
  Future<Uint8List> prepareCleanPagePreview({
    required String docId,
    required int pageIndex,
    required List<GpOverlayElement> elements,
  }) async =>
      Uint8List(0);
  Future<List<GpPageLink>> extractPageLinks({
    required String docId,
    required int pageIndex,
  }) async =>
      const [];
  ({double x, double y, double width, double height}) computeRotatedResizeRect({
    required double x,
    required double y,
    required double width,
    required double height,
    required double rotationDeg,
    required String handle,
    required double dxPx,
    required double dyPx,
    required bool aspectLocked,
  }) =>
      (x: x, y: y, width: width, height: height);
  ({double x, double y, bool snapped}) computeSnapGuidePosition({
    required double x,
    required double y,
    required double width,
    required double height,
    required double pageW,
    required double pageH,
    required List<ui.Rect> siblings,
  }) =>
      (x: x, y: y, snapped: false);
  Stream<GpSearchBatch> searchDocument({
    required String docId,
    required String query,
    required bool matchCase,
    required bool wholeWord,
  });
  Future<int> compileAndSaveVerified({
    required List<GpPageMeta> pages,
    required List<GpOverlayElement> elements,
    required List<ui.Rect> redactionsPage0,
    required String outputPath,
    GpPageNumberingConfig? pageNumbering,
    Uint8List? customTtfBytes,
  });
}

/// Live `flutter_rust_bridge` v2 session implementation backed by Rust single-thread PDFium actor (00 -> D2).
class FrbSessionBridge implements GpSessionBridge {
  bool _initialized = false;
  Uint8List? _fontRegular;
  Uint8List? _fontBold;
  Uint8List? _fontItalic;
  Uint8List? _fontSerif;
  Uint8List? _fontMono;
  bool _fontsLoaded = false;

  Future<Uint8List?> _loadFontAsset(String filename) async {
    try {
      final bd = await rootBundle.load('assets/fonts/$filename');
      return bd.buffer.asUint8List();
    } catch (_) {
      for (final p in ['assets/fonts/$filename', 'mobile/assets/fonts/$filename']) {
        final f = File(p);
        if (f.existsSync()) return f.readAsBytesSync();
      }
      return null;
    }
  }

  Future<void> _ensureBundledFonts() async {
    if (_fontsLoaded) return;
    _fontsLoaded = true;
    _fontRegular = await _loadFontAsset('DejaVuSans.ttf');
    _fontBold = await _loadFontAsset('DejaVuSans-Bold.ttf');
    _fontItalic = await _loadFontAsset('DejaVuSans-Oblique.ttf');
    _fontSerif = await _loadFontAsset('DejaVuSerif.ttf');
    _fontMono = await _loadFontAsset('DejaVuSansMono.ttf');
  }

  Future<rust_api.FrbEmbeddedImage?> _rasterizeElementImage(
    GpOverlayElement el,
  ) async {
    final bytes = el.imageBytes;
    if (bytes == null || bytes.isEmpty) return null;
    ui.Codec? codec;
    ui.Image? srcImg;
    ui.Image? croppedImg;
    try {
      codec = await ui.instantiateImageCodec(bytes);
      final frame = await codec.getNextFrame();
      srcImg = frame.image;
      final crop = el.cropRect;
      ui.Image finalImg = srcImg;
      if (crop != null &&
          (crop.left > 0.005 ||
              crop.top > 0.005 ||
              crop.width < 0.995 ||
              crop.height < 0.995)) {
        final sx = crop.left.clamp(0.0, 0.98) * srcImg.width;
        final sy = crop.top.clamp(0.0, 0.98) * srcImg.height;
        final sw = (crop.width.clamp(0.02, 1.0) * srcImg.width)
            .clamp(1.0, srcImg.width - sx);
        final sh = (crop.height.clamp(0.02, 1.0) * srcImg.height)
            .clamp(1.0, srcImg.height - sy);
        final outW = math.max(1, math.min(1600, sw.round()));
        final outH = math.max(1, math.min(1600, sh.round()));
        final recorder = ui.PictureRecorder();
        final canvas = ui.Canvas(recorder);
        canvas.drawImageRect(
          srcImg,
          ui.Rect.fromLTWH(sx, sy, sw, sh),
          ui.Rect.fromLTWH(0, 0, outW.toDouble(), outH.toDouble()),
          ui.Paint()..filterQuality = ui.FilterQuality.medium,
        );
        final pic = recorder.endRecording();
        croppedImg = await pic.toImage(outW, outH);
        pic.dispose();
        finalImg = croppedImg;
      }
      final data = await finalImg.toByteData(format: ui.ImageByteFormat.rawStraightRgba);
      if (data == null) return null;
      return rust_api.FrbEmbeddedImage(
        id: el.id,
        width: finalImg.width,
        height: finalImg.height,
        rgba: data.buffer.asUint8List(),
      );
    } catch (_) {
      return null;
    } finally {
      croppedImg?.dispose();
      srcImg?.dispose();
      codec?.dispose();
    }
  }

  @override
  Future<void> initialize() async {
    if (_initialized) return;
    ExternalLibrary? extLib;
    if (Platform.isAndroid) {
      extLib = ExternalLibrary.open('libgp_frb.so');
    } else if (Platform.isWindows) {
      final candidates = [
        'gp_frb.dll',
        '../core/target/debug/gp_frb.dll',
        '../core/target/release/gp_frb.dll',
        'core/target/debug/gp_frb.dll',
      ];
      for (final c in candidates) {
        if (File(c).existsSync()) {
          extLib = ExternalLibrary.open(File(c).absolute.path);
          break;
        }
      }
    }
    await RustLib.init(externalLibrary: extLib);
    await rust_api.initEngine(
      tileBudgetBytes: BigInt.from(128 * 1024 * 1024),
    );
    _initialized = true;
  }

  GpOutlineNode _mapOutline(rust_api.FrbOutlineItem n) => GpOutlineNode(
        id: n.id,
        title: n.title,
        pageIndex: n.pageIndex,
        children: n.children.map(_mapOutline).toList(),
      );

  GpOpenDocOutcome _mapOpen(String docId, rust_api.FrbOpenDocResult r) {
    return GpOpenDocOutcome(
      status: r.status,
      pageCount: r.pageCount,
      canCopyText: r.canCopyText,
      pages: r.pages
          .map(
            (p) => GpPageMeta(
              id: '${docId}_p${p.sourcePageIndex}',
              sourceDocId: docId,
              sourcePageIndex: p.sourcePageIndex,
              baseWidth: p.baseWidth,
              baseHeight: p.baseHeight,
              intrinsicRotation: p.intrinsicRotation,
            ),
          )
          .toList(),
      outline: r.outline.map(_mapOutline).toList(),
    );
  }

  @override
  Future<GpOpenDocOutcome> openDocumentFile({
    required String docId,
    required String path,
    String? password,
  }) async {
    await initialize();
    final res = await rust_api.openDocumentFile(
      docId: docId,
      path: path,
      password: password,
    );
    return _mapOpen(docId, res);
  }

  @override
  Future<GpOpenDocOutcome> openDocumentBytes({
    required String docId,
    required Uint8List bytes,
    String? password,
  }) async {
    await initialize();
    final res = await rust_api.openDocumentBytes(
      docId: docId,
      bytes: bytes,
      password: password,
    );
    return _mapOpen(docId, res);
  }

  @override
  Future<void> closeDocument(String docId) async {
    if (!_initialized) return;
    await rust_api.closeDocument(docId: docId);
  }

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
    await initialize();
    final bmp = await rust_api.renderTile(
      req: rust_api.FrbTileRequest(
        docId: docId,
        pageIndex: pageIndex,
        tileX: tileX,
        tileY: tileY,
        tileWidthPx: tileWidthPx,
        tileHeightPx: tileHeightPx,
        scale: scale,
        userRotation: userRotation,
        transparentBg: false,
        theme: theme,
        darkPaperInvert: darkPaperInvert,
        priorityTier: priorityTier,
        scope: scope,
      ),
    );
    return GpTilePixels(width: bmp.width, height: bmp.height, rgba: bmp.rgba);
  }

  @override
  Future<void> cancelRenderScope(String scope) async {
    if (!_initialized) return;
    await rust_api.cancelRenderScope(scope: scope);
  }

  @override
  Future<void> trimEngineMemory(int targetBytes) async {
    if (!_initialized) return;
    await rust_api.trimEngineMemory(targetBytes: BigInt.from(targetBytes));
  }

  @override
  Future<String> extractPageText(String docId, int pageIndex) async {
    await initialize();
    final res =
        await rust_api.extractPageText(docId: docId, pageIndex: pageIndex);
    return res.plainText;
  }

  @override
  Future<String> analyzePageObjectsJson({
    required String docId,
    required int pageIndex,
    required String pageId,
  }) async {
    await initialize();
    return rust_api.analyzePageObjectsJson(
      docId: docId,
      pageIndex: pageIndex,
      pageId: pageId,
    );
  }

  @override
  Future<Uint8List> prepareCleanPagePreview({
    required String docId,
    required int pageIndex,
    required List<GpOverlayElement> elements,
  }) async {
    await initialize();
    return rust_api.prepareCleanPagePreview(
      docId: docId,
      pageIndex: pageIndex,
      elementsJson: jsonEncode(elements.map((e) => e.toCoreJson()).toList()),
    );
  }

  @override
  Future<List<GpPageLink>> extractPageLinks({
    required String docId,
    required int pageIndex,
  }) async {
    await initialize();
    final links = await rust_api.extractPageLinks(
      docId: docId,
      pageIndex: pageIndex,
    );
    return links
        .map(
          (l) => GpPageLink(
            id: l.id,
            pageIndex: l.pageIndex,
            x: l.x,
            y: l.y,
            width: l.width,
            height: l.height,
            kind: l.kind,
            uri: l.uri,
            destPageIndex: l.destPageIndex,
          ),
        )
        .toList();
  }

  @override
  ({double x, double y, double width, double height}) computeRotatedResizeRect({
    required double x,
    required double y,
    required double width,
    required double height,
    required double rotationDeg,
    required String handle,
    required double dxPx,
    required double dyPx,
    required bool aspectLocked,
  }) {
    if (!_initialized) {
      return (x: x, y: y, width: width, height: height);
    }
    final r = rust_api.computeRotatedResizeRect(
      x: x,
      y: y,
      width: width,
      height: height,
      rotationDeg: rotationDeg,
      handle: handle,
      dxPx: dxPx,
      dyPx: dyPx,
      aspectLocked: aspectLocked,
    );
    return (x: r.x, y: r.y, width: r.width, height: r.height);
  }

  @override
  ({double x, double y, bool snapped}) computeSnapGuidePosition({
    required double x,
    required double y,
    required double width,
    required double height,
    required double pageW,
    required double pageH,
    required List<ui.Rect> siblings,
  }) {
    if (!_initialized) {
      return (x: x, y: y, snapped: false);
    }
    final sibJson = jsonEncode(
      siblings
          .map((s) => {
                'x': s.left,
                'y': s.top,
                'width': s.width,
                'height': s.height,
              })
          .toList(),
    );
    final res = rust_api.computeSnapGuidePosition(
      x: x,
      y: y,
      width: width,
      height: height,
      pageW: pageW,
      pageH: pageH,
      siblingsJson: sibJson,
    );
    return (x: res.x, y: res.y, snapped: res.snapped);
  }

  @override
  Stream<GpSearchBatch> searchDocument({
    required String docId,
    required String query,
    required bool matchCase,
    required bool wholeWord,
  }) async* {
    await initialize();
    await for (final evt in rust_api.searchDocumentStream(
      docId: docId,
      query: query,
      matchCase: matchCase,
      wholeWord: wholeWord,
    )) {
      yield GpSearchBatch(
        scannedPages: evt.scannedPages,
        totalPages: evt.totalPages,
        done: evt.done,
        hits: evt.hits
            .map(
              (h) => GpSearchMatch(
                pageIndex: h.pageIndex,
                matchIndexInPage: h.matchIndexInPage,
                snippet: h.snippet,
                rects: h.rects
                    .map((r) => ui.Rect.fromLTWH(r.x, r.y, r.width, r.height))
                    .toList(),
              ),
            )
            .toList(),
      );
    }
  }

  @override
  Future<int> compileAndSaveVerified({
    required List<GpPageMeta> pages,
    required List<GpOverlayElement> elements,
    required List<ui.Rect> redactionsPage0,
    required String outputPath,
    GpPageNumberingConfig? pageNumbering,
    Uint8List? customTtfBytes,
  }) async {
    await initialize();
    await _ensureBundledFonts();

    final embeddedImages = <rust_api.FrbEmbeddedImage>[];
    for (final el in elements) {
      if ((el.kind == 'image' ||
              el.kind == 'imageReplacement' ||
              el.kind == 'signature') &&
          el.imageBytes != null &&
          !el.deleted) {
        final decoded = await _rasterizeElementImage(el);
        if (decoded != null) {
          embeddedImages.add(decoded);
        }
      }
    }

    final redactRects = [
      for (final e in elements)
        if (e.isRedact)
          rust_api.FrbRedactionRect(
            pageIndex: pages.indexWhere((p) => p.id == e.pageId).clamp(0, pages.length - 1),
            x: e.x,
            y: e.y,
            width: e.width,
            height: e.height,
          ),
      for (final r in redactionsPage0)
        rust_api.FrbRedactionRect(
          pageIndex: 0,
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        ),
    ];

    final out = await rust_api.compileAndSaveVerified(
      req: rust_api.FrbCompileSaveRequest(
        pagesJson: jsonEncode(pages.map((p) => p.toJson()).toList()),
        elementsJson: jsonEncode(elements.map((e) => e.toCoreJson()).toList()),
        pageNumberingJson:
            pageNumbering != null && pageNumbering.enabled
                ? jsonEncode(pageNumbering.toCoreJson())
                : null,
        redactions: redactRects,
        outputPath: outputPath,
        customTtfBytes: customTtfBytes,
        fontRegularTtf: _fontRegular,
        fontBoldTtf: _fontBold,
        fontItalicTtf: _fontItalic,
        fontSerifTtf: _fontSerif,
        fontMonoTtf: _fontMono,
        embeddedImages: embeddedImages,
      ),
    );
    return out.verifiedPageCount;
  }
}
