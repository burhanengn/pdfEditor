import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  buildE2ePdf,
  countE2ePageImages,
  createE2ePngBytes,
  extractE2ePageCharsWithBoxes,
  extractE2ePageText,
  getE2ePdfInfo,
  measureE2eTtfWidth,
  patchTtfFontForTest,
  renderE2ePageRgba,
} from './helpers/pdfiumTestHelper';

function createWatermarkPngBuffer(): Uint8Array {
  return createE2ePngBytes(120, 160, undefined, [195, 220, 242, 255]);
}

async function createTurkishFormPdf(): Promise<Buffer> {
  const ttfDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
  const regularBytes = fs.readFileSync(path.join(ttfDir, 'DejaVuSerif.ttf'));
  const boldBytes = fs.readFileSync(path.join(ttfDir, 'DejaVuSerif-Bold.ttf'));

  const bytes = await buildE2ePdf(
    [
      {
        width: 595,
        height: 842,
        images: [
          {
            pngBytes: createWatermarkPngBuffer(),
            x: 90,
            yPdf: 120,
            width: 415,
            height: 550,
          },
        ],
        lines: [
          { x1: 90, y1Pdf: 635, x2: 505, y2Pdf: 635, stroke: [0, 0, 0], strokeWidth: 2 },
          { x1: 90, y1Pdf: 585, x2: 505, y2Pdf: 585, stroke: [0, 0, 0], strokeWidth: 2 },
        ],
        rects: [
          { x: 90, yPdf: 700, width: 415, height: 26, fill: [138, 41, 41] },
        ],
        texts: [
          {
            text: 'Öğrenim Görülecek Ülke',
            x: 100,
            yPdf: 604,
            fontSize: 11,
            color: [0, 0, 0],
            fontKey: 'serifReg',
          },
          {
            text: 'YURT DIŞI ÖĞRENCİ BİLGİLERİ',
            x: 170,
            yPdf: 708,
            fontSize: 12,
            color: [255, 255, 255],
            fontKey: 'serifBold',
          },
          {
            text: 'Birinci satır örnek eğitim programı kapsamında deneme',
            x: 98,
            yPdf: 470,
            fontSize: 11,
            color: [0, 0, 0],
            fontKey: 'serifReg',
          },
          {
            text: 'yazısı üzerinde yapılan detaylı inceleme neticesinde olan',
            x: 98,
            yPdf: 454,
            fontSize: 11,
            color: [0, 0, 0],
            fontKey: 'serifReg',
          },
          {
            text: 'bir yazı.',
            x: 98,
            yPdf: 438,
            fontSize: 11,
            color: [0, 0, 0],
            fontKey: 'serifReg',
          },
        ],
      },
    ],
    {
      customFonts: {
        serifReg: regularBytes,
        serifBold: boldBytes,
      },
    },
  );
  return Buffer.from(bytes);
}

function createPngBuffer(): Uint8Array {
  return createE2ePngBytes(40, 40, undefined, [180, 180, 180, 255]);
}

async function createMultiPagePdf(pageCount: number, prefix = 'Page'): Promise<Buffer> {
  const bytes = await buildE2ePdf(
    Array.from({ length: pageCount }, (_, i) => ({
      width: 612,
      height: 792,
      texts: [
        {
          text: `${prefix} ${i + 1} Content`,
          x: 54,
          yPdf: 720,
          fontSize: 16,
          color: [26, 26, 26],
        },
      ],
    })),
  );
  return Buffer.from(bytes);
}

async function createEncryptedPdf(password: string): Promise<Buffer> {
  const bytes = await buildE2ePdf(
    [
      {
        width: 612,
        height: 792,
        texts: [{ text: 'SecretPage 1 Content', x: 54, yPdf: 720, fontSize: 16 }],
      },
      {
        width: 612,
        height: 792,
        texts: [{ text: 'SecretPage 2 Content', x: 54, yPdf: 720, fontSize: 16 }],
      },
    ],
    { userPassword: password, ownerPassword: `owner_${password}` },
  );
  return Buffer.from(bytes);
}

