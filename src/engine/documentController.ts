import type { ImageAddElement } from '@/types/elements';
import type { AppMode, PageMeta, SourceDocumentInput, ToolMode } from '@/types/pdf';
import { generateBlankPdfBytes, type BlankPagePreset } from './blankPdf';
import { getDisplayDimensions } from './coordinates';
import { useEditorStore } from '@/store/useEditorStore';
import { blobRegistry } from '@/utils/blobRegistry';
import {
  deleteUserCustomFont,
  getUserFontAssetPayloads,
  importUserCustomFontFiles,
} from '@/utils/customFontStorage';
import { createId } from '@/utils/id';
import {
  getExtractedFontAssetPayloads,
  populateExtractedFontRegistry,
  registerExtractedPdfFontsInBrowser,
} from './embeddedFontExtractor';
import { parsePageRangeExpression } from './pageRange';
import { pdfjsService } from './pdfjsService';
import { perfMetrics } from './perfMetrics';
import { markSessionCleanSnapshot } from './sessionPersistence';
import { getSourceDocBytes } from './sourceDocRegistry';
import { wasmWorkerClient } from './wasmWorkerClient';

function triggerDownload(bytes: Uint8Array, filename: string, mimeType: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = blobRegistry.createUrl(new Blob([copy], { type: mimeType }), 'export');
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    setTimeout(() => blobRegistry.revoke(url), 4000);
  }
}

function buildPagesFromInspect(
  sourceDocId: string,
  inspectPages: Array<{
    sourcePageIndex: number;
    baseWidth: number;
    baseHeight: number;
    intrinsicRotation: 0 | 90 | 180 | 270;
    mediaBox: [number, number, number, number];
    cropBox: [number, number, number, number];
  }>,
): PageMeta[] {
  return inspectPages.map((p) => ({
    id: createId('page'),
    sourceDocId,
    sourcePageIndex: p.sourcePageIndex,
    baseWidth: p.baseWidth,
    baseHeight: p.baseHeight,
    intrinsicRotation: p.intrinsicRotation,
    userRotation: 0,
    mediaBox: p.mediaBox,
    cropBox: p.cropBox,
  }));
}

function hydrateEmbeddedFontsInBackground(sourceDocId: string): void {
  wasmWorkerClient
    .call('extractEmbeddedFonts', { sourceDocId })
    .then(async ({ fonts, assets }) => {
      if (fonts.length === 0) return;
      // Ignore stale extraction if document has already been unloaded
      if (!useEditorStore.getState().sourceDocs[sourceDocId]) return;
      populateExtractedFontRegistry(fonts, assets);
      await registerExtractedPdfFontsInBrowser(fonts);
      useEditorStore.getState().setExtractedFontsForDoc(sourceDocId, fonts);
    })
    .catch(() => {
      // Non-fatal: built-in fallback fonts remain usable
    });
}

export async function openPdfBytes(
  fileName: string,
  bytes: Uint8Array,
  password?: string,
  options?: { initialMode?: AppMode },
): Promise<void> {
  perfMetrics.markDocOpenStart(fileName);
  const store = useEditorStore.getState();
  const previousDocIds = Object.keys(store.sourceDocs);
  store.setLoading(true, `Inspecting ${fileName}…`);
  store.setErrorBanner(null);

  try {
    const sourceDocId = createId('src');
    const transferCopy = bytes.slice();
    const result = await wasmWorkerClient.call(
      'inspectPdf',
      { bytes: transferCopy, password, sourceDocId },
      120_000,
      [transferCopy.buffer],
    );
    if (result.status === 'needs-password' || result.status === 'invalid-password') {
      store.setPasswordPrompt({
        fileName,
        bytes,
        mode: 'open',
        invalidAttempt: result.status === 'invalid-password',
      });
      return;
    }

    for (const oldId of previousDocIds) {
      void wasmWorkerClient.releaseSourceDoc(oldId);
    }

    const effectiveBytes = result.decryptedBytes ?? bytes;
    const sourceDoc: SourceDocumentInput = {
      id: sourceDocId,
      name: fileName,
      bytes: effectiveBytes,
      wasEncrypted: result.wasEncrypted,
      pageCount: result.pageCount,
    };
    const pages = buildPagesFromInspect(sourceDocId, result.pages);
    await pdfjsService.releaseAllDocuments();
    store.loadInitialDocument(sourceDoc, pages, { initialMode: options?.initialMode });
    markSessionCleanSnapshot();

    hydrateEmbeddedFontsInBackground(sourceDocId);
  } catch (err) {
    store.setErrorBanner(err instanceof Error ? err.message : 'Failed to open PDF document.');
  } finally {
    useEditorStore.getState().setLoading(false, '');
  }
}

