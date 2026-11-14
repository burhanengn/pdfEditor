import { create } from 'zustand';
import {
  getElementLayerTier,
  type CanvasElement,
  type HighlightElement,
  type ImageAddElement,
  type ImageReplacementElement,
  type LayerTier,
  type SavedSignature,
  type SignatureElement,
  type StrokeElement,
  type TextAddElement,
  type TextEditElement,
} from '@/types/elements';
import type {
  DetectedImageObject,
  DetectedTextBlock,
  ExtractedPdfFont,
  PageExtractionResult,
  PageMeta,
  PageNumberingConfig,
  RotationAngle,
  SourceDocument,
  ThemeMode,
  ToolMode,
  UserCustomFont,
  ZoomMode,
} from '@/types/pdf';
import { normalizeRotation } from '@/engine/coordinates';
import {
  findMatchingFontByKey,
  isBuiltinFontFamily,
  parsePdfFontMetadata,
  resolveBlockFontAssignment,
} from '@/engine/fonts';
import { parsePageRangeExpression } from '@/engine/pageRange';
import { blobRegistry } from '@/utils/blobRegistry';
import { createId } from '@/utils/id';
import { dataUrlToUint8Array } from '@/utils/signatureStorage';
import {
  cloneSnapshot,
  collectSnapshotUrls,
  MAX_HISTORY_DEPTH,
  type DocumentSnapshot,
} from './history';

export interface PasswordPromptState {
  fileName: string;
  bytes: Uint8Array;
  mode: 'open' | 'merge';
  invalidAttempt: boolean;
}

export interface PendingSignaturePlacement {
  signature: SavedSignature;
  widthPt: number;
  heightPt: number;
  realisticInk: boolean;
}

export interface SignatureBatchScope {
  mode: 'all' | 'except-first' | 'range';
  rangeExpr?: string;
}

interface EditorState {
  documentName: string;
  sourceDocs: Record<string, SourceDocument>;
  pages: PageMeta[];
  elements: CanvasElement[];
  pageExtractions: Record<string, PageExtractionResult>;
  extractingPages: Record<string, boolean>;
  extractedFonts: ExtractedPdfFont[];
  userFonts: UserCustomFont[];

  activePageId: string | null;
  selectedPageIds: string[];
  lastSelectedPageId: string | null;
  selectedElementIds: string[];
  editingTextElementId: string | null;
  clipboard: CanvasElement[];
  pendingSignaturePlacement: PendingSignaturePlacement | null;
  pageNumbering: PageNumberingConfig | null;

  toolMode: ToolMode;
  zoom: number;
  zoomMode: ZoomMode;
  theme: ThemeMode;
  snapEnabled: boolean;

  drawColor: string;
  drawWidth: number;
  drawOpacity: number;
  highlightColor: string;
  highlightShape: 'highlight' | 'rect' | 'redact';

  isLoading: boolean;
  loadingMessage: string;
  errorBanner: string | null;
  passwordPrompt: PasswordPromptState | null;
  signatureModalOpen: boolean;
  splitModalOpen: boolean;
  organizeModalOpen: boolean;
  pageNumberingModalOpen: boolean;

  savedSignatures: SavedSignature[];

  past: DocumentSnapshot[];
  future: DocumentSnapshot[];
  transactionBaseline: DocumentSnapshot | null;

  canUndo: boolean;
  canRedo: boolean;

  // Actions
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setToolMode: (mode: ToolMode) => void;
  setZoom: (zoom: number, mode?: ZoomMode) => void;
  setZoomMode: (mode: ZoomMode) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setDrawStyle: (style: Partial<{ color: string; width: number; opacity: number }>) => void;
  setHighlightStyle: (
    style: Partial<{ color: string; shape: 'highlight' | 'rect' | 'redact' }>,
  ) => void;
  setLoading: (isLoading: boolean, loadingMessage?: string) => void;
  setErrorBanner: (message: string | null) => void;
  setPasswordPrompt: (prompt: PasswordPromptState | null) => void;
  setSignatureModalOpen: (open: boolean) => void;
  setSplitModalOpen: (open: boolean) => void;
  setOrganizeModalOpen: (open: boolean) => void;
  setPageNumberingModalOpen: (open: boolean) => void;
  setPageNumbering: (config: PageNumberingConfig | null) => void;

  loadInitialDocument: (doc: SourceDocument, pages: PageMeta[]) => void;
  appendMergedDocument: (doc: SourceDocument, newPages: PageMeta[], insertAt?: number) => void;
  resetDocument: () => void;

  setPageExtraction: (pageId: string, result: PageExtractionResult) => void;
  setPageExtracting: (pageId: string, extracting: boolean) => void;
  setExtractedFontsForDoc: (sourceDocId: string, fonts: ExtractedPdfFont[]) => void;
  setUserFonts: (fonts: UserCustomFont[]) => void;

  setActivePage: (pageId: string | null) => void;
  setSelectedPages: (pageIds: string[]) => void;
  togglePageSelection: (pageId: string, multi: boolean) => void;
  selectPageWithModifiers: (
    pageId: string,
    modifiers?: { shiftKey?: boolean; ctrlOrMetaKey?: boolean },
  ) => void;
  selectElements: (ids: string[]) => void;
  setEditingTextElementId: (id: string | null) => void;

  // Page operations (undoable)
  reorderPages: (fromIndex: number, toIndex: number) => void;
  rotatePages: (pageIds: string[], deltaDeg: 90 | -90 | 180) => void;
  deletePages: (pageIds: string[]) => void;
  duplicatePages: (pageIds: string[]) => void;

  // Element operations
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;

  addElement: (element: CanvasElement, select?: boolean) => void;
  updateElements: (
    updates: Array<{ id: string; patch: Partial<CanvasElement> }>,
    recordHistory?: boolean,
  ) => void;
  deleteElements: (ids: string[]) => void;
  bringToFront: (ids: string[]) => void;
  sendToBack: (ids: string[]) => void;
  stepLayer: (ids: string[], direction: 'forward' | 'backward') => void;
  nudgeSelected: (dx: number, dy: number) => void;
  copySelected: () => void;
  pasteClipboard: () => void;

  // Helpers for starting inline edit of detected PDF text or moving detected PDF image
  startEditDetectedText: (block: DetectedTextBlock, maskColor?: string) => TextEditElement;
  promoteDetectedImage: (img: DetectedImageObject) => ImageReplacementElement;

  // Repeating images / watermarks / headers / footers
  applyImageToPages: (
    elementId: string,
    scope: 'all' | 'odd' | 'even',
    behindContent?: boolean,
  ) => void;
  unlinkRepeatingImage: (elementId: string) => void;

