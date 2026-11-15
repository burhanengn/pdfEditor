import { expect, test } from '@playwright/test';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import path from 'node:path';
import * as mupdf from 'mupdf';
import { PDFDocument, rgb } from 'pdf-lib';

function createSoftPhotoPng(width = 160, height = 220): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, width, height], false);
  try {
    const samples = pixmap.getPixels();
    for (let i = 0; i < samples.length; i += 3) {
      samples[i] = 226;
      samples[i + 1] = 232;
      samples[i + 2] = 240;
    }
    return new Uint8Array(pixmap.asPNG());
  } finally {
    pixmap.destroy();
  }
}

async function createFullPageScanWithTextPdf(): Promise<Buffer> {
  const ttfDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
  const regularBytes = fs.readFileSync(path.join(ttfDir, 'DejaVuSans.ttf'));

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const sans = await doc.embedFont(regularBytes, { subset: false });
  const page = doc.addPage([595, 842]);

  // >= 84% page-area background image behind foreground text
  const bgImg = await doc.embedPng(createSoftPhotoPng());
  page.drawImage(bgImg, {
    x: 28,
    y: 31,
    width: 540,
    height: 780,
  });

  // Single-line fractional font size 10.62pt with Turkish characters right over the background scan
  page.drawText('ĞÜŞİÖÇ ğüşiöç ıİ Tek Satır Başlık', {
    x: 80,
    y: 620,
    size: 10.62,
    font: sans,
    color: rgb(0.06, 0.09, 0.16),
  });

  return Buffer.from(await doc.save());
}

async function readStreamBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

