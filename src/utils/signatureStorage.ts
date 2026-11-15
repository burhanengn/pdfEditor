import type { SavedSignature } from '@/types/elements';
import {
  extractSignatureFromRgba,
  type SignatureExtractParams,
} from './signatureExtractor';

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

export async function decodeImageFileToRgba(file: File): Promise<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode uploaded signature image.'));
      el.src = objectUrl;
    });

    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(img, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    return {
      data: imgData.data,
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function renderExtractedSignaturePng(
  srcRgba: Uint8ClampedArray,
  srcWidth: number,
  srcHeight: number,
  params: SignatureExtractParams = {},
): { dataUrl: string; width: number; height: number } {
  const extracted = extractSignatureFromRgba(srcRgba, srcWidth, srcHeight, params);
  const canvas = document.createElement('canvas');
  canvas.width = extracted.width;
  canvas.height = extracted.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');
  const outImgData = ctx.createImageData(extracted.width, extracted.height);
  outImgData.data.set(extracted.data);
  ctx.putImageData(outImgData, 0, 0);
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: extracted.width,
    height: extracted.height,
  };
}

/**
 * Extracts a crisp transparent signature PNG from an uploaded image or paper photograph
 * using adaptive local paper-illumination modeling, shadow removal, and auto-crop.
 */
export async function processUploadedSignatureImage(
  file: File,
  options: boolean | SignatureExtractParams = true,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const decoded = await decodeImageFileToRgba(file);
  const params: SignatureExtractParams =
    typeof options === 'boolean'
      ? { mode: options ? 'smart' : 'none', autoCrop: options }
      : options;
  return renderExtractedSignaturePng(decoded.data, decoded.width, decoded.height, params);
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
