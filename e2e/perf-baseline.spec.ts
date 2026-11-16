import { expect, test } from '@playwright/test';
import { generateReferencePdf } from '../src/engine/referencePdfSet';

test.describe('Performance Baseline & Regression Gates', () => {
  test('measures TTFP, long tasks, worker byte copies, and heap on 120-page reference PDF', async ({
    page,
  }) => {
    const pdf120 = await generateReferencePdf('text-120p', { pageCount: 120 });

    await page.goto('/');
    await page.evaluate(() => {
      (window as unknown as { __gpPerf?: { reset: () => void } }).__gpPerf?.reset();
    });

    // Open via welcome file input (available on welcome screen)
    const fileInput = page.locator('input[type="file"][accept*="pdf"]').first();
    await fileInput.setInputFiles({
      name: 'ref-text-120p.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(pdf120),
    });

    await expect(page.getByTestId('pdf-page-1')).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const c = document.querySelector('[data-testid="pdf-page-1"] canvas') as HTMLCanvasElement | null;
          return c ? c.width : 0;
        }),
      )
      .toBeGreaterThan(200);

    // Wait briefly for initial paint & background tasks
    await page.waitForTimeout(300);

    const report = await page.evaluate(() => {
      return (window as unknown as { __gpPerf?: { getReport: () => Record<string, unknown> } }).__gpPerf?.getReport();
    });

    console.log('PERF_BASELINE_REPORT:', JSON.stringify(report));
    expect(report).toBeTruthy();
    expect((report as { ttfpMs: number | null }).ttfpMs).not.toBeNull();
  });
});