function readDownloadBytes(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

test.describe('AetherPDF Studio E2E Verification', () => {
  test('supports full editing, text/image mutation, signatures, merge, split ZIP, export, and zero console errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText})`);
    });

    await page.goto('/');

    // Verify COOP/COEP headers enable crossOriginIsolated Wasm environment
    const isolated = await page.evaluate(() => window.crossOriginIsolated);
    expect(isolated).toBe(true);

    // 1. Load Sample PDF from welcome screen -> toggle single-button Edit mode (K4)
    await page.getByTestId('welcome-sample-btn').click();
    await page.getByTestId('toggle-edit-mode-btn').click();
    await expect(page.getByTestId('thumbnail-page-1')).toBeVisible();
    await expect(page.getByTestId('thumbnail-page-3')).toBeVisible();

    // Ensure PDF.js actually rendered non-empty canvas dimensions
    const page1Canvas = page.getByTestId('pdf-page-1').locator('canvas');
    await expect(page1Canvas).toBeVisible();
    await expect
      .poll(async () => page1Canvas.evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(200);

    // Wait for text & image extraction overlays on Page 1
    const detectedTexts = page.getByTestId('pdf-page-1').locator('[data-detected-text="true"]');
    await expect(detectedTexts.first()).toBeVisible();
    const detectedImages = page.getByTestId('pdf-page-1').locator('[data-detected-image="true"]');
    await expect(detectedImages.first()).toBeVisible();

    // 2. In-place text editing: click first detected text block ("Q4 Product Architecture Brief")
    await detectedTexts.first().click();
    const inlineEditor = page.getByTestId('inline-text-editor');
    await expect(inlineEditor).toBeVisible();
    await inlineEditor.fill('MODIFIED_IN_PLACE_WASM');
    await inlineEditor.press('Escape');
    await expect(inlineEditor).toBeHidden();

    // Verify RightInspector shows the selected text-edit properties and modify size
    await expect(page.getByTestId('inspector-text-content')).toHaveValue('MODIFIED_IN_PLACE_WASM');
    await page.getByTestId('inspector-font-size').fill('22');

    // Undo and Redo test
    await page.getByTestId('undo-btn').click();
    await expect(page.getByTestId('inspector-font-size')).not.toHaveValue('22');
    await page.getByTestId('redo-btn').click();
    await expect(page.getByTestId('inspector-font-size')).toHaveValue('22');

    // 3. Add a brand new text block via Add Text tool
    await page.getByTestId('tool-text').click();
    const p1Box = await page.getByTestId('pdf-page-1').boundingBox();
    expect(p1Box).not.toBeNull();
    await page.mouse.click(p1Box!.x + 360, p1Box!.y + 180);
    const addedEditor = page.getByTestId('inline-text-editor');
    await expect(addedEditor).toBeVisible();
    await addedEditor.fill('NEW_CUSTOM_TEXT_BLOCK');
    await addedEditor.press('Escape');

    // 4. Select & drag/resize existing embedded XObject image
    await detectedImages.first().click();
    const activeSelBox = page.locator('[data-testid^="selection-box-"]').first();
    await expect(activeSelBox).toBeVisible();
    const selBoxRect = await activeSelBox.boundingBox();
    expect(selBoxRect).not.toBeNull();

    // Drag embedded image by (+35, +25)
    await page.mouse.move(
      selBoxRect!.x + selBoxRect!.width / 2,
      selBoxRect!.y + selBoxRect!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      selBoxRect!.x + selBoxRect!.width / 2 + 35,
      selBoxRect!.y + selBoxRect!.height / 2 + 25,
      { steps: 5 },
    );
    await page.mouse.up();

    // Resize via bottom-right handle
    const seHandle = page.getByTestId('resize-handle-se');
    const seRect = await seHandle.boundingBox();
    await page.mouse.move(seRect!.x + 5, seRect!.y + 5);
    await page.mouse.down();
    await page.mouse.move(seRect!.x + 25, seRect!.y + 20, { steps: 4 });
    await page.mouse.up();

    // Rotate via inspector input
    await page.getByTestId('inspector-rotation-input').fill('12');

    // 5. Insert a new PNG image & WebP image onto Page 1
    await page.getByTestId('insert-image-input').setInputFiles({
      name: 'badge.png',
      mimeType: 'image/png',
      buffer: Buffer.from(createPngBuffer()),
    });
    await expect(page.locator('[data-testid^="canvas-element-img_"]')).toHaveCount(1);

    const webpBytes = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 80;
      c.height = 40;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 80, 40);
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(8, 30);
      ctx.lineTo(72, 10);
      ctx.stroke();
      const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/webp'));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });

    await page.getByTestId('insert-image-input').setInputFiles({
      name: 'stamp.webp',
      mimeType: 'image/webp',
      buffer: Buffer.from(webpBytes),
    });
    await expect(page.locator('[data-testid^="canvas-element-img_"]')).toHaveCount(2);

    // 6. Draw freehand stroke on Page 1 & verify Delete + Ctrl+Z keyboard shortcuts
    await page.getByTestId('tool-draw').click();
    await page.mouse.move(p1Box!.x + 350, p1Box!.y + 300);
    await page.mouse.down();
    await page.mouse.move(p1Box!.x + 410, p1Box!.y + 330, { steps: 6 });
    await page.mouse.move(p1Box!.x + 450, p1Box!.y + 290, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('[data-testid^="canvas-element-stroke_"]')).toHaveCount(1);

    await page.keyboard.press('Delete');
    await expect(page.locator('[data-testid^="canvas-element-stroke_"]')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-testid^="canvas-element-stroke_"]')).toHaveCount(1);

    // 7. Create Signature (Draw + Type + Upload WebP w/ white-bg removal & Vault Persistence)
    await page.getByTestId('tool-signature').click();
    const sigCanvas = page.getByTestId('signature-draw-canvas');
    const sigRect = await sigCanvas.boundingBox();
    await page.mouse.move(sigRect!.x + 40, sigRect!.y + 80);
    await page.mouse.down();
    await page.mouse.move(sigRect!.x + 140, sigRect!.y + 60, { steps: 5 });
    await page.mouse.move(sigRect!.x + 220, sigRect!.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.getByTestId('signature-place-btn').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const p1SigBox = await page.getByTestId('pdf-page-1').boundingBox();
    await page.mouse.move(p1SigBox!.x + 180, p1SigBox!.y + 340);
    await expect(page.getByTestId('signature-ghost-preview')).toBeVisible();
    await page.mouse.click(p1SigBox!.x + 180, p1SigBox!.y + 340);
    await expect(page.locator('[data-testid^="canvas-element-sigel_"]')).toHaveCount(1);

    // Type tab
    await page.getByTestId('tool-signature').click();
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    await page.getByTestId('signature-type-input').fill('Dr. Jane Doe');
    await page.getByTestId('signature-place-btn').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.mouse.move(p1SigBox!.x + 280, p1SigBox!.y + 410);
    await page.mouse.click(p1SigBox!.x + 280, p1SigBox!.y + 410);
    await expect(page.locator('[data-testid^="canvas-element-sigel_"]')).toHaveCount(2);

    // Upload tab (WebP with white-background transparency extraction)
    await page.getByTestId('tool-signature').click();
    await page.getByRole('button', { name: 'Upload', exact: true }).click();
    await page.getByRole('dialog').locator('input[type="file"][accept*="image/webp"]').setInputFiles({
      name: 'sig-upload.webp',
      mimeType: 'image/webp',
      buffer: Buffer.from(webpBytes),
    });
    await expect(page.getByAltText('Uploaded signature preview')).toBeVisible();
    await page.getByTestId('signature-place-btn').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await page.mouse.move(p1SigBox!.x + 380, p1SigBox!.y + 480);
    await page.mouse.click(p1SigBox!.x + 380, p1SigBox!.y + 480);
    await expect(page.locator('[data-testid^="canvas-element-sigel_"]')).toHaveCount(3);

    // 8. Merge another 2-page PDF -> total 5 pages
    const mergeBytes = await createMultiPagePdf(2, 'MergedPage');
    await page.getByTestId('merge-pdf-input').setInputFiles({
      name: 'extra.pdf',
      mimeType: 'application/pdf',
      buffer: mergeBytes,
    });
    await expect(page.getByTestId('thumbnail-page-5')).toBeVisible();

    // 9. Rotate Page 2 CW and delete Page 5 -> 4 pages
    await page.getByTestId('thumbnail-page-2').hover();
    await page.getByRole('button', { name: 'Rotate page 2 clockwise' }).click();
    await expect(page.getByTestId('thumbnail-page-2')).toContainText('90°');

    await page.getByTestId('thumbnail-page-5').hover();
    await page.getByRole('button', { name: 'Delete page 5' }).click();
    await expect(page.getByTestId('thumbnail-page-5')).toHaveCount(0);

    // 9b. Test Page Organize Modal & Light/Dark Theme Toggle
    await page.getByTestId('tool-organize').click();
    await expect(page.locator('#organize-modal-title')).toContainText('Organize Pages (4)');
    await page.getByRole('button', { name: 'Close organizer' }).click();
    await expect(page.locator('#organize-modal-title')).toBeHidden();

    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // 10. Split / Extract ZIP export
    await page.getByTestId('toolbar-split-btn').click();
    await page.locator('#split-range-input').fill('1-2, 3-4');
    await page.getByText('Split by Range Groups (.zip)').click();
    const [zipDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export ZIP' }).click(),
    ]);
    const zipStream = await zipDownload.createReadStream();
    const zipBuffer = await readDownloadBytes(zipStream!);
    expect(zipBuffer[0]).toBe(0x50);
    expect(zipBuffer[1]).toBe(0x4b);

    // 11. Export Final PDF and verify binary PDF output via MuPDF
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByTestId('export-pdf-btn').click();
        await page.getByTestId('save-as-copy-btn').click();
      })(),
    ]);
    const pdfStream = await pdfDownload.createReadStream();
    const exportedPdfBytes = await readDownloadBytes(pdfStream!);

    const expInfo = await getE2ePdfInfo(exportedPdfBytes);
    expect(expInfo.pageCount).toBe(4);
    const p0Text = await extractE2ePageText(exportedPdfBytes, 0);
    expect(p0Text).toContain('MODIFIED_IN_PLACE_WASM');
    expect(p0Text).toContain('NEW_CUSTOM_TEXT_BLOCK');
    expect(p0Text).not.toContain('Q4 Product Architecture Brief');

    const imgCount = await countE2ePageImages(exportedPdfBytes, 0);
    // Moved embedded image + badge.png + stamp.webp + uploaded PNG signature
    expect(imgCount).toBeGreaterThanOrEqual(4);

    // 12. Verify signature vault persisted in localStorage across reload
    await page.reload();
    await page.getByTestId('welcome-blank-btn').click();
    await page.getByTestId('tool-signature').click();
    await expect(page.getByText('Vault (3)')).toBeVisible();
    await page.getByRole('button', { name: 'Close signature modal' }).click();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test('unlocks password-protected PDF and smoothly virtualizes 105-page document', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.goto('/');

    // 1. Test encrypted PDF flow
    const lockedBytes = await createEncryptedPdf('topsecret99');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'locked.pdf',
      mimeType: 'application/pdf',
      buffer: lockedBytes,
    });

    await expect(page.locator('#pdf-password-input')).toBeVisible();
    await page.locator('#pdf-password-input').fill('wrongpass');
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await expect(page.getByTestId('password-error')).toBeVisible();

    await page.locator('#pdf-password-input').fill('topsecret99');
    await page.getByRole('button', { name: 'Unlock PDF' }).click();
    await expect(page.locator('#pdf-password-input')).toBeHidden();
    await page.getByTestId('toggle-edit-mode-btn').click();
    await expect(page.getByTestId('thumbnail-page-1')).toBeVisible();
    await expect(page.getByTestId('thumbnail-page-2')).toBeVisible();

    // 2. Test 105-page large PDF virtualization
    const largePdf = await createMultiPagePdf(105, 'LargeDoc');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'large-105.pdf',
      mimeType: 'application/pdf',
      buffer: largePdf,
    });
    await page.getByTestId('toggle-edit-mode-btn').click();

    await expect(page.getByTestId('thumbnail-sidebar')).toContainText('Pages (105)');
    const renderedMainCanvases = await page
      .getByTestId('document-viewport')
      .locator('[data-page-canvas-layer="true"]')
      .count();
    // Virtualizer keeps only visible + overscan pages mounted (far less than 105!)
    expect(renderedMainCanvases).toBeGreaterThan(0);
    expect(renderedMainCanvases).toBeLessThan(15);

    // Scroll main viewport down to page 80 smoothly
    const viewport = page.getByTestId('document-viewport');
    await viewport.evaluate((el) => {
      el.scrollTop = el.scrollHeight * 0.75;
    });
    await expect(page.locator('[data-testid="pdf-page-79"], [data-testid="pdf-page-80"]').first()).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('strips deleted background images cleanly, reflows 3-line Turkish paragraphs, and exports full Turkish Unicode without question marks', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText})`);
    });

    await page.goto('/');

    const turkishPdf = await createTurkishFormPdf();
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'turkish-form.pdf',
      mimeType: 'application/pdf',
      buffer: turkishPdf,
    });
    await page.getByTestId('toggle-edit-mode-btn').click();

    const pageEl = page.getByTestId('pdf-page-1');
    const canvas = pageEl.locator('canvas');
    await expect(canvas).toBeVisible();

    const detectedImages = pageEl.locator('[data-detected-image="true"]');
    const detectedTexts = pageEl.locator('[data-detected-text="true"]');
    await expect(detectedImages).toHaveCount(1);
    await expect(detectedTexts.first()).toBeVisible();

    const pdfToDom = async (pdfX: number, pdfY: number) => {
      const box = await pageEl.boundingBox();
      if (!box) throw new Error('pdf-page-1 boundingBox missing');
      return {
        x: box.x + (pdfX / 595) * box.width,
        y: box.y + ((842 - pdfY) / 842) * box.height,
      };
    };

    const samplePdfCanvasArea = async (pdfX: number, pdfY: number, radiusPx = 4) => {
      return canvas.evaluate(
        (c: HTMLCanvasElement, { px, py, rad }) => {
          const ctx = c.getContext('2d');
          if (!ctx || c.width === 0 || c.height === 0) return null;
          const cx = Math.round((px / 595) * c.width);
          const cy = Math.round(((842 - py) / 842) * c.height);
          const x0 = Math.max(0, cx - rad);
          const y0 = Math.max(0, cy - rad);
          const w = Math.min(c.width - x0, rad * 2 + 1);
          const h = Math.min(c.height - y0, rad * 2 + 1);
          const data = ctx.getImageData(x0, y0, w, h).data;
          let minLuma = 255;
          let centerR = 0;
          let centerG = 0;
          let centerB = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luma < minLuma) minLuma = luma;
          }
          const cIdx = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4;
          centerR = data[cIdx];
          centerG = data[cIdx + 1];
          centerB = data[cIdx + 2];
          return { minLuma, centerR, centerG, centerB };
        },
        { px: pdfX, py: pdfY, rad: radiusPx },
      );
    };

    // Wait until watermark tint is visible before deletion at empty interior PDF (280, 220)
    await expect
      .poll(async () => {
        const s = await samplePdfCanvasArea(280, 220, 1);
        return s ? s.centerB - s.centerR : 0;
      })
      .toBeGreaterThan(20);

    // 1. Verify dark maroon banner text preserves white ink color (#ffffff)
    const bannerPt = await pdfToDom(260, 713);
    await page.mouse.click(bannerPt.x, bannerPt.y);
    const bannerEditor = page.getByTestId('inline-text-editor');
    await expect(bannerEditor).toBeVisible();
    await expect(bannerEditor).toHaveText('YURT DIŞI ÖĞRENCİ BİLGİLERİ');
    const colorInput = page.getByTestId('right-inspector').locator('input[type="color"]').first();
    await expect(colorInput).toHaveValue('#ffffff');
    await bannerEditor.press('Escape');
    await expect(bannerEditor).toBeHidden();

    // 2. Delete the large background image watermark and verify underlying table line stays visible
    // Use PDF (280, 530): empty area right between bottom table border (585) and paragraph (470), visible in viewport
    const emptyWatermarkPt = await pdfToDom(280, 530);
    await page.mouse.click(emptyWatermarkPt.x, emptyWatermarkPt.y);
    await page.getByTestId('inspector-delete-btn').click();
    await expect(detectedImages).toHaveCount(0);

    // Wait for MuPDF clean-page preview to finish rendering with watermark stripped & border visible
    await expect
      .poll(async () => {
        const wm = await samplePdfCanvasArea(280, 530, 1);
        const br = await samplePdfCanvasArea(280, 585, 5);
        return (
          !!wm &&
          !!br &&
          wm.centerR > 245 &&
          wm.centerG > 245 &&
          wm.centerB > 245 &&
          br.minLuma < 85
        );
      })
      .toBe(true);

    // Table horizontal border inside deleted watermark box MUST still be dark ink on canvas
    const borderSample = await samplePdfCanvasArea(280, 585, 5);
    expect(borderSample).not.toBeNull();
    expect(borderSample!.minLuma).toBeLessThan(85);

    // Also verify NO descendant overlay inside pdf-page-1 covers that table line with an opaque white box
    const borderDomPt = await pdfToDom(280, 585);
    const hasOpaqueWhiteOverlay = await pageEl.evaluate(
      (pageContainer, { x, y }) => {
        const descendants = Array.from(pageContainer.querySelectorAll('*'));
        return descendants.some((el) => {
          if (el.tagName === 'CANVAS') return false;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
          const style = window.getComputedStyle(el);
          return (
            style.backgroundColor === 'rgb(255, 255, 255)' &&
            parseFloat(style.opacity || '1') > 0.5
          );
        });
      },
      { x: borderDomPt.x, y: borderDomPt.y },
    );
    expect(hasOpaqueWhiteOverlay).toBe(false);

    // 3. Verify 3-line wrapped Turkish paragraph loads as one reflowable block and grows cleanly
    const paraPt = await pdfToDom(220, 456);
    await page.mouse.click(paraPt.x, paraPt.y);
    const paraEditor = page.getByTestId('inline-text-editor');
    await expect(paraEditor).toBeVisible();
    const initialParaValue = (await paraEditor.textContent()) ?? '';
    expect(initialParaValue).toContain('Birinci satır');
    expect(initialParaValue).toContain('yazısı');
    expect(initialParaValue).toContain('bir yazı.');

    const beforeBox = await paraEditor.boundingBox();
    expect(beforeBox).not.toBeNull();

    const updatedPara =
      'Birinci satır örnek eğitim programı kapsamında deneme eklenen uzun Türkçe şğüöçıİŞĞÜÖÇ kelime eklentisiyle birlikte uzayıp giden yeni satır metniyle beraber yazısı üzerinde yapılan detaylı inceleme neticesinde olan bir yazı.';
    await paraEditor.fill(updatedPara);

    await expect
      .poll(async () => {
        const afterBox = await paraEditor.boundingBox();
        return afterBox ? afterBox.height : 0;
      })
      .toBeGreaterThan(beforeBox!.height + 16);

    await paraEditor.press('Escape');
    await expect(paraEditor).toBeHidden();
    await expect(page.getByTestId('inspector-text-content')).toHaveValue(updatedPara);

    // 4. Add a new Turkish + currency (₺) custom text block
    await page.getByTestId('document-viewport').evaluate((el) => {
      el.scrollTop = 360;
    });
    await page.getByTestId('tool-text').click();
    const customTextPt = await pdfToDom(180, 260);
    await page.mouse.click(customTextPt.x, customTextPt.y);
    const newEditor = page.getByTestId('inline-text-editor');
    await expect(newEditor).toBeVisible();
    await newEditor.fill('Fiyat: ₺1.250 — Bağlantı şığöüç ŞİĞÖÜÇ');
    await newEditor.press('Escape');

    // 5. Export final PDF and inspect with MuPDF
    const [pdfDownload] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByTestId('export-pdf-btn').click();
        await page.getByTestId('save-as-copy-btn').click();
      })(),
    ]);
    const pdfStream = await pdfDownload.createReadStream();
    const exportedPdfBytes = await readDownloadBytes(pdfStream!);

    const expInfo = await getE2ePdfInfo(exportedPdfBytes);
    expect(expInfo.pageCount).toBe(1);
    const exportedText = await extractE2ePageText(exportedPdfBytes, 0);
    const imgCount = await countE2ePageImages(exportedPdfBytes, 0);

    const normalizedExportText = exportedText.replace(/\s+/g, ' ');
    expect(imgCount).toBe(0);
    expect(normalizedExportText).toContain(
      'eklenen uzun Türkçe şğüöçıİŞĞÜÖÇ kelime eklentisiyle birlikte uzayıp giden',
    );
    expect(normalizedExportText).toContain('olan bir yazı.');
    expect(normalizedExportText).toContain('YURT DIŞI ÖĞRENCİ BİLGİLERİ');
    expect(normalizedExportText).toContain('Öğrenim Görülecek Ülke');
    expect(normalizedExportText).toContain('Fiyat: ₺1.250 — Bağlantı şığöüç ŞİĞÖÜÇ');
    expect(exportedText).not.toContain('?');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test('keeps behind-content watermark behind table lines on click/drag, preserves fonts, maintains justify alignment, and preserves superscripts/subscripts', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText})`);
    });

    const wmPngBytes = createE2ePngBytes(80, 60, undefined, [245, 210, 210, 255]);
    const uoDir = path.resolve(process.cwd(), 'node_modules/@universal-office/font-files');
    const serifRegBytes = new Uint8Array(
      fs.readFileSync(path.join(uoDir, 'liberationserif-regular.ttf')),
    );
    const calibriRegBytes = new Uint8Array(
      fs.readFileSync(path.join(uoDir, 'carlito-regular.ttf')),
    );

    const buildJustifiedTexts = async (words: string[], yPdf: number, leftX: number, rightX: number) => {
      const widths = await Promise.all(words.map((w) => measureE2eTtfWidth(serifRegBytes, w, 11)));
      const totalWordW = widths.reduce((s, w) => s + w, 0);
      const gap = (rightX - leftX - totalWordW) / (words.length - 1);
      let curX = leftX;
      return words.map((w, idx) => {
        const entry = {
          text: w,
          x: curX,
          yPdf,
          fontSize: 11,
          color: [0, 0, 0] as [number, number, number],
          fontKey: 'serif',
        };
        curX += widths[idx] + gap;
        return entry;
      });
    };

    const row1 = await buildJustifiedTexts(
      ['Öğrencinin', 'yurt', 'dışı', 'öğrenim', 'süreci', 'hakkında', 'hazırlanan', 'resmi'],
      430,
      54,
      540,
    );
    const row2 = await buildJustifiedTexts(
      ['belge', 'bütün', 'kurallar', 'çerçevesinde', 'iki', 'yana', 'yaslı', 'hizalı'],
      414,
      54,
      540,
    );

    const scriptParts: Array<{ txt: string; sz: number; yPdf: number }> = [
      { txt: 'Alan 10', sz: 12, yPdf: 340 },
      { txt: '2', sz: 8, yPdf: 345 },
      { txt: ' ve kimyasal H', sz: 12, yPdf: 340 },
      { txt: '2', sz: 8, yPdf: 336.5 },
      { txt: 'O ölçümü Madde 9', sz: 12, yPdf: 340 },
    ];
    let sx = 54;
    const scriptTexts: Array<{
      text: string;
      x: number;
      yPdf: number;
      fontSize: number;
      color: [number, number, number];
      fontKey: string;
    }> = [];
    for (const sp of scriptParts) {
      scriptTexts.push({
        text: sp.txt,
        x: sx,
        yPdf: sp.yPdf,
        fontSize: sp.sz,
        color: [0, 0, 0],
        fontKey: 'serif',
      });
      sx += await measureE2eTtfWidth(serifRegBytes, sp.txt, sp.sz);
    }

    const pdfBytes = Buffer.from(
      await buildE2ePdf(
        [
          {
            width: 595,
            height: 842,
            images: [{ pngBytes: wmPngBytes, x: 120, yPdf: 480, width: 350, height: 220 }],
            lines: [{ x1: 54, y1Pdf: 590, x2: 540, y2Pdf: 590, stroke: [0, 0, 0], strokeWidth: 3 }],
            texts: [
              { text: 'Resmi Tablo Başlığı', x: 64, yPdf: 605, fontSize: 12, color: [0, 0, 0], fontKey: 'serif' },
              ...row1,
              ...row2,
              { text: 'biçimde sunulmaktadır.', x: 54, yPdf: 398, fontSize: 11, color: [0, 0, 0], fontKey: 'serif' },
              ...scriptTexts,
              { text: 'Calibri Font Örneği', x: 54, yPdf: 270, fontSize: 12, color: [0, 0, 0], fontKey: 'calibri' },
            ],
          },
        ],
        {
          customFonts: {
            serif: serifRegBytes,
            calibri: calibriRegBytes,
          },
        },
      ),
    );

    await page.goto('/');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'fidelity-check.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBytes,
    });
    await page.getByTestId('toggle-edit-mode-btn').click();

    const pageEl = page.getByTestId('pdf-page-1');
    const canvas = pageEl.locator('canvas');
    await expect(canvas).toBeVisible();
    await expect(pageEl.locator('[data-detected-image="true"]')).toHaveCount(1);

    const pdfToDom = async (pdfX: number, pdfY: number) => {
      const box = await pageEl.boundingBox();
      if (!box) throw new Error('pdf-page-1 boundingBox missing');
      return {
        x: box.x + (pdfX / 595) * box.width,
        y: box.y + ((842 - pdfY) / 842) * box.height,
      };
    };

    const samplePdfCanvasArea = async (pdfX: number, pdfY: number, radiusPx = 4) =>
      canvas.evaluate(
        (c: HTMLCanvasElement, { px, py, rad }) => {
          const ctx = c.getContext('2d');
          if (!ctx || c.width === 0 || c.height === 0) return null;
          const cx = Math.round((px / 595) * c.width);
          const cy = Math.round(((842 - py) / 842) * c.height);
          const x0 = Math.max(0, cx - rad);
          const y0 = Math.max(0, cy - rad);
          const w = Math.min(c.width - x0, rad * 2 + 1);
          const h = Math.min(c.height - y0, rad * 2 + 1);
          const data = ctx.getImageData(x0, y0, w, h).data;
          let minLuma = 255;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3] / 255;
            const r = data[i] * a + 255 * (1 - a);
            const g = data[i + 1] * a + 255 * (1 - a);
            const b = data[i + 2] * a + 255 * (1 - a);
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            if (luma < minLuma) minLuma = luma;
          }
          return { minLuma };
        },
        { px: pdfX, py: pdfY, rad: radiusPx },
      );

    // 1. Clicking & dragging behind-content watermark must NEVER jump opaque img over black table line
    await expect
      .poll(async () => (await samplePdfCanvasArea(280, 590, 5))?.minLuma ?? 255)
      .toBeLessThan(85);

    const wmPt = await pdfToDom(280, 530);
    await page.mouse.click(wmPt.x, wmPt.y);
    const selBox = page.locator('[data-testid^="selection-box-"]').first();
    await expect(selBox).toBeVisible();
    await expect(page.getByTestId('inspector-behind-content-toggle')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('inspector-behind-content-toggle')).toContainText(
      'Behind PDF Content (Watermark)',
    );

    // Ensure NO opaque DOM element sits on top of the black table border at (280, 590)
    const borderDomPt = await pdfToDom(280, 590);
    const hasOpaqueImgOverBorder = await page.evaluate(({ x, y }) => {
      const stack = document.elementsFromPoint(x, y);
      for (const el of stack) {
        if (el.tagName === 'CANVAS') return false;
        if (el.tagName === 'IMG') {
          const st = window.getComputedStyle(el);
          if (parseFloat(st.opacity || '1') > 0.3 && st.mixBlendMode === 'normal') return true;
        }
      }
      return false;
    }, borderDomPt);
    expect(hasOpaqueImgOverBorder).toBe(false);

    // Drag behind-content watermark slightly (+18, +8) and confirm:
    //  a) clean paper area remains white/transparent (NEVER opaque black!)
    //  b) black table border remains dark & crisp on canvas in front of watermark
    await page.mouse.move(wmPt.x, wmPt.y);
    await page.mouse.down();
    await page.mouse.move(wmPt.x + 18, wmPt.y + 8, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const paper = await canvas.evaluate((c: HTMLCanvasElement) => {
          const ctx = c.getContext('2d');
          if (!ctx || c.width < 100 || c.height < 100) return null;
          const cx = Math.round((80 / 595) * c.width);
          const cy = Math.round(((842 - 750) / 842) * c.height);
          const d = ctx.getImageData(cx, cy, 1, 1).data;
          return { r: d[0], g: d[1], b: d[2], a: d[3] };
        });
        const br = await samplePdfCanvasArea(280, 590, 5);
        const paperOk =
          !!paper && (paper.a === 0 || (paper.r > 240 && paper.g > 240 && paper.b > 240));
        return paperOk && !!br && br.minLuma < 85;
      })
      .toBe(true);

    // 2. Verify Calibri font detection is preserved cleanly
    const calibriPt = await pdfToDom(90, 274);
    await page.mouse.click(calibriPt.x, calibriPt.y);
    const calEditor = page.getByTestId('inline-text-editor');
    await expect(calEditor).toBeVisible();
    await expect(page.getByTestId('inspector-font-family')).toHaveValue('Calibri');
    await calEditor.press('Escape');

    // 3. Verify inline superscript & subscript do NOT flatten + vertical offset stays compact + super button works
    const scriptPt = await pdfToDom(120, 342);
    await page.mouse.click(scriptPt.x, scriptPt.y);
    const scriptEditor = page.getByTestId('inline-text-editor');
    await expect(scriptEditor).toBeVisible();
    await expect(page.getByTestId('inspector-font-family')).toHaveValue('TimesRoman');
    await expect(scriptEditor.locator('sup')).toHaveCount(1);
    await expect(scriptEditor.locator('sup').first()).toHaveText('2');
    await expect(scriptEditor.locator('sub')).toHaveCount(1);
    await expect(scriptEditor.locator('sub').first()).toHaveText('2');

    const edBox = await scriptEditor.boundingBox();
    const supBox = await scriptEditor.locator('sup').first().boundingBox();
    expect(edBox).not.toBeNull();
    expect(supBox).not.toBeNull();
    expect(supBox!.y).toBeGreaterThanOrEqual(edBox!.y - 2);
    expect(supBox!.y + supBox!.height).toBeLessThan(edBox!.y + edBox!.height * 0.78);

    // Select trailing '9' inside inline editor and toggle superscript via Inspector button
    await scriptEditor.evaluate((container) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let lastNode: Text | null = null;
      let cur = walker.nextNode() as Text | null;
      while (cur) {
        if ((cur.textContent ?? '').includes('9')) lastNode = cur;
        cur = walker.nextNode() as Text | null;
      }
      if (!lastNode) throw new Error('Expected trailing 9 text node');
      const idx = lastNode.textContent!.lastIndexOf('9');
      const range = document.createRange();
      range.setStart(lastNode, idx);
      range.setEnd(lastNode, idx + 1);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await page.getByTestId('inspector-super-btn').click();
    await expect(scriptEditor.locator('sup')).toHaveCount(2);
    await expect(scriptEditor.locator('sup').nth(1)).toHaveText('9');
    await scriptEditor.press('Escape');
    await expect(scriptEditor).toBeHidden();

    // Verify static rendered canvas overlay keeps <sup> and <sub> nodes after closing inline editor
    const scriptStaticEl = pageEl.locator('[data-testid^="canvas-element-"]').filter({
      hasText: 'Alan 102',
    });
    await expect(scriptStaticEl.locator('sup')).toHaveCount(2);
    await expect(scriptStaticEl.locator('sub')).toHaveCount(1);

    // 4. Verify justified multi-line paragraph retains justify alignment in editor & edits cleanly
    const justPt = await pdfToDom(150, 416);
    await page.mouse.click(justPt.x, justPt.y);
    const justEditor = page.getByTestId('inline-text-editor');
    await expect(justEditor).toBeVisible();
    const cssAlign = await justEditor.evaluate((el) => window.getComputedStyle(el).textAlign);
    expect(cssAlign).toBe('justify');

    const origJustText = (await justEditor.textContent()) ?? '';
    await justEditor.fill(
      origJustText.replace(
        'resmi belge',
        'üniversite uluslararası ilişkiler koordinatörlüğü tarafından onaylanan resmi Türkçe şğüöçıİŞĞÜÖÇ belge',
      ),
    );
    await justEditor.press('Escape');

    // 5. Export final PDF & validate all 4 properties in MuPDF output
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByTestId('export-pdf-btn').click();
        await page.getByTestId('save-as-copy-btn').click();
      })(),
    ]);
    const exportedBytes = await readDownloadBytes((await dl.createReadStream())!);
    const { width: w, samples: px } = await renderE2ePageRgba(exportedBytes, 0, 1);
    const n = 4;
    let minLuma = 255;
    for (let dy = -3; dy <= 3; dy++) {
      const idx = ((252 + dy) * w + 280) * n;
      const luma = 0.2126 * px[idx] + 0.7152 * px[idx + 1] + 0.0722 * px[idx + 2];
      if (luma < minLuma) minLuma = luma;
    }
    expect(minLuma).toBeLessThan(60);

    const chars = await extractE2ePageCharsWithBoxes(exportedBytes, 0);
    const justRows: Array<{ y: number; x0: number; x1: number }> = [];
    const scriptGlyphs: Array<{ c: string; y: number; size: number }> = [];
    for (const ch of chars) {
      if (ch.yTop >= 400 && ch.yTop <= 465) {
        const row = justRows.find((r) => Math.abs(r.y - ch.yTop) <= 2.5);
        if (row) {
          row.x0 = Math.min(row.x0, ch.x0);
          row.x1 = Math.max(row.x1, ch.x1);
        } else {
          justRows.push({ y: ch.yTop, x0: ch.x0, x1: ch.x1 });
        }
      }
      if (ch.yTop >= 480 && ch.yTop <= 530) {
        scriptGlyphs.push({ c: ch.c, y: ch.yTop, size: ch.fontSize });
      }
    }

    justRows.sort((a, b) => a.y - b.y);
    expect(justRows.length).toBeGreaterThanOrEqual(3);
    expect(justRows[0].x1).toBeGreaterThan(528);
    expect(justRows[1].x1).toBeGreaterThan(528);
    expect(justRows[justRows.length - 1].x1).toBeLessThan(480);

    const baseH = scriptGlyphs.find((g) => g.c === 'H');
    const sup2 = scriptGlyphs.find((g) => g.c === '2' && baseH && g.y < baseH.y - 2);
    const sup9 = scriptGlyphs.find((g) => g.c === '9' && baseH && g.y < baseH.y - 2);
    const sub2 = scriptGlyphs.find((g) => g.c === '2' && baseH && g.y > baseH.y + 1.5);
    expect(baseH).toBeDefined();
    expect(sup2).toBeDefined();
    expect(sup9).toBeDefined();
    expect(sub2).toBeDefined();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });

  test('validates table column boundaries, rotated resize cursors, Shift+Click organize, ghost ink Paraf, repeating watermarks, and dynamic page numbers', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // Build a 4-page multi-column PDF with overlapping header image + vertical table rules + custom font name
    const ttfDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
    const regularBytes = fs.readFileSync(path.join(ttfDir, 'DejaVuSerif.ttf'));
    const acmeBrandFont = patchTtfFontForTest(regularBytes, {
      postscriptName: 'AcmeCorpBrand-Bold',
    });

    const pdfBuffer = Buffer.from(
      await buildE2ePdf(
        [
          {
            width: 595,
            height: 842,
            images: [{ pngBytes: createWatermarkPngBuffer(), x: 40, yPdf: 710, width: 515, height: 100 }],
            lines: [{ x1: 220, y1Pdf: 580, x2: 220, y2Pdf: 640, stroke: [0, 0, 0], strokeWidth: 1.5 }],
            texts: [
              { text: 'Header Overlap Title', x: 80, yPdf: 755, fontSize: 16, fontKey: 'acmeBrand' },
              { text: 'Cell Alpha', x: 75, yPdf: 605, fontSize: 12 },
              { text: 'Cell Beta', x: 245, yPdf: 605, fontSize: 12 },
            ],
          },
          ...[2, 3, 4].map((k) => ({
            width: 595,
            height: 842,
            texts: [{ text: `Body Page ${k}`, x: 72, yPdf: 760, fontSize: 12 }],
          })),
        ],
        { customFonts: { acmeBrand: acmeBrandFont } },
      ),
    );

    await page.goto('/');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'comprehensive-qa.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });
    await page.getByTestId('toggle-edit-mode-btn').click();

    const page1El = page.getByTestId('pdf-page-1');
    await expect(page1El.locator('canvas')).toBeVisible();
    await expect(page1El.locator('[data-detected-image="true"]')).toHaveCount(1);

    const pdfToDom = async (el: typeof page1El, pdfX: number, pdfY: number) => {
      const box = await el.boundingBox();
      if (!box) throw new Error('page boundingBox missing');
      return {
        x: box.x + (pdfX / 595) * box.width,
        y: box.y + ((842 - pdfY) / 842) * box.height,
      };
    };

    // 1. Header image click MUST NOT trap overlapping text underneath
    const imgOnlyPt = await pdfToDom(page1El, 480, 760);
    await page.mouse.click(imgOnlyPt.x, imgOnlyPt.y);
    await expect(page.getByTestId('inspector-layer-tier-badge')).toContainText('Tier 1');

    // Deselect & click overlapping text directly -> text editor opens with custom font fallback banner!
    await page.keyboard.press('Escape');
    const overlapTextPt = await pdfToDom(page1El, 120, 760);
    await page.mouse.click(overlapTextPt.x, overlapTextPt.y);
    const editor = page.getByTestId('inline-text-editor');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('Header Overlap Title');
    await expect(page.getByTestId('custom-font-active-banner')).toBeVisible();
    await expect(page.getByTestId('inspector-custom-font-active')).toContainText(
      'AcmeCorpBrand',
    );
    await page.keyboard.press('Escape');

    // Alt+Click on overlapping heading cycles to underlying image!
    await page.keyboard.down('Alt');
    await page.mouse.click(overlapTextPt.x, overlapTextPt.y);
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('inspector-layer-tier-badge')).toContainText('Tier 1');
    await page.keyboard.press('Escape');

    // 2. Bordered table columns stay separate
    const cellAlphaPt = await pdfToDom(page1El, 95, 610);
    await page.mouse.click(cellAlphaPt.x, cellAlphaPt.y);
    await expect(page.getByTestId('inline-text-editor')).toBeVisible();
    const alphaText = (await page.getByTestId('inline-text-editor').textContent()) ?? '';
    expect(alphaText).toContain('Cell Alpha');
    expect(alphaText).not.toContain('Cell Beta');

    // 3. Rotated bounding box resize cursor rotates dynamically
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inspector-rotation-input')).toBeVisible();
    await page.getByTestId('inspector-rotation-input').fill('90');
    await page.getByTestId('inspector-rotation-input').press('Enter');
    const nwHandle = page.getByTestId('resize-handle-nw');
    await expect(nwHandle).toBeVisible();
    const rotatedCursor = await nwHandle.evaluate((el) => window.getComputedStyle(el).cursor);
    expect(rotatedCursor).toBe('ne-resize');

    // 4. Shift+Click contiguous range selection in Organize Pages
    await page.getByTestId('tool-organize').click();
    const p2Thumb = page.getByRole('dialog').getByTestId('thumbnail-page-2');
    const p4Thumb = page.getByRole('dialog').getByTestId('thumbnail-page-4');
    await p2Thumb.click();
    await p4Thumb.click({ modifiers: ['Shift'] });
    await expect(p2Thumb).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('dialog').getByTestId('thumbnail-page-3')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(p4Thumb).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Close organizer').click();

    // 5. Realistic Ink Initials (Paraf) + Ghost Cursor + Multi-signature placement + Apply All
    await page.getByTestId('tool-signature').click();
    await expect(page.getByTestId('realistic-ink-toggle')).toContainText('Orijinal Görünümlü Ink ON');
    await page.getByTestId('signature-variant-initials').click();
    const drawCanvas = page.locator('canvas[data-testid="signature-draw-canvas"]');
    const sigCanvasBox = await drawCanvas.boundingBox();
    if (!sigCanvasBox) throw new Error('signature canvas missing');
    await page.mouse.move(sigCanvasBox.x + 40, sigCanvasBox.y + 80);
    await page.mouse.down();
    await page.mouse.move(sigCanvasBox.x + 180, sigCanvasBox.y + 45, { steps: 6 });
    await page.mouse.up();
    await page.getByTestId('signature-place-btn').click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // Hover shows ghost cursor preview, click drops first independent Paraf
    const dropPt1 = await pdfToDom(page1El, 460, 500);
    await page.mouse.move(dropPt1.x, dropPt1.y);
    await expect(page.getByTestId('signature-ghost-preview')).toBeVisible();
    await page.mouse.click(dropPt1.x, dropPt1.y);
    await expect(page.getByTestId('signature-ghost-preview')).toHaveCount(0);

    // Second placement from vault does not overwrite first
    await page.getByTestId('tool-signature').click();
    await page.getByRole('button', { name: 'Place', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden();
    const dropPt2 = await pdfToDom(page1El, 250, 480);
    await page.mouse.click(dropPt2.x, dropPt2.y);

    // Apply across pages
    await page.getByTestId('inspector-apply-sig-pages-btn').click();

    // 6. Repeating Image ("Her Sayfaya Ekle") on Page 1 -> synced across all 4 pages
    await page.getByTestId('insert-image-input').setInputFiles({
      name: 'logo-stamp.png',
      mimeType: 'image/png',
      buffer: Buffer.from(createPngBuffer()),
    });
    await expect(page.getByTestId('inspector-repeat-image-btn')).toBeVisible();
    await page.getByTestId('inspector-repeat-image-btn').click();
    await expect(page.getByText('Linked across all pages')).toBeVisible();

    // 7. Dynamic Page Numbers ("Sayfa Numarası Ekle") + Export PDF round-trip check
    await page.getByTestId('toolbar-page-numbers-btn').click();
    await page.getByTestId('pgnum-format-select').selectOption('page-number-of-total');
    await page.getByTestId('pgnum-skip-cover-checkbox').check();
    await expect(page.getByTestId('pgnum-sample-preview')).toContainText('Sayfa 1 / 3');
    await page.getByTestId('pgnum-apply-btn').click();

    await expect(page.getByTestId('page-number-preview-1')).toHaveCount(0);
    await page.getByTestId('thumbnail-page-2').click();
    await expect(page.getByTestId('page-number-preview-2')).toContainText('Sayfa 1 / 3');

    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByTestId('export-pdf-btn').click();
        await page.getByTestId('save-as-copy-btn').click();
      })(),
    ]);
    const outBytes = await readDownloadBytes((await dl.createReadStream())!);
    expect(await extractE2ePageText(outBytes, 1)).toContain('Sayfa 1 / 3');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('supports extracted subset custom fonts, user custom font upload/auto-match, expanded font library, and shaded mixed-style multi-line paragraphs', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const djDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
    const uoDir = path.resolve(process.cwd(), 'node_modules/@universal-office/font-files');
    const djBoldBytes = fs.readFileSync(path.join(djDir, 'DejaVuSans-Bold.ttf'));
    const djSerifRegBytes = fs.readFileSync(path.join(djDir, 'DejaVuSerif.ttf'));
    const djSerifBoldBytes = fs.readFileSync(path.join(djDir, 'DejaVuSerif-Bold.ttf'));
    const libSansBoldPath = path.join(uoDir, 'liberationsans-bold.ttf');
    const libSansRegPath = path.join(uoDir, 'liberationsans-regular.ttf');
    const libSansBoldBytes = fs.readFileSync(libSansBoldPath);

    const subsetBrandFont = patchTtfFontForTest(djBoldBytes, {
      postscriptName: 'AcmeSubsetBrand-Bold',
      subsetChars: 'CUSTOM BRAND HEADERABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ',
    });
    const libBrandFont = patchTtfFontForTest(libSansBoldBytes, {
      postscriptName: 'LiberationSans-Bold',
      subsetChars: 'TARGET UPLOAD MATCH TEXT',
    });

    const leadStr = 'Önemli Not: ';
    const leadWidth = await measureE2eTtfWidth(djSerifBoldBytes, leadStr, 11);

    const pdfBuffer = Buffer.from(
      await buildE2ePdf(
        [
          {
            width: 595,
            height: 842,
            rects: [{ x: 52, yPdf: 590, width: 490, height: 22, fill: [252, 245, 214] }],
            texts: [
              { text: 'CUSTOM BRAND HEADER', x: 60, yPdf: 760, fontSize: 16, fontKey: 'subsetBrand' },
              {
                text: 'TARGET UPLOAD MATCH TEXT',
                x: 60,
                yPdf: 700,
                fontSize: 13,
                color: [26, 51, 102],
                fontKey: 'libBrand',
              },
              { text: leadStr, x: 60, yPdf: 596, fontSize: 11, fontKey: 'leadBold' },
              {
                text: 'bu başvuru kapsamındaki tüm onaylı eğitim belgeleri',
                x: 60 + leadWidth,
                yPdf: 596,
                fontSize: 11,
                fontKey: 'bodySerif',
              },
              {
                text: 'ilgili akademik koordinatörlük birimine zamanında teslim',
                x: 60,
                yPdf: 580,
                fontSize: 11,
                fontKey: 'bodySerif',
              },
              { text: 'edilmelidir.', x: 60, yPdf: 564, fontSize: 11, fontKey: 'bodySerif' },
            ],
          },
        ],
        {
          customFonts: {
            subsetBrand: subsetBrandFont,
            libBrand: libBrandFont,
            leadBold: djSerifBoldBytes,
            bodySerif: djSerifRegBytes,
          },
        },
      ),
    );
    await page.goto('/');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'custom-fonts-and-paragraphs.pdf',
      mimeType: 'application/pdf',
      buffer: pdfBuffer,
    });
    await page.getByTestId('toggle-edit-mode-btn').click();

    const page1El = page.getByTestId('pdf-page-1');
    await expect(page1El.locator('canvas')).toBeVisible();
    await expect(page1El.locator('[data-detected-text="true"]').first()).toBeVisible();

    const pdfToDom = async (pdfX: number, pdfY: number) => {
      const box = await page1El.boundingBox();
      if (!box) throw new Error('page boundingBox missing');
      return {
        x: box.x + (pdfX / 595) * box.width,
        y: box.y + ((842 - pdfY) / 842) * box.height,
      };
    };

    // A. Click subsetted custom PDF font block -> repaired & actively used (`embedded-complete`)
    const headerPt = await pdfToDom(120, 766);
    await page.mouse.click(headerPt.x, headerPt.y);
    const editor = page.getByTestId('inline-text-editor');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('CUSTOM BRAND HEADER');
    await expect(page.getByTestId('custom-font-active-banner')).toBeVisible();
    await expect(page.getByTestId('inspector-custom-font-active')).toBeVisible();

    // Check expanded font library dropdown (>= 16 standard/built-in options + embedded optgroup)
    const optionCount = await page.getByTestId('inspector-font-family').locator('option').count();
    expect(optionCount).toBeGreaterThanOrEqual(16);

    // Type Turkish glyphs absent from subset -> banner transitions live to partial-subset warning
    await editor.fill('CUSTOM ŞİĞÜ HEADER');
    await expect(page.getByTestId('custom-font-warning-banner')).toBeVisible();
    await expect(page.getByTestId('inspector-custom-font-warning')).toBeVisible();
    await page.keyboard.press('Escape');

    // B. Upload custom TTF files (`LiberationSans`) -> automatically upgrades matching block to `user:*`
    const libPt = await pdfToDom(120, 705);
    await page.mouse.click(libPt.x, libPt.y);
    await expect(page.getByTestId('inline-text-editor')).toContainText('TARGET UPLOAD MATCH TEXT');

    await page
      .getByTestId('upload-custom-font-input')
      .setInputFiles([libSansRegPath, libSansBoldPath]);
    await expect(page.getByTestId('font-upload-status')).toBeVisible();
    await expect(page.getByTestId('inspector-font-family')).toHaveValue(/^user:liberationsans/);
    await expect(page.getByTestId('custom-font-active-banner')).toBeVisible();
    await expect(page.getByTestId('inspector-custom-font-active')).toContainText('Liberation Sans');
    await page.getByTestId('inline-text-editor').fill('Öğrenci ŞİĞÜ Özel Fontu');
    await page.keyboard.press('Escape');

    // C. Click the 3-line shaded mixed-weight Turkish paragraph -> must select ALL 3 lines as 1 unified block
    const paraPt = await pdfToDom(150, 600);
    await page.mouse.click(paraPt.x, paraPt.y);
    await expect(page.getByTestId('inline-text-editor')).toBeVisible();
    const paraText = (await page.getByTestId('inline-text-editor').textContent()) ?? '';
    expect(paraText).toContain('Önemli Not:');
    expect(paraText).toContain('koordinatörlük');
    expect(paraText).toContain('edilmelidir.');
    await page.keyboard.press('Escape');

    // D. Export edited PDF -> verify both subset-fallback Turkish text and user-uploaded font text round-trip
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.getByTestId('export-pdf-btn').click();
        await page.getByTestId('save-as-copy-btn').click();
      })(),
    ]);
      const outBytes = await readDownloadBytes((await dl.createReadStream())!);
      const exportedText = await extractE2ePageText(outBytes, 0);
      expect(exportedText).toContain('CUSTOM');
      expect(exportedText).toContain('ŞİĞÜ');
      expect(exportedText).toContain('Öğrenci ŞİĞÜ Özel Fontu');

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('runs cleanly from a GitHub Pages subpath (/my-github-repo/) without COOP/COEP headers', async ({
    page,
  }) => {
    const distRoot = path.resolve(process.cwd(), 'dist');
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.mjs': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.wasm': 'application/wasm',
      '.ttf': 'font/ttf',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    };

    const server = http.createServer((req, res) => {
      const reqPath = (req.url || '/').split('?')[0];
      const prefix = '/my-github-repo';
      if (!reqPath.startsWith(prefix)) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      let rel = reqPath.slice(prefix.length).replace(/^\/+/, '');
      if (!rel) rel = 'index.html';
      const target = path.resolve(distRoot, rel);
      if (!target.startsWith(distRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }
      const ext = path.extname(target).toLowerCase();
      res.setHeader('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
      fs.createReadStream(target).pipe(res);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      server.close();
      throw new Error('Failed to bind subpath static test server');
    }

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    const notFoundUrls: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} (${req.failure()?.errorText})`);
    });
    page.on('response', (resp) => {
      if (resp.status() >= 400) {
        notFoundUrls.push(`${resp.status()} ${resp.url()}`);
      }
    });

    try {
      await page.goto(`http://127.0.0.1:${addr.port}/my-github-repo/`);

      // Plain static hosts (such as GitHub Pages) do not send COOP/COEP headers
      const isolated = await page.evaluate(() => window.crossOriginIsolated);
      expect(isolated).toBe(false);

      await page.getByTestId('welcome-sample-btn').click();
      await page.getByTestId('toggle-edit-mode-btn').click();
      await expect(page.getByTestId('thumbnail-page-1')).toBeVisible();
      const page1Canvas = page.getByTestId('pdf-page-1').locator('canvas');
      await expect(page1Canvas).toBeVisible();
      await expect
        .poll(async () => page1Canvas.evaluate((c: HTMLCanvasElement) => c.width))
        .toBeGreaterThan(200);

      // Verify Wasm MuPDF worker + PDF.js extraction & export both succeed under subpath
      const detectedText = page.getByTestId('pdf-page-1').locator('[data-detected-text="true"]').first();
      await expect(detectedText).toBeVisible();
      await detectedText.click();
      await expect(page.getByTestId('inline-text-editor')).toBeVisible();
      await page.getByTestId('inline-text-editor').fill('GitHub Pages Türkçe ŞİĞÜ Doğrulama');
      await page.keyboard.press('Escape');

      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        (async () => {
        await page.getByTestId('export-pdf-btn').click();
        await page.getByTestId('save-as-copy-btn').click();
      })(),
      ]);
      const outBytes = await readDownloadBytes((await dl.createReadStream())!);
      const normalized = (await extractE2ePageText(outBytes, 0)).replace(/\s+/g, ' ');
      expect(normalized).toContain('GitHub Pages Türkçe ŞİĞÜ Doğrulama');

      expect(notFoundUrls).toEqual([]);
      expect(failedRequests).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
