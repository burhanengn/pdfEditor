import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { PDFDocument } from 'pdf-lib';
import {
  applyCropSubRectToElement,
  buildClippingMaskFromElement,
  elementLocalToPage,
  findOverlappingImagesForMask,
  findOverlappingMasksForImage,
  flipOpenCutMaskSide,
  flipSvgPath,
  resetImageCropGeometry,
  rotateRectAroundPivot,
} from '../imageMask';
import { compilePdfDocument, inspectPdfDocument } from '../pdfCompiler';
import { denormalizePathPoints } from '../vectorShapes';
import { useEditorStore } from '@/store/useEditorStore';
import type { PageMeta } from '@/types/pdf';
import type { ImageAddElement, VectorPathElement, VectorShapeElement } from '@/types/elements';

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc, false);
  return out;
}

function createTwoTonePngBytes(
  width = 40,
  height = 40,
  topRgb: [number, number, number] = [239, 68, 68],
  bottomRgb: [number, number, number] = [30, 58, 138],
): Uint8Array {
  const rowLen = 1 + width * 3;
  const raw = new Uint8Array(height * rowLen);
  const midY = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: None
    const rgb = y < midY ? topRgb : bottomRgb;
    for (let x = 0; x < width; x++) {
      raw[off + 1 + x * 3] = rgb[0];
      raw[off + 2 + x * 3] = rgb[1];
      raw[off + 3 + x * 3] = rgb[2];
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrDv = new DataView(ihdr.buffer);
  ihdrDv.setUint32(0, width, false);
  ihdrDv.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const c1 = pngChunk('IHDR', ihdr);
  const c2 = pngChunk('IDAT', new Uint8Array(deflateSync(raw)));
  const c3 = pngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(sig.length + c1.length + c2.length + c3.length);
  let pos = 0;
  for (const part of [sig, c1, c2, c3]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

async function createBlankPdfBytes(width = 400, height = 400): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return doc.save();
}

function makeTestPageMeta(id = 'page_0', width = 400, height = 400): PageMeta {
  return {
    id,
    sourceDocId: 'doc_test',
    sourcePageIndex: 0,
    baseWidth: width,
    baseHeight: height,
    intrinsicRotation: 0,
    userRotation: 0,
    mediaBox: [0, 0, width, height],
    cropBox: [0, 0, width, height],
  };
}

function makeShape(overrides: Partial<VectorShapeElement> = {}): VectorShapeElement {
  return {
    id: 'shp_1',
    pageId: 'page_0',
    kind: 'shape',
    shapeType: 'arrow',
    x: 100,
    y: 120,
    width: 80,
    height: 40,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    fillColor: '#2563eb',
    strokeColor: '#0f172a',
    strokeWidth: 2,
    borderRadius: 0,
    ...overrides,
  };
}

function makePath(overrides: Partial<VectorPathElement> = {}): VectorPathElement {
  return {
    id: 'path_1',
    pageId: 'page_0',
    kind: 'path',
    x: 80,
    y: 80,
    width: 100,
    height: 80,
    rotation: 0,
    opacity: 1,
    zIndex: 2,
    points: [
      { x: 0, y: 0.2 },
      { x: 1, y: 0.5 },
      { x: 0.3, y: 1 },
    ],
    closed: false,
    smooth: false,
    fillColor: 'transparent',
    strokeColor: '#1e3a8a',
    strokeWidth: 2,
    ...overrides,
  };
}

function makeImage(pngBytes: Uint8Array, overrides: Partial<ImageAddElement> = {}): ImageAddElement {
  return {
    id: 'img_1',
    pageId: 'page_0',
    kind: 'image',
    name: 'sample.png',
    mimeType: 'image/png',
    bytes: pngBytes,
    previewUrl: 'blob:test-image',
    x: 40,
    y: 40,
    width: 120,
    height: 120,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    naturalWidth: 40,
    naturalHeight: 40,
    aspectLocked: true,
    ...overrides,
  };
}

describe('imageMask geometry, transform actions & PDF vector clipping', () => {
  beforeEach(() => {
    useEditorStore.getState().resetDocument();
    useEditorStore.getState().loadInitialDocument(
      {
        id: 'doc_test',
        name: 'test.pdf',
        bytes: new Uint8Array([37, 80, 68, 70]),
        pageCount: 1,
        wasEncrypted: false,
      },
      [makeTestPageMeta('page_0', 400, 400)],
    );
  });

  it('reflectElements mirrors rotated shapes, rotated paths vertex-by-vertex, and multi-select groups cleanly', () => {
    const store = useEditorStore.getState();
    const shp = makeShape({ id: 'shp_rot', rotation: 30, flipX: false, flipY: false });
    const path = makePath({ id: 'path_rot', rotation: 40 });
    const png = createTwoTonePngBytes(10, 10);
    const img = makeImage(png, { id: 'img_rot', rotation: 25, x: 240, y: 120, width: 60, height: 60 });

    store.addElement(shp, false);
    store.addElement(path, false);
    store.addElement(img, false);

    // Record exact page-space path vertices before horizontal mirror
    const cxPath = path.x + path.width / 2;
    const beforePageVerts = denormalizePathPoints(path).map((abs) => {
      const localX = abs.x - path.x;
      const localY = abs.y - path.y;
      return elementLocalToPage(localX, localY, path, path.rotation);
    });

    // Horizontal mirror of rotated shape & rotated path
    useEditorStore.getState().reflectElements([shp.id], 'horizontal');
    const shpAfterH = useEditorStore.getState().elements.find((e) => e.id === shp.id) as VectorShapeElement;
    expect(shpAfterH.flipX).toBe(true);
    expect(shpAfterH.flipY).toBe(false);
    expect(shpAfterH.rotation).toBeCloseTo(330, 4);

    // Vertical mirror sequentially toggles flipY & flips rotation back to +30
    useEditorStore.getState().reflectElements([shp.id], 'vertical');
    const shpAfterV = useEditorStore.getState().elements.find((e) => e.id === shp.id) as VectorShapeElement;
    expect(shpAfterV.flipX).toBe(true);
    expect(shpAfterV.flipY).toBe(true);
    expect(shpAfterV.rotation).toBeCloseTo(30, 4);

    // Rotated path page vertices mirror identically across cxPath on horizontal reflection
    useEditorStore.getState().reflectElements([path.id], 'horizontal');
    const pathAfterH = useEditorStore.getState().elements.find((e) => e.id === path.id) as VectorPathElement;
    expect(pathAfterH.rotation).toBeCloseTo(320, 4);
    const afterPageVerts = denormalizePathPoints(pathAfterH).map((abs) => {
      const localX = abs.x - pathAfterH.x;
      const localY = abs.y - pathAfterH.y;
      return elementLocalToPage(localX, localY, pathAfterH, pathAfterH.rotation);
    });
    for (let i = 0; i < beforePageVerts.length; i++) {
      expect(afterPageVerts[i].x).toBeCloseTo(2 * cxPath - beforePageVerts[i].x, 3);
      expect(afterPageVerts[i].y).toBeCloseTo(beforePageVerts[i].y, 3);
    }

    // Multi-select horizontal reflection mirrors centers across group center & sets image flipX
    const shpCenterBefore = shpAfterV.x + shpAfterV.width / 2;
    const imgCenterBefore = img.x + img.width / 2;
    const minX = Math.min(shpAfterV.x, img.x);
    const maxX = Math.max(shpAfterV.x + shpAfterV.width, img.x + img.width);
    const groupCx = (minX + maxX) / 2;

    useEditorStore.getState().reflectElements([shp.id, img.id], 'horizontal');
    const shpGroupAfter = useEditorStore.getState().elements.find((e) => e.id === shp.id) as VectorShapeElement;
    const imgGroupAfter = useEditorStore.getState().elements.find((e) => e.id === img.id) as ImageAddElement;
    expect(shpGroupAfter.x + shpGroupAfter.width / 2).toBeCloseTo(2 * groupCx - shpCenterBefore, 3);
    expect(imgGroupAfter.x + imgGroupAfter.width / 2).toBeCloseTo(2 * groupCx - imgCenterBefore, 3);
    expect(imgGroupAfter.flipX).toBe(true);
    expect(imgGroupAfter.rotation).toBeCloseTo(335, 4);
  });

  it('rotateElements & rotateAndDuplicateElements create an exact rosette around bottom-center pivot with single undo', () => {
    const store = useEditorStore.getState();
    const petal = makeShape({
      id: 'petal_0',
      shapeType: 'triangle',
      x: 190,
      y: 140,
      width: 20,
      height: 60,
      rotation: 0,
    });
    store.addElement(petal, false);

    // Bottom center pivot on page is (200, 200)
    const createdIds = useEditorStore.getState().rotateAndDuplicateElements([petal.id], 45, 7, 'bottom-center');
    expect(createdIds).toHaveLength(7);

    const stateAfter = useEditorStore.getState();
    expect(stateAfter.elements).toHaveLength(8);
    expect(stateAfter.lastRotateCopyConfig).toEqual({
      angleDeg: 45,
      copies: 7,
      pivot: 'bottom-center',
    });

    // Verify step 4 (180 deg) lands symmetrically below pivot (200, 200) -> center at (200, 230)
    const halfTurnEl = stateAfter.elements.find((e) => e.id === createdIds[3]) as VectorShapeElement;
    expect(halfTurnEl.rotation).toBeCloseTo(180, 4);
    expect(halfTurnEl.x + halfTurnEl.width / 2).toBeCloseTo(200, 3);
    expect(halfTurnEl.y + halfTurnEl.height / 2).toBeCloseTo(230, 3);

    // Multi-select rotateElements rotates around group pivot
    useEditorStore.getState().rotateElements([petal.id, createdIds[3]], 90, 'center');
    const rotatedFirst = useEditorStore.getState().elements.find((e) => e.id === petal.id)!;
    expect(rotatedFirst.rotation).toBeCloseTo(90, 4);

    // Undo restores rotateElements, then second undo restores all 7 rotate-copied petals cleanly
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements).toHaveLength(8);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements).toHaveLength(1);
    expect(useEditorStore.getState().elements[0].id).toBe(petal.id);

    // Pure geometry check for rotateRectAroundPivot at 0 -> 90 deg
    const rotCheck = rotateRectAroundPivot(
      { x: 100, y: 100, width: 40, height: 20 },
      0,
      90,
      { x: 120, y: 120 },
    );
    expect(rotCheck.rotation).toBeCloseTo(90, 4);
    expect(rotCheck.x + 20).toBeCloseTo(130, 3);
    expect(rotCheck.y + 10).toBeCloseTo(120, 3);
  });

  it('applyCropSubRectToElement & resetImageCropGeometry roundtrip accurately at 0 deg and 35 deg flipped', () => {
    const png = createTwoTonePngBytes(40, 40);

    // Unrotated nested crop roundtrip
    const baseImg = makeImage(png, { x: 100, y: 100, width: 200, height: 100, rotation: 0 });
    const crop1 = applyCropSubRectToElement(baseImg, { x: 0.25, y: 0.2, width: 0.5, height: 0.6 });
    expect(crop1.width).toBeCloseTo(100, 3);
    expect(crop1.height).toBeCloseTo(60, 3);
    expect(crop1.x).toBeCloseTo(150, 3);
    expect(crop1.y).toBeCloseTo(120, 3);

    const midImg: ImageAddElement = { ...baseImg, ...crop1 };
    const crop2 = applyCropSubRectToElement(midImg, { x: 0.1, y: 0.25, width: 0.8, height: 0.5 });
    const finalImg: ImageAddElement = { ...midImg, ...crop2 };
    const restored0 = resetImageCropGeometry(finalImg);
    expect(restored0.x).toBeCloseTo(100, 3);
    expect(restored0.y).toBeCloseTo(100, 3);
    expect(restored0.width).toBeCloseTo(200, 3);
    expect(restored0.height).toBeCloseTo(100, 3);

    // Rotated 35 deg + flipX + flipY nested crop roundtrip
    const rotImg = makeImage(png, {
      x: 80,
      y: 90,
      width: 180,
      height: 120,
      rotation: 35,
      flipX: true,
      flipY: true,
    });
    const rCrop1 = applyCropSubRectToElement(rotImg, { x: 0.15, y: 0.1, width: 0.65, height: 0.7 });
    const rMid: ImageAddElement = { ...rotImg, ...rCrop1 };
    const rCrop2 = applyCropSubRectToElement(rMid, { x: 0.2, y: 0.2, width: 0.5, height: 0.5 });
    const rFinal: ImageAddElement = { ...rMid, ...rCrop2 };
    const restoredRot = resetImageCropGeometry(rFinal);
    expect(restoredRot.x).toBeCloseTo(80, 3);
    expect(restoredRot.y).toBeCloseTo(90, 3);
    expect(restoredRot.width).toBeCloseTo(180, 3);
    expect(restoredRot.height).toBeCloseTo(120, 3);
  });

  it('builds Illustrator clipping masks from shapes & open lines, flips sides, and restores moved masks on release', () => {
    const png = createTwoTonePngBytes(40, 40);
    const store = useEditorStore.getState();

    const img = makeImage(png, { id: 'img_mask', x: 50, y: 50, width: 160, height: 120 });
    const ellipseMask = makeShape({
      id: 'shp_ellipse_mask',
      shapeType: 'ellipse',
      x: 70,
      y: 70,
      width: 120,
      height: 80,
      rotation: 15,
    });
    const openCut = makePath({
      id: 'path_cut',
      x: 40,
      y: 45,
      width: 180,
      height: 130,
      points: [
        { x: 0, y: 0.8 },
        { x: 0.5, y: 0.45 },
        { x: 1, y: 0.15 },
      ],
      closed: false,
      smooth: true,
    });

    store.addElement(img, false);
    store.addElement(ellipseMask, false);
    store.addElement(openCut, false);

    // Overlap auto-discovery checks
    const masksForImg = findOverlappingMasksForImage(img, useEditorStore.getState().elements);
    expect(masksForImg.map((m) => m.mask.id)).toContain('shp_ellipse_mask');
    expect(masksForImg.map((m) => m.mask.id)).toContain('path_cut');
    const imgsForLine = findOverlappingImagesForMask(openCut, useEditorStore.getState().elements);
    expect(imgsForLine[0]?.isOpenLineCut).toBe(true);
    expect(imgsForLine[0]?.image.id).toBe('img_mask');

    // Pure geometry check: rotated ellipse mask builds valid closed unit SVG path + cropRect
    const maskPatch = buildClippingMaskFromElement(img, ellipseMask);
    expect(maskPatch.cropRect.width).toBeGreaterThan(0.5);
    expect(maskPatch.clipMask.unitSvgPath).toContain('M ');
    expect(maskPatch.clipMask.unitSvgPath).toContain('Z');

    // Open-line cut side 'a' vs side 'b' via flipOpenCutMaskSide
    const sideA = buildClippingMaskFromElement(img, openCut, 'a');
    expect(sideA.clipMask.openCutSide).toBe('a');
    const maskedImgA: ImageAddElement = { ...img, ...sideA };
    const sideB = flipOpenCutMaskSide(maskedImgA);
    expect(sideB).not.toBeNull();
    expect(sideB!.clipMask.openCutSide).toBe('b');

    // Store workflow: mask image by ellipse -> move masked image -> release & restore shape at shifted coords
    useEditorStore.getState().applyImageClippingMask(img.id, ellipseMask.id, 'a', true);
    expect(useEditorStore.getState().elements.some((e) => e.id === ellipseMask.id)).toBe(false);

    const afterMask = useEditorStore.getState().elements.find((e) => e.id === img.id) as ImageAddElement;
    expect(afterMask.clipMask?.sourceElement?.kind).toBe('shape');

    // Shift masked image by (+40, -25)
    useEditorStore.getState().updateElements(
      [{ id: img.id, patch: { x: afterMask.x + 40, y: afterMask.y - 25 } }],
      true,
    );

    useEditorStore.getState().releaseImageCropAndMask(img.id, true);
    const elsAfterRelease = useEditorStore.getState().elements;
    const restoredImg = elsAfterRelease.find((e) => e.id === img.id) as ImageAddElement;
    const restoredMask = elsAfterRelease.find((e) => e.kind === 'shape') as VectorShapeElement;

    expect(restoredImg.clipMask).toBeUndefined();
    expect(restoredImg.cropRect).toBeUndefined();
    expect(restoredImg.x).toBeCloseTo(img.x + 40, 3);
    expect(restoredImg.y).toBeCloseTo(img.y - 25, 3);
    expect(restoredImg.width).toBeCloseTo(img.width, 3);
    expect(restoredMask).toBeDefined();
    expect(restoredMask.shapeType).toBe('ellipse');
    expect(restoredMask.x).toBeCloseTo(ellipseMask.x + 40, 3);
    expect(restoredMask.y).toBeCloseTo(ellipseMask.y - 25, 3);
    expect(restoredMask.rotation).toBeCloseTo(15, 3);

    // Also verify flipSvgPath preserves command count & flips Y/X endpoints cleanly
    const flippedD = flipSvgPath('M 0.1 0.2 L 0.9 0.8 Z', 1, 1, true, true, 3);
    expect(flippedD).toBe('M 0.9 0.8 L 0.1 0.2 Z');
  });

  it('compiles PDF with native vector W clipping paths for ellipse mask, open-line cut (both sides), and flipped rotated shape', async () => {
    const basePdf = await createBlankPdfBytes(400, 400);
    const info = await inspectPdfDocument(mupdf, basePdf);
    const pages: PageMeta[] = info.pages.map((p, idx) => ({
      id: `page_${idx}`,
      sourceDocId: 'src_1',
      sourcePageIndex: p.sourcePageIndex,
      baseWidth: p.baseWidth,
      baseHeight: p.baseHeight,
      intrinsicRotation: p.intrinsicRotation,
      userRotation: 0,
      mediaBox: p.mediaBox,
      cropBox: p.cropBox,
    }));

    const twoTonePng = createTwoTonePngBytes(40, 40, [239, 68, 68], [30, 58, 138]);

    // 1) Image at (20, 20, 120x120) sliced horizontally by open line y=80; choose side keeping TOP RED half
    const imgCutBase = makeImage(twoTonePng, {
      id: 'img_cut',
      pageId: 'page_0',
      x: 20,
      y: 20,
      width: 120,
      height: 120,
    });
    const horzLine = makePath({
      id: 'line_cut',
      pageId: 'page_0',
      x: 10,
      y: 80,
      width: 140,
      height: 2,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      closed: false,
    });
    const tryA = buildClippingMaskFromElement(imgCutBase, horzLine, 'a');
    const keepTopSide: 'a' | 'b' = tryA.cropRect.y < 0.25 ? 'a' : 'b';
    const topPatch = buildClippingMaskFromElement(imgCutBase, horzLine, keepTopSide);
    const imgTopHalf: ImageAddElement = { ...imgCutBase, ...topPatch };

    // 2) Second copy placed identically side-by-side at (20, 180) with flipped side keeping BOTTOM BLUE half
    const imgCutBotBase = makeImage(twoTonePng, {
      id: 'img_cut_bot',
      pageId: 'page_0',
      x: 20,
      y: 180,
      width: 120,
      height: 120,
    });
    const horzLineBot = makePath({
      id: 'line_cut_bot',
      pageId: 'page_0',
      x: 10,
      y: 240,
      width: 140,
      height: 2,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      closed: false,
    });
    const botPatch = buildClippingMaskFromElement(
      imgCutBotBase,
      horzLineBot,
      keepTopSide === 'a' ? 'b' : 'a',
    );
    const imgBottomHalf: ImageAddElement = { ...imgCutBotBase, ...botPatch };

    // 3) Image at (200, 20, 120x120) masked by centered ellipse at (220, 40, 80x80)
    const imgCircleBase = makeImage(twoTonePng, {
      id: 'img_circle',
      pageId: 'page_0',
      x: 200,
      y: 20,
      width: 120,
      height: 120,
    });
    const circleShape = makeShape({
      id: 'shp_mask_circle',
      pageId: 'page_0',
      shapeType: 'ellipse',
      x: 220,
      y: 40,
      width: 80,
      height: 80,
    });
    const circlePatch = buildClippingMaskFromElement(imgCircleBase, circleShape);
    const imgCircleMasked: ImageAddElement = { ...imgCircleBase, ...circlePatch };

    // 4) Flipped green arrow shape at (200, 200, 100x80) pointing LEFT via flipX: true
    const flippedArrow = makeShape({
      id: 'shp_flip_arrow',
      pageId: 'page_0',
      shapeType: 'arrow',
      x: 200,
      y: 200,
      width: 100,
      height: 80,
      rotation: 0,
      flipX: true,
      fillColor: '#16a34a',
      strokeColor: 'transparent',
      strokeWidth: 0,
    });

    const compiledBytes = await compilePdfDocument(mupdf, {
      sourceDocs: [{ id: 'src_1', bytes: basePdf }],
      pages,
      elements: [imgTopHalf, imgBottomHalf, imgCircleMasked, flippedArrow],
      optimizeWithMupdf: true,
    });

    const doc = mupdf.Document.openDocument(compiledBytes, 'application/pdf');
    try {
      const page = doc.loadPage(0);
      const pm = page.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        const px = pm.getPixels();
        const w = pm.getWidth();
        const n = pm.getNumberOfComponents();
        const sample = (x: number, y: number): [number, number, number] => {
          const idx = (y * w + x) * n;
          return [px[idx], px[idx + 1], px[idx + 2]];
        };

        // Top-half open-line cut: (80, 50) is bright red, (80, 110) in bottom half is clipped white!
        const [rTop, gTop, bTop] = sample(80, 50);
        expect(rTop).toBeGreaterThan(190);
        expect(gTop).toBeLessThan(95);
        expect(bTop).toBeLessThan(95);
        const [rTopClip, gTopClip, bTopClip] = sample(80, 110);
        expect(rTopClip).toBeGreaterThan(245);
        expect(gTopClip).toBeGreaterThan(245);
        expect(bTopClip).toBeGreaterThan(245);

        // Flipped bottom-half cut: (80, 210) in top half is white, (80, 270) is dark blue!
        const [rBotClip, gBotClip, bBotClip] = sample(80, 210);
        expect(rBotClip).toBeGreaterThan(245);
        expect(gBotClip).toBeGreaterThan(245);
        expect(bBotClip).toBeGreaterThan(245);
        const [rBot, , bBot] = sample(80, 270);
        expect(bBot).toBeGreaterThan(110);
        expect(rBot).toBeLessThan(65);

        // Ellipse clip on Image 3: outer corner (223, 43) is white, upper inside (260, 60) is red, lower inside (260, 98) is dark blue
        const [cCornerR, cCornerG, cCornerB] = sample(223, 43);
        expect(cCornerR).toBeGreaterThan(245);
        expect(cCornerG).toBeGreaterThan(245);
        expect(cCornerB).toBeGreaterThan(245);

        const [cUpperR, cUpperG] = sample(260, 60);
        expect(cUpperR).toBeGreaterThan(190);
        expect(cUpperG).toBeLessThan(95);

        const [cLowerR, , cLowerB] = sample(260, 98);
        expect(cLowerB).toBeGreaterThan(110);
        expect(cLowerR).toBeLessThan(65);

        // Flipped arrow-right (now pointing LEFT):
        // Mid-shaft/head right edge near (290, 240) has shaft ink? Wait: arrow-right shaft spans x=0..0.55, head apex at x=1.
        // With flipX:true, arrowhead points to x=200 (apex at (200,240)), shaft at right (x=245..300, y=224..256),
        // so top-left of bbox (208, 212) is outside arrowhead -> WHITE, while top-right tail? Shaft is middle band; head widest near x=245 -> (242, 215) IS green, whereas unflipped (242, 215) was empty tail!
        // Specifically: at (210, 240) (arrowhead tip) it IS green (#16a34a), and at (290, 208) (outside shaft on right tail) it IS white!
        const [arrHeadR, arrHeadG] = sample(215, 240);
        expect(arrHeadG).toBeGreaterThan(130);
        expect(arrHeadR).toBeLessThan(60);

        const [arrTailCornerR, arrTailCornerG, arrTailCornerB] = sample(290, 208);
        expect(arrTailCornerR).toBeGreaterThan(245);
        expect(arrTailCornerG).toBeGreaterThan(245);
        expect(arrTailCornerB).toBeGreaterThan(245);
      } finally {
        pm.destroy();
        page.destroy();
      }
    } finally {
      doc.destroy();
    }
  });
});
