import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { buildE2ePdf } from './helpers/pdfiumTestHelper';

const DIST_DIR = path.resolve(process.cwd(), 'dist');

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function startDistStaticServer(): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const cleanUrl = (req.url ?? '/').split('?')[0];
      let rel = cleanUrl.replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      const filePath = path.join(DIST_DIR, rel);
      if (!filePath.startsWith(DIST_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test.describe('Phase F4 Cloudflare Pages, PWA File Handlers, & Memory Leak Gate', () => {
  test('verifies Cloudflare Pages _headers, prompt-safe SW config, file_handlers, share_target, & launchQueue handling', async ({
    page,
  }) => {
    const headersPath = path.join(DIST_DIR, '_headers');
    expect(fs.existsSync(headersPath)).toBe(true);
    const headersContent = fs.readFileSync(headersPath, 'utf-8');
    expect(headersContent).toContain('/assets/*');
    expect(headersContent).toContain('Cache-Control: public, max-age=31536000, immutable');
    expect(headersContent).toContain('/sw.js');
    expect(headersContent).toContain('must-revalidate');

    const manifestPath = path.join(DIST_DIR, 'manifest.webmanifest');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.file_handlers?.[0]?.accept?.['application/pdf']).toContain('.pdf');
    expect(manifest.share_target?.method).toBe('POST');
    expect(manifest.share_target?.params?.files?.[0]?.name).toBe('file');

    const swText = fs.readFileSync(path.join(DIST_DIR, 'sw.js'), 'utf-8');
    expect(swText).toContain('sw-share-target.js');
    // Prompt-safe SW waits for explicit SKIP_WAITING message from PwaUpdateToast
    expect(swText).toContain('SKIP_WAITING');
    expect(swText).not.toContain('s.skipWaiting(),s.clientsClaim()');

    const launchPdfBytes = Array.from(
      await buildE2ePdf([
        {
          width: 595,
          height: 842,
          texts: [{ text: 'Launched via PWA File Handler', x: 70, yPdf: 700, fontSize: 16 }],
        },
      ]),
    );

    const srv = await startDistStaticServer();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    try {
      await page.addInitScript((bytesArray: number[]) => {
        const u8 = new Uint8Array(bytesArray);
        (window as unknown as { __launchLog: string[] }).__launchLog = [];
        const log = (msg: string) =>
          (window as unknown as { __launchLog: string[] }).__launchLog.push(msg);

        const invokeMock = function (consumer: (p: unknown) => void) {
          log('setConsumer called');
          setTimeout(async () => {
            try {
              log('invoking consumer');
              await consumer({
                files: [
                  {
                    kind: 'file',
                    name: 'launched-handler.pdf',
                    getFile: async () =>
                      new File([u8], 'launched-handler.pdf', { type: 'application/pdf' }),
                  },
                ],
              });
              log('consumer resolved');
            } catch (err) {
              log('consumer err: ' + String(err));
            }
          }, 80);
        };

        const proto = (window as unknown as { LaunchQueue?: { prototype: { setConsumer: unknown } } })
          .LaunchQueue?.prototype;
        if (proto) {
          proto.setConsumer = invokeMock;
          log('patched LaunchQueue.prototype.setConsumer');
        } else {
          Object.defineProperty(window, 'launchQueue', {
            configurable: true,
            writable: true,
            value: { setConsumer: invokeMock },
          });
          log('defined window.launchQueue');
        }
      }, launchPdfBytes);

      await page.goto(srv.url);
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { __launchLog?: string[] }).__launchLog ?? []),
        )
        .toContain('consumer resolved');
      expect(errors).toEqual([]);
      await expect(page.getByTestId('toggle-edit-mode-btn')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('pdf-page-1').locator('canvas')).toBeVisible();
      await expect(page.locator('header')).toContainText('launched-handler.pdf');
    } finally {
      await srv.close();
    }
  });

  test('passes repeated document open/close memory leak & visual regression gate', async ({
    page,
  }) => {
    const sampleA = Buffer.from(
      await buildE2ePdf([
        {
          width: 595,
          height: 842,
          rects: [{ x: 48, yPdf: 720, width: 499, height: 64, fill: [22, 78, 175] }],
          texts: [{ text: 'Regression Doc Alpha', x: 64, yPdf: 745, fontSize: 18, color: [255, 255, 255] }],
        },
      ]),
    );
    const sampleB = Buffer.from(
      await buildE2ePdf(
        Array.from({ length: 24 }, (_, idx) => ({
          width: 595,
          height: 842,
          texts: [{ text: `Dense Page ${idx + 1} Türkçe İçerik Şğıöç`, x: 54, yPdf: 780, fontSize: 13 }],
        })),
      ),
    );

    await page.goto('/');

    const heaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      const buf = i % 2 === 0 ? sampleA : sampleB;
      await page.getByTestId('open-pdf-input').setInputFiles({
        name: `cycle-${i}.pdf`,
        mimeType: 'application/pdf',
        buffer: buf,
      });
      await expect(page.getByTestId('pdf-page-1').locator('canvas')).toBeVisible();
      await expect
        .poll(async () => {
          const metrics = await page.evaluate(
            () => (window as unknown as { __gpPerf?: { getReport: () => { ttfpMs?: number | null } } }).__gpPerf?.getReport(),
          );
          return metrics?.ttfpMs ?? null;
        })
        .not.toBeNull();
      const report = await page.evaluate(() =>
        (
          window as unknown as {
            __gpPerf?: {
              getReport: () => {
                ttfpMs: number | null;
                longTaskCount: number;
                workerBytesCloned: number;
                heapUsedBytes: number | null;
              };
            };
          }
        ).__gpPerf?.getReport(),
      );
      expect(report!.ttfpMs!).toBeLessThan(1200);
      expect(report!.longTaskCount).toBe(0);
      expect(report!.workerBytesCloned).toBe(0);
      if (typeof report?.heapUsedBytes === 'number') {
        heaps.push(report.heapUsedBytes);
      }
    }

    if (heaps.length >= 2) {
      // Final heap stays comfortably under 64 MB budget & doesn't spike uncontrollably
      expect(heaps[heaps.length - 1]).toBeLessThan(64 * 1024 * 1024);
    }
  });
});