test.describe('Master Plan Section 4 Acceptance E2E Suite', () => {
  test('Mobile 390x844: 300%/500% 4-edge panning, <2px pinch focal drift, 2nd-finger drag abort, & collapsed sheet auto-hide', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();

    try {
      await page.goto('/');
      await page.getByTestId('welcome-sample-btn').click();
      const page1 = page.getByTestId('pdf-page-1');
      await expect(page1.locator('canvas')).toBeVisible();
      await expect
        .poll(async () => page1.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width))
        .toBeGreaterThan(200);

      // 1. Zoom to 300% via zoom-select (pinch / zoom controller) and verify unobstructed 4-edge panning
      const setMobileZoom = async (val: string) => {
        await page.evaluate((target) => {
          const sel = document.querySelector('[data-testid="zoom-select"]') as HTMLSelectElement;
          sel.value = target;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }, val);
      };
      await setMobileZoom('3');
      await expect
        .poll(async () => page1.evaluate((el) => el.getBoundingClientRect().width))
        .toBeGreaterThan(1500);

      const edgeReport300 = await page.evaluate(() => {
        const vp = document.querySelector('[data-testid="document-viewport"]') as HTMLElement;
        const p1 = document.querySelector('[data-testid="pdf-page-1"]') as HTMLElement;
        const p3 = document.querySelector('[data-testid="pdf-page-3"]') as HTMLElement;
        const dock = document.querySelector('[data-testid="mobile-bottom-dock"]') as HTMLElement;

        vp.scrollLeft = 0;
        const vr0 = vp.getBoundingClientRect();
        const pr0 = p1.getBoundingClientRect();
        const leftGap = pr0.left - vr0.left;

        vp.scrollLeft = vp.scrollWidth - vp.clientWidth;
        const prMax = p1.getBoundingClientRect();
        const rightGap = vr0.right - prMax.right;

        vp.scrollTop = 0;
        const pt0 = p1.getBoundingClientRect();
        const topGap = pt0.top - vr0.top;

        vp.scrollTop = vp.scrollHeight - vp.clientHeight;
        const pbMax = p3.getBoundingClientRect();
        const dockRect = dock.getBoundingClientRect();
        return {
          leftGap,
          rightGap,
          topGap,
          lastPageClearanceAboveDock: dockRect.top - pbMax.bottom,
        };
      });

      expect(edgeReport300.leftGap).toBeGreaterThanOrEqual(48);
      expect(edgeReport300.rightGap).toBeGreaterThanOrEqual(48);
      expect(edgeReport300.topGap).toBeGreaterThanOrEqual(48);
      expect(edgeReport300.lastPageClearanceAboveDock).toBeGreaterThanOrEqual(48);

      // Also verify 500% zoom clamps cleanly without zero canvas
      await setMobileZoom('5');
      await expect
        .poll(async () => page1.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width * c.height))
        .toBeLessThanOrEqual(12_800_000);
      await expect
        .poll(async () => page1.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width))
        .toBeGreaterThan(500);

      // 2. Pinch focal-point drift (< 2px) across 200% -> 320% pinch around arbitrary off-center focal point
      await setMobileZoom('2');
      await page.evaluate(() => {
        const vp = document.querySelector('[data-testid="document-viewport"]') as HTMLElement;
        vp.scrollLeft = 220;
        vp.scrollTop = 260;
      });
      await page.waitForTimeout(80);

      const pinchDrift = await page.evaluate(async () => {
        const vp = document.querySelector('[data-testid="document-viewport"]') as HTMLElement;
        const p1 = document.querySelector('[data-testid="pdf-page-1"]') as HTMLElement;
        const vr = vp.getBoundingClientRect();
        const midX = vr.left + vr.width * 0.62;
        const midY = vr.top + vr.height * 0.44;
        const beforeRect = p1.getBoundingClientRect();
        const normX = (midX - beforeRect.left) / beforeRect.width;
        const normY = (midY - beforeRect.top) / beforeRect.height;

        const mkPtr = (type: string, id: number, x: number, y: number) =>
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 301,
            clientX: x,
            clientY: y,
          });

        vp.dispatchEvent(mkPtr('pointerdown', 301, midX - 40, midY));
        vp.dispatchEvent(mkPtr('pointerdown', 302, midX + 40, midY));
        window.dispatchEvent(mkPtr('pointermove', 301, midX - 64, midY));
        window.dispatchEvent(mkPtr('pointermove', 302, midX + 64, midY));
        window.dispatchEvent(mkPtr('pointerup', 301, midX - 64, midY));
        window.dispatchEvent(mkPtr('pointerup', 302, midX + 64, midY));

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const afterRect = p1.getBoundingClientRect();
        const newAnchorX = afterRect.left + normX * afterRect.width;
        const newAnchorY = afterRect.top + normY * afterRect.height;
        return Math.hypot(newAnchorX - midX, newAnchorY - midY);
      });
      expect(pinchDrift).toBeLessThan(2.5);

      // 3. Place signature, start 1-finger drag, touch 2nd finger -> drag aborts & restores original box
      await setMobileZoom('fit-width');
      await page.getByTestId('mobile-dock-pages').click();
      await page.getByTestId('mobile-page-thumb-1').click();
      await page.getByTestId('mobile-dock-tools').click();
      await page.getByTestId('mobile-tool-signature').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Type', exact: true }).click();
      await page.getByTestId('signature-place-btn').click();
      await expect(page.getByTestId('signature-placement-banner')).toBeVisible();

      const p1Box = await page1.boundingBox();
      await page.touchscreen.tap(p1Box!.x + p1Box!.width * 0.5, p1Box!.y + p1Box!.height * 0.45);
      await expect(page.getByTestId('signature-placement-banner')).toHaveCount(0);

      // Collapsed inspector bar visible when selected
      await expect(page.getByTestId('mobile-inspector-collapsed')).toBeVisible();

      const selBox = page.locator('[data-testid^="selection-box-"]').first();
      const boxBeforeDrag = await selBox.boundingBox();
      expect(boxBeforeDrag).not.toBeNull();

      await page.evaluate(() => {
        const vp = document.querySelector('[data-testid="document-viewport"]') as HTMLElement;
        const sb = document.querySelector('[data-testid^="selection-box-"]') as HTMLElement;
        const r = sb.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const mk = (t: string, id: number, x: number, y: number, prim = true) =>
          new PointerEvent(t, {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'touch',
            isPrimary: prim,
            clientX: x,
            clientY: y,
          });
        sb.dispatchEvent(mk('pointerdown', 401, cx, cy, true));
        sb.dispatchEvent(mk('pointermove', 401, cx + 60, cy + 50, true));
        // Second finger lands on viewport while drag is active -> abortTransaction()!
        vp.dispatchEvent(mk('pointerdown', 402, cx + 110, cy + 20, false));
        window.dispatchEvent(mk('pointerup', 402, cx + 110, cy + 20, false));
        window.dispatchEvent(mk('pointerup', 401, cx + 60, cy + 50, true));
      });
      await page.waitForTimeout(80);
      const boxAfterAbort = await selBox.boundingBox();
      expect(Math.abs(boxAfterAbort!.x - boxBeforeDrag!.x)).toBeLessThan(2);
      expect(Math.abs(boxAfterAbort!.y - boxBeforeDrag!.y)).toBeLessThan(2);

      // 4. Add text block -> active InlineTextEditor must hide collapsed MobileInspectorSheet
      await page.getByTestId('mobile-dock-tools').click();
      await page.getByTestId('mobile-tool-text').click();
      const p1Now = await page1.boundingBox();
      await page.mouse.click(p1Now!.x + p1Now!.width * 0.4, p1Now!.y + 120);
      await expect(page.getByTestId('inline-text-editor')).toBeVisible();
      await expect(page.getByTestId('mobile-inspector-collapsed')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('Background isolation (>=65%), text-first selection, layer lock, 10.62pt sub-pixel parity, & single-line Turkish export (Tz + İ)', async ({
    page,
  }) => {
    const scanPdf = await createFullPageScanWithTextPdf();
    await page.goto('/');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'full-scan-tr.pdf',
      mimeType: 'application/pdf',
      buffer: scanPdf,
    });

    const pageEl = page.getByTestId('pdf-page-1');
    await expect(pageEl.locator('canvas')).toBeVisible();
    await expect
      .poll(async () => pageEl.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(200);

    // Wait for extracted text over >=84% background scan
    const detectedTexts = pageEl.locator('[data-detected-text="true"]');
    await expect(detectedTexts.first()).toBeVisible();

    // Verify full-page background detected overlay does NOT intercept pointer events
    const bgOverlay = pageEl.locator('[data-detected-image="true"]').first();
    await expect(bgOverlay).toBeVisible();
    await expect
      .poll(async () => bgOverlay.evaluate((el) => window.getComputedStyle(el).pointerEvents))
      .toBe('none');

    // 1. Click directly on the detected text line over the full-page scan
    const textBox = await detectedTexts.first().boundingBox();
    expect(textBox).not.toBeNull();
    await page.mouse.click(textBox!.x + textBox!.width * 0.5, textBox!.y + textBox!.height * 0.5);

    const inlineEditor = page.getByTestId('inline-text-editor');
    await expect(inlineEditor).toBeVisible();
    // Sub-pixel font size 10.62pt preserved without 0.5pt quantization (i.e. NOT 10.5pt)
    const fontMetricsCheck = await inlineEditor.evaluate((ed) => {
      const layer = ed.closest('[data-page-canvas-layer]') as HTMLElement;
      const zoomScale = layer ? layer.getBoundingClientRect().width / 595 : 1;
      const computedPx = parseFloat(window.getComputedStyle(ed).fontSize);
      return {
        fontPt: computedPx / zoomScale,
      };
    });
    expect(fontMetricsCheck.fontPt).toBeGreaterThan(10.55);
    expect(fontMetricsCheck.fontPt).toBeLessThan(10.69);

    // Append decomposed Turkish I\u0307STANBUL without adding newline -> must remain single-line
    await inlineEditor.fill('ĞÜŞİÖÇ ğüşiöç I\u0307STANBUL Başlık');
    await inlineEditor.press('Escape');
    await expect(inlineEditor).toBeHidden();

    // Ensure background image was NEVER promoted during text click
    await expect(pageEl.locator('[data-testid^="canvas-element-imgedit_"]')).toHaveCount(0);

    // 2. Toggle "Arka Planı Seç" -> click empty area of full-page scan -> promote + Lock layer
    await page.getByTestId('toggle-select-background').click();
    const p1Rect = await pageEl.boundingBox();
    await page.mouse.click(p1Rect!.x + p1Rect!.width * 0.5, p1Rect!.y + 420);
    await expect(pageEl.locator('[data-testid^="canvas-element-imgedit_"]')).toHaveCount(1);

    await page.getByTestId('inspector-lock-layer-toggle').click();
    await expect(page.locator('[data-testid^="locked-badge-"]')).toBeVisible();

    // Turn off "Arka Planı Seç" and click our edited text again -> text edits cleanly even after bg promotion
    await page.getByTestId('toggle-select-background').click();
    const editedEl = pageEl.locator('[data-testid^="canvas-element-txtedit_"]').first();
    await expect(editedEl).toBeVisible();
    await editedEl.dblclick();
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.press('Escape');

    // 3. Export PDF -> inspect exported output with MuPDF Wasm:
    // Must contain composed 'İSTANBUL' and stay on 1 single visual line (never wrapped to 2 lines!)
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-btn').click(),
    ]);
    const exportedBytes = await readStreamBytes((await pdfDownload.createReadStream())!);
    const md = mupdf.Document.openDocument(exportedBytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      try {
        const st = mp.toStructuredText('preserve-whitespace');
        try {
          const rows: Array<{ y: number; text: string }> = [];
          st.walk({
            onChar(c, origin) {
              if (!c.trim()) return;
              const row = rows.find((r) => Math.abs(r.y - origin[1]) <= 3);
              if (row) row.text += c;
              else rows.push({ y: origin[1], text: c });
            },
          });
          expect(rows).toHaveLength(1);
          expect(rows[0].text).toContain('İSTANBUL');
          expect(rows[0].text).toContain('ĞÜŞİÖÇ');
        } finally {
          st.destroy();
        }
      } finally {
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });

  test('Sample PDF header banner background can be selected, recolored, and exported behind white title without trapping text', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('welcome-sample-btn').click();
    const page1 = page.getByTestId('pdf-page-1');
    await expect(page1.locator('canvas')).toBeVisible();
    await expect
      .poll(async () => page1.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(200);

    // Wait for extracted text and vector shapes on Sample PDF Page 1
    const shapeOverlay = page1.locator('[data-detected-shape="true"]').first();
    await expect(shapeOverlay).toBeVisible();

    const titleTextOverlay = page1.locator('[data-detected-text="true"]').first();
    await expect(titleTextOverlay).toBeVisible();

    // 1. Clicking title text still prioritizes text editing cleanly over the header banner
    const titleBox = await titleTextOverlay.boundingBox();
    expect(titleBox).not.toBeNull();
    await page.mouse.click(titleBox!.x + titleBox!.width * 0.4, titleBox!.y + titleBox!.height * 0.5);
    const inlineEditor = page.getByTestId('inline-text-editor');
    await expect(inlineEditor).toBeVisible();
    await expect(inlineEditor).toContainText('Q4 Product Architecture Brief');
    await inlineEditor.press('Escape');
    await expect(inlineEditor).toBeHidden();

    // Wait briefly so we don't collide cleanly, now locate header banner by bounding box (< 0.15 of page top & widest)
    const bannerRect = await page1.evaluate(() => {
      const shapes = Array.from(document.querySelectorAll('[data-detected-shape="true"]'));
      const header = shapes
        .map((el) => el.getBoundingClientRect())
        .sort((a, b) => a.top - b.top || b.width - a.width)[0];
      return header ? { x: header.left, y: header.top, width: header.width, height: header.height } : null;
    });
    expect(bannerRect).not.toBeNull();

    // 2. Click open right side of header banner -> promotes shape-replacement & opens Background Shape Style
    await page.mouse.click(bannerRect!.x + bannerRect!.width * 0.88, bannerRect!.y + bannerRect!.height * 0.5);
    const promotedShape = page1.locator('[data-testid^="canvas-element-shpedit_"]').first();
    await expect(promotedShape).toBeVisible();

    const redSwatch = page.getByTestId('inspector-shape-swatch-#dc2626');
    await expect(redSwatch).toBeVisible();
    await redSwatch.click();

    await expect
      .poll(async () =>
        promotedShape.evaluate((el) => ({
          bg: window.getComputedStyle(el).backgroundColor,
          z: Number(window.getComputedStyle(el).zIndex),
        })),
      )
      .toEqual({ bg: 'rgb(220, 38, 38)', z: 5 });

    // 3. Export PDF -> verify red banner renders BEHIND preserved white title 'Q4 Product Architecture Brief'
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-btn').click(),
    ]);
    const exportedBytes = await readStreamBytes((await pdfDownload.createReadStream())!);
    const md = mupdf.Document.openDocument(exportedBytes, 'application/pdf');
    try {
      const mp = md.loadPage(0);
      expect(mp.toStructuredText('preserve-whitespace').asText()).toContain(
        'Q4 Product Architecture Brief',
      );
      const pm = mp.toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
      try {
        const px = pm.getPixels();
        const w = pm.getWidth();
        const n = pm.getNumberOfComponents();
        // Open right side of banner at top-right (x=520, y=65) is now red (#dc2626)
        const bannerIdx = (65 * w + 520) * n;
        expect(px[bannerIdx]).toBeGreaterThan(190);
        expect(px[bannerIdx + 1]).toBeLessThan(65);
        expect(px[bannerIdx + 2]).toBeLessThan(65);
      } finally {
        pm.destroy();
        mp.destroy();
      }
    } finally {
      md.destroy();
    }
  });
});
