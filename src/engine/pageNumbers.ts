import type { PageNumberingConfig, TextAlignOption } from '@/types/pdf';

export const DEFAULT_PAGE_NUMBERING_CONFIG: PageNumberingConfig = {
  enabled: false,
  position: 'bottom-center',
  format: 'number',
  fontFamily: 'Helvetica',
  fontSize: 10,
  color: '#334155',
  marginX: 36,
  marginY: 26,
  startFromPage: 1,
  startNumber: 1,
  opacity: 0.92,
};

const ROMAN_PAIRS: Array<[number, string]> = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

export function toRomanNumeral(num: number, upper = true): string {
  const n = Math.floor(num);
  if (!Number.isFinite(n) || n < 1 || n > 3999) {
    return String(num);
  }
  let rem = n;
  let out = '';
  for (const [val, sym] of ROMAN_PAIRS) {
    while (rem >= val) {
      out += sym;
      rem -= val;
    }
  }
  return upper ? out : out.toLowerCase();
}

export function formatPageNumberLabel(
  pageIndexZeroBased: number,
  totalPages: number,
  config: PageNumberingConfig,
): string | null {
  if (!config.enabled) return null;
  const oneBased = pageIndexZeroBased + 1;
  const startFrom = Math.max(1, Math.round(config.startFromPage || 1));
  if (oneBased < startFrom) return null;

  const startNum = Math.max(1, Math.round(config.startNumber || 1));
  const displayNum = startNum + (oneBased - startFrom);
  const displayTotal = Math.max(displayNum, totalPages - (startFrom - 1) + (startNum - 1));

  switch (config.format) {
    case 'number':
      return String(displayNum);
    case 'number-of-total':
      return `${displayNum} / ${displayTotal}`;
    case 'page-number':
      return `Sayfa ${displayNum}`;
    case 'page-number-of-total':
      return `Sayfa ${displayNum} / ${displayTotal}`;
    case 'roman-lower':
      return toRomanNumeral(displayNum, false);
    case 'roman-upper':
      return toRomanNumeral(displayNum, true);
    default:
      return String(displayNum);
  }
}

export interface PageNumberLayoutBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align: Exclude<TextAlignOption, 'justify'>;
}

export function computePageNumberLayout(
  pageWidth: number,
  pageHeight: number,
  pageIndexZeroBased: number,
  totalPages: number,
  config: PageNumberingConfig,
): PageNumberLayoutBox | null {
  const label = formatPageNumberLabel(pageIndexZeroBased, totalPages, config);
  if (!label) return null;

  const safeMarginX = Math.max(8, Math.min(pageWidth * 0.35, config.marginX || 36));
  const safeMarginY = Math.max(6, Math.min(pageHeight * 0.35, config.marginY || 26));
  const fs = Math.max(6, Math.min(72, config.fontSize || 10));

  const align: Exclude<TextAlignOption, 'justify'> = config.position.endsWith('-left')
    ? 'left'
    : config.position.endsWith('-right')
      ? 'right'
      : 'center';

  const isTop = config.position.startsWith('top-');
  const height = Number((fs * 1.35).toFixed(2));
  const y = isTop
    ? Math.max(4, Number((safeMarginY - fs * 0.25).toFixed(2)))
    : Math.max(4, Number((pageHeight - safeMarginY - fs * 0.95).toFixed(2)));

  const width = Math.max(40, Number((pageWidth - safeMarginX * 2).toFixed(2)));
  return {
    text: label,
    x: Number(safeMarginX.toFixed(2)),
    y,
    width,
    height,
    align,
  };
}