  // Signatures & Initials (Paraf)
  setSavedSignatures: (sigs: SavedSignature[]) => void;
  addSavedSignature: (sig: SavedSignature) => void;
  removeSavedSignature: (id: string) => void;
  startPendingSignaturePlacement: (placement: PendingSignaturePlacement) => void;
  cancelPendingSignaturePlacement: () => void;
  placeSignatureAt: (
    pageId: string,
    centerX: number,
    centerY: number,
    placement?: PendingSignaturePlacement,
  ) => SignatureElement | null;
  applySignatureToPages: (
    params: {
      sourceElementId?: string;
      signature?: SavedSignature;
      xNorm?: number;
      yNorm?: number;
      widthPt?: number;
      heightPt?: number;
      rotation?: number;
      opacity?: number;
      realisticInk?: boolean;
    },
    scope: SignatureBatchScope,
  ) => number;

  // Undo / Redo
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

function getNextZIndexForTier(
  elements: CanvasElement[],
  pageId: string,
  tier: LayerTier,
): number {
  let maxZ = 0;
  for (const el of elements) {
    if (el.pageId === pageId && getElementLayerTier(el) === tier && el.zIndex > maxZ) {
      maxZ = el.zIndex;
    }
  }
  return maxZ + 1;
}

function resolveBatchTargetPageIndices(
  totalPages: number,
  scope: SignatureBatchScope,
): number[] {
  if (totalPages <= 0) return [];
  if (scope.mode === 'all') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }
  if (scope.mode === 'except-first') {
    return Array.from({ length: Math.max(0, totalPages - 1) }, (_, i) => i + 1);
  }
  const parsed = parsePageRangeExpression(scope.rangeExpr ?? '', totalPages);
  if (parsed.error) return [];
  return parsed.allIndices;
}

function pushSnapshot(
  past: DocumentSnapshot[],
  snapshot: DocumentSnapshot,
): DocumentSnapshot[] {
  const next = [...past, snapshot];
  if (next.length > MAX_HISTORY_DEPTH) {
    return next.slice(next.length - MAX_HISTORY_DEPTH);
  }
  return next;
}

function runBlobGc(state: {
  pages: PageMeta[];
  elements: CanvasElement[];
  past: DocumentSnapshot[];
  future: DocumentSnapshot[];
  pageExtractions: Record<string, PageExtractionResult>;
}): void {
  const activeUrls = collectSnapshotUrls([
    { pages: state.pages, elements: state.elements },
    ...state.past,
    ...state.future,
  ]);
  for (const extraction of Object.values(state.pageExtractions)) {
    for (const img of extraction.images) {
      if (img.previewUrl) activeUrls.add(img.previewUrl);
    }
  }
  blobRegistry.gc(activeUrls);
}

function sanitizeSelectionAfterSnapshot(
  pages: PageMeta[],
  elements: CanvasElement[],
  activePageId: string | null,
  selectedElementIds: string[],
): { activePageId: string | null; selectedElementIds: string[] } {
  const pageIds = new Set(pages.map((p) => p.id));
  const elemIds = new Set(elements.map((e) => e.id));
  return {
    activePageId: activePageId && pageIds.has(activePageId) ? activePageId : (pages[0]?.id ?? null),
    selectedElementIds: selectedElementIds.filter((id) => elemIds.has(id)),
  };
}