export async function mergePdfBytes(
  fileName: string,
  bytes: Uint8Array,
  insertAt?: number,
  password?: string,
): Promise<void> {
  const store = useEditorStore.getState();
  if (store.pages.length === 0) {
    return openPdfBytes(fileName, bytes, password);
  }

  store.setLoading(true, `Merging ${fileName}…`);
  store.setErrorBanner(null);

  try {
    const sourceDocId = createId('src');
    const transferCopy = bytes.slice();
    const result = await wasmWorkerClient.call(
      'inspectPdf',
      { bytes: transferCopy, password, sourceDocId },
      120_000,
      [transferCopy.buffer],
    );
    if (result.status === 'needs-password' || result.status === 'invalid-password') {
      store.setPasswordPrompt({
        fileName,
        bytes,
        mode: 'merge',
        invalidAttempt: result.status === 'invalid-password',
      });
      return;
    }

    const effectiveBytes = result.decryptedBytes ?? bytes;
    const sourceDoc: SourceDocumentInput = {
      id: sourceDocId,
      name: fileName,
      bytes: effectiveBytes,
      wasEncrypted: result.wasEncrypted,
      pageCount: result.pageCount,
    };
    const pages = buildPagesFromInspect(sourceDocId, result.pages);
    store.appendMergedDocument(sourceDoc, pages, insertAt);

    hydrateEmbeddedFontsInBackground(sourceDocId);
  } catch (err) {
    store.setErrorBanner(err instanceof Error ? err.message : 'Failed to merge PDF document.');
  } finally {
    useEditorStore.getState().setLoading(false, '');
  }
}

export async function openPdfFile(file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  await openPdfBytes(file.name, new Uint8Array(buf));
}

export async function mergePdfFile(file: File, insertAt?: number): Promise<void> {
  const buf = await file.arrayBuffer();
  await mergePdfBytes(file.name, new Uint8Array(buf), insertAt);
}

export async function submitPasswordUnlock(password: string): Promise<void> {
  const prompt = useEditorStore.getState().passwordPrompt;
  if (!prompt) return;
  if (prompt.mode === 'merge') {
    await mergePdfBytes(prompt.fileName, prompt.bytes, undefined, password);
  } else {
    await openPdfBytes(prompt.fileName, prompt.bytes, password);
  }
}

export async function createBlankDocument(options?: {
  preset?: BlankPagePreset;
  width?: number;
  height?: number;
  fileName?: string;
  initialToolMode?: ToolMode;
}): Promise<void> {
  const bytes = await generateBlankPdfBytes({
    preset: options?.preset ?? 'a4-portrait',
    width: options?.width,
    height: options?.height,
    pageCount: 1,
  });
  await openPdfBytes(options?.fileName ?? 'Bos-Belge.pdf', bytes, undefined, { initialMode: 'edit' });
  if (options?.initialToolMode) {
    useEditorStore.getState().setToolMode(options.initialToolMode);
  }
}

