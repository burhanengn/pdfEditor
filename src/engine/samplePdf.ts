import { ensureRustCoreReady } from './rustCoreBridge';

function createGradientRgbBytes(): { rgb: Uint8Array; width: number; height: number } {
  const width = 240;
  const height = 140;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#1d4ed8');
      grad.addColorStop(0.5, '#0ea5e9');
      grad.addColorStop(1, '#10b981');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

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

      const imgData = ctx.getImageData(0, 0, width, height);
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < imgData.data.length; i += 4, j += 3) {
        rgb[j] = imgData.data[i];
        rgb[j + 1] = imgData.data[i + 1];
        rgb[j + 2] = imgData.data[i + 2];
      }
      return { rgb, width, height };
    }
  }
  return { rgb: new Uint8Array(0), width: 0, height: 0 };
}

export async function generateSamplePdfBytes(): Promise<Uint8Array> {
  const wasm = await ensureRustCoreReady();
  const { rgb, width, height } = createGradientRgbBytes();
  return wasm.create_sample_pdf_bytes(rgb, width, height);
}
