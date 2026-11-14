import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as mupdf from 'mupdf';

const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function startSubpathStaticServer(prefix: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const cleanPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;
  const server = http.createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    if (!reqPath.startsWith(cleanPrefix)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    let rel = reqPath.slice(cleanPrefix.length);
    if (!rel || rel === '/') rel = 'index.html';
    const filePath = path.resolve(DIST_DIR, rel);
    if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.setHeader('Content-Type', MIME_MAP[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to bind server'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}${cleanPrefix}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function readDownloadBytes(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

test.describe('gullacpdf Mobile, PWA & GitHub Pages Verification', () => {
  test('Branding, PWA manifest/icons, Service Worker & /pdfEditor/ subpath hosting work without errors', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const badResponses: string[] = [];

    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('response', (resp) => {
      if (resp.status() >= 400) badResponses.push(`${resp.status()} ${resp.url()}`);
    });

    const srv = await startSubpathStaticServer('/pdfEditor/');
    try {
      await page.goto(srv.url);

      // 1. Page title & SVG branding
      await expect(page).toHaveTitle(/gullacpdf/i);
      const brandLogo = page.getByTestId('brand-logo-container');
      await expect(brandLogo).toBeVisible();
      await expect(brandLogo.locator('svg').last()).toBeVisible();

      // 2. Verify PWA manifest, icons, favicon & Service Worker precache
      const pwaAudit = await page.evaluate(async () => {
        const manRes = await fetch('./manifest.webmanifest');
        const manifest = await manRes.json();
        const swRes = await fetch('./sw.js');
        const swText = await swRes.text();
        const favRes = await fetch('./favicon.svg');
        const favText = await favRes.text();
        const iconStatuses: Array<{ src: string; status: number; type: string | null }> = [];
        for (const ic of manifest.icons) {
          const r = await fetch(`./${ic.src}`);
          iconStatuses.push({
            src: ic.src,
            status: r.status,
            type: r.headers.get('content-type'),
          });
        }
        return {
          manStatus: manRes.status,
          manifest,
          swStatus: swRes.status,
          hasMupdfWasmInSw: swText.includes('mupdf-wasm'),
          hasPdfWorkerInSw: swText.includes('pdf.worker'),
          favStatus: favRes.status,
          hasFavSvg: favText.includes('<svg'),
          iconStatuses,
        };
      });

      expect(pwaAudit.manStatus).toBe(200);
      expect(pwaAudit.manifest.short_name).toBe('gullacpdf');
      expect(pwaAudit.manifest.display).toBe('standalone');
      expect(pwaAudit.swStatus).toBe(200);
      expect(pwaAudit.hasMupdfWasmInSw).toBe(true);
      expect(pwaAudit.hasPdfWorkerInSw).toBe(true);
      expect(pwaAudit.favStatus).toBe(200);
      expect(pwaAudit.hasFavSvg).toBe(true);
      for (const ic of pwaAudit.iconStatuses) {
        expect(ic.status).toBe(200);
      }

      // 3. Load sample PDF & confirm Wasm works cleanly under /pdfEditor/
      await page.getByTestId('welcome-sample-btn').click();
      await expect(page.getByTestId('pdf-page-1')).toBeVisible();
      expect(badResponses).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await srv.close();
    }
  });

  for (const vp of [
    { name: 'iPhone 375x812', width: 375, height: 812 },
    { name: 'Modern Mobile 390x844', width: 390, height: 844 },
  ]) {
    test(`${vp.name}: Mobile Bottom Dock, sheets, enlarged touch handles, pinch zoom, tap-to-place signature, & Web Share`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: true,
        acceptDownloads: true,
      });
      const page = await context.newPage();

      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') consoleErrors.push(m.text());
      });
      page.on('pageerror', (e) => pageErrors.push(String(e)));

      // Expose navigator.share spy cleanly before app load
      await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>).__sharedFiles = [];
        Object.defineProperty(navigator, 'canShare', {
          configurable: true,
          value: (data?: { files?: File[] }) => Array.isArray(data?.files) && data.files.length > 0,
        });
        Object.defineProperty(navigator, 'share', {
          configurable: true,
          value: async (data?: { title?: string; files?: File[] }) => {
            const files = data?.files ?? [];
            (window as unknown as Record<string, unknown>).__sharedFiles = files.map((f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
            }));
          },
        });
      });

      await page.goto('/');

      // 1. Assert zero horizontal overflow & single-row compact top bar
      const layoutMetrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        headerHeight: document.querySelector('header')?.getBoundingClientRect().height ?? 0,
      }));
      expect(layoutMetrics.scrollWidth).toBeLessThanOrEqual(layoutMetrics.innerWidth);
      expect(layoutMetrics.headerHeight).toBeLessThanOrEqual(56);

      // 2. Desktop sidebars hidden on phone, Bottom Dock visible with >= 44px touch targets
      await expect(page.getByTestId('thumbnail-sidebar')).toBeHidden();
      await expect(page.getByTestId('right-inspector')).toHaveCount(0);
      const dock = page.getByTestId('mobile-bottom-dock');
      await expect(dock).toBeVisible();

      for (const tabId of [
        'mobile-dock-pages',
        'mobile-dock-tools',
        'mobile-dock-inspector',
        'mobile-dock-export',
      ]) {
        const box = await page.getByTestId(tabId).boundingBox();
        expect(box).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }

      // 3. Load sample PDF & check touch rendering + zero overflow
      await page.getByTestId('welcome-sample-btn').click();
      const page1Canvas = page.getByTestId('pdf-page-1').locator('canvas');
      await expect(page1Canvas).toBeVisible();
      await expect
        .poll(async () => page1Canvas.evaluate((c: HTMLCanvasElement) => c.width))
        .toBeGreaterThan(200);

      const postLoadWidth = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(postLoadWidth.scrollWidth).toBeLessThanOrEqual(postLoadWidth.innerWidth);

      // 4. Test Pinch-to-Zoom via synthetic PointerEvent touch pinch on document-viewport
      const zoomBefore = await page.evaluate(() => {
        const opt = document.querySelector('[data-testid="zoom-select"] option:checked');
        return opt?.textContent ?? '';
      });
      await page.evaluate(() => {
        const vpEl = document.querySelector('[data-testid="document-viewport"]')!;
        const rect = vpEl.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;

        const mkPtr = (type: string, id: number, x: number, y: number) =>
          new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: id,
            pointerType: 'touch',
            isPrimary: id === 101,
            clientX: x,
            clientY: y,
          });

        vpEl.dispatchEvent(mkPtr('pointerdown', 101, cx - 30, cy));
        vpEl.dispatchEvent(mkPtr('pointerdown', 102, cx + 30, cy));
        window.dispatchEvent(mkPtr('pointermove', 101, cx - 75, cy));
        window.dispatchEvent(mkPtr('pointermove', 102, cx + 75, cy));
        window.dispatchEvent(mkPtr('pointerup', 101, cx - 75, cy));
        window.dispatchEvent(mkPtr('pointerup', 102, cx + 75, cy));
      });

      const zoomAfter = await page.evaluate(() => {
        const opt = document.querySelector('[data-testid="zoom-select"] option:checked');
        return opt?.textContent ?? '';
      });
      expect(zoomAfter).not.toEqual(zoomBefore);

      // 5. Open Pages Bottom Sheet
      await page.getByTestId('mobile-dock-pages').click();
      await expect(page.getByTestId('mobile-pages-sheet')).toBeVisible();
      await expect(page.getByTestId('mobile-page-thumb-1')).toBeVisible();
      await page.getByTestId('mobile-page-thumb-1').click();
      await expect(page.getByTestId('mobile-pages-sheet')).toHaveCount(0);

      // 6. Open Tools Sheet -> Signature & Paraf -> Use & Place -> Mobile Tap-to-Place Banner
      await page.getByTestId('mobile-dock-tools').click();
      await expect(page.getByTestId('mobile-tools-sheet')).toBeVisible();
      await page.getByTestId('mobile-tool-signature').click();
      const sigDialog = page.getByRole('dialog');
      await expect(sigDialog).toBeVisible();
      await sigDialog.getByRole('button', { name: 'Type', exact: true }).click();

      await page.getByTestId('signature-place-btn').click();
      const banner = page.getByTestId('signature-placement-banner');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText('İmzayı yerleştirmek istediğiniz yere dokunun');

      // Tap canvas to place signature
      const pageBox = await page.getByTestId('pdf-page-1').boundingBox();
      expect(pageBox).not.toBeNull();
      await page.touchscreen.tap(pageBox!.x + pageBox!.width * 0.5, pageBox!.y + pageBox!.height * 0.45);
      await expect(banner).toHaveCount(0);

      // Verify element placed, selection overlay visible, and >= 36px touch handle hit area active
      const selBox = page.locator('[data-testid^="selection-box-"]').first();
      await expect(selBox).toBeVisible();
      const seHandleHit = await selBox
        .getByTestId('resize-handle-se')
        .evaluate((el) => {
          const ps = window.getComputedStyle(el, '::after');
          return {
            w: parseFloat(ps.width || '0'),
            h: parseFloat(ps.height || '0'),
          };
        });
      expect(seHandleHit.w).toBeGreaterThanOrEqual(36);
      expect(seHandleHit.h).toBeGreaterThanOrEqual(36);

      // Contextual Bottom Sheet should auto-open collapsed, then expand to half-screen Inspector
      await expect(page.getByTestId('mobile-inspector-collapsed')).toBeVisible();
      await page.getByTestId('mobile-inspector-expand-btn').click();
      await expect(page.getByTestId('mobile-inspector-sheet')).toBeVisible();
      await expect(page.getByTestId('mobile-inspector-content')).toBeVisible();
      await page.getByTestId('mobile-inspector-close-btn').click();
      await expect(page.getByTestId('mobile-inspector-sheet')).toHaveCount(0);

      // 7. Mobile inline text edit + Web Share & PDF Download
      const detectedText = page.getByTestId('pdf-page-1').locator('[data-detected-text="true"]').first();
      await detectedText.tap();
      const editor = page.getByTestId('inline-text-editor');
      await expect(editor).toBeVisible();
      await editor.fill('Mobil Test Türkçe ŞİĞÜ');
      await page.keyboard.press('Escape');

      // Open Export / Share Sheet -> Test Web Share with File
      await page.getByTestId('mobile-dock-export').click();
      await expect(page.getByTestId('mobile-export-sheet')).toBeVisible();
      await page.getByTestId('mobile-share-pdf-btn').click();

      await expect
        .poll(async () =>
          page.evaluate(
            () =>
              (window as unknown as { __sharedFiles?: Array<{ name: string; type: string; size: number }> })
                .__sharedFiles ?? [],
          ),
        )
        .toHaveLength(1);

      const shared = await page.evaluate(
        () =>
          (window as unknown as { __sharedFiles: Array<{ name: string; type: string; size: number }> })
            .__sharedFiles[0],
      );
      expect(shared.type).toBe('application/pdf');
      expect(shared.name.endsWith('.pdf')).toBe(true);
      expect(shared.size).toBeGreaterThan(1000);

      // Also test Direct PDF Download button from Mobile Export Sheet
      await page.getByTestId('mobile-dock-export').click();
      const [dl] = await Promise.all([
        page.waitForEvent('download'),
        page.getByTestId('mobile-download-pdf-btn').click(),
      ]);
      const outBytes = await readDownloadBytes((await dl.createReadStream())!);
      const outDoc = mupdf.Document.openDocument(outBytes, 'application/pdf');
      try {
        const p1 = outDoc.loadPage(0);
        try {
          const text = p1.toStructuredText('preserve-whitespace').asText().replace(/\s+/g, ' ');
          expect(text).toContain('Mobil Test Türkçe ŞİĞÜ');
        } finally {
          p1.destroy();
        }
      } finally {
        outDoc.destroy();
      }

      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await context.close();
    });
  }

  test('Tablet 768x1024 iPad layout: sidebar visible, no overflow, tablet inspector toggles cleanly', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
    });
    const page = await context.newPage();

    await page.goto('/');
    await page.getByTestId('welcome-sample-btn').click();
    await expect(page.getByTestId('thumbnail-sidebar')).toBeVisible();
    await expect(page.getByTestId('mobile-bottom-dock')).toBeHidden();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);

    const tabletBtn = page.getByTestId('tablet-inspector-btn');
    await expect(tabletBtn).toBeVisible();
    await tabletBtn.click();
    await expect(page.getByTestId('mobile-inspector-sheet')).toBeVisible();
    await page.getByTestId('mobile-inspector-close-btn').click();
    await expect(page.getByTestId('mobile-inspector-sheet')).toHaveCount(0);

    await context.close();
  });
});