function remapExtractionsAndElementsWithFonts(
  pages: PageMeta[],
  pageExtractions: Record<string, PageExtractionResult>,
  elements: CanvasElement[],
  userFonts: UserCustomFont[],
  extractedFonts: ExtractedPdfFont[],
): {
  pageExtractions: Record<string, PageExtractionResult>;
  elements: CanvasElement[];
} {
  const pageSourceMap = new Map(pages.map((p) => [p.id, p.sourceDocId]));
  const nextExtractions: Record<string, PageExtractionResult> = {};
  for (const [pageId, ext] of Object.entries(pageExtractions)) {
    const sourceDocId = pageSourceMap.get(pageId);
    nextExtractions[pageId] = {
      ...ext,
      textBlocks: ext.textBlocks.map((b) => {
        const res = resolveBlockFontAssignment({
          rawFontName: b.rawFontName,
          originalFontName: b.originalFontName,
          currentFontFamily: b.fontFamily,
          currentFallback: b.fallbackFontFamily,
          isCustomFont: b.isCustomFont,
          sourceDocId,
          userFonts,
          extractedFonts,
        });
        return {
          ...b,
          fontFamily: res.fontFamily,
          fallbackFontFamily: res.fallbackFontFamily,
          fontSource: res.fontSource,
          isCustomFont: res.isCustomFont,
        };
      }),
    };
  }

  const nextElements = elements.map((el) => {
    if (el.kind !== 'text-edit' && el.kind !== 'text-add') return el;
    const sourceDocId = pageSourceMap.get(el.pageId);
    const usesRemovedUserFont =
      el.fontFamily.startsWith('user:') && !userFonts.some((u) => u.id === el.fontFamily);

    // Auto-upgrade elements that still rely on auto-detected/fallback/embedded fonts for their
    // detected original PDF font (including metric-matched fonts when a user explicitly uploads
    // an exact-family font), or safely fall back if their user font was deleted
    const nameHint = el.originalFontName || el.rawFontName;
    const matchedUser = nameHint ? findMatchingFontByKey(nameHint, userFonts) : undefined;
    const inferredBuiltin = nameHint ? parsePdfFontMetadata(nameHint).fontFamily : undefined;
    const matchesAutoAssignedBuiltin =
      el.kind === 'text-edit' &&
      isBuiltinFontFamily(el.fontFamily) &&
      (el.fontFamily === el.fallbackFontFamily || el.fontFamily === inferredBuiltin);

    const shouldReResolve =
      usesRemovedUserFont ||
      Boolean(matchedUser && (matchesAutoAssignedBuiltin || el.fontFamily.startsWith('embedded:'))) ||
      el.fontFamily.startsWith('embedded:') ||
      (el.kind === 'text-edit' && el.isCustomFont && isBuiltinFontFamily(el.fontFamily));

    if (!shouldReResolve) return el;

    const res = resolveBlockFontAssignment({
      rawFontName: el.rawFontName,
      originalFontName: el.originalFontName,
      currentFontFamily: usesRemovedUserFont ? el.fallbackFontFamily ?? 'Helvetica' : el.fontFamily,
      currentFallback: el.fallbackFontFamily,
      isCustomFont: el.isCustomFont,
      sourceDocId,
      userFonts,
      extractedFonts,
    });
    if (
      res.fontFamily === el.fontFamily &&
      res.fontSource === el.fontSource &&
      res.fallbackFontFamily === el.fallbackFontFamily
    ) {
      return el;
    }
    return {
      ...el,
      fontFamily: res.fontFamily,
      fallbackFontFamily: res.fallbackFontFamily,
      fontSource: res.fontSource,
      isCustomFont: res.isCustomFont,
    };
  });

  return { pageExtractions: nextExtractions, elements: nextElements };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  documentName: 'Untitled.pdf',
  sourceDocs: {},
  pages: [],
  elements: [],
  pageExtractions: {},
  extractingPages: {},
  extractedFonts: [],
  userFonts: [],

  activePageId: null,
  selectedPageIds: [],
  lastSelectedPageId: null,
  selectedElementIds: [],
  editingTextElementId: null,
  clipboard: [],
  pendingSignaturePlacement: null,
  pageNumbering: null,

  toolMode: 'select',
  zoom: 1,
  zoomMode: 'fit-width',
  theme: 'dark',
  snapEnabled: true,

  drawColor: '#ef4444',
  drawWidth: 2.5,
  drawOpacity: 1,
  highlightColor: '#facc15',
  highlightShape: 'highlight',

  isLoading: false,
  loadingMessage: '',
  errorBanner: null,
  passwordPrompt: null,
  signatureModalOpen: false,
  splitModalOpen: false,
  organizeModalOpen: false,
  pageNumberingModalOpen: false,

  savedSignatures: [],

  past: [],
  future: [],
  transactionBaseline: null,

  canUndo: false,
  canRedo: false,

  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  setToolMode: (toolMode) =>
    set({
      toolMode,
      pendingSignaturePlacement: null,
      ...(toolMode !== 'select' ? { selectedElementIds: [], editingTextElementId: null } : {}),
    }),
  setZoom: (zoom, mode = 'custom') =>
    set({
      zoom: Math.min(4, Math.max(0.25, Number(zoom.toFixed(3)))),
      zoomMode: mode,
    }),
  setZoomMode: (zoomMode) => set({ zoomMode }),
  setSnapEnabled: (snapEnabled) => set({ snapEnabled }),
  setDrawStyle: (style) =>
    set((s) => ({
      drawColor: style.color ?? s.drawColor,
      drawWidth: style.width ?? s.drawWidth,
      drawOpacity: style.opacity ?? s.drawOpacity,
    })),
  setHighlightStyle: (style) =>
    set((s) => ({
      highlightColor: style.color ?? s.highlightColor,
      highlightShape: style.shape ?? s.highlightShape,
    })),
  setLoading: (isLoading, loadingMessage = '') => set({ isLoading, loadingMessage }),
  setErrorBanner: (errorBanner) => set({ errorBanner }),
  setPasswordPrompt: (passwordPrompt) => set({ passwordPrompt }),
  setSignatureModalOpen: (signatureModalOpen) => set({ signatureModalOpen }),
  setSplitModalOpen: (splitModalOpen) => set({ splitModalOpen }),
  setOrganizeModalOpen: (organizeModalOpen) => set({ organizeModalOpen }),
  setPageNumberingModalOpen: (pageNumberingModalOpen) => set({ pageNumberingModalOpen }),
  setPageNumbering: (pageNumbering) => {
    const state = get();
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      pageNumbering: pageNumbering ? { ...pageNumbering } : null,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  loadInitialDocument: (doc, pages) => {
    blobRegistry.revokeScope('doc');
    blobRegistry.revokeScope('cache');
    set({
      documentName: doc.name,
      sourceDocs: { [doc.id]: doc },
      pages,
      elements: [],
      pageExtractions: {},
      extractingPages: {},
      extractedFonts: [],
      activePageId: pages[0]?.id ?? null,
      selectedPageIds: pages[0] ? [pages[0].id] : [],
      lastSelectedPageId: pages[0]?.id ?? null,
      selectedElementIds: [],
      editingTextElementId: null,
      pendingSignaturePlacement: null,
      pageNumbering: null,
      past: [],
      future: [],
      transactionBaseline: null,
      canUndo: false,
      canRedo: false,
      errorBanner: null,
      passwordPrompt: null,
    });
  },

  appendMergedDocument: (doc, newPages, insertAt) => {
    const state = get();
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextPages = [...state.pages];
    const index =
      insertAt !== undefined && insertAt >= 0 && insertAt <= nextPages.length
        ? insertAt
        : nextPages.length;
    nextPages.splice(index, 0, ...newPages);
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      sourceDocs: { ...state.sourceDocs, [doc.id]: doc },
      pages: nextPages,
      activePageId: newPages[0]?.id ?? state.activePageId,
      selectedPageIds: newPages.map((p) => p.id),
      lastSelectedPageId: newPages[0]?.id ?? state.lastSelectedPageId,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  resetDocument: () => {
    blobRegistry.revokeScope('doc');
    blobRegistry.revokeScope('cache');
    set({
      documentName: 'Untitled.pdf',
      sourceDocs: {},
      pages: [],
      elements: [],
      pageExtractions: {},
      extractingPages: {},
      extractedFonts: [],
      activePageId: null,
      selectedPageIds: [],
      lastSelectedPageId: null,
      selectedElementIds: [],
      editingTextElementId: null,
      pendingSignaturePlacement: null,
      pageNumbering: null,
      past: [],
      future: [],
      transactionBaseline: null,
      canUndo: false,
      canRedo: false,
    });
  },

  setPageExtraction: (pageId, result) =>
    set((s) => {
      const sourceDocId = s.pages.find((p) => p.id === pageId)?.sourceDocId;
      const mappedBlocks = result.textBlocks.map((b) => {
        const res = resolveBlockFontAssignment({
          rawFontName: b.rawFontName,
          originalFontName: b.originalFontName,
          currentFontFamily: b.fontFamily,
          currentFallback: b.fallbackFontFamily,
          isCustomFont: b.isCustomFont,
          sourceDocId,
          userFonts: s.userFonts,
          extractedFonts: s.extractedFonts,
        });
        return {
          ...b,
          fontFamily: res.fontFamily,
          fallbackFontFamily: res.fallbackFontFamily,
          fontSource: res.fontSource,
          isCustomFont: res.isCustomFont,
        };
      });
      return {
        pageExtractions: {
          ...s.pageExtractions,
          [pageId]: { ...result, textBlocks: mappedBlocks },
        },
        extractingPages: { ...s.extractingPages, [pageId]: false },
      };
    }),

  setPageExtracting: (pageId, extracting) =>
    set((s) => ({
      extractingPages: { ...s.extractingPages, [pageId]: extracting },
    })),

  setExtractedFontsForDoc: (sourceDocId, fonts) =>
    set((s) => {
      const others = s.extractedFonts.filter((f) => f.sourceDocId !== sourceDocId);
      const nextExtracted = [...others, ...fonts];
      const remapped = remapExtractionsAndElementsWithFonts(
        s.pages,
        s.pageExtractions,
        s.elements,
        s.userFonts,
        nextExtracted,
      );
      return {
        extractedFonts: nextExtracted,
        pageExtractions: remapped.pageExtractions,
        elements: remapped.elements,
      };
    }),

  setUserFonts: (userFonts) =>
    set((s) => {
      const remapped = remapExtractionsAndElementsWithFonts(
        s.pages,
        s.pageExtractions,
        s.elements,
        userFonts,
        s.extractedFonts,
      );
      return {
        userFonts,
        pageExtractions: remapped.pageExtractions,
        elements: remapped.elements,
      };
    }),

  setActivePage: (activePageId) => set({ activePageId }),
  setSelectedPages: (selectedPageIds) =>
    set((s) => ({
      selectedPageIds,
      lastSelectedPageId: selectedPageIds[0] ?? s.lastSelectedPageId,
    })),
  togglePageSelection: (pageId, multi) =>
    set((s) => {
      if (!multi) {
        return {
          selectedPageIds: [pageId],
          activePageId: pageId,
          lastSelectedPageId: pageId,
        };
      }
      const exists = s.selectedPageIds.includes(pageId);
      const next = exists
        ? s.selectedPageIds.filter((id) => id !== pageId)
        : [...s.selectedPageIds, pageId];
      return {
        selectedPageIds: next.length > 0 ? next : [pageId],
        activePageId: pageId,
        lastSelectedPageId: pageId,
      };
    }),
  selectPageWithModifiers: (pageId, modifiers = {}) =>
    set((s) => {
      const targetIndex = s.pages.findIndex((p) => p.id === pageId);
      if (targetIndex < 0) return {};

      if (modifiers.shiftKey) {
        const anchorId = s.lastSelectedPageId ?? s.activePageId ?? s.pages[0]?.id;
        let anchorIndex = s.pages.findIndex((p) => p.id === anchorId);
        if (anchorIndex < 0) anchorIndex = 0;
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        const rangeIds = s.pages.slice(start, end + 1).map((p) => p.id);
        return {
          selectedPageIds: rangeIds,
          activePageId: pageId,
          // Keep lastSelectedPageId intact as Shift anchor per desktop OS conventions
          lastSelectedPageId: s.lastSelectedPageId ?? anchorId ?? pageId,
        };
      }

      if (modifiers.ctrlOrMetaKey) {
        const exists = s.selectedPageIds.includes(pageId);
        const next = exists
          ? s.selectedPageIds.filter((id) => id !== pageId)
          : [...s.selectedPageIds, pageId];
        return {
          selectedPageIds: next.length > 0 ? next : [pageId],
          activePageId: pageId,
          lastSelectedPageId: pageId,
        };
      }

      return {
        selectedPageIds: [pageId],
        activePageId: pageId,
        lastSelectedPageId: pageId,
      };
    }),

  selectElements: (selectedElementIds) => set({ selectedElementIds }),
  setEditingTextElementId: (editingTextElementId) => set({ editingTextElementId }),

  reorderPages: (fromIndex, toIndex) => {
    const state = get();
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= state.pages.length ||
      toIndex >= state.pages.length
    ) {
      return;
    }
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextPages = [...state.pages];
    const [moved] = nextPages.splice(fromIndex, 1);
    nextPages.splice(toIndex, 0, moved);
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      pages: nextPages,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  rotatePages: (pageIds, deltaDeg) => {
    const state = get();
    if (pageIds.length === 0) return;
    const idSet = new Set(pageIds);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextPages = state.pages.map((p) =>
      idSet.has(p.id)
        ? { ...p, userRotation: normalizeRotation(p.userRotation + deltaDeg) as RotationAngle }
        : p,
    );
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      pages: nextPages,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  deletePages: (pageIds) => {
    const state = get();
    if (pageIds.length === 0 || state.pages.length <= 1) return;
    const idSet = new Set(pageIds);
    const remaining = state.pages.filter((p) => !idSet.has(p.id));
    if (remaining.length === 0) return;
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const remainingIds = new Set(remaining.map((p) => p.id));
    const nextElements = state.elements.filter((el) => remainingIds.has(el.pageId));
    const nextActive =
      state.activePageId && remainingIds.has(state.activePageId)
        ? state.activePageId
        : remaining[0].id;
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      pages: remaining,
      elements: nextElements,
      activePageId: nextActive,
      selectedPageIds: [nextActive],
      lastSelectedPageId: nextActive,
      selectedElementIds: state.selectedElementIds.filter((id) =>
        nextElements.some((el) => el.id === id),
      ),
      editingTextElementId: null,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
    runBlobGc({
      pages: remaining,
      elements: nextElements,
      past: nextPast,
      future: [],
      pageExtractions: state.pageExtractions,
    });
  },

  duplicatePages: (pageIds) => {
    const state = get();
    if (pageIds.length === 0) return;
    const idSet = new Set(pageIds);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextPages: PageMeta[] = [];
    const clonedElements: CanvasElement[] = [...state.elements];
    let lastDuplicatedId: string | null = null;

    for (const p of state.pages) {
      nextPages.push(p);
      if (idSet.has(p.id)) {
        const dupId = createId('page');
        lastDuplicatedId = dupId;
        nextPages.push({
          ...p,
          id: dupId,
          mediaBox: [...p.mediaBox] as [number, number, number, number],
          cropBox: [...p.cropBox] as [number, number, number, number],
        });
        for (const el of state.elements) {
          if (el.pageId === p.id) {
            clonedElements.push({
              ...el,
              id: createId('el'),
              pageId: dupId,
            } as CanvasElement);
          }
        }
      }
    }

    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      pages: nextPages,
      elements: clonedElements,
      activePageId: lastDuplicatedId ?? state.activePageId,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  beginTransaction: () => {
    const state = get();
    if (state.transactionBaseline) return;
    set({
      transactionBaseline: cloneSnapshot(state.pages, state.elements, state.pageNumbering),
    });
  },

  commitTransaction: () => {
    const state = get();
    if (!state.transactionBaseline) return;
    const nextPast = pushSnapshot(state.past, state.transactionBaseline);
    set({
      past: nextPast,
      future: [],
      transactionBaseline: null,
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  abortTransaction: () => {
    const state = get();
    if (!state.transactionBaseline) return;
    set({
      pages: state.transactionBaseline.pages,
      elements: state.transactionBaseline.elements,
      pageNumbering: state.transactionBaseline.pageNumbering ?? null,
      transactionBaseline: null,
    });
  },

  addElement: (element, select = true) => {
    const state = get();
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const tier = getElementLayerTier(element);
    const zIndex = element.zIndex || getNextZIndexForTier(state.elements, element.pageId, tier);
    const nextEl = { ...element, zIndex } as CanvasElement;
    const nextElements = [...state.elements, nextEl];
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: select ? [nextEl.id] : state.selectedElementIds,
      activePageId: nextEl.pageId,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  updateElements: (updates, recordHistory = true) => {
    if (updates.length === 0) return;
    const state = get();
    const patchMap = new Map(updates.map((u) => [u.id, u.patch]));

    // Sync transform/opacity/behindContent across repeating image siblings
    const repeatGroupPatches = new Map<string, Partial<ImageAddElement | ImageReplacementElement>>();
    const SYNC_KEYS = [
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'opacity',
      'behindContent',
      'flipX',
      'flipY',
      'layerOverride',
    ] as const;

    for (const u of updates) {
      const target = state.elements.find((el) => el.id === u.id);
      if (
        target &&
        (target.kind === 'image' || target.kind === 'image-replacement') &&
        target.repeatGroupId
      ) {
        const synced: Record<string, unknown> = {};
        let hasSyncField = false;
        const pRecord = u.patch as Record<string, unknown>;
        for (const k of SYNC_KEYS) {
          if (k in pRecord) {
            synced[k] = pRecord[k];
            hasSyncField = true;
          }
        }
        if (hasSyncField) {
          repeatGroupPatches.set(
            target.repeatGroupId,
            synced as Partial<ImageAddElement | ImageReplacementElement>,
          );
        }
      }
    }

    const shouldPush = recordHistory && !state.transactionBaseline;
    const snapshot = shouldPush
      ? cloneSnapshot(state.pages, state.elements, state.pageNumbering)
      : null;

    const nextElements = state.elements.map((el) => {
      const directPatch = patchMap.get(el.id);
      if (directPatch) {
        return { ...el, ...directPatch } as CanvasElement;
      }
      if (
        (el.kind === 'image' || el.kind === 'image-replacement') &&
        el.repeatGroupId &&
        repeatGroupPatches.has(el.repeatGroupId)
      ) {
        return { ...el, ...repeatGroupPatches.get(el.repeatGroupId) } as CanvasElement;
      }
      return el;
    });

    if (shouldPush && snapshot) {
      const nextPast = pushSnapshot(state.past, snapshot);
      set({
        elements: nextElements,
        past: nextPast,
        future: [],
        canUndo: nextPast.length > 0,
        canRedo: false,
      });
    } else {
      set({ elements: nextElements });
    }
  },

  deleteElements: (ids) => {
    if (ids.length === 0) return;
    const state = get();
    const idSet = new Set(ids);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);

    // For existing detected PDF text/image edits, mark `deleted: true` instead of removing,
    // so the underlying PDF content stream operator is still removed on preview & export!
    const nextElements: CanvasElement[] = [];
    for (const el of state.elements) {
      if (!idSet.has(el.id)) {
        nextElements.push(el);
        continue;
      }
      if (el.kind === 'text-edit') {
        nextElements.push({ ...el, deleted: true });
      } else if (el.kind === 'image-replacement') {
        nextElements.push({ ...el, deleted: true });
      }
    }

    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: state.selectedElementIds.filter((id) => !idSet.has(id)),
      editingTextElementId:
        state.editingTextElementId && idSet.has(state.editingTextElementId)
          ? null
          : state.editingTextElementId,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
    runBlobGc({
      pages: state.pages,
      elements: nextElements,
      past: nextPast,
      future: [],
      pageExtractions: state.pageExtractions,
    });
  },

  bringToFront: (ids) => {
    const state = get();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    let maxZ = state.elements.reduce((m, e) => Math.max(m, e.zIndex), 0);
    const nextElements = state.elements.map((el) => {
      if (!idSet.has(el.id)) return el;
      if (el.kind === 'image' || el.kind === 'image-replacement') {
        return {
          ...el,
          zIndex: ++maxZ,
          layerOverride: 4,
          behindContent: false,
        } as CanvasElement;
      }
      return { ...el, zIndex: ++maxZ, layerOverride: 4 } as CanvasElement;
    });
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  sendToBack: (ids) => {
    const state = get();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    let minZ = state.elements.reduce((m, e) => Math.min(m, e.zIndex), 1);
    const nextElements = state.elements.map((el) => {
      if (!idSet.has(el.id)) return el;
      if (el.kind === 'image' || el.kind === 'image-replacement') {
        return {
          ...el,
          zIndex: --minZ,
          layerOverride: 1,
          behindContent: true,
        } as CanvasElement;
      }
      return { ...el, zIndex: --minZ, layerOverride: 1 } as CanvasElement;
    });
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  stepLayer: (ids, direction) => {
    const state = get();
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextElements = state.elements.map((el) => {
      if (!idSet.has(el.id)) return el;
      const curTier = getElementLayerTier(el);
      const samePagePeers = state.elements.filter(
        (other) => other.pageId === el.pageId && other.id !== el.id && !('deleted' in other && other.deleted),
      );

      if (direction === 'forward') {
        const sameTierHigher = samePagePeers.filter(
          (p) => getElementLayerTier(p) === curTier && p.zIndex > el.zIndex,
        );
        if (sameTierHigher.length > 0) {
          const minHigher = Math.min(...sameTierHigher.map((p) => p.zIndex));
          return { ...el, zIndex: minHigher + 1 } as CanvasElement;
        }
        const nextTier = Math.min(4, curTier + 1) as LayerTier;
        const patch: Partial<CanvasElement> = {
          layerOverride: nextTier,
          zIndex: el.zIndex + 1,
        };
        if ((el.kind === 'image' || el.kind === 'image-replacement') && nextTier > 1) {
          (patch as Partial<ImageAddElement>).behindContent = false;
        }
        return { ...el, ...patch } as CanvasElement;
      }

      const sameTierLower = samePagePeers.filter(
        (p) => getElementLayerTier(p) === curTier && p.zIndex < el.zIndex,
      );
      if (sameTierLower.length > 0) {
        const maxLower = Math.max(...sameTierLower.map((p) => p.zIndex));
        return { ...el, zIndex: maxLower - 1 } as CanvasElement;
      }
      const prevTier = Math.max(1, curTier - 1) as LayerTier;
      const patch: Partial<CanvasElement> = {
        layerOverride: prevTier,
        zIndex: el.zIndex - 1,
      };
      if (el.kind === 'image' || el.kind === 'image-replacement') {
        (patch as Partial<ImageAddElement>).behindContent = prevTier === 1;
      }
      return { ...el, ...patch } as CanvasElement;
    });
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  nudgeSelected: (dx, dy) => {
    const state = get();
    if (state.selectedElementIds.length === 0) return;
    const idSet = new Set(state.selectedElementIds);
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextElements = state.elements.map((el) =>
      idSet.has(el.id) ? ({ ...el, x: el.x + dx, y: el.y + dy } as CanvasElement) : el,
    );
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  copySelected: () => {
    const state = get();
    const idSet = new Set(state.selectedElementIds);
    const copied = state.elements.filter(
      (el) => idSet.has(el.id) && !('deleted' in el && el.deleted),
    );
    if (copied.length > 0) {
      set({ clipboard: copied });
    }
  },

  pasteClipboard: () => {
    const state = get();
    if (state.clipboard.length === 0) return;
    const targetPageId = state.activePageId ?? state.pages[0]?.id;
    if (!targetPageId) return;
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const pastedIds: string[] = [];
    const additions: CanvasElement[] = [];

    for (const item of state.clipboard) {
      const id = createId('el');
      pastedIds.push(id);
      const itemTier = getElementLayerTier(item);
      const nextZ = getNextZIndexForTier([...state.elements, ...additions], targetPageId, itemTier);

      if (item.kind === 'text-edit') {
        const converted: TextAddElement = {
          id,
          pageId: targetPageId,
          kind: 'text-add',
          x: item.x + 16,
          y: item.y + 16,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
          opacity: item.opacity,
          zIndex: nextZ,
          text: item.text,
          runs: item.runs ? item.runs.map((r) => ({ ...r })) : undefined,
          fontFamily: item.fontFamily,
          fallbackFontFamily: item.fallbackFontFamily,
          fontSource: item.fontSource,
          rawFontName: item.rawFontName,
          originalFontName: item.originalFontName,
          isCustomFont: item.isCustomFont,
          fontSize: item.fontSize,
          color: item.color,
          bold: item.bold,
          italic: item.italic,
          align: item.align,
          lineHeight: item.lineHeight,
          horizontalScale: item.horizontalScale,
          letterSpacing: item.letterSpacing,
        };
        additions.push(converted);
      } else if (item.kind === 'image-replacement') {
        const converted: ImageAddElement = {
          id,
          pageId: targetPageId,
          kind: 'image',
          x: item.x + 16,
          y: item.y + 16,
          width: item.width,
          height: item.height,
          rotation: item.rotation,
          opacity: item.opacity,
          zIndex: nextZ,
          name: item.name,
          mimeType: item.mimeType,
          bytes: item.bytes,
          previewUrl: blobRegistry.createUrlFromBytes(item.bytes, item.mimeType, 'doc'),
          naturalWidth: item.naturalWidth,
          naturalHeight: item.naturalHeight,
          aspectLocked: item.aspectLocked,
          behindContent: item.behindContent,
          flipX: item.flipX,
          flipY: item.flipY,
        };
        additions.push(converted);
      } else if (item.kind === 'signature') {
        const pngCopy = new Uint8Array(item.pngBytes);
        const dup: SignatureElement = {
          ...item,
          id,
          pageId: targetPageId,
          x: item.x + 16,
          y: item.y + 16,
          zIndex: nextZ,
          pngBytes: pngCopy,
          previewUrl: blobRegistry.createUrlFromBytes(pngCopy, 'image/png', 'doc'),
          svgPaths: item.svgPaths ? item.svgPaths.map((p) => ({ ...p })) : undefined,
        };
        additions.push(dup);
      } else {
        const dup = {
          ...item,
          id,
          pageId: targetPageId,
          x: item.x + 16,
          y: item.y + 16,
          zIndex: nextZ,
          repeatGroupId: undefined,
          repeatScope: undefined,
        } as CanvasElement;
        if ('bytes' in dup && dup.bytes && 'mimeType' in dup) {
          dup.previewUrl = blobRegistry.createUrlFromBytes(dup.bytes, dup.mimeType, 'doc');
        }
        additions.push(dup);
      }
    }

    const nextElements = [...state.elements, ...additions];
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: pastedIds,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  startEditDetectedText: (block, maskColor) => {
    const state = get();
    const existing = state.elements.find(
      (el): el is TextEditElement =>
        el.kind === 'text-edit' &&
        el.pageId === block.pageId &&
        el.originalBlockId === block.id &&
        !el.deleted,
    );
    if (existing) {
      set({
        selectedElementIds: [existing.id],
        editingTextElementId: existing.id,
        activePageId: block.pageId,
      });
      return existing;
    }

    const created: TextEditElement = {
      id: createId('txtedit'),
      pageId: block.pageId,
      kind: 'text-edit',
      originalBlockId: block.id,
      originalRect: {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
      },
      originalText: block.text,
      x: block.x,
      y: block.y,
      width: Math.max((block.paragraphWidth ?? block.width) + 2, 40),
      height: Math.max(block.height, block.fontSize * 1.25),
      rotation: 0,
      opacity: 1,
      zIndex: getNextZIndexForTier(state.elements, block.pageId, 3),
      text: block.text,
      runs: block.runs ? block.runs.map((r) => ({ ...r })) : undefined,
      fontFamily: block.fontFamily,
      fallbackFontFamily: block.fallbackFontFamily,
      fontSource: block.fontSource,
      rawFontName: block.rawFontName,
      originalFontName: block.originalFontName,
      isCustomFont: block.isCustomFont,
      fontSize: block.fontSize,
      color: block.color,
      bold: block.bold,
      italic: block.italic,
      align: block.align ?? 'left',
      lineHeight: block.lineHeight,
      horizontalScale: block.horizontalScale,
      letterSpacing: block.letterSpacing,
      maskColor: maskColor ?? '#ffffff',
    };

    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextElements = [...state.elements, created];
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: [created.id],
      editingTextElementId: created.id,
      activePageId: block.pageId,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
    return created;
  },

  promoteDetectedImage: (img) => {
    const state = get();
    const existing = state.elements.find(
      (el): el is ImageReplacementElement =>
        el.kind === 'image-replacement' &&
        el.pageId === img.pageId &&
        el.originalImageId === img.id &&
        !el.deleted,
    );
    if (existing) {
      set({
        selectedElementIds: [existing.id],
        activePageId: img.pageId,
      });
      return existing;
    }

    const previewUrl = blobRegistry.createUrlFromBytes(img.pngBytes, 'image/png', 'doc');
    const isBehind = Boolean(img.behindContent || img.isHeaderOrBackground);
    const tier: LayerTier = isBehind ? 1 : 2;
    const created: ImageReplacementElement = {
      id: createId('imgedit'),
      pageId: img.pageId,
      kind: 'image-replacement',
      originalImageId: img.id,
      resourceName: img.resourceName,
      originalRect: {
        x: img.x,
        y: img.y,
        width: img.width,
        height: img.height,
      },
      name: img.resourceName || 'Embedded Image',
      mimeType: 'image/png',
      bytes: img.pngBytes,
      previewUrl,
      x: img.x,
      y: img.y,
      width: img.width,
      height: img.height,
      rotation: img.rotation,
      flipX: img.flipX,
      flipY: img.flipY,
      opacity: img.opacity ?? 1,
      zIndex: img.operatorIndex ?? getNextZIndexForTier(state.elements, img.pageId, tier),
      naturalWidth: img.pixelWidth,
      naturalHeight: img.pixelHeight,
      aspectLocked: true,
      behindContent: isBehind,
    };

    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextElements = [...state.elements, created];
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: [created.id],
      activePageId: img.pageId,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
    return created;
  },

  applyImageToPages: (elementId, scope, behindContent) => {
    const state = get();
    const source = state.elements.find(
      (el): el is ImageAddElement | ImageReplacementElement =>
        el.id === elementId && (el.kind === 'image' || el.kind === 'image-replacement'),
    );
    if (!source || state.pages.length === 0) return;

    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const repeatGroupId = source.repeatGroupId ?? createId('rptimg');
    const effectiveBehind = behindContent ?? source.behindContent ?? false;
    const effectiveTier: LayerTier = effectiveBehind ? 1 : 2;

    // Remove older clones belonging to same repeatGroupId on other pages so scope changes cleanly
    const cleanedElements = state.elements.filter(
      (el) =>
        el.id === source.id ||
        !(
          (el.kind === 'image' || el.kind === 'image-replacement') &&
          el.repeatGroupId === repeatGroupId
        ),
    );

    const updatedSource: ImageAddElement | ImageReplacementElement = {
      ...source,
      repeatGroupId,
      repeatScope: scope,
      behindContent: effectiveBehind,
      layerOverride: effectiveBehind ? 1 : undefined,
    };

    const nextElements: CanvasElement[] = cleanedElements.map((el) =>
      el.id === source.id ? updatedSource : el,
    );

    state.pages.forEach((pg, pageIdx) => {
      if (pg.id === source.pageId) return;
      const pageNum = pageIdx + 1;
      if (scope === 'odd' && pageNum % 2 === 0) return;
      if (scope === 'even' && pageNum % 2 === 1) return;

      const bytesCopy = new Uint8Array(source.bytes);
      const clone: ImageAddElement = {
        id: createId('img'),
        pageId: pg.id,
        kind: 'image',
        name: source.name,
        mimeType: source.mimeType,
        bytes: bytesCopy,
        previewUrl: blobRegistry.createUrlFromBytes(bytesCopy, source.mimeType, 'doc'),
        naturalWidth: source.naturalWidth,
        naturalHeight: source.naturalHeight,
        aspectLocked: source.aspectLocked,
        behindContent: effectiveBehind,
        layerOverride: effectiveBehind ? 1 : undefined,
        flipX: source.flipX,
        flipY: source.flipY,
        repeatGroupId,
        repeatScope: scope,
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
        rotation: source.rotation,
        opacity: source.opacity,
        zIndex: getNextZIndexForTier(nextElements, pg.id, effectiveTier),
      };
      nextElements.push(clone);
    });

    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  unlinkRepeatingImage: (elementId) => {
    const state = get();
    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextElements = state.elements.map((el) =>
      el.id === elementId && (el.kind === 'image' || el.kind === 'image-replacement')
        ? { ...el, repeatGroupId: undefined, repeatScope: undefined }
        : el,
    );
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
  },

  setSavedSignatures: (savedSignatures) => set({ savedSignatures }),
  addSavedSignature: (sig) =>
    set((s) => ({ savedSignatures: [sig, ...s.savedSignatures] })),
  removeSavedSignature: (id) =>
    set((s) => ({ savedSignatures: s.savedSignatures.filter((sig) => sig.id !== id) })),

  startPendingSignaturePlacement: (pendingSignaturePlacement) =>
    set({
      pendingSignaturePlacement,
      toolMode: 'select',
      selectedElementIds: [],
      editingTextElementId: null,
    }),

  cancelPendingSignaturePlacement: () => set({ pendingSignaturePlacement: null }),

  placeSignatureAt: (pageId, centerX, centerY, overridePlacement) => {
    const state = get();
    const pending = overridePlacement ?? state.pendingSignaturePlacement;
    if (!pending) return null;
    const page = state.pages.find((p) => p.id === pageId);
    if (!page) return null;

    const { signature, widthPt, heightPt, realisticInk } = pending;
    const pngBytes = dataUrlToUint8Array(signature.dataUrl);
    const previewUrl = blobRegistry.createUrlFromBytes(pngBytes, 'image/png', 'doc');

    const clampedW = Math.min(page.baseWidth, Math.max(16, Math.round(widthPt)));
    const clampedH = Math.min(page.baseHeight, Math.max(12, Math.round(heightPt)));
    const rawX = centerX - clampedW / 2;
    const rawY = centerY - clampedH / 2;
    const x = Math.max(0, Math.min(page.baseWidth - clampedW, Math.round(rawX)));
    const y = Math.max(0, Math.min(page.baseHeight - clampedH, Math.round(rawY)));

    const el: SignatureElement = {
      id: createId('sigel'),
      pageId: page.id,
      kind: 'signature',
      signatureId: signature.id,
      templateId: signature.templateId ?? signature.id,
      variant: signature.variant ?? 'signature',
      label: signature.label,
      pngBytes,
      previewUrl,
      naturalWidth: signature.width,
      naturalHeight: signature.height,
      aspectLocked: true,
      realisticInk,
      svgPaths: signature.svgPaths ? signature.svgPaths.map((p) => ({ ...p })) : undefined,
      viewBoxWidth: signature.viewBoxWidth,
      viewBoxHeight: signature.viewBoxHeight,
      x,
      y,
      width: clampedW,
      height: clampedH,
      rotation: 0,
      opacity: 1,
      zIndex: getNextZIndexForTier(state.elements, page.id, 4),
    };

    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextElements = [...state.elements, el];
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: [el.id],
      activePageId: page.id,
      pendingSignaturePlacement: null,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
    return el;
  },

  applySignatureToPages: (params, scope) => {
    const state = get();
    if (state.pages.length === 0) return 0;
    const indices = resolveBatchTargetPageIndices(state.pages.length, scope);
    if (indices.length === 0) return 0;

    let srcEl: SignatureElement | undefined;
    if (params.sourceElementId) {
      srcEl = state.elements.find(
        (el): el is SignatureElement => el.id === params.sourceElementId && el.kind === 'signature',
      );
    }

    const sig = params.signature;
    if (!srcEl && !sig) return 0;

    const srcPage = srcEl ? state.pages.find((p) => p.id === srcEl.pageId) : undefined;
    const xNorm =
      params.xNorm ??
      (srcEl && srcPage ? (srcEl.x + srcEl.width / 2) / Math.max(1, srcPage.baseWidth) : 0.78);
    const yNorm =
      params.yNorm ??
      (srcEl && srcPage ? (srcEl.y + srcEl.height / 2) / Math.max(1, srcPage.baseHeight) : 0.88);
    const baseW = srcEl ? srcEl.width : (params.widthPt ?? 120);
    const baseH = srcEl ? srcEl.height : (params.heightPt ?? 44);
    const baseRot = srcEl ? srcEl.rotation : (params.rotation ?? 0);
    const baseOpacity = srcEl ? srcEl.opacity : (params.opacity ?? 1);
    const realisticInk = srcEl ? Boolean(srcEl.realisticInk) : Boolean(params.realisticInk ?? sig?.realisticInk);

    const snapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const additions: SignatureElement[] = [];

    for (const pageIdx of indices) {
      const targetPage = state.pages[pageIdx];
      if (!targetPage) continue;
      if (srcEl && targetPage.id === srcEl.pageId) continue;

      const rawBytes = srcEl
        ? new Uint8Array(srcEl.pngBytes)
        : dataUrlToUint8Array(sig!.dataUrl);
      const previewUrl = blobRegistry.createUrlFromBytes(rawBytes, 'image/png', 'doc');

      const w = Math.min(targetPage.baseWidth, Math.max(16, Math.round(baseW)));
      const h = Math.min(targetPage.baseHeight, Math.max(12, Math.round(baseH)));
      const cx = xNorm * targetPage.baseWidth;
      const cy = yNorm * targetPage.baseHeight;
      const x = Math.max(0, Math.min(targetPage.baseWidth - w, Math.round(cx - w / 2)));
      const y = Math.max(0, Math.min(targetPage.baseHeight - h, Math.round(cy - h / 2)));

      additions.push({
        id: createId('sigel'),
        pageId: targetPage.id,
        kind: 'signature',
        signatureId: srcEl ? srcEl.signatureId : sig!.id,
        templateId: srcEl ? srcEl.templateId : (sig!.templateId ?? sig!.id),
        variant: srcEl ? srcEl.variant : (sig!.variant ?? 'signature'),
        label: srcEl ? srcEl.label : sig!.label,
        pngBytes: rawBytes,
        previewUrl,
        naturalWidth: srcEl ? srcEl.naturalWidth : sig!.width,
        naturalHeight: srcEl ? srcEl.naturalHeight : sig!.height,
        aspectLocked: true,
        realisticInk,
        svgPaths: (srcEl ? srcEl.svgPaths : sig?.svgPaths)?.map((p) => ({ ...p })),
        viewBoxWidth: srcEl ? srcEl.viewBoxWidth : sig?.viewBoxWidth,
        viewBoxHeight: srcEl ? srcEl.viewBoxHeight : sig?.viewBoxHeight,
        x,
        y,
        width: w,
        height: h,
        rotation: baseRot,
        opacity: baseOpacity,
        zIndex: getNextZIndexForTier([...state.elements, ...additions], targetPage.id, 4),
      });
    }

    if (additions.length === 0) return 0;

    const nextElements = [...state.elements, ...additions];
    const nextPast = pushSnapshot(state.past, snapshot);
    set({
      elements: nextElements,
      selectedElementIds: [additions[0].id],
      activePageId: additions[0].pageId,
      pendingSignaturePlacement: null,
      past: nextPast,
      future: [],
      canUndo: nextPast.length > 0,
      canRedo: false,
    });
    return additions.length;
  },

  undo: () => {
    const state = get();
    if (state.past.length === 0) return;
    const previous = state.past[state.past.length - 1];
    const currentSnapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextPast = state.past.slice(0, -1);
    const nextFuture = [currentSnapshot, ...state.future].slice(0, MAX_HISTORY_DEPTH);
    const sanitized = sanitizeSelectionAfterSnapshot(
      previous.pages,
      previous.elements,
      state.activePageId,
      state.selectedElementIds,
    );
    set({
      pages: previous.pages,
      elements: previous.elements,
      pageNumbering: previous.pageNumbering ?? null,
      activePageId: sanitized.activePageId,
      selectedElementIds: sanitized.selectedElementIds,
      editingTextElementId: null,
      past: nextPast,
      future: nextFuture,
      transactionBaseline: null,
      canUndo: nextPast.length > 0,
      canRedo: nextFuture.length > 0,
    });
    runBlobGc({
      pages: previous.pages,
      elements: previous.elements,
      past: nextPast,
      future: nextFuture,
      pageExtractions: state.pageExtractions,
    });
  },

  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const next = state.future[0];
    const currentSnapshot = cloneSnapshot(state.pages, state.elements, state.pageNumbering);
    const nextFuture = state.future.slice(1);
    const nextPast = pushSnapshot(state.past, currentSnapshot);
    const sanitized = sanitizeSelectionAfterSnapshot(
      next.pages,
      next.elements,
      state.activePageId,
      state.selectedElementIds,
    );
    set({
      pages: next.pages,
      elements: next.elements,
      pageNumbering: next.pageNumbering ?? null,
      activePageId: sanitized.activePageId,
      selectedElementIds: sanitized.selectedElementIds,
      editingTextElementId: null,
      past: nextPast,
      future: nextFuture,
      transactionBaseline: null,
      canUndo: nextPast.length > 0,
      canRedo: nextFuture.length > 0,
    });
    runBlobGc({
      pages: next.pages,
      elements: next.elements,
      past: nextPast,
      future: nextFuture,
      pageExtractions: state.pageExtractions,
    });
  },

  clearHistory: () => set({ past: [], future: [], canUndo: false, canRedo: false }),
}));

export type {
  TextEditElement,
  TextAddElement,
  ImageAddElement,
  ImageReplacementElement,
  SignatureElement,
  StrokeElement,
  HighlightElement,
};