export async function insertBlankPageInDocument(options?: {
  preset?: BlankPagePreset;
  width?: number;
  height?: number;
  insertAfterPageId?: string;
}): Promise<void> {
  const state = useEditorStore.getState();
  if (state.pages.length === 0) {
    await createBlankDocument({
      preset: options?.preset,
      width: options?.width,
      height: options?.height,
    });
    return;
  }

  const targetId = options?.insertAfterPageId ?? state.activePageId;
  const targetIdx = targetId ? state.pages.findIndex((p) => p.id === targetId) : -1;
  const refPage =
    targetIdx >= 0 ? state.pages[targetIdx] : state.pages[state.pages.length - 1];
  const insertAt = targetIdx >= 0 ? targetIdx + 1 : state.pages.length;

  let width = options?.width;
  let height = options?.height;
  if ((!width || !height) && !options?.preset && refPage) {
    const dims = getDisplayDimensions(
      refPage.baseWidth,
      refPage.baseHeight,
      refPage.userRotation,
      1,
    );
    width = dims.width;
    height = dims.height;
  }

  const bytes = await generateBlankPdfBytes({
    preset: options?.preset ?? 'a4-portrait',
    width,
    height,
    pageCount: 1,
  });
  await mergePdfBytes('Bos-Sayfa.pdf', bytes, insertAt);
}

function collectCustomExportFontPayloads(
  elements: ReturnType<typeof useEditorStore.getState>['elements'],
  pageNumbering: ReturnType<typeof useEditorStore.getState>['pageNumbering'],
) {
  const userIds = new Set<string>();
  const embeddedIds = new Set<string>();
  for (const el of elements) {
    if (el.kind === 'text-edit' || el.kind === 'text-add') {
      if (el.fontFamily.startsWith('user:')) userIds.add(el.fontFamily);
      else if (el.fontFamily.startsWith('embedded:')) embeddedIds.add(el.fontFamily);
    }
  }
  if (pageNumbering?.enabled) {
    if (pageNumbering.fontFamily.startsWith('user:')) userIds.add(pageNumbering.fontFamily);
    else if (pageNumbering.fontFamily.startsWith('embedded:')) embeddedIds.add(pageNumbering.fontFamily);
  }
  return [
    ...getUserFontAssetPayloads([...userIds]),
    ...getExtractedFontAssetPayloads([...embeddedIds]),
  ];
}

export async function uploadCustomFontFiles(
  files: File[],
): Promise<{ addedIds: string[]; matchedBlocks: number }> {
  if (files.length === 0) return { addedIds: [], matchedBlocks: 0 };
  const { allFonts, affectedIds } = await importUserCustomFontFiles(files);
  useEditorStore.getState().setUserFonts(allFonts);

  const after = useEditorStore.getState();
  const affectedSet = new Set(affectedIds);
  let matchedBlocks = 0;
  for (const ext of Object.values(after.pageExtractions)) {
    for (const b of ext.textBlocks) {
      if (affectedSet.has(b.fontFamily)) matchedBlocks++;
    }
  }
  for (const el of after.elements) {
    if ((el.kind === 'text-edit' || el.kind === 'text-add') && affectedSet.has(el.fontFamily)) {
      matchedBlocks++;
    }
  }
  return { addedIds: affectedIds, matchedBlocks };
}

export async function removeUserCustomFont(fontId: string): Promise<void> {
  const nextFonts = await deleteUserCustomFont(fontId);
  useEditorStore.getState().setUserFonts(nextFonts);
}

function buildWorkerSourceDocRefs(usedDocIds: Set<string>): {
  sourceDocs: Array<{ id: string; bytes?: Uint8Array }>;
  transfer: Transferable[];
} {
  const transfer: Transferable[] = [];
  const sourceDocs: Array<{ id: string; bytes?: Uint8Array }> = [];
  for (const id of usedDocIds) {
    if (wasmWorkerClient.isSourceDocRegistered(id)) {
      sourceDocs.push({ id });
    } else {
      const raw = getSourceDocBytes(id);
      if (raw) {
        const copy = raw.slice();
        transfer.push(copy.buffer);
        sourceDocs.push({ id, bytes: copy });
      }
    }
  }
  return { sourceDocs, transfer };
}

