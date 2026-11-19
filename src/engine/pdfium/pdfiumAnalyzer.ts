import {
  decomposeImageCtm,
  MAX_PDF_CANVAS_PIXELS,
  computeCappedCanvasDpr,
} from '../coordinates';
import { getSharedPdfium, type PdfiumRuntimeModule } from './pdfiumLoader';
import { extractTextBlocksFromPdfiumPage } from '../textExtractor';
import { rgbaToPngBytes, uint8ToBase64 } from '@/utils/pngCodec';
import type {
  DetectedImageObject,
  DetectedVectorShape,
  PageExtractionResult,
  RectBox,
} from '@/types/pdf';
import type { HorizontalRule, VectorGeometry, VerticalRule } from '@/types/worker';

export { computeCappedCanvasDpr, MAX_PDF_CANVAS_PIXELS };

const FPDF_PAGEOBJ_TEXT = 1;
const FPDF_PAGEOBJ_PATH = 2;
const FPDF_PAGEOBJ_IMAGE = 3;
const FPDF_PAGEOBJ_FORM = 5;

const FPDF_SEGMENT_LINETO = 1;
const FPDF_SEGMENT_BEZIERTO = 2;
const FPDF_SEGMENT_MOVETO = 0;

function toHexColor(r: number, g: number, b: number): string {
  const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g)
    .toString(16)
    .padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`;
}

function pdfBitmapToPngBytes(mod: PdfiumRuntimeModule, bmpPtr: number): {
  width: number;
  height: number;
  pngBytes: Uint8Array;
} | null {
  if (!bmpPtr) return null;
  const w = mod.FPDFBitmap_GetWidth(bmpPtr);
  const h = mod.FPDFBitmap_GetHeight(bmpPtr);
  const stride = mod.FPDFBitmap_GetStride(bmpPtr);
  const bufPtr = mod.FPDFBitmap_GetBuffer(bmpPtr);
  if (w <= 0 || h <= 0 || !bufPtr || stride <= 0) return null;

  const rgba = new Uint8Array(w * h * 4);
  const heap = mod.pdfium.HEAPU8;
  for (let y = 0; y < h; y++) {
    const srcRow = bufPtr + y * stride;
    const dstRow = y * w * 4;
    for (let x = 0; x < w; x++) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 4;
      // PDFium bitmap buffer is BGRA
      rgba[d] = heap[s + 2];
      rgba[d + 1] = heap[s + 1];
      rgba[d + 2] = heap[s];
      rgba[d + 3] = heap[s + 3];
    }
  }
  return {
    width: w,
    height: h,
    pngBytes: rgbaToPngBytes(rgba, w, h),
  };
}

class PdfiumAnalyzerService {
  private analysisCache = new Map<
    string,
    VectorGeometry & { images: DetectedImageObject[]; shapes: DetectedVectorShape[] }
  >();

  clearCacheForDoc(sourceDocId: string): void {
    const prefix = `${sourceDocId}:`;
    for (const k of this.analysisCache.keys()) {
      if (k.startsWith(prefix)) {
        this.analysisCache.delete(k);
      }
    }
  }

  private walkObjects(
    mod: PdfiumRuntimeModule,
    docPtr: number,
    pagePtr: number,
    pageWidth: number,
    pageHeight: number,
    pageIndex: number,
    pageId: string,
  ): VectorGeometry & { images: DetectedImageObject[]; shapes: DetectedVectorShape[] } {
    const horizontalRules: HorizontalRule[] = [];
    const verticalRules: VerticalRule[] = [];
    const cellRects: RectBox[] = [];
    const images: DetectedImageObject[] = [];
    const rawShapes: Array<DetectedVectorShape & { bboxAreaRatio: number }> = [];

    const textObjectBounds: Array<{ opIdx: number; rect: RectBox }> = [];
    let opCounter = 0;

    const matrixPtr = mod.pdfium.wasmExports.malloc(24);
    const boundsPtr = mod.pdfium.wasmExports.malloc(16);
    const colorPtr = mod.pdfium.wasmExports.malloc(16);
    const fillModePtr = mod.pdfium.wasmExports.malloc(4);
    const strokeBoolPtr = mod.pdfium.wasmExports.malloc(4);
    const strokeWidthPtr = mod.pdfium.wasmExports.malloc(4);
    const segPtPtr = mod.pdfium.wasmExports.malloc(8);
    const pxSizePtr = mod.pdfium.wasmExports.malloc(8);

    type PdfMat = [number, number, number, number, number, number];
    const mulMat = (parent: PdfMat, local: PdfMat): PdfMat => [
      local[0] * parent[0] + local[1] * parent[2],
      local[0] * parent[1] + local[1] * parent[3],
      local[2] * parent[0] + local[3] * parent[2],
      local[2] * parent[1] + local[3] * parent[3],
      local[4] * parent[0] + local[5] * parent[2] + parent[4],
      local[4] * parent[1] + local[5] * parent[3] + parent[5],
    ];
    const readMat = (objPtr: number): PdfMat | null => {
      if (!mod.FPDFPageObj_GetMatrix(objPtr, matrixPtr)) return null;
      return [
        mod.pdfium.getValue(matrixPtr, 'float'),
        mod.pdfium.getValue(matrixPtr + 4, 'float'),
        mod.pdfium.getValue(matrixPtr + 8, 'float'),
        mod.pdfium.getValue(matrixPtr + 12, 'float'),
        mod.pdfium.getValue(matrixPtr + 16, 'float'),
        mod.pdfium.getValue(matrixPtr + 20, 'float'),
      ];
    };
    const boundsToVisual = (
      l: number,
      b: number,
      r: number,
      t: number,
      parentMat: PdfMat | null,
    ): RectBox => {
      if (!parentMat) {
        return {
          x: Math.min(l, r),
          y: Math.max(0, pageHeight - Math.max(t, b)),
          width: Math.abs(r - l),
          height: Math.abs(t - b),
        };
      }
      const [ma, mb, mc, md, me, mf] = parentMat;
      const pts = [
        [l, b],
        [r, b],
        [l, t],
        [r, t],
      ].map(([px, py]) => ({
        x: ma * px + mc * py + me,
        y: mb * px + md * py + mf,
      }));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      return {
        x: minX,
        y: Math.max(0, pageHeight - maxY),
        width: maxX - minX,
        height: maxY - minY,
      };
    };

    const inspectList = (containerPtr: number, isForm: boolean, parentMat: PdfMat | null) => {
      const count = isForm
        ? mod.FPDFFormObj_CountObjects(containerPtr)
        : mod.FPDFPage_CountObjects(containerPtr);

      for (let i = 0; i < count; i++) {
        const objPtr = isForm
          ? mod.FPDFFormObj_GetObject(containerPtr, i)
          : mod.FPDFPage_GetObject(containerPtr, i);
        if (!objPtr) continue;
        const myOpIdx = opCounter++;
        const objType = mod.FPDFPageObj_GetType(objPtr);

        if (objType === FPDF_PAGEOBJ_FORM) {
          const localMat = readMat(objPtr);
          const nextMat = localMat ? (parentMat ? mulMat(parentMat, localMat) : localMat) : parentMat;
          inspectList(objPtr, true, nextMat);
          continue;
        }

        if (objType === FPDF_PAGEOBJ_TEXT) {
          if (
            mod.FPDFPageObj_GetBounds(
              objPtr,
              boundsPtr,
              boundsPtr + 4,
              boundsPtr + 8,
              boundsPtr + 12,
            )
          ) {
            const l = mod.pdfium.getValue(boundsPtr, 'float');
            const b = mod.pdfium.getValue(boundsPtr + 4, 'float');
            const r = mod.pdfium.getValue(boundsPtr + 8, 'float');
            const t = mod.pdfium.getValue(boundsPtr + 12, 'float');
            textObjectBounds.push({
              opIdx: myOpIdx,
              rect: boundsToVisual(l, b, r, t, parentMat),
            });
          }
          continue;
        }

        if (objType === FPDF_PAGEOBJ_IMAGE) {
          let geom = {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            rotation: 0,
            flipX: false,
            flipY: false,
          };
          const localMat = readMat(objPtr);
          if (localMat) {
            const [a, b, c, d, e, f] = parentMat ? mulMat(parentMat, localMat) : localMat;
            geom = decomposeImageCtm([a, -b, c, -d, e, pageHeight - f]);
          } else if (
            mod.FPDFPageObj_GetBounds(
              objPtr,
              boundsPtr,
              boundsPtr + 4,
              boundsPtr + 8,
              boundsPtr + 12,
            )
          ) {
            const l = mod.pdfium.getValue(boundsPtr, 'float');
            const b = mod.pdfium.getValue(boundsPtr + 4, 'float');
            const r = mod.pdfium.getValue(boundsPtr + 8, 'float');
            const t = mod.pdfium.getValue(boundsPtr + 12, 'float');
            geom = {
              ...boundsToVisual(l, b, r, t, parentMat),
              rotation: 0,
              flipX: false,
              flipY: false,
            };
          }

          if (geom.width < 3 || geom.height < 3) continue;

          const bmpPtr =
            mod.FPDFImageObj_GetRenderedBitmap(docPtr, pagePtr, objPtr) ||
            mod.FPDFImageObj_GetBitmap(objPtr);
          let pngBytes: Uint8Array = new Uint8Array(0);
          let pixelWidth = Math.max(1, Math.round(geom.width));
          let pixelHeight = Math.max(1, Math.round(geom.height));
          if (bmpPtr) {
            try {
              const converted = pdfBitmapToPngBytes(mod, bmpPtr);
              if (converted) {
                pngBytes = converted.pngBytes;
                pixelWidth = converted.width;
                pixelHeight = converted.height;
              }
            } finally {
              mod.FPDFBitmap_Destroy(bmpPtr);
            }
          } else if (mod.FPDFImageObj_GetImagePixelSize(objPtr, pxSizePtr, pxSizePtr + 4)) {
            pixelWidth = mod.pdfium.getValue(pxSizePtr, 'i32') || pixelWidth;
            pixelHeight = mod.pdfium.getValue(pxSizePtr + 4, 'i32') || pixelHeight;
          }

          const previewUrl =
            pngBytes.byteLength > 0
              ? `data:image/png;base64,${uint8ToBase64(pngBytes)}`
              : '';
          const pageArea = Math.max(1, pageWidth * pageHeight);
          const areaRatio = (geom.width * geom.height) / pageArea;

          images.push({
            id: `img_${pageIndex}_${myOpIdx}`,
            pageId,
            resourceName: `Im${myOpIdx}`,
            operatorIndex: myOpIdx,
            x: geom.x,
            y: geom.y,
            width: geom.width,
            height: geom.height,
            rotation: geom.rotation,
            flipX: geom.flipX,
            flipY: geom.flipY,
            pixelWidth,
            pixelHeight,
            previewUrl,
            pngBytes,
            isHeaderOrBackground: areaRatio >= 0.45,
            opacity: 1,
          });
          continue;
        }

        if (objType === FPDF_PAGEOBJ_PATH) {
          mod.pdfium.setValue(fillModePtr, 0, 'i32');
          mod.pdfium.setValue(strokeBoolPtr, 0, 'i32');
          mod.FPDFPath_GetDrawMode(objPtr, fillModePtr, strokeBoolPtr);
          const fillMode = mod.pdfium.getValue(fillModePtr, 'i32');
          const hasStroke = Boolean(mod.pdfium.getValue(strokeBoolPtr, 'i32'));
          const isFilled = fillMode > 0;
          if (!isFilled && !hasStroke) continue;

          if (
            !mod.FPDFPageObj_GetBounds(
              objPtr,
              boundsPtr,
              boundsPtr + 4,
              boundsPtr + 8,
              boundsPtr + 12,
            )
          ) {
            continue;
          }
          const l = mod.pdfium.getValue(boundsPtr, 'float');
          const b = mod.pdfium.getValue(boundsPtr + 4, 'float');
          const r = mod.pdfium.getValue(boundsPtr + 8, 'float');
          const t = mod.pdfium.getValue(boundsPtr + 12, 'float');
          const visBox = boundsToVisual(l, b, r, t, parentMat);
          const bx = visBox.x;
          const by = visBox.y;
          const bw = visBox.width;
          const bh = visBox.height;

          let fillColor: string | null = null;
          let fillAlpha = 1;
          if (
            isFilled &&
            mod.FPDFPageObj_GetFillColor(
              objPtr,
              colorPtr,
              colorPtr + 4,
              colorPtr + 8,
              colorPtr + 12,
            )
          ) {
            fillColor = toHexColor(
              mod.pdfium.getValue(colorPtr, 'i32'),
              mod.pdfium.getValue(colorPtr + 4, 'i32'),
              mod.pdfium.getValue(colorPtr + 8, 'i32'),
            );
            fillAlpha = Math.max(0.05, mod.pdfium.getValue(colorPtr + 12, 'i32') / 255);
          }

          let strokeColor: string | null = null;
          if (
            hasStroke &&
            mod.FPDFPageObj_GetStrokeColor(
              objPtr,
              colorPtr,
              colorPtr + 4,
              colorPtr + 8,
              colorPtr + 12,
            )
          ) {
            strokeColor = toHexColor(
              mod.pdfium.getValue(colorPtr, 'i32'),
              mod.pdfium.getValue(colorPtr + 4, 'i32'),
              mod.pdfium.getValue(colorPtr + 8, 'i32'),
            );
          }

          let strokeWidth = 1;
          if (hasStroke && mod.FPDFPageObj_GetStrokeWidth(objPtr, strokeWidthPtr)) {
            strokeWidth = Math.max(0.5, mod.pdfium.getValue(strokeWidthPtr, 'float'));
          }

          // Inspect line segments to classify horizontal/vertical table rules & cell boxes
          const segCount = mod.FPDFPath_CountSegments(objPtr);
          const localPathMat = readMat(objPtr);
          const effPathMat: PdfMat = localPathMat
            ? (parentMat ? mulMat(parentMat, localPathMat) : localPathMat)
            : (parentMat ?? [1, 0, 0, 1, 0, 0]);
          const [ma, mb, mc, md, me, mf] = effPathMat;

          let lastVis: { x: number; y: number } | null = null;
          for (let sIdx = 0; sIdx < segCount; sIdx++) {
            const segPtr = mod.FPDFPath_GetPathSegment(objPtr, sIdx);
            if (!segPtr) continue;
            const sType = mod.FPDFPathSegment_GetType(segPtr);
            if (!mod.FPDFPathSegment_GetPoint(segPtr, segPtPtr, segPtPtr + 4)) continue;
            const rx = mod.pdfium.getValue(segPtPtr, 'float');
            const ry = mod.pdfium.getValue(segPtPtr + 4, 'float');
            const ux = ma * rx + mc * ry + me;
            const uy = mb * rx + md * ry + mf;
            const vx = ux;
            const vy = pageHeight - uy;

            if (sType === FPDF_SEGMENT_MOVETO) {
              lastVis = { x: vx, y: vy };
            } else if (sType === FPDF_SEGMENT_LINETO && lastVis) {
              if (Math.abs(vy - lastVis.y) <= 1.8 && Math.abs(vx - lastVis.x) >= 16) {
                horizontalRules.push({
                  y: (vy + lastVis.y) / 2,
                  x0: Math.min(lastVis.x, vx),
                  x1: Math.max(lastVis.x, vx),
                });
              } else if (Math.abs(vx - lastVis.x) <= 1.8 && Math.abs(vy - lastVis.y) >= 12) {
                verticalRules.push({
                  x: (vx + lastVis.x) / 2,
                  y0: Math.min(lastVis.y, vy),
                  y1: Math.max(lastVis.y, vy),
                });
              }
              lastVis = { x: vx, y: vy };
            } else if (sType === FPDF_SEGMENT_BEZIERTO) {
              lastVis = { x: vx, y: vy };
            }
          }

          if (hasStroke && !isFilled && bw >= 18 && bh >= 12) {
            cellRects.push({ x: bx, y: by, width: bw, height: bh });
          }

          // Ignore full-page white paper background fills
          const pageArea = Math.max(1, pageWidth * pageHeight);
          const bboxAreaRatio = (bw * bh) / pageArea;
          const isWhiteFullBg =
            bboxAreaRatio >= 0.88 &&
            fillColor?.toLowerCase() === '#ffffff' &&
            !hasStroke;
          if (!isWhiteFullBg && (bw >= 8 || bh >= 8)) {
            rawShapes.push({
              id: `shp_${pageIndex}_${myOpIdx}`,
              pageId,
              operatorIndex: myOpIdx,
              x: bx,
              y: by,
              width: bw,
              height: bh,
              fillColor,
              strokeColor,
              strokeWidth,
              opacity: fillAlpha,
              bboxAreaRatio,
            });
          }
        }
      }
    };

    try {
      inspectList(pagePtr, false, null);

      // Classify behindContent & isBackgroundLayer by paint order against overlapping text
      const overlapsTextBefore = (box: RectBox, myOp: number): boolean =>
        textObjectBounds.some(
          (t) =>
            t.opIdx > myOp &&
            Math.min(box.x + box.width, t.rect.x + t.rect.width) > Math.max(box.x, t.rect.x) + 1 &&
            Math.min(box.y + box.height, t.rect.y + t.rect.height) > Math.max(box.y, t.rect.y) + 1,
        );

      const pageArea = Math.max(1, pageWidth * pageHeight);
      for (const img of images) {
        const areaRatio = (img.width * img.height) / pageArea;
        const behind = overlapsTextBefore(img, img.operatorIndex) || areaRatio >= 0.65;
        img.behindContent = behind;
        img.isBackgroundLayer = areaRatio >= 0.65;
        img.isHeaderOrBackground = behind || areaRatio >= 0.35;
      }

      const shapes: DetectedVectorShape[] = rawShapes.map(({ bboxAreaRatio, ...s }) => {
        const behind = overlapsTextBefore(s, s.operatorIndex) || bboxAreaRatio >= 0.65;
        return {
          ...s,
          behindContent: behind,
          isBackgroundLayer: bboxAreaRatio >= 0.65,
          isHeaderOrBackground: behind || bboxAreaRatio >= 0.35,
        };
      });

      return {
        images,
        shapes,
        horizontalRules,
        verticalRules,
        cellRects,
      };
    } finally {
      mod.pdfium.wasmExports.free(matrixPtr);
      mod.pdfium.wasmExports.free(boundsPtr);
      mod.pdfium.wasmExports.free(colorPtr);
      mod.pdfium.wasmExports.free(fillModePtr);
      mod.pdfium.wasmExports.free(strokeBoolPtr);
      mod.pdfium.wasmExports.free(strokeWidthPtr);
      mod.pdfium.wasmExports.free(segPtPtr);
      mod.pdfium.wasmExports.free(pxSizePtr);
    }
  }

  async extractPageImagesAndRules(
    sourceDocId: string,
    pdfBytes: Uint8Array,
    pageIndex: number,
    pageId: string,
  ): Promise<VectorGeometry & { images: DetectedImageObject[]; shapes: DetectedVectorShape[] }> {
    const cacheKey = `${sourceDocId}:${pdfBytes.byteLength}:${pageIndex}`;
    const cached = this.analysisCache.get(cacheKey);
    if (cached) return cached;

    const mod = await getSharedPdfium();
    const dataPtr = mod.pdfium.wasmExports.malloc(pdfBytes.byteLength);
    if (!dataPtr) {
      return { images: [], shapes: [], horizontalRules: [], verticalRules: [], cellRects: [] };
    }
    mod.pdfium.HEAPU8.set(pdfBytes, dataPtr);
    const docPtr = mod.FPDF_LoadMemDocument(dataPtr, pdfBytes.byteLength, '');
    if (!docPtr) {
      mod.pdfium.wasmExports.free(dataPtr);
      return { images: [], shapes: [], horizontalRules: [], verticalRules: [], cellRects: [] };
    }

    try {
      const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
      if (!pagePtr) {
        return { images: [], shapes: [], horizontalRules: [], verticalRules: [], cellRects: [] };
      }
      try {
        const pageW = mod.FPDF_GetPageWidthF(pagePtr) || 595;
        const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 842;
        const result = this.walkObjects(mod, docPtr, pagePtr, pageW, pageH, pageIndex, pageId);
        this.analysisCache.set(cacheKey, result);
        return result;
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    } finally {
      mod.FPDF_CloseDocument(docPtr);
      mod.pdfium.wasmExports.free(dataPtr);
    }
  }

  async extractPageContent(
    sourceDocId: string,
    pdfBytes: Uint8Array,
    pageIndex: number,
    pageId: string,
  ): Promise<PageExtractionResult> {
    const objRes = await this.extractPageImagesAndRules(sourceDocId, pdfBytes, pageIndex, pageId);
    const mod = await getSharedPdfium();
    const dataPtr = mod.pdfium.wasmExports.malloc(pdfBytes.byteLength);
    if (!dataPtr) {
      return { textBlocks: [], ...objRes };
    }
    mod.pdfium.HEAPU8.set(pdfBytes, dataPtr);
    const docPtr = mod.FPDF_LoadMemDocument(dataPtr, pdfBytes.byteLength, '');
    if (!docPtr) {
      mod.pdfium.wasmExports.free(dataPtr);
      return { textBlocks: [], ...objRes };
    }
    try {
      const pagePtr = mod.FPDF_LoadPage(docPtr, pageIndex);
      if (!pagePtr) return { textBlocks: [], ...objRes };
      try {
        const pageH = mod.FPDF_GetPageHeightF(pagePtr) || 842;
        const textBlocks = extractTextBlocksFromPdfiumPage(mod, pagePtr, pageH, pageId, {
          horizontalRules: objRes.horizontalRules,
          verticalRules: objRes.verticalRules,
          cellRects: objRes.cellRects,
        });
        return { textBlocks, ...objRes };
      } finally {
        mod.FPDF_ClosePage(pagePtr);
      }
    } finally {
      mod.FPDF_CloseDocument(docPtr);
      mod.pdfium.wasmExports.free(dataPtr);
    }
  }
}

export const pdfiumAnalyzer = new PdfiumAnalyzerService();
