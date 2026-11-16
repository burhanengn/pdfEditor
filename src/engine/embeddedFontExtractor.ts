import {
  clearExtractedFontsForDoc,
  extractedFontRegistry,
  getExtractedFontAssetPayloads,
  populateExtractedFontRegistry,
  registerExtractedPdfFontsInBrowser,
} from './extractedFontRegistry';
import { ensureRustCoreReady } from './rustCoreBridge';
import type { BuiltinFontFamilyOption, ExtractedPdfFont } from '@/types/pdf';
import type { FontAssetPayload } from '@/types/worker';

export {
  clearExtractedFontsForDoc,
  getExtractedFontAssetPayloads,
  populateExtractedFontRegistry,
  registerExtractedPdfFontsInBrowser,
};

interface RustFontAsset {
  family: string;
  regular?: number[] | Uint8Array;
  bold?: number[] | Uint8Array;
  italic?: number[] | Uint8Array;
  boldItalic?: number[] | Uint8Array;
}

interface RustExtractedFontsBundle {
  fonts: Array<{
    id: string;
    sourceDocId: string;
    cleanName: string;
    displayName: string;
    baseKey: string;
    cssFamily: string;
    fallbackFamily: BuiltinFontFamilyOption;
    variants: {
      regular: boolean;
      bold: boolean;
      italic: boolean;
      boldItalic: boolean;
    };
    supportedCodePoints: number[];
    unicodeUsable: boolean;
  }>;
  assets: RustFontAsset[];
}

function toUint8(data?: number[] | Uint8Array): Uint8Array | undefined {
  if (!data) return undefined;
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Extracts embedded TrueType `/FontFile2` font streams from PDF bytes via Rust `gp-redact` + `ttf-parser`
 * (zero `@pdf-lib/fontkit` or `pdf-lib` dependency), populating the shared font registry.
 */
export async function extractEmbeddedFontsFromPdfBytes(
  sourceDocId: string,
  pdfBytes: Uint8Array,
): Promise<ExtractedPdfFont[]> {
  clearExtractedFontsForDoc(sourceDocId);
  const wasm = await ensureRustCoreReady();
  const bundle = wasm.extract_embedded_fonts_from_pdf(
    sourceDocId,
    pdfBytes,
  ) as RustExtractedFontsBundle;

  const fonts: ExtractedPdfFont[] = bundle.fonts.map((f) => ({
    id: f.id,
    sourceDocId: f.sourceDocId,
    cleanName: f.cleanName,
    displayName: f.displayName,
    baseKey: f.baseKey,
    cssFamily: f.cssFamily,
    fallbackFamily: f.fallbackFamily,
    variants: f.variants,
    supportedCodePoints: Array.from(f.supportedCodePoints),
    unicodeUsable: f.unicodeUsable,
  }));

  const assets: FontAssetPayload[] = bundle.assets.map((a) => ({
    family: a.family,
    regular: toUint8(a.regular),
    bold: toUint8(a.bold),
    italic: toUint8(a.italic),
    boldItalic: toUint8(a.boldItalic),
  }));

  populateExtractedFontRegistry(fonts, assets);
  if (typeof document !== 'undefined') {
    await registerExtractedPdfFontsInBrowser(fonts);
  }
  return fonts;
}

export { extractedFontRegistry };
