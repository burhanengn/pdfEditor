import type { CanvasElement } from '@/types/elements';
import type {
  AppMode,
  PageMeta,
  PageNumberingConfig,
  SourceDocument,
  ZoomMode,
} from '@/types/pdf';
import { useEditorStore } from '@/store/useEditorStore';
import { blobRegistry } from '@/utils/blobRegistry';
import { getExtractedFontAssetPayloads, populateExtractedFontRegistry, registerExtractedPdfFontsInBrowser } from './embeddedFontExtractor';
import { pdfjsService } from './pdfjsService';
import { getSourceDocBytes, setSourceDocBytes } from './sourceDocRegistry';
import { wasmWorkerClient } from './wasmWorkerClient';

const DB_NAME = 'gullacpdf_session_recovery_v1';
const DB_VERSION = 1;
const SESSION_STORE = 'sessions';
const BLOB_STORE = 'doc_blobs';
const ACTIVE_SESSION_KEY = 'active';

export interface PersistedSessionRecord {
  id: string;
  documentName: string;
  sourceDocs: Record<string, SourceDocument>;
  pages: PageMeta[];
  elements: CanvasElement[];
  pageNumbering: PageNumberingConfig | null;
  activePageId: string | null;
  zoom: number;
  zoomMode: ZoomMode;
  appMode: AppMode;
  hasUnsavedEdits: boolean;
  savedAt: number;
}

export interface RecoverableSessionSummary {
  documentName: string;
  pageCount: number;
  elementCount: number;
  savedAt: number;
  record: PersistedSessionRecord;
  docBytesMap: Record<string, Uint8Array>;
}

let lastCleanPagesRef: PageMeta[] | null = null;
let lastCleanElementsRef: CanvasElement[] | null = null;
let lastCleanNumberingRef: PageNumberingConfig | null = null;

export function markSessionCleanSnapshot(): void {
  const s = useEditorStore.getState();
  lastCleanPagesRef = s.pages;
  lastCleanElementsRef = s.elements;
  lastCleanNumberingRef = s.pageNumbering;
}

export function hasUnsavedSessionChanges(): boolean {
  const s = useEditorStore.getState();
  if (s.pages.length === 0) return false;
  if (lastCleanPagesRef === null && s.elements.length === 0 && !s.canUndo) {
    return false;
  }
  return (
    s.pages !== lastCleanPagesRef ||
    s.elements !== lastCleanElementsRef ||
    s.pageNumbering !== lastCleanNumberingRef
  );
}

function openSessionDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        db.createObjectStore(BLOB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open session IndexedDB'));
  });
}

function stripTransientUrls(elements: CanvasElement[]): CanvasElement[] {
  return elements.map((el) => {
    if ('previewUrl' in el) {
      return { ...el, previewUrl: '' };
    }
    return el;
  });
}

function rehydrateTransientUrls(elements: CanvasElement[]): CanvasElement[] {
  return elements.map((el) => {
    if (el.kind === 'image') {
      const url = blobRegistry.createUrlFromBytes(el.bytes, el.mimeType, 'doc');
      return { ...el, previewUrl: url };
    }
    if (el.kind === 'image-replacement') {
      const url = blobRegistry.createUrlFromBytes(el.bytes, el.mimeType, 'doc');
      return { ...el, previewUrl: url };
    }
    if (el.kind === 'signature') {
      const url = blobRegistry.createUrlFromBytes(el.pngBytes, 'image/png', 'doc');
      return { ...el, previewUrl: url };
    }
    return el;
  });
}

export async function saveAutosaveSession(): Promise<void> {
  const s = useEditorStore.getState();
  if (s.pages.length === 0) return;
  // Persist only when edits exist so opening a file purely for reading doesn't bloat IndexedDB
  if (!hasUnsavedSessionChanges() && s.elements.length === 0 && !s.canUndo) {
    return;
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openSessionDb();
    const usedDocIds = new Set(s.pages.map((p) => p.sourceDocId));
    const tx = db.transaction([SESSION_STORE, BLOB_STORE], 'readwrite');
    const sessionStore = tx.objectStore(SESSION_STORE);
    const blobStore = tx.objectStore(BLOB_STORE);

    for (const docId of usedDocIds) {
      const bytes = getSourceDocBytes(docId);
      if (bytes) {
        blobStore.put({ id: docId, bytes, savedAt: Date.now() });
      }
    }

    const record: PersistedSessionRecord = {
      id: ACTIVE_SESSION_KEY,
      documentName: s.documentName,
      sourceDocs: s.sourceDocs,
      pages: s.pages,
      elements: stripTransientUrls(s.elements),
      pageNumbering: s.pageNumbering,
      activePageId: s.activePageId,
      zoom: s.zoom,
      zoomMode: s.zoomMode,
      appMode: s.appMode,
      hasUnsavedEdits: hasUnsavedSessionChanges(),
      savedAt: Date.now(),
    };
    sessionStore.put(record);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Session save failed'));
    });
  } catch {
    // Best-effort offline autosave; ignore quota/private-mode errors cleanly
  } finally {
    db?.close();
  }
}

