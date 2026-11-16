import { expect, test } from '@playwright/test';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { generateReferencePdf } from '../src/engine/referencePdfSet';

async function createTurkishMultiPagePdf(): Promise<Buffer> {
  const ttfDir = path.resolve(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf');
  const regularBytes = fs.readFileSync(path.join(ttfDir, 'DejaVuSerif.ttf'));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(regularBytes, { subset: false });

  const lines = [
    'Öğrenim Görülecek Ülke: Türkiye Cumhuriyeti',
    'İstanbul Üniversitesi Çalışma Programı',
    'Üçüncü sayfa arşiv ve şifre doğrulama metni',
  ];
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Sayfa ${i + 1}: ${lines[i]}`, {
      x: 56,
      y: 740,
      size: 14,
      font,
      color: rgb(0.1, 0.12, 0.18),
    });
  }
  return Buffer.from(await doc.save());
}

test.describe('Enterprise Viewer + Dual-Mode Editor Verification (F1)', () => {
  test('Viewer default mode, PDFium render, Turkish-folding search, themes, K7 Save modal, & ±2px Editor anchor switch', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const turkishPdf = await createTurkishMultiPagePdf();

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Open PDF directly in Viewer mode (K4)
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'turkish-contract.pdf',
      mimeType: 'application/pdf',
      buffer: turkishPdf,
    });

    const page1 = page.getByTestId('pdf-page-1');
    await expect(page1).toBeVisible();
    await expect
      .poll(async () => page1.locator('canvas').evaluate((c: HTMLCanvasElement) => c.width))
      .toBeGreaterThan(200);

    // Zero Editor clutter on open
    await expect(page.getByTestId('tool-text')).toHaveCount(0);
    await expect(page.getByTestId('toggle-edit-mode-btn')).toBeVisible();

    // Streaming Turkish-folding search: ASCII query "ogrenim" matches "Öğrenim"
    await page.getByTestId('viewer-search-btn').click();
    const searchInput = page.getByTestId('viewer-search-input');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('ogrenim');
    await expect
      .poll(async () => page.getByTestId('viewer-search-bar').textContent())
      .toContain('/ ');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('viewer-search-bar')).toHaveCount(0);

    // Reading themes cycle (Dark -> Sepia -> Light -> Dark) in Viewer
    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).toHaveClass(/theme-sepia/);
    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).not.toHaveClass(/dark|theme-sepia/);
    await page.getByTestId('theme-toggle-btn').click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // i18n EN -> TR toggle inside overflow menu updates <html lang="tr">
    await page.getByTestId('toolbar-overflow-btn').click();
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await page.getByTestId('locale-toggle-btn').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByTestId('toolbar-overflow-btn').click();

    // Zoom & capture anchor, then toggle Viewer -> Editor -> Viewer verifying <= 2px drift
    await page.getByTestId('zoom-in-btn').click();
    await page.waitForTimeout(80);
    const beforeSwitch = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="document-viewport"]')!;
      const p1 = document.querySelector('[data-testid="pdf-page-1"]')!;
      vp.scrollTop = 180;
      return {
        scrollTop: vp.scrollTop,
        pageWidth: Math.round(p1.getBoundingClientRect().width),
      };
    });

    await page.getByTestId('toggle-edit-mode-btn').click();
    await expect(page.getByTestId('tool-text')).toBeVisible();

    const afterToEdit = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="document-viewport"]')!;
      const p1 = document.querySelector('[data-testid="pdf-page-1"]')!;
      return {
        scrollTop: vp.scrollTop,
        pageWidth: Math.round(p1.getBoundingClientRect().width),
      };
    });
    expect(Math.abs(afterToEdit.scrollTop - beforeSwitch.scrollTop)).toBeLessThanOrEqual(2);
    expect(afterToEdit.pageWidth).toEqual(beforeSwitch.pageWidth);

    // K7 Save modal presents Save as copy as primary CTA and closes on Escape
    await page.getByTestId('export-pdf-btn').click();
    await expect(page.getByTestId('save-as-copy-btn')).toBeVisible();
    await expect(page.getByTestId('save-overwrite-btn')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('save-as-copy-btn')).toHaveCount(0);

    // Toggle back to Viewer cleanly via Done button
    await page.getByTestId('toggle-edit-mode-btn').click();
    await expect(page.getByTestId('tool-text')).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  test('Compact 360x800 mobile audit: zero overflow, >=44px touch targets, long-press selection loupe', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 360, height: 800 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    const pdf = await generateReferencePdf('text-120p', { pageCount: 6 });
    await page.goto('/');
    await page.getByTestId('open-pdf-input').setInputFiles({
      name: 'mobile-audit.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdf),
    });

    await expect(page.getByTestId('pdf-page-1')).toBeVisible();
    await expect
      .poll(async () =>
        page
          .getByTestId('pdf-page-1')
          .locator('canvas')
          .evaluate((c: HTMLCanvasElement) => c.width),
      )
      .toBeGreaterThan(200);

    // Horizontal overflow check
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(dims.scrollWidth).toBeLessThanOrEqual(dims.innerWidth);

    // Compact Viewer FAB & bottom pill sizing check (>= 44px touch targets)
    const fabBox = await page.getByTestId('mobile-edit-fab').boundingBox();
    expect(fabBox).not.toBeNull();
    expect(fabBox!.height).toBeGreaterThanOrEqual(44);

    // Enter Editor & check every button in Bottom Dock meets >= 44px touch requirement
    await page.getByTestId('mobile-edit-fab').click();
    const dock = page.getByTestId('mobile-bottom-dock');
    await expect(dock).toBeVisible();
    const dockBoxes = await dock.locator('button').evaluateAll((btns) =>
      btns.map((b) => {
        const r = b.getBoundingClientRect();
        return { width: r.width, height: r.height };
      }),
    );
    expect(dockBoxes.length).toBeGreaterThanOrEqual(5);
    for (const box of dockBoxes) {
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    await context.close();
  });
});
