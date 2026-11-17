import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gullacpdf_mobile/app/session_state.dart';
import 'package:gullacpdf_mobile/engine/session_bridge.dart';
import 'package:gullacpdf_mobile/engine/tile_cache.dart';

void main() {
  test('LIVE Rust FRB v2 + PDFium Native Engine: compile, open, render 256x256 ui.Image, Turkish search & verified D3 redaction', () async {
    final dllCandidates = [
      File('../core/target/debug/gp_frb.dll'),
      File('../core/target/release/gp_frb.dll'),
    ];
    final hasNativeLib = Platform.isWindows && dllCandidates.any((f) => f.existsSync());
    if (!hasNativeLib) {
      fail('Expected compiled gp_frb.dll under core/target/debug for FRB integration test.');
    }

    final bridge = FrbSessionBridge();
    await bridge.initialize();

    final tmpDir = Directory.systemTemp.createTempSync('gp_mobile_frb_test_');
    try {
      final srcPath = '${tmpDir.path}/native_source.pdf';
      final redactedPath = '${tmpDir.path}/native_redacted.pdf';

      const p0 = GpPageMeta(
        id: 'p0',
        sourceDocId: 'blank',
        sourcePageIndex: 0,
        baseWidth: 595,
        baseHeight: 842,
        intrinsicRotation: 0,
      );

      // 1. Compile native PDF with Turkish public header + secret text via PDFium + atomic verification
      final compiledCount = await bridge.compileAndSaveVerified(
        pages: const [p0],
        elements: const [
          GpOverlayElement(
            id: 't_pub',
            pageId: 'p0',
            kind: 'textAdd',
            x: 60,
            y: 80,
            width: 300,
            height: 24,
            text: 'PUBLIC ISTANBUL HEADER',
            fontSize: 16,
            colorValue: 0xFF000000,
          ),
          GpOverlayElement(
            id: 't_sec',
            pageId: 'p0',
            kind: 'textAdd',
            x: 60,
            y: 140,
            width: 300,
            height: 24,
            text: 'SECRET_MOBILE_PASS_88',
            fontSize: 14,
            colorValue: 0xFF000000,
          ),
        ],
        redactionsPage0: const [],
        outputPath: srcPath,
      );
      expect(compiledCount, 1);
      expect(File(srcPath).existsSync(), isTrue);

      // 2. Open working copy via D2 single-thread PDFium actor
      final opened = await bridge.openDocumentFile(docId: 'nat1', path: srcPath);
      expect(opened.status, 'ok');
      expect(opened.pageCount, 1);

      // 3. Render real 256x256 premultiplied RGBA tile and decode to GPU ui.Image
      final tile = await bridge.renderTile(
        docId: 'nat1',
        pageIndex: 0,
        tileX: 0,
        tileY: 0,
        tileWidthPx: 256,
        tileHeightPx: 256,
        scale: 1.0,
        userRotation: 0,
        theme: 'light',
        darkPaperInvert: false,
        priorityTier: 0,
        scope: 'live-test',
      );
      expect(tile.width, 256);
      expect(tile.height, 256);
      expect(tile.rgba.length, 256 * 256 * 4);

      final uiImg = await decodePremultipliedRgbaImage(
        rgba: tile.rgba,
        width: tile.width,
        height: tile.height,
      );
      expect(uiImg.width, 256);
      expect(uiImg.height, 256);
      uiImg.dispose();

      // 4. Streaming search via FRB StreamSink (case-insensitive)
      final batches = await bridge
          .searchDocument(
            docId: 'nat1',
            query: 'istanbul',
            matchCase: false,
            wholeWord: false,
          )
          .toList();
      expect(batches.last.done, isTrue);
      final totalHits = batches.fold<int>(0, (s, b) => s + b.hits.length);
      expect(totalHits, greaterThanOrEqualTo(1));

      // 5. Verified D3 redaction across compiled PDF + post-redaction text extraction assertion
      await bridge.compileAndSaveVerified(
        pages: const [
          GpPageMeta(
            id: 'p0',
            sourceDocId: 'nat1',
            sourcePageIndex: 0,
            baseWidth: 595,
            baseHeight: 842,
            intrinsicRotation: 0,
          ),
        ],
        elements: const [],
        redactionsPage0: const [Rect.fromLTWH(50, 128, 280, 40)],
        outputPath: redactedPath,
      );

      final openedAfter = await bridge.openDocumentFile(docId: 'nat2', path: redactedPath);
      expect(openedAfter.status, 'ok');
      final textAfter = await bridge.extractPageText('nat2', 0);
      expect(textAfter, contains('PUBLIC ISTANBUL HEADER'));
      expect(textAfter, isNot(contains('SECRET_MOBILE_PASS_88')));

      await bridge.closeDocument('nat1');
      await bridge.closeDocument('nat2');
    } finally {
      tmpDir.deleteSync(recursive: true);
    }
  });
}
