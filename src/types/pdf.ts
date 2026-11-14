export type RotationAngle = 0 | 90 | 180 | 270;

export type ToolMode =
  | 'select'
  | 'text'
  | 'image'
  | 'draw'
  | 'highlight'
  | 'signature'
  | 'organize';

export type ZoomMode = 'custom' | 'fit-width' | 'fit-page';

export type ThemeMode = 'dark' | 'light';

export type BuiltinFontFamilyOption =
  | 'Helvetica'
  | 'TimesRoman'
  | 'Courier'
  | 'Calibri'
  | 'Cambria'
  | 'Inter'
  | 'Merriweather'
  | 'JetBrainsMono'
  | 'DejaVuSans'
  | 'DejaVuSansCondensed'
  | 'DejaVuSerif'
  | 'DejaVuSerifCondensed'
  | 'DejaVuSansMono'
  | 'Georgia'
  | 'Verdana'
  | 'Garamond'
  | 'GreatVibes'
  | 'Caveat';

export type FontFamilyOption = BuiltinFontFamilyOption | (string & {});

export type FontSourceKind = 'builtin' | 'embedded' | 'user';

export interface FontVariantAvailability {
  regular: boolean;
  bold: boolean;
  italic: boolean;
  boldItalic: boolean;
}

export interface ExtractedPdfFont {
  id: string;
  sourceDocId: string;
  cleanName: string;
  displayName: string;
  baseKey: string;
  cssFamily: string;
  fallbackFamily: BuiltinFontFamilyOption;
  variants: FontVariantAvailability;
  supportedCodePoints: number[];
  unicodeUsable: boolean;
}

export interface UserCustomFont {
  id: string;
  name: string;
  baseKey: string;
  cssFamily: string;
  fallbackFamily: BuiltinFontFamilyOption;
  variants: FontVariantAvailability;
  supportedCodePoints: number[];
  fileNames: Partial<Record<'regular' | 'bold' | 'italic' | 'boldItalic', string>>;
  addedAt: number;
}

export type TextAlignOption = 'left' | 'center' | 'right' | 'justify';

export type TextScriptMode = 'normal' | 'super' | 'sub';

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  script?: TextScriptMode;
}

export interface SourceDocument {
  id: string;
  name: string;
  bytes: Uint8Array;
  wasEncrypted: boolean;
  pageCount: number;
}

export interface PageMeta {
  id: string;
  sourceDocId: string;
  sourcePageIndex: number;
  baseWidth: number;
  baseHeight: number;
  intrinsicRotation: RotationAngle;
  userRotation: RotationAngle;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
}

export interface RectBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedTextBlock {
  id: string;
  pageId: string;
  text: string;
  runs?: TextRun[];
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: FontFamilyOption;
  fallbackFontFamily?: BuiltinFontFamilyOption;
  fontSource?: FontSourceKind;
  rawFontName: string;
  originalFontName?: string;
  isCustomFont?: boolean;
  bold: boolean;
  italic: boolean;
  align?: TextAlignOption;
  color: string;
  lineHeight: number;
  baselineOffset: number;
  horizontalScale?: number;
  letterSpacing?: number;
  paragraphWidth?: number;
}

export interface DetectedImageObject {
  id: string;
  pageId: string;
  resourceName: string;
  operatorIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX?: boolean;
  flipY?: boolean;
  pixelWidth: number;
  pixelHeight: number;
  previewUrl: string;
  pngBytes: Uint8Array;
  behindContent?: boolean;
  isHeaderOrBackground?: boolean;
  opacity?: number;
}

export interface PageExtractionResult {
  textBlocks: DetectedTextBlock[];
  images: DetectedImageObject[];
  horizontalRules?: Array<{ y: number; x0: number; x1: number }>;
  verticalRules?: Array<{ x: number; y0: number; y1: number }>;
  cellRects?: RectBox[];
}

export type PageNumberingPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type PageNumberingFormat =
  | 'number'
  | 'number-of-total'
  | 'page-number'
  | 'page-number-of-total'
  | 'roman-lower'
  | 'roman-upper';

export interface PageNumberingConfig {
  enabled: boolean;
  position: PageNumberingPosition;
  format: PageNumberingFormat;
  fontFamily: FontFamilyOption;
  fontSize: number;
  color: string;
  marginX: number;
  marginY: number;
  startFromPage: number;
  startNumber: number;
  opacity: number;
}

export interface SnapGuide {
  orientation: 'vertical' | 'horizontal';
  position: number;
  start: number;
  end: number;
}
