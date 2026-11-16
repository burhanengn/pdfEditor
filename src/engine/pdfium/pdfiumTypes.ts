import type { ReadingTheme, RotationAngle } from '@/types/pdf';

export interface PdfOutlineNode {
  id: string;
  title: string;
  pageIndex: number | null;
  children: PdfOutlineNode[];
}

export interface PdfLinkAnnotation {
  id: string;
  pageIndex: number;
  /** Visual page-space normalized [0..1] or unscaled visual pt rect */
  x: number;
  y: number;
  width: number;
  height: number;
  kind: 'uri' | 'goto';
  uri?: string;
  destPageIndex?: number;
}

export interface PdfTextCharBox {
  unicode: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfTextSpan {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  baselineY: number;
}

export interface PdfSearchHit {
  pageIndex: number;
  matchIndexInPage: number;
  snippet: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface PdfiumPageSummary {
  sourcePageIndex: number;
  baseWidth: number;
  baseHeight: number;
  intrinsicRotation: RotationAngle;
}

export interface PdfiumOpenResult {
  status: 'ok' | 'needs-password' | 'invalid-password';
  pageCount: number;
  pages: PdfiumPageSummary[];
  canCopyText: boolean;
  permissions: number;
}

export interface TileRenderRequest {
  sourceDocId: string;
  pageIndex: number;
  /** Top-left pixel coordinate within the scaled page */
  tileX: number;
  tileY: number;
  /** Output bitmap pixel dimensions */
  tileWidthPx: number;
  tileHeightPx: number;
  /** Pixels per PDF point (zoom * dpr) */
  scale: number;
  userRotation: RotationAngle;
  transparentBg?: boolean;
  theme?: ReadingTheme;
  darkPaperInvert?: boolean;
}