export async function loadAutosaveSession(): Promise<RecoverableSessionSummary | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openSessionDb();
    const tx = db.transaction([SESSION_STORE, BLOB_STORE], 'readonly');
    const sessionStore = tx.objectStore(SESSION_STORE);
    const blobStore = tx.objectStore(BLOB_STORE);

    const record = await new Promise<PersistedSessionRecord | undefined>((resolve, reject) => {
      const req = sessionStore.get(ACTIVE_SESSION_KEY);
      req.onsuccess = () => resolve(req.result as PersistedSessionRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record || !record.pages || record.pages.length === 0) {
      return null;
    }

    const docBytesMap: Record<string, Uint8Array> = {};
    const neededDocIds = new Set(record.pages.map((p) => p.sourceDocId));
    for (const docId of neededDocIds) {
      const blobRow = await new Promise<{ id: string; bytes: Uint8Array } | undefined>(
        (resolve, reject) => {
          const req = blobStore.get(docId);
          req.onsuccess = () =>
            resolve(req.result as { id: string; bytes: Uint8Array } | undefined);
          req.onerror = () => reject(req.error);
        },
      );
      if (!blobRow?.bytes) {
        return null;
      }
      docBytesMap[docId] = blobRow.bytes;
    }

    return {
      documentName: record.documentName,
      pageCount: record.pages.length,
      elementCount: record.elements.length,
      savedAt: record.savedAt,
      record,
      docBytesMap,
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function restoreAutosaveSession(summary: RecoverableSessionSummary): Promise<void> {
  const { record, docBytesMap } = summary;
  await pdfjsService.releaseAllDocuments();

  const docIds = Object.keys(docBytesMap);
  if (docIds.length === 0) return;

  const primaryId = record.pages[0]?.sourceDocId ?? docIds[0];
  const primaryMeta = record.sourceDocs[primaryId];
  const primaryBytes = docBytesMap[primaryId];
  if (!primaryMeta || !primaryBytes) return;

  const store = useEditorStore.getState();
  store.loadInitialDocument(
    {
      ...primaryMeta,
      bytes: primaryBytes,
    },
    record.pages,
    { initialMode: record.appMode },
  );

  // Register any additional merged source docs
  for (const docId of docIds) {
    const bytes = docBytesMap[docId];
    if (bytes) {
      await wasmWorkerClient.registerSourceDoc(docId, bytes).catch(() => {});
    }
    if (docId !== primaryId && record.sourceDocs[docId]) {
      const meta = record.sourceDocs[docId];
      // Add metadata + bytes without duplicating pages
      useEditorStore.setState((prev) => ({
        sourceDocs: { ...prev.sourceDocs, [docId]: meta },
      }));
      setSourceDocBytes(docId, bytes);
    }
  }

  const hydratedElements = rehydrateTransientUrls(record.elements);
  useEditorStore.setState({
    documentName: record.documentName,
    elements: hydratedElements,
    pageNumbering: record.pageNumbering,
    activePageId: record.activePageId ?? record.pages[0]?.id ?? null,
    zoom: record.zoom,
    zoomMode: record.zoomMode,
  });

  // Hydrate embedded fonts for primary doc in background
  wasmWorkerClient
    .call('extractEmbeddedFonts', { sourceDocId: primaryId })
    .then(async ({ fonts, assets }) => {
      if (fonts.length === 0) return;
      populateExtractedFontRegistry(fonts, assets);
      await registerExtractedPdfFontsInBrowser(fonts);
      useEditorStore.getState().setExtractedFontsForDoc(primaryId, fonts);
      void getExtractedFontAssetPayloads;
    })
    .catch(() => {});
}

export async function clearAutosaveSession(): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openSessionDb();
    const tx = db.transaction([SESSION_STORE, BLOB_STORE], 'readwrite');
    tx.objectStore(SESSION_STORE).clear();
    tx.objectStore(BLOB_STORE).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore cleanup errors
  } finally {
    db?.close();
  }
}

export function bindAutosaveAndBeforeUnload(): () => void {
  if (typeof window === 'undefined') return () => {};

  let debounceTimer: number | null = null;
  let lastSnapshot = {
    pages: useEditorStore.getState().pages,
    elements: useEditorStore.getState().elements,
    pageNumbering: useEditorStore.getState().pageNumbering,
    sourceDocs: useEditorStore.getState().sourceDocs,
  };

  const unsubscribe = useEditorStore.subscribe((state) => {
    // Reset clean baseline when a fresh document is loaded or reset
    if (state.sourceDocs !== lastSnapshot.sourceDocs && state.elements.length === 0 && !state.canUndo) {
      lastCleanPagesRef = state.pages;
      lastCleanElementsRef = state.elements;
      lastCleanNumberingRef = state.pageNumbering;
    }

    const changed =
      state.pages !== lastSnapshot.pages ||
      state.elements !== lastSnapshot.elements ||
      state.pageNumbering !== lastSnapshot.pageNumbering;

    lastSnapshot = {
      pages: state.pages,
      elements: state.elements,
      pageNumbering: state.pageNumbering,
      sourceDocs: state.sourceDocs,
    };

    if (!changed || state.pages.length === 0) return;

    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      void saveAutosaveSession();
    }, 2000);
  });

  const handleVisibilityOrHide = () => {
    if (document.visibilityState === 'hidden') {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      void saveAutosaveSession();
    }
  };

  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (hasUnsavedSessionChanges()) {
      e.preventDefault();
      e.returnValue = '';
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityOrHide);
  window.addEventListener('pagehide', handleVisibilityOrHide);
  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    unsubscribe();
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    document.removeEventListener('visibilitychange', handleVisibilityOrHide);
    window.removeEventListener('pagehide', handleVisibilityOrHide);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}
