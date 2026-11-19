import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:gullacpdf_mobile/app/session_state.dart';
import 'package:gullacpdf_mobile/engine/session_bridge.dart';
import 'package:gullacpdf_mobile/engine/tile_cache.dart';

Future<Uint8List> _makeTestPngBytes() async {
  final rec = ui.PictureRecorder();
  final c = Canvas(rec);
  c.drawRect(const Rect.fromLTWH(0, 0, 8, 8), Paint()..color = const Color(0xFFDC2626));
  final pic = rec.endRecording();
  final img = await pic.toImage(8, 8);
  pic.dispose();
  final bd = await img.toByteData(format: ui.ImageByteFormat.png);
  img.dispose();
  return bd!.buffer.asUint8List();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
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

      // 6. Phase 3/4 Full Web-Parity Compilation: Turkish UTF-8 + Shapes + Paths + SVG Signature + Embedded PNG + TextEdit + PageNumbering
      final pngBytes = await _makeTestPngBytes();
      final p3BasePath = '${tmpDir.path}/phase3_base.pdf';
      final p3EditedPath = '${tmpDir.path}/phase3_edited.pdf';

      await bridge.compileAndSaveVerified(
        pages: const [p0],
        elements: const [
          GpOverlayElement(
            id: 'orig_old',
            pageId: 'p0',
            kind: 'textAdd',
            x: 60,
            y: 90,
            width: 240,
            height: 24,
            text: 'ESKİ_BLOK_SILINECEK',
            fontSize: 14,
            colorValue: 0xFF0F172A,
          ),
          GpOverlayElement(
            id: 'orig_keep',
            pageId: 'p0',
            kind: 'textAdd',
            x: 60,
            y: 160,
            width: 260,
            height: 24,
            text: 'Çağrı Şişman İğde Öç',
            fontSize: 14,
            colorValue: 0xFF0F172A,
          ),
        ],
        redactionsPage0: const [],
        outputPath: p3BasePath,
      );

      final openedP3 = await bridge.openDocumentFile(docId: 'p3base', path: p3BasePath);
      expect(openedP3.status, 'ok');
      final analysisJson = await bridge.analyzePageObjectsJson(
        docId: 'p3base',
        pageIndex: 0,
        pageId: 'p0',
      );
      final parsedAnalysis = GpPageAnalysis.fromJsonString(analysisJson);
      expect(parsedAnalysis.textBlocks, isNotEmpty);

      final oldBlock = parsedAnalysis.textBlocks.firstWhere(
        (b) => b.text.contains('ESK'),
        orElse: () => parsedAnalysis.textBlocks.first,
      );

      final textEditEl = GpOverlayElement(
        id: 'te_p3',
        pageId: 'p0',
        kind: 'textEdit',
        x: oldBlock.x,
        y: oldBlock.y,
        width: 260,
        height: 24,
        text: 'YENİ_TÜRKÇE_METİN_ÜĞŞİÖÇ',
        originalText: oldBlock.text,
        sourceBlockId: oldBlock.id,
        fontSize: 14,
        colorValue: 0xFF1D4ED8,
      );

      final cleanBytes = await bridge.prepareCleanPagePreview(
        docId: 'p3base',
        pageIndex: 0,
        elements: [textEditEl],
      );
      expect(cleanBytes, isNotEmpty);

      await bridge.compileAndSaveVerified(
        pages: const [
          GpPageMeta(
            id: 'p0',
            sourceDocId: 'p3base',
            sourcePageIndex: 0,
            baseWidth: 595,
            baseHeight: 842,
            intrinsicRotation: 0,
          ),
        ],
        elements: [
          textEditEl,
          const GpOverlayElement(
            id: 'shp_arrow',
            pageId: 'p0',
            kind: 'shape',
            shapeType: 'arrow',
            x: 60,
            y: 230,
            width: 140,
            height: 40,
            colorValue: 0xFFDC2626,
            fillColorValue: 0x33DC2626,
            strokeWidth: 3.0,
            strokeDash: 'dashed',
          ),
          const GpOverlayElement(
            id: 'path_line',
            pageId: 'p0',
            kind: 'path',
            x: 60,
            y: 290,
            width: 180,
            height: 30,
            colorValue: 0xFF15803D,
            strokeWidth: 2.5,
            points: [Offset(60, 290), Offset(140, 315), Offset(240, 295)],
          ),
          const GpOverlayElement(
            id: 'sig_vec',
            pageId: 'p0',
            kind: 'signature',
            x: 60,
            y: 340,
            width: 140,
            height: 60,
            colorValue: 0xFF0F172A,
            svgPaths: [
              GpSignatureSvgPath(
                d: 'M 10 30 Q 60 5 110 30 T 210 25',
                fill: 'none',
                stroke: '#0f172a',
                strokeWidth: 2.4,
              ),
            ],
            viewBoxWidth: 220,
            viewBoxHeight: 60,
          ),
          GpOverlayElement(
            id: 'img_logo',
            pageId: 'p0',
            kind: 'image',
            x: 320,
            y: 220,
            width: 96,
            height: 96,
            imageName: 'logo.png',
            mimeType: 'image/png',
            imageBytes: pngBytes,
          ),
        ],
        redactionsPage0: const [],
        outputPath: p3EditedPath,
        pageNumbering: const GpPageNumberingConfig(
          enabled: true,
          position: 'bottom-center',
          format: 'number-of-total',
        ),
      );

      final openedEdited = await bridge.openDocumentFile(docId: 'p3out', path: p3EditedPath);
      expect(openedEdited.status, 'ok');
      final finalText = await bridge.extractPageText('p3out', 0);
      expect(finalText, contains('Çağrı'));
      expect(finalText, contains('YENİ_TÜRKÇE_METİN'));
      expect(finalText, isNot(contains('ESKİ_BLOK_SILINECEK')));
      expect(finalText, contains('1 / 1'));

      final outAnalysisJson = await bridge.analyzePageObjectsJson(
        docId: 'p3out',
        pageIndex: 0,
        pageId: 'p0',
      );
      final outAnalysis = GpPageAnalysis.fromJsonString(outAnalysisJson);
      expect(outAnalysis.images, isNotEmpty);

      await bridge.closeDocument('p3base');
      await bridge.closeDocument('p3out');
    } finally {
      tmpDir.deleteSync(recursive: true);
    }
  });
}
