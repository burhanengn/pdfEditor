import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  computeRotatedResizeRect,
  computeViewportSurfaceMetrics,
  getRotatedBoundingBox,
  pointInRotatedRect,
} from '../coordinates';
import { normalizeFontMatchKey, normalizeUnicodeForPdf, parsePdfFontMetadata } from '../fonts';
import { flipSvgPath, scaleSvgPath } from '../imageMask';
import { computePageNumberLayout, DEFAULT_PAGE_NUMBERING_CONFIG, formatPageNumberLabel } from '../pageNumbers';
import { buildPageOffsetIndex } from '../pageOffsets';
import { parsePageRangeExpression } from '../pageRange';
import { buildWrappedRichLines, ensureRunsFromElement, normalizeTextRuns } from '../richText';
import { createRustSession, initRustCoreSync, type GpWasmModule } from '../rustCoreBridge';
import { buildDetectedTextBlocksFromMuLines } from '../textExtractor';
import { computeSnapPosition } from '@/utils/snapGuides';
import { normalizeAbsolutePoints, pathPointsToSvgPath, shapeToSvgPath } from '../vectorShapes';

describe('Rust Core (gp-wasm) F2 parity & session verification', () => {
  let wasm: GpWasmModule;

  beforeAll(() => {
    const wasmPath = path.resolve(__dirname, '../wasm-core/gp_wasm_bg.wasm');
    const bytes = fs.readFileSync(wasmPath);
    wasm = initRustCoreSync(bytes);
  });

  it('matches geometry helpers (rotated resize, bbox, hit test, snapping, page offsets)', () => {
    const startRect = { x: 100, y: 120, width: 160, height: 80 };
    const resizeParams = {
      startRect,
      handle: 'se' as const,
      dxPx: 42,
      dyPx: -12,
      frameRotationDeg: 15,
      userRotation: 90 as const,
      zoom: 1.5,
      aspectLocked: true,
      shiftKey: false,
      minSize: 12,
    };

    const tsResize = computeRotatedResizeRect(resizeParams);
    const rsResize = wasm.compute_rotated_resize_rect(resizeParams);
    expect(rsResize.x).toBeCloseTo(tsResize.x, 4);
    expect(rsResize.y).toBeCloseTo(tsResize.y, 4);
    expect(rsResize.width).toBeCloseTo(tsResize.width, 4);
    expect(rsResize.height).toBeCloseTo(tsResize.height, 4);

    const tsBbox = getRotatedBoundingBox(startRect, 25);
    const rsBbox = wasm.get_rotated_bounding_box(startRect, 25);
    expect(rsBbox.x).toBeCloseTo(tsBbox.x, 4);
    expect(rsBbox.y).toBeCloseTo(tsBbox.y, 4);
    expect(rsBbox.width).toBeCloseTo(tsBbox.width, 4);
    expect(rsBbox.height).toBeCloseTo(tsBbox.height, 4);

    expect(wasm.point_in_rotated_rect(180, 160, startRect, 30, 0)).toBe(
      pointInRotatedRect(180, 160, startRect, 30, 0),
    );
    expect(wasm.point_in_rotated_rect(5, 5, startRect, 30, 0)).toBe(
      pointInRotatedRect(5, 5, startRect, 30, 0),
    );

    const moving = { x: 37.5, y: 101, width: 50, height: 20 };
    const siblings = [{ x: 200, y: 102, width: 80, height: 20 }];
    const tsSnap = computeSnapPosition(moving, 595, 842, siblings, true);
    const rsSnap = wasm.compute_snap_position(moving, 595, 842, siblings, true);
    expect(rsSnap.x).toBeCloseTo(tsSnap.x, 4);
    expect(rsSnap.y).toBeCloseTo(tsSnap.y, 4);
    expect(rsSnap.guides.length).toBe(tsSnap.guides.length);

    const pages = [
      {
        id: 'p1',
        sourceDocId: 'd1',
        sourcePageIndex: 0,
        baseWidth: 595,
        baseHeight: 842,
        intrinsicRotation: 0 as const,
        userRotation: 0 as const,
        mediaBox: [0, 0, 595, 842] as [number, number, number, number],
        cropBox: [0, 0, 595, 842] as [number, number, number, number],
      },
      {
        id: 'p2',
        sourceDocId: 'd1',
        sourcePageIndex: 1,
        baseWidth: 595,
        baseHeight: 842,
        intrinsicRotation: 0 as const,
        userRotation: 90 as const,
        mediaBox: [0, 0, 595, 842] as [number, number, number, number],
        cropBox: [0, 0, 595, 842] as [number, number, number, number],
      },
    ];
    const metrics = computeViewportSurfaceMetrics(pages, 1024, 768, 1.25, false);
    const tsOffsets = buildPageOffsetIndex(pages, 1.25, metrics);
    const rsOffsets = wasm.build_page_offset_index(pages, 1.25, metrics);
    expect(rsOffsets.count).toBe(tsOffsets.count);
    expect(rsOffsets.rowTops[0]).toBeCloseTo(tsOffsets.rowTops[0], 2);
    expect(rsOffsets.rowTops[1]).toBeCloseTo(tsOffsets.rowTops[1], 2);
  });

  it('matches vector shape SVG paths and image mask transforms', () => {
    for (const kind of ['rect', 'ellipse', 'triangle', 'diamond', 'arrow'] as const) {
      expect(wasm.shape_to_svg_path(kind, 120, 60, 8)).toBe(shapeToSvgPath(kind, 120, 60, 8));
    }

    const normPts = [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ];
    expect(wasm.path_points_to_svg_path(normPts, 200, 100, false, true)).toBe(
      pathPointsToSvgPath(normPts, 200, 100, false, true),
    );
    expect(wasm.path_points_to_svg_path(normPts, 200, 100, true, false)).toBe(
      pathPointsToSvgPath(normPts, 200, 100, true, false),
    );
    const mixedNormPts = [
      { x: 0, y: 0 },
      { x: 1, y: 0, smooth: true },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    expect(wasm.path_points_to_svg_path(mixedNormPts, 100, 100, true, false)).toBe(
      pathPointsToSvgPath(mixedNormPts, 100, 100, true, false),
    );

    const abs = [
      { x: 40, y: 50 },
      { x: 140, y: 150 },
    ];
    const tsNormAbs = normalizeAbsolutePoints(abs);
    const rsNormAbs = wasm.normalize_absolute_points(abs);
    expect(rsNormAbs.rect).toEqual(tsNormAbs.rect);
    expect(rsNormAbs.points[0].x).toBeCloseTo(tsNormAbs.points[0].x, 4);
    expect(rsNormAbs.points[1].y).toBeCloseTo(tsNormAbs.points[1].y, 4);

    const d = 'M 0 0 L 100 0 L 100 50 Z';
    expect(wasm.flip_svg_path(d, 100, 50, true, true, 2)).toBe(
      flipSvgPath(d, 100, 50, true, true, 2),
    );
    expect(wasm.scale_svg_path(d, 1.5, 2, 2)).toBe(scaleSvgPath(d, 1.5, 2, 2));
  });

  it('matches text, Turkish search normalization, font metadata, page ranges, page numbers, and layout', () => {
    expect(wasm.normalize_unicode_for_pdf('I\u0307stanbul')).toBe(
      normalizeUnicodeForPdf('I\u0307stanbul'),
    );
    expect(wasm.normalize_for_turkish_search('İstanbul Çağrı Şeker', true)).toBe(
      'istanbul cagri seker',
    );
    expect(wasm.normalize_for_turkish_search('I\u0307STANBUL', false)).toBe('istanbul');

    const rawFont = 'ABCDEF+TimesNewRomanPS-BoldItalicMT';
    expect(wasm.normalize_font_match_key(rawFont)).toEqual(normalizeFontMatchKey(rawFont));
    expect(wasm.parse_pdf_font_metadata(rawFont, false, false, false, false)).toEqual(
      parsePdfFontMetadata(rawFont, {
        isSerif: false,
        isMono: false,
        isBold: false,
        isItalic: false,
      }),
    );

    const rangeTs = parsePageRangeExpression('1-3, 5, 9-7', 12);
    const rangeRs = wasm.parse_page_range_expression('1-3, 5, 9-7', 12);
    expect(rangeRs).toEqual(rangeTs);

    const numCfg = {
      ...DEFAULT_PAGE_NUMBERING_CONFIG,
      enabled: true,
      format: 'page-number-of-total' as const,
    };
    expect(wasm.format_page_number_label(2, 10, numCfg)).toBe(
      formatPageNumberLabel(2, 10, numCfg),
    );
    const tsBox = computePageNumberLayout(595, 842, 2, 10, numCfg);
    const rsBox = wasm.compute_page_number_layout(595, 842, 2, 10, numCfg);
    expect(rsBox).toEqual(tsBox);

    const runs = [
      { text: 'Alan 25 m', bold: false, italic: false },
      { text: '2', script: 'super' as const },
      { text: ' oldu', bold: false },
    ];
    expect(wasm.normalize_text_runs(runs, false, false)).toEqual(
      normalizeTextRuns(runs, false, false),
    );
    expect(wasm.ensure_runs_from_element('Alan 25 m2 oldu', runs, false, false)).toEqual(
      ensureRunsFromElement('Alan 25 m2 oldu', runs, false, false),
    );

    const tsWrapped = buildWrappedRichLines(
      runs,
      70,
      (t, _b, _i, script) => t.length * 8 * (script === 'normal' ? 1 : 0.72),
      false,
      false,
    );
    const rsWrapped = wasm.build_wrapped_rich_lines(runs, 70, {}, 8, false, false, null);
    expect(rsWrapped).toEqual(tsWrapped);

    const rawLines = [
      {
        text: 'İlk satır burada',
        x0: 72,
        y0: 90,
        x1: 480,
        y1: 102,
        baselineY: 100,
        fontSize: 12,
        firstWordWidth: 42,
        color: '#000000',
        fontFamily: 'Helvetica' as const,
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 0,
        blockIdx: 0,
      },
      {
        text: 'devam ediyor.',
        x0: 72,
        y0: 106,
        x1: 240,
        y1: 118,
        baselineY: 116,
        fontSize: 12,
        firstWordWidth: 42,
        color: '#000000',
        fontFamily: 'Helvetica' as const,
        rawFontName: 'Helvetica',
        bold: false,
        italic: false,
        serif: false,
        mono: false,
        mupdfBlockIdx: 0,
        blockIdx: 0,
      },
    ];
    const tsBlocks = buildDetectedTextBlocksFromMuLines(rawLines, 'p1');
    const rsBlocks = wasm.build_detected_text_blocks(rawLines, 'p1', null);
    expect(rsBlocks.length).toBe(tsBlocks.length);
    expect(rsBlocks[0].text).toBe(tsBlocks[0].text);
    expect(rsBlocks[0].align).toBe(tsBlocks[0].align);
  });

  it('supports WasmSession command execution, undo/redo history, and memory trim', () => {
    const session = createRustSession(8 * 1024 * 1024);
    try {
      expect(session.can_undo()).toBe(false);
      expect(session.can_redo()).toBe(false);
      expect(Number(session.revision())).toBe(0);

      const addCmd = {
        type: 'addElements',
        elements: [
          {
            kind: 'text-add',
            id: 'el-1',
            pageId: 'p1',
            x: 50,
            y: 60,
            width: 120,
            height: 28,
            text: 'gullacpdf',
            fontFamily: 'Helvetica',
            fontSize: 14,
            color: '#0f172a',
            bold: true,
            italic: false,
            align: 'left',
            lineHeight: 1.25,
          },
        ],
      };

      const snapAfterAdd = JSON.parse(session.apply_command_json(JSON.stringify(addCmd)));
      expect(snapAfterAdd.elements).toHaveLength(1);
      expect(session.can_undo()).toBe(true);
      expect(Number(session.revision())).toBe(1);

      expect(session.undo()).toBe(true);
      expect(JSON.parse(session.export_snapshot_json()).elements).toHaveLength(0);
      expect(session.can_redo()).toBe(true);

      expect(session.redo()).toBe(true);
      expect(JSON.parse(session.export_snapshot_json()).elements).toHaveLength(1);
      session.trim_memory(4 * 1024 * 1024);
    } finally {
      session.free();
    }
  });
});
