import type { StandardFonts } from 'pdf-lib';

const STD_FONT = {
  Courier: 'Courier' as StandardFonts,
  CourierBold: 'Courier-Bold' as StandardFonts,
  CourierOblique: 'Courier-Oblique' as StandardFonts,
  CourierBoldOblique: 'Courier-BoldOblique' as StandardFonts,
  Helvetica: 'Helvetica' as StandardFonts,
  HelveticaBold: 'Helvetica-Bold' as StandardFonts,
  HelveticaOblique: 'Helvetica-Oblique' as StandardFonts,
  HelveticaBoldOblique: 'Helvetica-BoldOblique' as StandardFonts,
  TimesRoman: 'Times-Roman' as StandardFonts,
  TimesRomanBold: 'Times-Bold' as StandardFonts,
  TimesRomanItalic: 'Times-Italic' as StandardFonts,
  TimesRomanBoldItalic: 'Times-BoldItalic' as StandardFonts,
};
import type {
  BuiltinFontFamilyOption,
  ExtractedPdfFont,
  FontFamilyOption,
  FontSourceKind,
  UserCustomFont,
} from '@/types/pdf';

export type FontCategory = 'sans' | 'serif' | 'mono' | 'calibri' | 'cambria' | 'script';
export type FontStyleVariant = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface FontDefinition {
  id: BuiltinFontFamilyOption;
  label: string;
  cssFamily: string;
  category: FontCategory;
  pdfStandard: {
    regular: StandardFonts;
    bold: StandardFonts;
    italic: StandardFonts;
    boldItalic: StandardFonts;
  };
}

