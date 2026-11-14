import libSansRegUrl from '../../node_modules/@universal-office/font-files/liberationsans-regular.ttf?url';
import libSansBoldUrl from '../../node_modules/@universal-office/font-files/liberationsans-bold.ttf?url';
import libSansItalUrl from '../../node_modules/@universal-office/font-files/liberationsans-italic.ttf?url';
import libSansBIUrl from '../../node_modules/@universal-office/font-files/liberationsans-bolditalic.ttf?url';

import libSerifRegUrl from '../../node_modules/@universal-office/font-files/liberationserif-regular.ttf?url';
import libSerifBoldUrl from '../../node_modules/@universal-office/font-files/liberationserif-bold.ttf?url';
import libSerifItalUrl from '../../node_modules/@universal-office/font-files/liberationserif-italic.ttf?url';
import libSerifBIUrl from '../../node_modules/@universal-office/font-files/liberationserif-bolditalic.ttf?url';

import libMonoRegUrl from '../../node_modules/@universal-office/font-files/liberationmono-regular.ttf?url';
import libMonoBoldUrl from '../../node_modules/@universal-office/font-files/liberationmono-bold.ttf?url';
import libMonoItalUrl from '../../node_modules/@universal-office/font-files/liberationmono-italic.ttf?url';
import libMonoBIUrl from '../../node_modules/@universal-office/font-files/liberationmono-bolditalic.ttf?url';

import carlitoRegUrl from '../../node_modules/@universal-office/font-files/carlito-regular.ttf?url';
import carlitoBoldUrl from '../../node_modules/@universal-office/font-files/carlito-bold.ttf?url';
import carlitoItalUrl from '../../node_modules/@universal-office/font-files/carlito-italic.ttf?url';
import carlitoBIUrl from '../../node_modules/@universal-office/font-files/carlito-bolditalic.ttf?url';

import caladeaRegUrl from '../../node_modules/@universal-office/font-files/caladea-regular.ttf?url';
import caladeaBoldUrl from '../../node_modules/@universal-office/font-files/caladea-bold.ttf?url';
import caladeaItalUrl from '../../node_modules/@universal-office/font-files/caladea-italic.ttf?url';
import caladeaBIUrl from '../../node_modules/@universal-office/font-files/caladea-bolditalic.ttf?url';

import dejavuSansRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import dejavuSansBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf?url';
import dejavuSansItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf?url';
import dejavuSansBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-BoldOblique.ttf?url';

import dejavuSansCondRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?url';
import dejavuSansCondBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?url';
import dejavuSansCondItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Oblique.ttf?url';
import dejavuSansCondBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-BoldOblique.ttf?url';

import dejavuSerifRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif.ttf?url';
import dejavuSerifBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf?url';
import dejavuSerifItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf?url';
import dejavuSerifBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf?url';

import dejavuSerifCondRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed.ttf?url';
import dejavuSerifCondBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed-Bold.ttf?url';
import dejavuSerifCondItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed-Italic.ttf?url';
import dejavuSerifCondBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed-BoldItalic.ttf?url';

import dejavuMonoRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import dejavuMonoBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url';
import dejavuMonoItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Oblique.ttf?url';
import dejavuMonoBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-BoldOblique.ttf?url';

