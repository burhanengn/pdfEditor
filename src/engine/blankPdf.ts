import { PDFDocument } from 'pdf-lib';

export type BlankPagePreset =
  | 'a4-portrait'
  | 'a4-landscape'
  | 'letter-portrait'
  | 'letter-landscape';

export interface BlankPagePresetSpec {
  id: BlankPagePreset;
  label: string;
  shortLabel: string;
  width: number;
  height: number;
}

export const BLANK_PAGE_PRESETS: Record<BlankPagePreset, BlankPagePresetSpec> = {
  'a4-portrait': {
    id: 'a4-portrait',
    label: 'A4 Dikey (595×842 pt)',
    shortLabel: 'A4 Dikey',
    width: 595,
    height: 842,
  },
  'a4-landscape': {
    id: 'a4-landscape',
    label: 'A4 Yatay (842×595 pt)',
    shortLabel: 'A4 Yatay',
    width: 842,
    height: 595,
  },
  'letter-portrait': {
    id: 'letter-portrait',
    label: 'Letter Dikey (612×792 pt)',
    shortLabel: 'Letter',
    width: 612,
    height: 792,
  },
  'letter-landscape': {
    id: 'letter-landscape',
    label: 'Letter Yatay (792×612 pt)',
    shortLabel: 'Letter Yatay',
    width: 792,
    height: 612,
  },
};

export interface GenerateBlankPdfOptions {
  preset?: BlankPagePreset;
  width?: number;
  height?: number;
  pageCount?: number;
}

/**
 * Creates a clean blank PDF byte buffer with one or more white pages of the chosen dimensions.
 */
export async function generateBlankPdfBytes(
  options: GenerateBlankPdfOptions = {},
): Promise<Uint8Array> {
  const presetSpec = BLANK_PAGE_PRESETS[options.preset ?? 'a4-portrait'];
  const width = Math.max(72, Math.round(options.width ?? presetSpec.width));
  const height = Math.max(72, Math.round(options.height ?? presetSpec.height));
  const pageCount = Math.max(1, Math.min(50, Math.round(options.pageCount ?? 1)));

  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([width, height]);
  }
  return doc.save();
}
