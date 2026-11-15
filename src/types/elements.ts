import type {
  BuiltinFontFamilyOption,
  FontFamilyOption,
  FontSourceKind,
  RectBox,
  TextAlignOption,
  TextRun,
} from './pdf';

export type ElementKind =
  | 'text-edit'
  | 'text-add'
  | 'image'
  | 'image-replacement'
  | 'signature'
  | 'stroke'
  | 'highlight';

export type LayerTier = 1 | 2 | 3 | 4;

export interface BaseElement {
  id: string;
  pageId: string;
  kind: ElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  layerOverride?: LayerTier;
  locked?: boolean;
  isBackgroundLayer?: boolean;
}

export interface TextEditElement extends BaseElement {
  kind: 'text-edit';
  originalBlockId: string;
  originalRect: RectBox;
  originalText: string;
  text: string;
  runs?: TextRun[];
  fontFamily: FontFamilyOption;
  fallbackFontFamily?: BuiltinFontFamilyOption;
  fontSource?: FontSourceKind;
  rawFontName?: string;
  originalFontName?: string;
  isCustomFont?: boolean;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlignOption;
  lineHeight: number;
  baselineOffset?: number;
  horizontalScale?: number;
  letterSpacing?: number;
  renderedLineCount?: number;
  widthResizedByUser?: boolean;
  maskColor?: string;
  deleted?: boolean;
}

export interface TextAddElement extends BaseElement {
  kind: 'text-add';
  text: string;
  runs?: TextRun[];
  fontFamily: FontFamilyOption;
  fallbackFontFamily?: BuiltinFontFamilyOption;
  fontSource?: FontSourceKind;
  rawFontName?: string;
  originalFontName?: string;
  isCustomFont?: boolean;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: TextAlignOption;
  lineHeight: number;
  baselineOffset?: number;
  horizontalScale?: number;
  letterSpacing?: number;
  renderedLineCount?: number;
  widthResizedByUser?: boolean;
  backgroundColor?: string;
}

export interface ImageAddElement extends BaseElement {
  kind: 'image';
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectLocked: boolean;
  behindContent?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  repeatGroupId?: string;
  repeatScope?: 'all' | 'odd' | 'even';
}

export interface ImageReplacementElement extends BaseElement {
  kind: 'image-replacement';
  originalImageId: string;
  resourceName: string;
  originalRect: RectBox;
  name: string;
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Uint8Array;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectLocked: boolean;
  behindContent?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  repeatGroupId?: string;
  repeatScope?: 'all' | 'odd' | 'even';
  deleted?: boolean;
}

export interface SignatureVectorPath {
  d: string;
  strokeWidth: number;
  color: string;
  opacity?: number;
  fill?: boolean;
}

export type SignatureVariant = 'signature' | 'initials';

export interface SignatureElement extends BaseElement {
  kind: 'signature';
  signatureId: string;
  templateId?: string;
  variant?: SignatureVariant;
  label: string;
  pngBytes: Uint8Array;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectLocked: boolean;
  realisticInk?: boolean;
  svgPaths?: SignatureVectorPath[];
  viewBoxWidth?: number;
  viewBoxHeight?: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface StrokeElement extends BaseElement {
  kind: 'stroke';
  points: NormalizedPoint[];
  strokeColor: string;
  strokeWidth: number;
}

export interface HighlightElement extends BaseElement {
  kind: 'highlight';
  shape: 'highlight' | 'rect' | 'redact';
  fillColor: string;
  strokeColor?: string;
  strokeWidth?: number;
}

export type CanvasElement =
  | TextEditElement
  | TextAddElement
  | ImageAddElement
  | ImageReplacementElement
  | SignatureElement
  | StrokeElement
  | HighlightElement;

export type TextCanvasElement = TextEditElement | TextAddElement;
export type ImageCanvasElement = ImageAddElement | ImageReplacementElement;

export interface SavedSignature {
  id: string;
  templateId?: string;
  variant?: SignatureVariant;
  label: string;
  mode: 'draw' | 'type' | 'upload';
  createdAt: number;
  dataUrl: string;
  width: number;
  height: number;
  realisticInk?: boolean;
  svgPaths?: SignatureVectorPath[];
  viewBoxWidth?: number;
  viewBoxHeight?: number;
  typedText?: string;
  typedFont?: string;
  inkColor?: string;
}

/**
 * Deterministic Z-order layer tier:
 * Tier 1: Background/Header Images
 * Tier 2: Standard Images
 * Tier 3: Text Blocks
 * Tier 4: Annotations & Signatures
 */
export function getElementDefaultLayerTier(
  el: Pick<CanvasElement, 'kind'> & { behindContent?: boolean; isBackgroundLayer?: boolean },
): LayerTier {
  if (el.kind === 'image' || el.kind === 'image-replacement') {
    return el.behindContent || el.isBackgroundLayer ? 1 : 2;
  }
  if (el.kind === 'text-edit' || el.kind === 'text-add') {
    return 3;
  }
  return 4;
}

export function getElementLayerTier(el: CanvasElement): LayerTier {
  if (el.layerOverride) return el.layerOverride;
  return getElementDefaultLayerTier(el);
}
