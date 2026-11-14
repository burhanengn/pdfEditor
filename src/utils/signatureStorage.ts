import type { SavedSignature } from '@/types/elements';

const STORAGE_KEY = 'aetherpdf_signature_vault_v1';

export function loadSavedSignatures(): SavedSignature[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedSignature[]).map((item) => ({
      ...item,
      templateId: item.templateId ?? item.id,
      variant: item.variant ?? 'signature',
    }));
  } catch {
    return [];
  }
}

export function persistSavedSignatures(sigs: SavedSignature[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sigs));
  } catch {
    // Handle storage quota exceeded silently
  }
}

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] ?? '';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Strips light/white background pixels from an uploaded signature image
 * so signatures appear cleanly transparent on PDF pages.
 */
export async function processUploadedSignatureImage(
  file: File,
  removeWhiteBg: boolean,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode uploaded signature image.'));
      el.src = objectUrl;
    });

    const maxDim = 900;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(img, 0, 0, width, height);

    if (removeWhiteBg) {
      const imageData = ctx.getImageData(0, 0, width, height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (lum > 225) {
          d[i + 3] = 0;
        } else if (lum > 185) {
          d[i + 3] = Math.round(((225 - lum) / 40) * d[i + 3]);
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }

    return {
      dataUrl: canvas.toDataURL('image/png'),
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const TYPED_SIGNATURE_STYLES = [
  { id: 'script-classic', label: 'Classic Script', fontCss: 'italic 54px Georgia, "Times New Roman", serif' },
  { id: 'script-calligraphy', label: 'Calligraphy', fontCss: '58px "Brush Script MT", "Segoe Script", cursive' },
  { id: 'script-casual', label: 'Modern Hand', fontCss: 'italic 48px "Segoe Print", "Comic Sans MS", cursive' },
  { id: 'script-editorial', label: 'Editorial Serif', fontCss: 'italic 600 46px Palatino, Georgia, serif' },
] as const;

export function renderTypedSignatureToPng(
  text: string,
  fontCss: string,
  color: string,
): { dataUrl: string; width: number; height: number } {
  const canvas = document.createElement('canvas');
  const dpr = 2;
  const logicalW = 520;
  const logicalH = 150;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, logicalW, logicalH);
  ctx.font = fontCss;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, logicalW / 2, logicalH / 2, logicalW - 36);

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: logicalW,
    height: logicalH,
  };
}