const FACE_DEFS: Array<[string, number, string, string]> = [
  ['Liberation Sans', 400, 'normal', libSansRegUrl],
  ['Liberation Sans', 700, 'normal', libSansBoldUrl],
  ['Liberation Sans', 400, 'italic', libSansItalUrl],
  ['Liberation Sans', 700, 'italic', libSansBIUrl],
  ['Liberation Serif', 400, 'normal', libSerifRegUrl],
  ['Liberation Serif', 700, 'normal', libSerifBoldUrl],
  ['Liberation Serif', 400, 'italic', libSerifItalUrl],
  ['Liberation Serif', 700, 'italic', libSerifBIUrl],
  ['Liberation Mono', 400, 'normal', libMonoRegUrl],
  ['Liberation Mono', 700, 'normal', libMonoBoldUrl],
  ['Liberation Mono', 400, 'italic', libMonoItalUrl],
  ['Liberation Mono', 700, 'italic', libMonoBIUrl],
  ['Carlito', 400, 'normal', carlitoRegUrl],
  ['Carlito', 700, 'normal', carlitoBoldUrl],
  ['Carlito', 400, 'italic', carlitoItalUrl],
  ['Carlito', 700, 'italic', carlitoBIUrl],
  ['Caladea', 400, 'normal', caladeaRegUrl],
  ['Caladea', 700, 'normal', caladeaBoldUrl],
  ['Caladea', 400, 'italic', caladeaItalUrl],
  ['Caladea', 700, 'italic', caladeaBIUrl],
  ['DejaVu Sans', 400, 'normal', dejavuSansRegUrl],
  ['DejaVu Sans', 700, 'normal', dejavuSansBoldUrl],
  ['DejaVu Sans', 400, 'italic', dejavuSansItalUrl],
  ['DejaVu Sans', 700, 'italic', dejavuSansBIUrl],
  ['DejaVu Sans Condensed', 400, 'normal', dejavuSansCondRegUrl],
  ['DejaVu Sans Condensed', 700, 'normal', dejavuSansCondBoldUrl],
  ['DejaVu Sans Condensed', 400, 'italic', dejavuSansCondItalUrl],
  ['DejaVu Sans Condensed', 700, 'italic', dejavuSansCondBIUrl],
  ['DejaVu Serif', 400, 'normal', dejavuSerifRegUrl],
  ['DejaVu Serif', 700, 'normal', dejavuSerifBoldUrl],
  ['DejaVu Serif', 400, 'italic', dejavuSerifItalUrl],
  ['DejaVu Serif', 700, 'italic', dejavuSerifBIUrl],
  ['DejaVu Serif Condensed', 400, 'normal', dejavuSerifCondRegUrl],
  ['DejaVu Serif Condensed', 700, 'normal', dejavuSerifCondBoldUrl],
  ['DejaVu Serif Condensed', 400, 'italic', dejavuSerifCondItalUrl],
  ['DejaVu Serif Condensed', 700, 'italic', dejavuSerifCondBIUrl],
  ['DejaVu Sans Mono', 400, 'normal', dejavuMonoRegUrl],
  ['DejaVu Sans Mono', 700, 'normal', dejavuMonoBoldUrl],
  ['DejaVu Sans Mono', 400, 'italic', dejavuMonoItalUrl],
  ['DejaVu Sans Mono', 700, 'italic', dejavuMonoBIUrl],
];

let injected = false;

/**
 * Registers metric-compatible offline @font-face rules so browser WYSIWYG previews and
 * line-wrapping widths match exported PDF glyphs 1:1 on all OS platforms.
 */
export function registerOfflineFontFaces(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const css = FACE_DEFS.map(
    ([family, weight, style, url]) =>
      `@font-face{font-family:"${family}";src:url("${url}") format("truetype");font-weight:${weight};font-style:${style};font-display:swap;}`,
  ).join('\n');
  const styleEl = document.createElement('style');
  styleEl.dataset.pdfEditorFonts = 'true';
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

const loadedDynamicFaces = new Map<string, FontFace>();

export function buildUnicodeRangeFromCodePoints(codePoints?: number[]): string | undefined {
  if (!codePoints || codePoints.length === 0 || codePoints.length > 3500) {
    return undefined;
  }
  const sorted = [...new Set(codePoints)].filter((cp) => cp > 0 && cp <= 0x10ffff).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;

  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(
        start === end
          ? `U+${start.toString(16).toUpperCase()}`
          : `U+${start.toString(16).toUpperCase()}-${end.toString(16).toUpperCase()}`,
      );
      start = sorted[i];
      end = sorted[i];
    }
  }
  ranges.push(
    start === end
      ? `U+${start.toString(16).toUpperCase()}`
      : `U+${start.toString(16).toUpperCase()}-${end.toString(16).toUpperCase()}`,
  );
  return ranges.join(', ');
}

/**
 * Registers an extracted embedded PDF font or user-uploaded custom font in `document.fonts`
 * for real-time WYSIWYG canvas and inline editor rendering.
 */
export async function registerDynamicFontFace(
  cssFamily: string,
  bytes: Uint8Array,
  variant: 'regular' | 'bold' | 'italic' | 'boldItalic',
  unicodeRange?: string,
): Promise<boolean> {
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    return false;
  }
  const weight = variant === 'bold' || variant === 'boldItalic' ? '700' : '400';
  const style = variant === 'italic' || variant === 'boldItalic' ? 'italic' : 'normal';
  const key = `${cssFamily}::${weight}::${style}`;
  const existing = loadedDynamicFaces.get(key);
  if (existing) {
    document.fonts.delete(existing);
    loadedDynamicFaces.delete(key);
  }

  try {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const descriptors: FontFaceDescriptors = {
      weight,
      style,
      display: 'swap',
      ...(unicodeRange ? { unicodeRange } : {}),
    };
    const face = new FontFace(cssFamily, copy.buffer, descriptors);
    const loaded = await face.load();
    document.fonts.add(loaded);
    loadedDynamicFaces.set(key, loaded);
    return true;
  } catch {
    return false;
  }
}

export function unregisterDynamicFontFamily(cssFamily: string): void {
  if (typeof document === 'undefined') return;
  for (const [key, face] of loadedDynamicFaces.entries()) {
    if (key.startsWith(`${cssFamily}::`)) {
      document.fonts.delete(face);
      loadedDynamicFaces.delete(key);
    }
  }
}
