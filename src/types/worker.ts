import type { CanvasElement } from './elements';
import type { DetectedTextBlock, PageMeta, RectBox, RotationAngle } from './pdf';

export interface HorizontalRule {
  y: number;
  x0: number;
  x1: number;
}

export interface VerticalRule {
  x: number;
  y0: number;
  y1: number;
}

export interface VectorGeometry {
  horizontalRules: HorizontalRule[];
  verticalRules: VerticalRule[];
  cellRects: RectBox[];
}

export interface InspectPdfPayload {
  bytes: Uint8Array;
  password?: string;
}

export interface InspectPdfResult {
  status: 'ok' | 'needs-password' | 'invalid-password';
  decryptedBytes?: Uint8Array;
  wasEncrypted: boolean;
  pageCount: number;
  pages: Array<{
    sourcePageIndex: number;
    baseWidth: number;
    baseHeight: number;
    intrinsicRotation: RotationAngle;
    mediaBox: [number, number, number, number];
    cropBox: [number, number, number, number];
  }>;
}

export interface CompileSourceDocInput {
  id: string;
  bytes: Uint8Array;
}

export interface FontAssetPayload {
  family: string;
  regular?: Uint8Array;
  bold?: Uint8Array;
  italic?: Uint8Array;
  boldItalic?: Uint8Array;
}

export interface ExtractPageTextPayload {
  sourceDocId: string;
  bytes: Uint8Array;
  sourcePageIndex: number;
  pageId: string;
  horizontalRules?: HorizontalRule[];
  verticalRules?: VerticalRule[];
  cellRects?: RectBox[];
}

export interface PrepareCleanPagePayload {
  sourceDocId: string;
  bytes: Uint8Array;
  sourcePageIndex: number;
  textRects: RectBox[];
  imageRects: RectBox[];
}

export interface CompilePdfPayload {
  sourceDocs: CompileSourceDocInput[];
  pages: PageMeta[];
  elements: CanvasElement[];
  fonts?: FontAssetPayload[];
  pageNumbering?: import('./pdf').PageNumberingConfig | null;
  optimizeWithMupdf?: boolean;
}

export interface SplitJobSpec {
  id: string;
  filename: string;
  pages: PageMeta[];
}

export interface SplitPdfZipPayload {
  sourceDocs: CompileSourceDocInput[];
  elements: CanvasElement[];
  jobs: SplitJobSpec[];
  fonts?: FontAssetPayload[];
  pageNumbering?: import('./pdf').PageNumberingConfig | null;
}

export interface WorkerRequestMap {
  ping: { payload: Record<string, never>; result: { ready: true; mupdfLoaded: boolean } };
  inspectPdf: { payload: InspectPdfPayload; result: InspectPdfResult };
  extractPageText: { payload: ExtractPageTextPayload; result: { textBlocks: DetectedTextBlock[] } };
  prepareCleanPage: { payload: PrepareCleanPagePayload; result: { bytes: Uint8Array } };
  compilePdf: { payload: CompilePdfPayload; result: { bytes: Uint8Array } };
  splitPdfZip: { payload: SplitPdfZipPayload; result: { zipBytes: Uint8Array } };
}

export type WorkerMethod = keyof WorkerRequestMap;

export interface WorkerEnvelope<M extends WorkerMethod = WorkerMethod> {
  id: string;
  method: M;
  payload: WorkerRequestMap[M]['payload'];
}

export interface WorkerResponse<M extends WorkerMethod = WorkerMethod> {
  id: string;
  ok: boolean;
  result?: WorkerRequestMap[M]['result'];
  error?: string;
}
