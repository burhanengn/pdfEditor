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

import dejavuSerifRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif.ttf?url';
import dejavuSerifBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Bold.ttf?url';
import dejavuSerifItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-Italic.ttf?url';
import dejavuSerifBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerif-BoldItalic.ttf?url';

import dejavuMonoRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import dejavuMonoBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf?url';
import dejavuMonoItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-Oblique.ttf?url';
import dejavuMonoBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansMono-BoldOblique.ttf?url';

import dejavuSansCondRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?url';
import dejavuSansCondBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?url';
import dejavuSansCondItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Oblique.ttf?url';
import dejavuSansCondBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed-BoldOblique.ttf?url';

import dejavuSerifCondRegUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed.ttf?url';
import dejavuSerifCondBoldUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed-Bold.ttf?url';
import dejavuSerifCondItalUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed-Italic.ttf?url';
import dejavuSerifCondBIUrl from '../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSerifCondensed-BoldItalic.ttf?url';

import type { FontAssetPayload } from '@/types/worker';

let cachedFontPackPromise: Promise<FontAssetPayload[]> | null = null;

async function fetchFontBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch bundled font asset (${res.status}): ${url}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Loads metric-compatible TrueType fonts (Liberation Serif/Sans/Mono, Carlito/Calibri,
 * Caladea/Cambria) with full Turkish coverage, plus DejaVu Unicode glyph fallback (e.g. ₺).
 */
export function loadWorkerUnicodeFonts(): Promise<FontAssetPayload[]> {
  if (!cachedFontPackPromise) {
    cachedFontPackPromise = (async () => {
      const [
        libSansReg,
        libSansBold,
        libSansItal,
        libSansBI,
        libSerifReg,
        libSerifBold,
        libSerifItal,
        libSerifBI,
        libMonoReg,
        libMonoBold,
        libMonoItal,
        libMonoBI,
        carlitoReg,
        carlitoBold,
        carlitoItal,
        carlitoBI,
        caladeaReg,
        caladeaBold,
        caladeaItal,
        caladeaBI,
        djSansReg,
        djSansBold,
        djSansItal,
        djSansBI,
        djSerifReg,
        djSerifBold,
        djSerifItal,
        djSerifBI,
        djMonoReg,
        djMonoBold,
        djMonoItal,
        djMonoBI,
        djSansCondReg,
        djSansCondBold,
        djSansCondItal,
        djSansCondBI,
        djSerifCondReg,
        djSerifCondBold,
        djSerifCondItal,
        djSerifCondBI,
      ] = await Promise.all([
        fetchFontBytes(libSansRegUrl),
        fetchFontBytes(libSansBoldUrl),
        fetchFontBytes(libSansItalUrl),
        fetchFontBytes(libSansBIUrl),
        fetchFontBytes(libSerifRegUrl),
        fetchFontBytes(libSerifBoldUrl),
        fetchFontBytes(libSerifItalUrl),
        fetchFontBytes(libSerifBIUrl),
        fetchFontBytes(libMonoRegUrl),
        fetchFontBytes(libMonoBoldUrl),
        fetchFontBytes(libMonoItalUrl),
        fetchFontBytes(libMonoBIUrl),
        fetchFontBytes(carlitoRegUrl),
        fetchFontBytes(carlitoBoldUrl),
        fetchFontBytes(carlitoItalUrl),
        fetchFontBytes(carlitoBIUrl),
        fetchFontBytes(caladeaRegUrl),
        fetchFontBytes(caladeaBoldUrl),
        fetchFontBytes(caladeaItalUrl),
        fetchFontBytes(caladeaBIUrl),
        fetchFontBytes(dejavuSansRegUrl),
        fetchFontBytes(dejavuSansBoldUrl),
        fetchFontBytes(dejavuSansItalUrl),
        fetchFontBytes(dejavuSansBIUrl),
        fetchFontBytes(dejavuSerifRegUrl),
        fetchFontBytes(dejavuSerifBoldUrl),
        fetchFontBytes(dejavuSerifItalUrl),
        fetchFontBytes(dejavuSerifBIUrl),
        fetchFontBytes(dejavuMonoRegUrl),
        fetchFontBytes(dejavuMonoBoldUrl),
        fetchFontBytes(dejavuMonoItalUrl),
        fetchFontBytes(dejavuMonoBIUrl),
        fetchFontBytes(dejavuSansCondRegUrl),
        fetchFontBytes(dejavuSansCondBoldUrl),
        fetchFontBytes(dejavuSansCondItalUrl),
        fetchFontBytes(dejavuSansCondBIUrl),
        fetchFontBytes(dejavuSerifCondRegUrl),
        fetchFontBytes(dejavuSerifCondBoldUrl),
        fetchFontBytes(dejavuSerifCondItalUrl),
        fetchFontBytes(dejavuSerifCondBIUrl),
      ]);

      return [
        {
          family: 'category:sans',
          regular: libSansReg,
          bold: libSansBold,
          italic: libSansItal,
          boldItalic: libSansBI,
        },
        {
          family: 'category:serif',
          regular: libSerifReg,
          bold: libSerifBold,
          italic: libSerifItal,
          boldItalic: libSerifBI,
        },
        {
          family: 'category:mono',
          regular: libMonoReg,
          bold: libMonoBold,
          italic: libMonoItal,
          boldItalic: libMonoBI,
        },
        {
          family: 'category:calibri',
          regular: carlitoReg,
          bold: carlitoBold,
          italic: carlitoItal,
          boldItalic: carlitoBI,
        },
        {
          family: 'category:cambria',
          regular: caladeaReg,
          bold: caladeaBold,
          italic: caladeaItal,
          boldItalic: caladeaBI,
        },
        {
          family: 'category:script',
          regular: libSerifItal,
          bold: libSerifBI,
          italic: libSerifItal,
          boldItalic: libSerifBI,
        },
        {
          family: 'DejaVuSans',
          regular: djSansReg,
          bold: djSansBold,
          italic: djSansItal,
          boldItalic: djSansBI,
        },
        {
          family: 'DejaVuSansCondensed',
          regular: djSansCondReg,
          bold: djSansCondBold,
          italic: djSansCondItal,
          boldItalic: djSansCondBI,
        },
        {
          family: 'DejaVuSerif',
          regular: djSerifReg,
          bold: djSerifBold,
          italic: djSerifItal,
          boldItalic: djSerifBI,
        },
        {
          family: 'DejaVuSerifCondensed',
          regular: djSerifCondReg,
          bold: djSerifCondBold,
          italic: djSerifCondItal,
          boldItalic: djSerifCondBI,
        },
        {
          family: 'DejaVuSansMono',
          regular: djMonoReg,
          bold: djMonoBold,
          italic: djMonoItal,
          boldItalic: djMonoBI,
        },
        {
          family: 'fallback:sans',
          regular: djSansReg,
          bold: djSansBold,
          italic: djSansItal,
          boldItalic: djSansBI,
        },
        {
          family: 'fallback:serif',
          regular: djSerifReg,
          bold: djSerifBold,
          italic: djSerifItal,
          boldItalic: djSerifBI,
        },
        {
          family: 'fallback:mono',
          regular: djMonoReg,
          bold: djMonoBold,
          italic: djMonoItal,
          boldItalic: djMonoBI,
        },
        {
          family: 'fallback:script',
          regular: djSerifItal,
          bold: djSerifBI,
          italic: djSerifItal,
          boldItalic: djSerifBI,
        },
      ];
    })().catch((err) => {
      cachedFontPackPromise = null;
      throw err;
    });
  }
  return cachedFontPackPromise;
}