export async function compileCurrentDocumentBytes(): Promise<Uint8Array> {
  const state = useEditorStore.getState();
  const usedDocIds = new Set(state.pages.map((p) => p.sourceDocId));
  const { sourceDocs, transfer } = buildWorkerSourceDocRefs(usedDocIds);
  const customFonts = collectCustomExportFontPayloads(state.elements, state.pageNumbering);

  const { bytes } = await wasmWorkerClient.call(
    'compilePdf',
    {
      sourceDocs,
      pages: state.pages,
      elements: state.elements,
      fonts: customFonts.length > 0 ? customFonts : undefined,
      optimizeWithMupdf: true,
      pageNumbering: state.pageNumbering,
    },
    120_000,
    transfer,
  );
  return bytes;
}

export async function exportCurrentPdf(): Promise<void> {
  const store = useEditorStore.getState();
  if (store.pages.length === 0) return;
  store.setLoading(true, 'Preparing PDF…');
  store.setErrorBanner(null);

  try {
    const bytes = await compileCurrentDocumentBytes();
    const baseName = store.documentName.replace(/\.pdf$/i, '') || 'document';
    triggerDownload(bytes, `${baseName}-edited.pdf`, 'application/pdf');
    useEditorStore.getState().markDocumentSaved();
    markSessionCleanSnapshot();
  } catch (err) {
    store.setErrorBanner(err instanceof Error ? err.message : 'Failed to export PDF.');
  } finally {
    useEditorStore.getState().setLoading(false, '');
  }
}

export function canUseWebSharePdf(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  if (typeof navigator.canShare !== 'function') {
    return true;
  }
  try {
    const probe = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'probe.pdf', {
      type: 'application/pdf',
    });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareCurrentPdf(): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const store = useEditorStore.getState();
  if (store.pages.length === 0) return 'cancelled';
  store.setLoading(true, 'Preparing PDF for share…');
  store.setErrorBanner(null);

  try {
    const bytes = await compileCurrentDocumentBytes();
    const baseName = store.documentName.replace(/\.pdf$/i, '') || 'document';
    const filename = `${baseName}-edited.pdf`;
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const pdfFile = new File([copy], filename, { type: 'application/pdf' });

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      (!navigator.canShare || navigator.canShare({ files: [pdfFile] }))
    ) {
      try {
        await navigator.share({
          title: filename,
          text: `${filename} — gullacpdf`,
          files: [pdfFile],
        });
        return 'shared';
      } catch (shareErr) {
        if (shareErr instanceof DOMException && shareErr.name === 'AbortError') {
          return 'cancelled';
        }
        // Fallback to direct download if browser rejects share programmatically
      }
    }

    triggerDownload(bytes, filename, 'application/pdf');
    return 'downloaded';
  } catch (err) {
    store.setErrorBanner(err instanceof Error ? err.message : 'Failed to share PDF.');
    return 'cancelled';
  } finally {
    useEditorStore.getState().setLoading(false, '');
  }
}

