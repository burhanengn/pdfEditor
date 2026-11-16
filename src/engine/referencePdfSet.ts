import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type ReferenceDocKind =
  | 'form-1p'
  | 'text-120p'
  | 'scanned-300p'
  | 'vector-dense'
  | 'rtl-cjk';

export interface ReferenceDocOptions {
  /** Override page count for multi-page fixtures in lightweight unit tests. */
  pageCount?: number;
  /** Number of vector strokes/primitives for vector-dense fixture. */
  vectorSegments?: number;
}

/**
 * Minimal valid 4x4 RGBA PNG (generated deterministically without DOM canvas)
 * so reference fixture generation works cleanly in Node, Vitest, Workers, and browsers.
 */
function createDeterministicPngBytes(): Uint8Array {
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
    0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 96, 96, 248, 15, 0, 1, 5, 1,
    2, 167, 132, 185, 146, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
}

export async function generateReferencePdf(
  kind: ReferenceDocKind,
  options: ReferenceDocOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const times = await doc.embedFont(StandardFonts.TimesRoman);

  switch (kind) {
    case 'form-1p': {
      const page = doc.addPage([595, 842]);
      page.drawRectangle({ x: 42, y: 740, width: 511, height: 52, color: rgb(0.11, 0.22, 0.44) });
      page.drawText('gullacpdf Enterprise Form — Reference 1P', {
        x: 56,
        y: 760,
        size: 16,
        font: helveticaBold,
        color: rgb(1, 1, 1),
      });

      const img = await doc.embedPng(createDeterministicPngBytes());
      page.drawImage(img, { x: 450, y: 620, width: 96, height: 96 });

      // Table grid (horizontal & vertical rules)
      for (let row = 0; row <= 5; row++) {
        const y = 660 - row * 36;
        page.drawLine({
          start: { x: 42, y },
          end: { x: 430, y },
          thickness: 1,
          color: rgb(0.2, 0.25, 0.35),
        });
      }
      for (const x of [42, 210, 430]) {
        page.drawLine({
          start: { x, y: 480 },
          end: { x, y: 660 },
          thickness: 1,
          color: rgb(0.2, 0.25, 0.35),
        });
      }

      const rows = [
        ['Field Name', 'Sample Value'],
        ['Applicant ID', 'GP-2026-0041'],
        ['Department', 'Core Architecture'],
        ['Status', 'Verified Baseline'],
        ['Confidential Tag', 'SECRET-TOKEN-ALPHA'],
      ];
      rows.forEach(([k, v], idx) => {
        const y = 636 - idx * 36;
        page.drawText(k, { x: 52, y, size: 11, font: helveticaBold, color: rgb(0.1, 0.1, 0.15) });
        page.drawText(v, { x: 222, y, size: 11, font: helvetica, color: rgb(0.15, 0.18, 0.24) });
      });

      page.drawText(
        'Paragraph block for selection and redaction regression testing across engines.',
        { x: 42, y: 390, size: 11, font: times, color: rgb(0.1, 0.1, 0.1) },
      );
      break;
    }

    case 'text-120p': {
      const count = options.pageCount ?? 120;
      for (let i = 0; i < count; i++) {
        const page = doc.addPage([595, 842]);
        page.drawText(`Chapter ${Math.floor(i / 10) + 1} — Page ${i + 1} of ${count}`, {
          x: 48,
          y: 780,
          size: 14,
          font: helveticaBold,
          color: rgb(0.08, 0.12, 0.2),
        });
        for (let line = 0; line < 22; line++) {
          const y = 735 - line * 28;
          page.drawText(
            `Line ${line + 1}: Deterministic enterprise text payload for virtual scroll, search, and memory profiling (page ${i + 1}).`,
            {
              x: 48,
              y,
              size: 10.5,
              font: helvetica,
              color: rgb(0.15, 0.18, 0.22),
            },
          );
        }
      }
      break;
    }

    case 'scanned-300p': {
      const count = options.pageCount ?? 300;
      const img = await doc.embedPng(createDeterministicPngBytes());
      for (let i = 0; i < count; i++) {
        const page = doc.addPage([595, 842]);
        page.drawImage(img, { x: 24, y: 40, width: 547, height: 760 });
        page.drawText(`Scan Sheet #${i + 1}`, {
          x: 40,
          y: 22,
          size: 9,
          font: helvetica,
          color: rgb(0.3, 0.3, 0.3),
        });
      }
      break;
    }

    case 'vector-dense': {
      const segments = options.vectorSegments ?? 1800;
      const page = doc.addPage([842, 595]);
      page.drawText('Technical CAD / Vector Grid Reference', {
        x: 36,
        y: 560,
        size: 13,
        font: helveticaBold,
        color: rgb(0.05, 0.1, 0.2),
      });
      for (let i = 0; i < segments; i++) {
        const x0 = 36 + ((i * 19) % 760);
        const y0 = 36 + ((i * 23) % 500);
        const x1 = x0 + ((i % 7) + 1) * 8;
        const y1 = y0 + ((i % 5) + 1) * 6;
        page.drawLine({
          start: { x: x0, y: y0 },
          end: { x: Math.min(810, x1), y: Math.min(545, y1) },
          thickness: 0.6,
          color: rgb((i % 10) / 20, 0.25, 0.55),
        });
      }
      break;
    }

    case 'rtl-cjk': {
      // Uses standard PDF-safe labels + metadata; Unicode font embedding tested separately with DejaVu
      const page = doc.addPage([595, 842]);
      page.drawText('Unicode / RTL / CJK Layout Reference Container', {
        x: 48,
        y: 770,
        size: 15,
        font: helveticaBold,
        color: rgb(0.1, 0.12, 0.18),
      });
      page.drawText('Latin anchor text alongside mixed script blocks.', {
        x: 48,
        y: 735,
        size: 11,
        font: helvetica,
        color: rgb(0.2, 0.24, 0.3),
      });
      break;
    }
  }

  return doc.save();
}
