import { buildUnicodeRangeFromCodePoints, registerDynamicFontFace } from './fontFaces';
import type { FontStyleVariant } from './fonts';
import type { ExtractedPdfFont } from '@/types/pdf';
import type { FontAssetPayload } from '@/types/worker';

export interface ExtractedFontBinaryRecord {
  meta: ExtractedPdfFont;
  variants: Partial<Record<FontStyleVariant, Uint8Array>>;
}

export const extractedFontRegistry = new Map<string, ExtractedFontBinaryRecord>();

/**
 * Registers usable extracted PDF fonts into CSS `document.fonts` so browser overlays
 * and inline editors render the original document typography verbatim.
 */
export async function registerExtractedPdfFontsInBrowser(
  fonts: ExtractedPdfFont[],
): Promise<void> {
  if (typeof document === 'undefined') return;
  for (const font of fonts) {
    const record = extractedFontRegistry.get(font.id);
    if (!record) continue;
    const unicodeRange =
      font.supportedCodePoints.length > 0 && font.supportedCodePoints.length < 1800
        ? buildUnicodeRangeFromCodePoints(font.supportedCodePoints)
        : undefined;
    const entries: Array<[FontStyleVariant, Uint8Array | undefined]> = [
      ['regular', record.variants.regular],
      ['bold', record.variants.bold],
      ['italic', record.variants.italic],
      ['boldItalic', record.variants.boldItalic],
    ];
    for (const [variant, bytes] of entries) {
      if (bytes) {
        await registerDynamicFontFace(font.cssFamily, bytes, variant, unicodeRange);
      }
    }
  }
}

export function populateExtractedFontRegistry(
  fonts: ExtractedPdfFont[],
  assets: FontAssetPayload[],
): void {
  const assetMap = new Map<string, FontAssetPayload>();
  for (const a of assets) {
    assetMap.set(a.family, a);
  }
  for (const font of fonts) {
    const asset = assetMap.get(font.id);
    if (!asset) continue;
    extractedFontRegistry.set(font.id, {
      meta: font,
      variants: {
        regular: asset.regular,
        bold: asset.bold,
        italic: asset.italic,
        boldItalic: asset.boldItalic,
      },
    });
  }
}

export function getExtractedFontAssetPayloads(fontIds?: string[]): FontAssetPayload[] {
  const out: FontAssetPayload[] = [];
  for (const [id, rec] of extractedFontRegistry.entries()) {
    if (fontIds && !fontIds.includes(id)) continue;
    out.push({
      family: id,
      regular: rec.variants.regular,
      bold: rec.variants.bold,
      italic: rec.variants.italic,
      boldItalic: rec.variants.boldItalic,
    });
  }
  return out;
}

export function clearExtractedFontsForDoc(sourceDocId: string): void {
  for (const [id] of extractedFontRegistry.entries()) {
    if (id.startsWith(`embedded:${sourceDocId}:`)) {
      extractedFontRegistry.delete(id);
    }
  }
}