export async function exportSplitDocuments(
  rangeExpression: string,
  mode: 'single-pdf' | 'split-zip-by-range' | 'split-zip-per-page',
): Promise<void> {
  const store = useEditorStore.getState();
  const parsed = parsePageRangeExpression(rangeExpression, store.pages.length);
  if (parsed.error) {
    throw new Error(parsed.error);
  }

  const usedDocIds = new Set(store.pages.map((p) => p.sourceDocId));
  const { sourceDocs, transfer } = buildWorkerSourceDocRefs(usedDocIds);
  const baseName = store.documentName.replace(/\.pdf$/i, '') || 'document';

  store.setLoading(true, 'Extracting & bundling pages…');
  store.setErrorBanner(null);

  try {
    if (mode === 'single-pdf') {
      const selectedPages = parsed.allIndices.map((idx) => store.pages[idx]);
      const selectedIds = new Set(selectedPages.map((p) => p.id));
      const selectedEls = store.elements.filter((el) => selectedIds.has(el.pageId));
      const customFonts = collectCustomExportFontPayloads(selectedEls, store.pageNumbering);
      const { bytes } = await wasmWorkerClient.call(
        'compilePdf',
        {
          sourceDocs,
          pages: selectedPages,
          elements: selectedEls,
          fonts: customFonts.length > 0 ? customFonts : undefined,
          optimizeWithMupdf: true,
          pageNumbering: store.pageNumbering,
        },
        120_000,
        transfer,
      );
      triggerDownload(bytes, `${baseName}-extracted.pdf`, 'application/pdf');
      return;
    }

    const jobs =
      mode === 'split-zip-per-page'
        ? parsed.allIndices.map((idx) => ({
            id: createId('job'),
            filename: `${baseName}-page-${String(idx + 1).padStart(3, '0')}.pdf`,
            pages: [store.pages[idx]],
          }))
        : parsed.groups.map((grp, i) => ({
            id: createId('job'),
            filename: `${baseName}-part-${i + 1}-pages-${grp.label}.pdf`,
            pages: grp.pageIndices.map((idx) => store.pages[idx]),
          }));

    const customFonts = collectCustomExportFontPayloads(store.elements, store.pageNumbering);
    const { zipBytes } = await wasmWorkerClient.call(
      'splitPdfZip',
      {
        sourceDocs,
        elements: store.elements,
        jobs,
        fonts: customFonts.length > 0 ? customFonts : undefined,
        pageNumbering: store.pageNumbering,
      },
      120_000,
      transfer,
    );
    triggerDownload(zipBytes, `${baseName}-split.zip`, 'application/zip');
  } finally {
    useEditorStore.getState().setLoading(false, '');
  }
}

export async function normalizeImageFileToPdfImage(file: File): Promise<{
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}> {
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  const isJpg = file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);

  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to decode image "${file.name}".`));
      image.src = imgUrl;
    });

    const width = img.naturalWidth || 200;
    const height = img.naturalHeight || 200;

    if (isJpg) {
      return { bytes: rawBytes, mimeType: 'image/jpeg', width, height };
    }
    if (isPng) {
      return { bytes: rawBytes, mimeType: 'image/png', width, height };
    }

    // Convert WebP / BMP / GIF / SVG cleanly to PNG bytes in-browser
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable for image conversion.');
    ctx.drawImage(img, 0, 0, width, height);
    const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!pngBlob) throw new Error('Failed to encode PNG bytes.');
    return {
      bytes: new Uint8Array(await pngBlob.arrayBuffer()),
      mimeType: 'image/png',
      width,
      height,
    };
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

export async function insertImageFileOnPage(file: File, pageId: string): Promise<void> {
  const store = useEditorStore.getState();
  const page = store.pages.find((p) => p.id === pageId) ?? store.pages[0];
  if (!page) return;

  const decoded = await normalizeImageFileToPdfImage(file);
  const maxW = Math.min(page.baseWidth * 0.45, 260);
  const scale = Math.min(1, maxW / decoded.width);
  const w = Math.max(24, Math.round(decoded.width * scale));
  const h = Math.max(24, Math.round(decoded.height * scale));
  const previewUrl = blobRegistry.createUrlFromBytes(decoded.bytes, decoded.mimeType, 'doc');

  const element: ImageAddElement = {
    id: createId('img'),
    pageId: page.id,
    kind: 'image',
    name: file.name,
    mimeType: decoded.mimeType,
    bytes: decoded.bytes,
    previewUrl,
    naturalWidth: decoded.width,
    naturalHeight: decoded.height,
    aspectLocked: true,
    x: Math.round((page.baseWidth - w) / 2),
    y: Math.round((page.baseHeight - h) / 2),
    width: w,
    height: h,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
  };

  store.addElement(element, true);
  store.setToolMode('select');
}
