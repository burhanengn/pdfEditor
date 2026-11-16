import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../pdfiumEngine';
import { generateReferencePdf } from '@/engine/referencePdfSet';

describe('PdfiumEngine (Wasm) rendering, text spans, Turkish search, and outline', () => {
  const engine = new PdfiumEngine();

  beforeAll(async () => {
    const wasmPath = path.resolve(
      process.cwd(),
      'node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
    );
    const wasmBinary = fs.readFileSync(wasmPath);
    await engine.init({ wasmBinary });
  });

  afterAll(() => {
    engine.destroy();
  });

  it('opens PDF, verifies top-left vs bottom-right tile orientation, extracts text spans, and runs Turkish-folded search', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    // Paint bright RED block at visual TOP-LEFT (PDF space y=520..580, x=20..120)
    page.drawRectangle({ x: 20, y: 520, width: 100, height: 60, color: rgb(0.95, 0.05, 0.05) });
    // Paint bright BLUE block at visual BOTTOM-RIGHT (PDF space y=20..80, x=280..380)
    page.drawRectangle({ x: 280, y: 20, width: 100, height: 60, color: rgb(0.05, 0.1, 0.95) });
    page.drawText('Istanbul Turkish Verification Line', { x: 40, y: 400, size: 14 });
    const bytes = await doc.save();

    const openRes = engine.openDocument('orient_test', bytes);
    expect(openRes.status).toBe('ok');
    expect(openRes.pageCount).toBe(1);
    expect(openRes.pages[0].baseWidth).toBeCloseTo(400, 0);
    expect(openRes.pages[0].baseHeight).toBeCloseTo(600, 0);

    // Render top-left 200x200 tile at 1x scale -> must contain RED block, NOT BLUE
    const topLeftTile = engine.renderTileRgba({
      sourceDocId: 'orient_test',
      pageIndex: 0,
      tileX: 0,
      tileY: 0,
      tileWidthPx: 200,
      tileHeightPx: 200,
      scale: 1,
      userRotation: 0,
    });
    // Pixel inside top-left red box: (50, 40) -> visual y=40 is PDF y=560 (inside 520..580)
    const idxTL = (40 * 200 + 50) * 4;
    expect(topLeftTile.rgba[idxTL]).toBeGreaterThan(200); // R
    expect(topLeftTile.rgba[idxTL + 2]).toBeLessThan(40); // B

    // Render bottom-right 200x200 tile (x=200..400, y=400..600) -> must contain BLUE block
    const botRightTile = engine.renderTileRgba({
      sourceDocId: 'orient_test',
      pageIndex: 0,
      tileX: 200,
      tileY: 400,
      tileWidthPx: 200,
      tileHeightPx: 200,
      scale: 1,
      userRotation: 0,
    });
    // Local pixel (120, 150) corresponds to (320, 550) visual -> PDF y=50 (inside 20..80)
    const idxBR = (150 * 200 + 120) * 4;
    expect(botRightTile.rgba[idxBR + 2]).toBeGreaterThan(200); // B
    expect(botRightTile.rgba[idxBR]).toBeLessThan(40); // R

    // Text spans extraction
    const spans = engine.extractPageTextSpans('orient_test', 0);
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.map((s) => s.text).join(' ')).toContain('Istanbul Turkish Verification Line');

    // Turkish-sensitive folding search ("istanbul" matches "Istanbul", "İstanbul", etc.)
    const hits = engine.searchPage('orient_test', 0, 'istanbul');
    expect(hits.length).toBe(1);
    expect(hits[0].rects.length).toBeGreaterThan(0);

    // Also test on reference 120p PDF
    const ref120 = await generateReferencePdf('text-120p', { pageCount: 25 });
    const refOpen = engine.openDocument('ref25', ref120);
    expect(refOpen.status).toBe('ok');
    expect(refOpen.pageCount).toBe(25);
    const p20Hits = engine.searchPage('ref25', 19, 'page 20');
    expect(p20Hits.length).toBeGreaterThan(0);

    engine.closeDocument('orient_test');
    engine.closeDocument('ref25');
  });

  it('rotates tile rendering accurately across 90, 180, and 270 userRotation steps', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 600]);
    // Put RED block at top-left in 0-deg visual space: x=0..100, y=500..600 (PDF Y-up)
    page.drawRectangle({ x: 0, y: 500, width: 100, height: 100, color: rgb(0.95, 0.05, 0.05) });
    const bytes = await doc.save();

    engine.openDocument('rot_test', bytes);

    // 90 deg CW: display becomes 600x400; original top-left moves to TOP-RIGHT (x=500..600, y=0..100)
    const rot90 = engine.renderTileRgba({
      sourceDocId: 'rot_test',
      pageIndex: 0,
      tileX: 500,
      tileY: 0,
      tileWidthPx: 100,
      tileHeightPx: 100,
      scale: 1,
      userRotation: 90,
    });
    const idx90 = (50 * 100 + 50) * 4;
    expect(rot90.rgba[idx90]).toBeGreaterThan(200);
    expect(rot90.rgba[idx90 + 2]).toBeLessThan(40);

    // 180 deg CW: display 400x600; original top-left moves to BOTTOM-RIGHT (x=300..400, y=500..600)
    const rot180 = engine.renderTileRgba({
      sourceDocId: 'rot_test',
      pageIndex: 0,
      tileX: 300,
      tileY: 500,
      tileWidthPx: 100,
      tileHeightPx: 100,
      scale: 1,
      userRotation: 180,
    });
    const idx180 = (50 * 100 + 50) * 4;
    expect(rot180.rgba[idx180]).toBeGreaterThan(200);

    // 270 deg CW: display 600x400; original top-left moves to BOTTOM-LEFT (x=0..100, y=300..400)
    const rot270 = engine.renderTileRgba({
      sourceDocId: 'rot_test',
      pageIndex: 0,
      tileX: 0,
      tileY: 300,
      tileWidthPx: 100,
      tileHeightPx: 100,
      scale: 1,
      userRotation: 270,
    });
    const idx270 = (50 * 100 + 50) * 4;
    expect(rot270.rgba[idx270]).toBeGreaterThan(200);

    engine.closeDocument('rot_test');
  });
});
