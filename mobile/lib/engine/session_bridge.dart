import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui';

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
  Stream<GpSearchBatch> searchDocument({
    required String docId,
    required String query,
    required bool matchCase,
    required bool wholeWord,
  });
  Future<int> compileAndSaveVerified({
    required List<GpPageMeta> pages,
    required List<GpOverlayElement> elements,
    required List<Rect> redactionsPage0,
    required String outputPath,
  });
}

/// Live `flutter_rust_bridge` v2 session implementation backed by Rust single-thread PDFium actor (00 -> D2).
class FrbSessionBridge implements GpSessionBridge {
  bool _initialized = false;

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
                    .map((r) => Rect.fromLTWH(r.x, r.y, r.width, r.height))
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
    required List<Rect> redactionsPage0,
    required String outputPath,
  }) async {
    await initialize();
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
        redactions: redactRects,
        outputPath: outputPath,
        customTtfBytes: null,
      ),
    );
    return out.verifiedPageCount;
  }
}