export const FONT_REGISTRY: Record<BuiltinFontFamilyOption, FontDefinition> = {
  Helvetica: {
    id: 'Helvetica',
    label: 'Helvetica / Arial',
    cssFamily: 'Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif',
    category: 'sans',
    pdfStandard: {
      regular: STD_FONT.Helvetica,
      bold: STD_FONT.HelveticaBold,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
  Calibri: {
    id: 'Calibri',
    label: 'Calibri (Carlito)',
    cssFamily: 'Calibri, "Carlito", "Segoe UI", Arial, "Liberation Sans", sans-serif',
    category: 'calibri',
    pdfStandard: {
      regular: STD_FONT.Helvetica,
      bold: STD_FONT.HelveticaBold,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
  Inter: {
    id: 'Inter',
    label: 'Inter / Modern Sans',
    cssFamily: 'Inter, "Segoe UI", "Carlito", "Liberation Sans", system-ui, Arial, sans-serif',
    category: 'sans',
    pdfStandard: {
      regular: STD_FONT.Helvetica,
      bold: STD_FONT.HelveticaBold,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
  DejaVuSans: {
    id: 'DejaVuSans',
    label: 'DejaVu Sans',
    cssFamily: '"DejaVu Sans", "Liberation Sans", Arial, sans-serif',
    category: 'sans',
    pdfStandard: {
      regular: STD_FONT.Helvetica,
      bold: STD_FONT.HelveticaBold,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
  DejaVuSansCondensed: {
    id: 'DejaVuSansCondensed',
    label: 'DejaVu Sans Condensed',
    cssFamily: '"DejaVu Sans Condensed", "DejaVu Sans", "Liberation Sans", sans-serif',
    category: 'sans',
    pdfStandard: {
      regular: STD_FONT.Helvetica,
      bold: STD_FONT.HelveticaBold,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
  Verdana: {
    id: 'Verdana',
    label: 'Verdana / Tahoma (Sans)',
    cssFamily: 'Verdana, Tahoma, "DejaVu Sans", "Liberation Sans", sans-serif',
    category: 'sans',
    pdfStandard: {
      regular: STD_FONT.Helvetica,
      bold: STD_FONT.HelveticaBold,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
  TimesRoman: {
    id: 'TimesRoman',
    label: 'Times New Roman',
    cssFamily: '"Times New Roman", "Liberation Serif", Times, Georgia, serif',
    category: 'serif',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  Cambria: {
    id: 'Cambria',
    label: 'Cambria (Caladea)',
    cssFamily: 'Cambria, "Caladea", Georgia, "Liberation Serif", "Times New Roman", serif',
    category: 'cambria',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  Merriweather: {
    id: 'Merriweather',
    label: 'Merriweather (Serif)',
    cssFamily: 'Merriweather, Georgia, "Caladea", "Liberation Serif", "Times New Roman", serif',
    category: 'serif',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  Georgia: {
    id: 'Georgia',
    label: 'Georgia (Serif)',
    cssFamily: 'Georgia, "Caladea", "Liberation Serif", "Times New Roman", serif',
    category: 'serif',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  Garamond: {
    id: 'Garamond',
    label: 'Garamond / Palatino',
    cssFamily: 'Garamond, Palatino, "Palatino Linotype", "Liberation Serif", Georgia, serif',
    category: 'serif',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  DejaVuSerif: {
    id: 'DejaVuSerif',
    label: 'DejaVu Serif',
    cssFamily: '"DejaVu Serif", "Liberation Serif", Georgia, serif',
    category: 'serif',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  DejaVuSerifCondensed: {
    id: 'DejaVuSerifCondensed',
    label: 'DejaVu Serif Condensed',
    cssFamily: '"DejaVu Serif Condensed", "DejaVu Serif", "Liberation Serif", serif',
    category: 'serif',
    pdfStandard: {
      regular: STD_FONT.TimesRoman,
      bold: STD_FONT.TimesRomanBold,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  Courier: {
    id: 'Courier',
    label: 'Courier New',
    cssFamily: '"Courier New", "Liberation Mono", "DejaVu Sans Mono", Courier, monospace',
    category: 'mono',
    pdfStandard: {
      regular: STD_FONT.Courier,
      bold: STD_FONT.CourierBold,
      italic: STD_FONT.CourierOblique,
      boldItalic: STD_FONT.CourierBoldOblique,
    },
  },
  JetBrainsMono: {
    id: 'JetBrainsMono',
    label: 'JetBrains Mono',
    cssFamily: '"JetBrains Mono", Consolas, "Liberation Mono", "Courier New", monospace',
    category: 'mono',
    pdfStandard: {
      regular: STD_FONT.Courier,
      bold: STD_FONT.CourierBold,
      italic: STD_FONT.CourierOblique,
      boldItalic: STD_FONT.CourierBoldOblique,
    },
  },
  DejaVuSansMono: {
    id: 'DejaVuSansMono',
    label: 'DejaVu Sans Mono',
    cssFamily: '"DejaVu Sans Mono", "Liberation Mono", Consolas, monospace',
    category: 'mono',
    pdfStandard: {
      regular: STD_FONT.Courier,
      bold: STD_FONT.CourierBold,
      italic: STD_FONT.CourierOblique,
      boldItalic: STD_FONT.CourierBoldOblique,
    },
  },
  GreatVibes: {
    id: 'GreatVibes',
    label: 'Great Vibes (Script)',
    cssFamily: '"Segoe Script", "Brush Script MT", "Apple Chancery", "Liberation Serif", cursive',
    category: 'script',
    pdfStandard: {
      regular: STD_FONT.TimesRomanItalic,
      bold: STD_FONT.TimesRomanBoldItalic,
      italic: STD_FONT.TimesRomanItalic,
      boldItalic: STD_FONT.TimesRomanBoldItalic,
    },
  },
  Caveat: {
    id: 'Caveat',
    label: 'Caveat (Hand)',
    cssFamily: '"Comic Sans MS", "Segoe Print", "Bradley Hand", "Carlito", cursive',
    category: 'script',
    pdfStandard: {
      regular: STD_FONT.HelveticaOblique,
      bold: STD_FONT.HelveticaBoldOblique,
      italic: STD_FONT.HelveticaOblique,
      boldItalic: STD_FONT.HelveticaBoldOblique,
    },
  },
};

export function isBuiltinFontFamily(family: string): family is BuiltinFontFamilyOption {
  return Object.prototype.hasOwnProperty.call(FONT_REGISTRY, family);
}

export function getBuiltinFontDefinition(
  family: FontFamilyOption,
  fallback?: BuiltinFontFamilyOption,
): FontDefinition {
  if (isBuiltinFontFamily(family)) {
    return FONT_REGISTRY[family];
  }
  if (fallback && isBuiltinFontFamily(fallback)) {
    return FONT_REGISTRY[fallback];
  }
  return FONT_REGISTRY.Helvetica;
}

export function getFontCategory(
  family: FontFamilyOption,
  fallback?: BuiltinFontFamilyOption,
): FontCategory {
  return getBuiltinFontDefinition(family, fallback).category;
}

export const FONT_OPTIONS: FontDefinition[] = Object.values(FONT_REGISTRY);

export function getStandardPdfFont(
  family: FontFamilyOption,
  bold: boolean,
  italic: boolean,
  fallback?: BuiltinFontFamilyOption,
): StandardFonts {
  const def = getBuiltinFontDefinition(family, fallback);
  if (bold && italic) return def.pdfStandard.boldItalic;
  if (bold) return def.pdfStandard.bold;
  if (italic) return def.pdfStandard.italic;
  return def.pdfStandard.regular;
}

const SUFFIX_STRIP_RE =
  /[-_,.\s]*(?:bold\s*italic|bold\s*oblique|semi\s*bold|demi\s*bold|extra\s*bold|ultra\s*bold|extra\s*light|ultra\s*light|regular|normal|book|roman|italic|oblique|slant|bold|black|heavy|medium|light|thin|semibold|demibold|extrabold|condensed|expanded|narrow|extended|mt|ps|std|pro|lt|bd|bi|it|rg)$/i;

export function normalizeFontMatchKey(rawName: string): {
  cleanName: string;
  exactKey: string;
  baseKey: string;
  bold: boolean;
  italic: boolean;
  variant: FontStyleVariant;
} {
  const cleanName = rawName
    .replace(/\.(ttf|otf|woff2?)$/i, '')
    .replace(/^[A-Z]{6}\+/, '')
    .trim();
  const lower = cleanName.toLowerCase();

  const bold =
    lower.includes('bold') ||
    lower.includes('black') ||
    lower.includes('heavy') ||
    lower.includes('semibold') ||
    lower.includes('demi') ||
    lower.includes('extrabold') ||
    /[-_,](bd|b|bi)\b/.test(lower);

  const italic =
    lower.includes('italic') ||
    lower.includes('oblique') ||
    lower.includes('slant') ||
    /[-_,](it|i|ob|bi)\b/.test(lower);

  const variant: FontStyleVariant =
    bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';

  let base = cleanName;
  for (let pass = 0; pass < 4; pass++) {
    const next = base.replace(SUFFIX_STRIP_RE, '').trim();
    if (!next || next === base) break;
    base = next;
  }

  return {
    cleanName: cleanName || 'Custom Font',
    exactKey: lower.replace(/[^a-z0-9]/g, ''),
    baseKey: base.toLowerCase().replace(/[^a-z0-9]/g, '') || lower.replace(/[^a-z0-9]/g, ''),
    bold,
    italic,
    variant,
  };
}

export function findMatchingFontByKey<
  T extends { baseKey: string; cleanName?: string; name?: string },
>(rawOrCleanFontName: string | undefined, candidates: T[]): T | undefined {
  if (!rawOrCleanFontName || candidates.length === 0) return undefined;
  const parsed = normalizeFontMatchKey(rawOrCleanFontName);
  if (!parsed.baseKey && !parsed.exactKey) return undefined;

  // 1. Exact key match against cleanName / name
  for (const c of candidates) {
    const candExact = normalizeFontMatchKey(c.cleanName ?? c.name ?? c.baseKey).exactKey;
    if (candExact && candExact === parsed.exactKey) return c;
  }

  // 2. Normalized family base key match (e.g. "ABCDEF+Montserrat-SemiBold" <-> "Montserrat")
  for (const c of candidates) {
    if (c.baseKey && c.baseKey === parsed.baseKey) return c;
  }

  return undefined;
}

export function collectUnsupportedChars(
  text: string,
  supportedCodePoints?: Set<number> | number[] | null,
): string[] {
  if (!supportedCodePoints) return [];
  const cpSet = Array.isArray(supportedCodePoints) ? new Set(supportedCodePoints) : supportedCodePoints;
  if (cpSet.size === 0) return [];
  const normalized = normalizeUnicodeForPdf(text);
  const missing = new Set<string>();
  for (const ch of normalized) {
    if (ch === '\n' || ch === '\r' || ch === '\t' || ch === ' ') continue;
    const cp = ch.codePointAt(0);
    if (cp !== undefined && !cpSet.has(cp)) {
      missing.add(ch);
    }
  }
  return [...missing];
}

export interface ParsedPdfFontInfo {
  fontFamily: BuiltinFontFamilyOption;
  bold: boolean;
  italic: boolean;
  cleanFontName: string;
  isCustomFont: boolean;
  matchedLabel: string;
  estimatedHorizontalScale: number;
}

const EXACT_OR_METRIC_EQUIV_RE =
  /^(?:helvetica|arial|arimo|liberation[-_\s]?sans|calibri|carlito|cambria|caladea|times(?:[-_\s]?(?:new[-_\s]?roman|roman|ps))?|tinos|liberation[-_\s]?serif|courier(?:[-_\s]?(?:new|ps))?|cousine|liberation[-_\s]?mono|dejavu[-_\s]?sans(?:[-_\s]?(?:condensed|mono))?|dejavu[-_\s]?serif(?:[-_\s]?condensed)?|inter|merriweather|jetbrains[-_\s]?mono)(?:$|[-_,.\s])/i;

export function parsePdfFontMetadata(
  rawFontName: string,
  flags?: { isSerif?: boolean; isMono?: boolean; isBold?: boolean; isItalic?: boolean },
): ParsedPdfFontInfo {
  const norm = normalizeFontMatchKey(rawFontName);
  const cleanFontName = rawFontName.replace(/^[A-Z]{6}\+/, '').trim();
  const lower = cleanFontName.toLowerCase();

  const bold = Boolean(flags?.isBold) || norm.bold;
  const italic = Boolean(flags?.isItalic) || norm.italic;

  const isCondensed =
    lower.includes('condensed') ||
    lower.includes('narrow') ||
    lower.includes('compressed') ||
    /[-_,](cn|cond)\b/.test(lower);

  const isExpanded = lower.includes('expanded') || lower.includes('extended');

  let fontFamily: BuiltinFontFamilyOption = 'Helvetica';
  if (lower.includes('dejavu') && lower.includes('mono')) {
    fontFamily = 'DejaVuSansMono';
  } else if (lower.includes('dejavu') && lower.includes('sans') && lower.includes('cond')) {
    fontFamily = 'DejaVuSansCondensed';
  } else if (lower.includes('dejavu') && lower.includes('sans')) {
    fontFamily = 'DejaVuSans';
  } else if (lower.includes('dejavu') && lower.includes('serif') && lower.includes('cond')) {
    fontFamily = 'DejaVuSerifCondensed';
  } else if (lower.includes('dejavu') && lower.includes('serif')) {
    fontFamily = 'DejaVuSerif';
  } else if (
    flags?.isMono ||
    lower.includes('courier') ||
    lower.includes('mono') ||
    lower.includes('consolas') ||
    lower.includes('cousine') ||
    lower.includes('firacode') ||
    lower.includes('inconsolata') ||
    lower.includes('menlo') ||
    lower.includes('monaco') ||
    lower.includes('code')
  ) {
    fontFamily = lower.includes('jetbrains') || lower.includes('fira') ? 'JetBrainsMono' : 'Courier';
  } else if (lower.includes('calibri') || lower.includes('carlito')) {
    fontFamily = 'Calibri';
  } else if (lower.includes('cambria') || lower.includes('caladea')) {
    fontFamily = 'Cambria';
  } else if (lower.includes('merriweather')) {
    fontFamily = 'Merriweather';
  } else if (lower.includes('georgia')) {
    fontFamily = 'Georgia';
  } else if (lower.includes('garamond') || lower.includes('palatino')) {
    fontFamily = 'Garamond';
  } else if (lower.includes('verdana') || lower.includes('tahoma')) {
    fontFamily = 'Verdana';
  } else if (lower.includes('inter') || lower.includes('roboto') || lower.includes('opensans') || lower.includes('open sans') || lower.includes('lato') || lower.includes('montserrat')) {
    fontFamily = 'Inter';
  } else if (
    lower.includes('sans-serif') ||
    lower.includes('sansserif') ||
    lower.includes('sans') ||
    lower.includes('helvetica') ||
    lower.includes('arial') ||
    lower.includes('arimo') ||
    lower.includes('liberationsans') ||
    lower.includes('liberation-sans') ||
    lower.includes('nimbussan') ||
    lower.includes('segoe') ||
    lower.includes('frutiger') ||
    lower.includes('myriad') ||
    lower.includes('futura') ||
    lower.includes('avenir') ||
    lower.includes('proxima')
  ) {
    fontFamily = 'Helvetica';
  } else if (
    flags?.isSerif ||
    lower.includes('times') ||
    lower.includes('tinos') ||
    lower.includes('liberationserif') ||
    lower.includes('liberation-serif') ||
    lower.includes('nimbusrom') ||
    lower.includes('serif') ||
    lower.includes('baskerville') ||
    lower.includes('minion') ||
    lower.includes('playfair') ||
    lower.includes('century') ||
    lower.includes('book') ||
    lower.includes('roman')
  ) {
    fontFamily = 'TimesRoman';
  } else if (lower.includes('script') || lower.includes('brush') || lower.includes('chancery')) {
    fontFamily = 'GreatVibes';
  } else if (lower.includes('hand') || lower.includes('comic') || lower.includes('caveat')) {
    fontFamily = 'Caveat';
  }

  // Strip common PDF Standard / Font weight suffixes to check if font is a standard/metric match
  const baseToken = cleanFontName
    .replace(
      /[-_,.\s]+(mt|ps|std|pro|lt|regular|bold|italic|oblique|bolditalic|boldoblique|semibold|medium|light|bd|it|bi)+$/gi,
      '',
    )
    .trim();
  const isGenericInternalId = /^g_d\d+_f\d+$|^f\d+$/i.test(cleanFontName);
  const isMetricMatched =
    !isGenericInternalId &&
    (EXACT_OR_METRIC_EQUIV_RE.test(cleanFontName) || EXACT_OR_METRIC_EQUIV_RE.test(baseToken));
  const isCustomFont = cleanFontName.length > 0 && !isMetricMatched;

  return {
    fontFamily,
    bold,
    italic,
    cleanFontName: cleanFontName || 'Embedded Font',
    isCustomFont,
    matchedLabel: (FONT_REGISTRY[fontFamily] ?? FONT_REGISTRY.Helvetica).label,
    estimatedHorizontalScale: isCondensed ? 0.85 : isExpanded ? 1.15 : 1,
  };
}

export function inferFontFromPdfName(rawFontName: string): {
  fontFamily: BuiltinFontFamilyOption;
  bold: boolean;
  italic: boolean;
} {
  const parsed = parsePdfFontMetadata(rawFontName);
  return {
    fontFamily: parsed.fontFamily,
    bold: parsed.bold,
    italic: parsed.italic,
  };
}

export function normalizeUnicodeForPdf(text: string): string {
  const turkishComposed = text
    .replace(/I\u0307/g, '\u0130')
    .replace(/i\u0307/g, 'i');
  return typeof turkishComposed.normalize === 'function'
    ? turkishComposed.normalize('NFC')
    : turkishComposed;
}

const WINANSI_SAFE_REPLACEMENTS: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2013': '-',
  '\u2014': '--',
  '\u2026': '...',
  '\u2212': '-',
  '\u00A0': ' ',
  '\u2713': '[v]',
  '\u2714': '[v]',
  '\u2717': '[x]',
  '\u2192': '->',
  '\u2190': '<-',
};

/**
 * Replaces characters outside WinAnsi with safe ASCII/WinAnsi equivalents
 * when falling back to Standard14 PDF fonts so serialization never crashes.
 */
export function sanitizeForWinAnsi(text: string): string {
  const normalized = normalizeUnicodeForPdf(text);
  let out = '';
  for (const ch of normalized) {
    if (WINANSI_SAFE_REPLACEMENTS[ch]) {
      out += WINANSI_SAFE_REPLACEMENTS[ch];
      continue;
    }
    const code = ch.charCodeAt(0);
    // WinAnsi printable ASCII + Latin-1 subset + common CP1252 punctuation
    if (
      ch === '\n' ||
      ch === '\r' ||
      ch === '\t' ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0xa0 && code <= 0xff) ||
      code === 0x20ac || // €
      code === 0x2022 || // •
      code === 0x2122 // ™
    ) {
      out += ch;
    } else {
      out += '?';
    }
  }
  return out;
}

/**
 * Preserves full Unicode text (including Turkish, Cyrillic, Greek, symbols) when an
 * embedded TrueType font supports the glyphs; only sanitizes missing code points.
 */
export function filterTextForPdfFont(
  text: string,
  supportedCodePoints: Set<number> | null,
): string {
  if (!supportedCodePoints) {
    return sanitizeForWinAnsi(text);
  }
  const normalized = normalizeUnicodeForPdf(text);
  let out = '';
  for (const ch of normalized) {
    if (ch === '\n' || ch === '\r' || ch === '\t') {
      out += ch;
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp !== undefined && supportedCodePoints.has(cp)) {
      out += ch;
    } else if (WINANSI_SAFE_REPLACEMENTS[ch]) {
      out += WINANSI_SAFE_REPLACEMENTS[ch];
    } else {
      out += ' ';
    }
  }
  return out;
}

export interface FontResolutionResult {
  fontFamily: FontFamilyOption;
  fallbackFontFamily: BuiltinFontFamilyOption;
  fontSource: FontSourceKind;
  isCustomFont: boolean;
}

export function resolveBlockFontAssignment(params: {
  rawFontName?: string;
  originalFontName?: string;
  currentFontFamily: FontFamilyOption;
  currentFallback?: BuiltinFontFamilyOption;
  isCustomFont?: boolean;
  sourceDocId?: string;
  userFonts: UserCustomFont[];
  extractedFonts: ExtractedPdfFont[];
}): FontResolutionResult {
  const nameHint = params.originalFontName || params.rawFontName;
  const fallback: BuiltinFontFamilyOption =
    params.currentFallback ??
    (isBuiltinFontFamily(params.currentFontFamily)
      ? params.currentFontFamily
      : parsePdfFontMetadata(nameHint ?? '').fontFamily);

  // If user already picked a specific user uploaded font, keep it unless missing
  if (params.currentFontFamily.startsWith('user:')) {
    const existing = params.userFonts.find((f) => f.id === params.currentFontFamily);
    if (existing) {
      return {
        fontFamily: existing.id,
        fallbackFontFamily: existing.fallbackFamily,
        fontSource: 'user',
        isCustomFont: true,
      };
    }
  }

  // Match newly/previously uploaded user font by exact or normalized base family name
  const userMatch = findMatchingFontByKey(nameHint, params.userFonts);
  if (userMatch && (params.isCustomFont || params.currentFontFamily.startsWith('embedded:') || params.userFonts.some((u) => u.id === userMatch.id))) {
    // Only auto-override built-in non-custom fonts if user explicitly uploaded an exact family match
    // OR the PDF block uses a custom font
    const hintKey = normalizeFontMatchKey(nameHint ?? '');
    const exactOrCustom = params.isCustomFont || hintKey.baseKey === userMatch.baseKey;
    if (exactOrCustom) {
      return {
        fontFamily: userMatch.id,
        fallbackFontFamily: userMatch.fallbackFamily,
        fontSource: 'user',
        isCustomFont: true,
      };
    }
  }

  // Else check usable extracted embedded PDF font for the same document (or cleanName match)
  if (params.isCustomFont || params.currentFontFamily.startsWith('embedded:')) {
    const docExtracted = params.sourceDocId
      ? params.extractedFonts.filter((f) => f.sourceDocId === params.sourceDocId && f.unicodeUsable)
      : params.extractedFonts.filter((f) => f.unicodeUsable);
    const embMatch =
      (params.currentFontFamily.startsWith('embedded:')
        ? params.extractedFonts.find((f) => f.id === params.currentFontFamily)
        : undefined) ?? findMatchingFontByKey(nameHint, docExtracted);
    if (embMatch) {
      return {
        fontFamily: embMatch.id,
        fallbackFontFamily: embMatch.fallbackFamily,
        fontSource: 'embedded',
        isCustomFont: true,
      };
    }
    return {
      fontFamily: fallback,
      fallbackFontFamily: fallback,
      fontSource: 'builtin',
      isCustomFont: true,
    };
  }

  return {
    fontFamily: isBuiltinFontFamily(params.currentFontFamily) ? params.currentFontFamily : fallback,
    fallbackFontFamily: fallback,
    fontSource: 'builtin',
    isCustomFont: false,
  };
}

export interface FontDisplayStatus {
  cssFamily: string;
  label: string;
  fallbackLabel: string;
  fallbackFamily: BuiltinFontFamilyOption;
  status: 'builtin' | 'user-complete' | 'user-partial' | 'embedded-complete' | 'embedded-partial' | 'fallback';
  missingChars: string[];
}

export function resolveFontDisplayStatus(params: {
  fontFamily: FontFamilyOption;
  fallbackFontFamily?: BuiltinFontFamilyOption;
  originalFontName?: string;
  isCustomFont?: boolean;
  text: string;
  userFonts: UserCustomFont[];
  extractedFonts: ExtractedPdfFont[];
}): FontDisplayStatus {
  const fallbackFamily: BuiltinFontFamilyOption =
    params.fallbackFontFamily ??
    (isBuiltinFontFamily(params.fontFamily)
      ? params.fontFamily
      : parsePdfFontMetadata(params.originalFontName ?? '').fontFamily);
  const fallbackDef = FONT_REGISTRY[fallbackFamily] ?? FONT_REGISTRY.Helvetica;

  if (params.fontFamily.startsWith('user:')) {
    const u = params.userFonts.find((f) => f.id === params.fontFamily);
    if (u) {
      const missing = collectUnsupportedChars(params.text, u.supportedCodePoints);
      return {
        cssFamily: `"${u.cssFamily}", ${fallbackDef.cssFamily}`,
        label: u.name,
        fallbackLabel: fallbackDef.label,
        fallbackFamily,
        status: missing.length > 0 ? 'user-partial' : 'user-complete',
        missingChars: missing,
      };
    }
  }

  if (params.fontFamily.startsWith('embedded:')) {
    const e = params.extractedFonts.find((f) => f.id === params.fontFamily);
    if (e) {
      const missing = collectUnsupportedChars(params.text, e.supportedCodePoints);
      return {
        cssFamily: `"${e.cssFamily}", ${fallbackDef.cssFamily}`,
        label: e.displayName,
        fallbackLabel: fallbackDef.label,
        fallbackFamily,
        status: missing.length > 0 ? 'embedded-partial' : 'embedded-complete',
        missingChars: missing,
      };
    }
  }

  if (isBuiltinFontFamily(params.fontFamily)) {
    const def = FONT_REGISTRY[params.fontFamily];
    return {
      cssFamily: def.cssFamily,
      label: def.label,
      fallbackLabel: def.label,
      fallbackFamily: def.id,
      status: params.isCustomFont ? 'fallback' : 'builtin',
      missingChars: [],
    };
  }

  return {
    cssFamily: fallbackDef.cssFamily,
    label: fallbackDef.label,
    fallbackLabel: fallbackDef.label,
    fallbackFamily,
    status: 'fallback',
    missingChars: [],
  };
}

export interface DomTextCalibration {
  ascentRatio: number;
  cssBaselineFromTopPt: number;
  topOffsetPt: number;
  letterSpacingPt: number;
  horizontalScale: number;
}

let cachedCalibrationCtx: CanvasRenderingContext2D | null | undefined;

function getCalibrationContext(): CanvasRenderingContext2D | null {
  if (cachedCalibrationCtx !== undefined) {
    return cachedCalibrationCtx;
  }
  if (typeof document === 'undefined') {
    cachedCalibrationCtx = null;
    return null;
  }
  try {
    const canvas = document.createElement('canvas');
    cachedCalibrationCtx = canvas.getContext('2d');
  } catch {
    cachedCalibrationCtx = null;
  }
  return cachedCalibrationCtx;
}

function getFallbackAscentRatio(fontFamily: string): number {
  const familyKey = fontFamily;
  const reg = isBuiltinFontFamily(familyKey) ? FONT_REGISTRY[familyKey] : undefined;
  const haystack = `${reg?.cssFamily ?? ''} ${familyKey}`.toLowerCase();
  if (/courier|mono/.test(haystack)) return 0.8;
  if (/times|serif|georgia|caladea|cambria/.test(haystack)) return 0.825;
  return 0.815;
}

function resolveCssStackForCalibration(fontFamily: string, explicitCssFamily?: string): string {
  if (explicitCssFamily) return explicitCssFamily;
  if (isBuiltinFontFamily(fontFamily)) {
    return FONT_REGISTRY[fontFamily].cssFamily;
  }
  const fallback = getFallbackAscentRatio(fontFamily);
  if (fallback === 0.8) return FONT_REGISTRY.Courier.cssFamily;
  if (fallback === 0.825) return FONT_REGISTRY.TimesRoman.cssFamily;
  return FONT_REGISTRY.Helvetica.cssFamily;
}

/**
 * Calibrates DOM baseline alignment and sub-pixel advance width against extracted PDF glyph bounds.
 */
export function calibrateDomTextMetrics(params: {
  sampleText: string;
  targetPdfWidthPt: number;
  fontSizePt: number;
  lineHeight: number;
  baselineOffsetPt?: number;
  fontFamily: string;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  initialHorizontalScale?: number;
  cssFontFamily?: string;
}): DomTextCalibration {
  const safeFontSize = Math.max(1, params.fontSizePt);
  const safeLineHeight = Math.max(0.8, params.lineHeight || 1.2);
  let ascentRatio = getFallbackAscentRatio(params.fontFamily);
  const cssFamily = resolveCssStackForCalibration(params.fontFamily, params.cssFontFamily);
  const ctx = getCalibrationContext();

  if (ctx) {
    ctx.font = `${params.fontStyle} ${params.fontWeight} 100px ${cssFamily}`;
    try {
      const m = ctx.measureText('HgÁğŞİp');
      if (
        typeof m.fontBoundingBoxAscent === 'number' &&
        typeof m.fontBoundingBoxDescent === 'number' &&
        m.fontBoundingBoxAscent + Math.abs(m.fontBoundingBoxDescent) > 0
      ) {
        const ratio =
          m.fontBoundingBoxAscent /
          (m.fontBoundingBoxAscent + Math.abs(m.fontBoundingBoxDescent));
        ascentRatio = Math.min(0.88, Math.max(0.74, Number(ratio.toFixed(4))));
      }
    } catch {
      // ignore if canvas text metrics partially supported
    }
  }

  const cssBaselineFromTopPt = safeFontSize * ((safeLineHeight - 1) * 0.5 + ascentRatio);
  const topOffsetPt =
    params.baselineOffsetPt !== undefined
      ? params.baselineOffsetPt - cssBaselineFromTopPt
      : -Math.max(0, (safeLineHeight - 1) * 0.35) * safeFontSize;

  let letterSpacingPt = 0;
  let horizontalScale = params.initialHorizontalScale ?? 1;

  if (ctx && params.sampleText.length > 1 && params.targetPdfWidthPt > 1) {
    try {
      const measuredPx = ctx.measureText(params.sampleText).width;
      const domWidthPt = (measuredPx / 100) * safeFontSize;
      if (domWidthPt > 1) {
        const ratio = params.targetPdfWidthPt / domWidthPt;
        if (Math.abs(ratio - 1) <= 0.06) {
          const rawSpacing = (params.targetPdfWidthPt - domWidthPt) / (params.sampleText.length - 1);
          letterSpacingPt = Math.min(1.2, Math.max(-0.45, Number(rawSpacing.toFixed(3))));
          horizontalScale = params.initialHorizontalScale ?? 1;
        } else {
          letterSpacingPt = 0;
          horizontalScale = Math.min(1.35, Math.max(0.7, Number(ratio.toFixed(4))));
        }
      }
    } catch {
      // ignore fallback
    }
  }

  return {
    ascentRatio,
    cssBaselineFromTopPt,
    topOffsetPt,
    letterSpacingPt,
    horizontalScale,
  };
}
