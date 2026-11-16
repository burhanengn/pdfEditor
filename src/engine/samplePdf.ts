import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function createGradientPngBytes(): Uint8Array {
  // Generate a small crisp PNG on canvas (browser) or fallback 1x1 PNG bytes
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 140;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 240, 140);
      grad.addColorStop(0, '#1d4ed8');
      grad.addColorStop(0.5, '#0ea5e9');
      grad.addColorStop(1, '#10b981');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 240, 140);

      // Clean geometric badge graphics
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(190, 45, 42, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('gullacpdf Asset', 20, 62);
      ctx.font = '13px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillText('Embedded Raster XObject', 20, 88);

      const dataUrl = canvas.toDataURL('image/png');
      const base64 = dataUrl.split(',')[1];
      const bin = atob(base64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }
  }

  // Fallback minimal 1x1 blue PNG
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0,
    0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73, 68, 65, 84, 8, 215, 99, 96, 96, 248, 15, 0, 1, 5, 1,
    2, 167, 132, 185, 146, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
}

export async function generateSamplePdfBytes(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const timesItalic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const courier = await doc.embedFont(StandardFonts.Courier);

  // Page 1: Executive Brief with editable text + embedded image XObject
  const p1 = doc.addPage([612, 792]);
  p1.drawRectangle({ x: 48, y: 700, width: 516, height: 54, color: rgb(0.08, 0.14, 0.28) });
  p1.drawText('Q4 Product Architecture Brief', {
    x: 64,
    y: 722,
    size: 20,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });
  p1.drawText('Click any text block to edit in-place or drag the embedded graphic below.', {
    x: 48,
    y: 660,
    size: 12,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.35),
  });
  p1.drawText('Client-Side Wasm Pipeline Summary', {
    x: 48,
    y: 615,
    size: 15,
    font: helveticaBold,
    color: rgb(0.07, 0.24, 0.56),
  });
  p1.drawText(
    'All PDF rendering, operator extraction, and content-stream rewriting run inside Web Workers.',
    {
      x: 48,
      y: 590,
      size: 11,
      font: helvetica,
      color: rgb(0.15, 0.18, 0.25),
    },
  );

  const imgBytes = createGradientPngBytes();
  const embeddedImg = await doc.embedPng(imgBytes);
  p1.drawImage(embeddedImg, { x: 48, y: 410, width: 240, height: 140 });

  p1.drawText('Document Reference: GULLAC-2026-04', {
    x: 315,
    y: 525,
    size: 11,
    font: courier,
    color: rgb(0.12, 0.35, 0.22),
  });
  p1.drawText('Prepared for internal review & digital signature.', {
    x: 315,
    y: 500,
    size: 11,
    font: timesItalic,
    color: rgb(0.3, 0.3, 0.35),
  });

  // Signature block box
  p1.drawRectangle({
    x: 48,
    y: 120,
    width: 260,
    height: 90,
    borderColor: rgb(0.65, 0.72, 0.82),
    borderWidth: 1,
    color: rgb(0.97, 0.98, 1),
  });
  p1.drawText('Authorized Signature Area', {
    x: 60,
    y: 190,
    size: 10,
    font: helveticaBold,
    color: rgb(0.35, 0.42, 0.55),
  });

  // Page 2: Landscape Specification Table
  const p2 = doc.addPage([792, 612]);
  p2.drawText('Page 2 — Performance & Privacy Verification', {
    x: 48,
    y: 550,
    size: 18,
    font: helveticaBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  p2.drawText('Try rotating, reordering, duplicating, or splitting this page using the left sidebar.', {
    x: 48,
    y: 515,
    size: 12,
    font: helvetica,
    color: rgb(0.25, 0.3, 0.4),
  });

  // Page 3: Sign-off Page
  const p3 = doc.addPage([612, 792]);
  p3.drawText('Page 3 — Appendix & Export Check', {
    x: 48,
    y: 720,
    size: 18,
    font: helveticaBold,
    color: rgb(0.1, 0.15, 0.25),
  });
  p3.drawText('Original text edits remove the underlying PDF text operator rather than painting over it.', {
    x: 48,
    y: 685,
    size: 11,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.35),
  });

  return doc.save();
}
