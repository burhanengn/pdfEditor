import { create } from 'zustand';
import type { PdfOutlineNode, PdfSearchHit } from '@/engine/pdfium/pdfiumTypes';
import type { ReadingTheme } from '@/types/pdf';

export type ScrollLayoutMode = 'vertical' | 'page-snap' | 'two-page';
export type NavigatorTab = 'pages' | 'outline';

const EDIT_HINT_KEY = 'gp_edit_hint_seen_v1';
const OVERWRITE_CONFIRM_KEY = 'gp_overwrite_no_confirm_v1';
const LEFT_HANDED_KEY = 'gp_left_handed_v1';
const READING_THEME_KEY = 'gp_reading_theme_v1';

function readBoolPref(key: string, fallback = false): boolean {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) === '1' : fallback;
  } catch {
    return fallback;
  }
}

function writeBoolPref(key: string, val: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val ? '1' : '0');
    }
  } catch {
    // Ignore storage error
  }
}

function readInitialReadingTheme(): ReadingTheme {
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(READING_THEME_KEY);
      if (saved === 'light' || saved === 'dark' || saved === 'sepia') {
        return saved;
      }
    }
  } catch {
    // Ignore
  }
  return 'dark';
}

export interface ViewportAnchor {
  pageId: string;
  normX: number;
  normY: number;
  zoom: number;
}

interface ViewerState {
  scrollMode: ScrollLayoutMode;
  readingTheme: ReadingTheme;
  darkPaperInvert: boolean;
  immersiveControlsHidden: boolean;
  leftHandedMode: boolean;
  navigatorOpen: boolean;
  navigatorTab: NavigatorTab;
  outline: PdfOutlineNode[];
  docCanCopyText: boolean;
  docRevision: number;
  pageRevisions: Record<string, number>;
  fastScrolling: boolean;

  searchOpen: boolean;
  searchQuery: string;
  searchMatchCase: boolean;
  searchWholeWord: boolean;
  searchScanning: boolean;
  searchScannedPages: number;
  searchTotalPages: number;
  searchHits: PdfSearchHit[];
  activeSearchHitIndex: number;

  goToPageOpen: boolean;
  openSourceLicensesOpen: boolean;
  saveWorkflowOpen: boolean;
  firstTimeEditHintSeen: boolean;
  overwriteConfirmDontAskAgain: boolean;
  pendingAnchor: ViewportAnchor | null;

  setScrollMode: (mode: ScrollLayoutMode) => void;
  setReadingThemePref: (theme: ReadingTheme) => void;
  setDarkPaperInvert: (invert: boolean) => void;
  setImmersiveControlsHidden: (hidden: boolean) => void;
  toggleImmersiveControls: () => void;
  setLeftHandedMode: (leftHanded: boolean) => void;
  setNavigatorOpen: (open: boolean) => void;
  setNavigatorTab: (tab: NavigatorTab) => void;
  setDocumentViewerMeta: (meta: {
    outline: PdfOutlineNode[];
    canCopyText: boolean;
  }) => void;
  bumpPageRevision: (pageId: string) => void;
  setFastScrolling: (fast: boolean) => void;

  setSearchOpen: (open: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSearchOptions: (opts: Partial<{ matchCase: boolean; wholeWord: boolean }>) => void;
  resetSearchResults: (totalPages: number) => void;
  appendSearchChunk: (chunk: {
    hits: PdfSearchHit[];
    scannedPages: number;
    totalPages: number;
    done: boolean;
  }) => void;
  setActiveSearchHitIndex: (idx: number) => void;
  stepSearchHit: (delta: 1 | -1) => PdfSearchHit | null;

  setGoToPageOpen: (open: boolean) => void;
  setOpenSourceLicensesOpen: (open: boolean) => void;
  setSaveWorkflowOpen: (open: boolean) => void;
  markFirstTimeEditHintSeen: () => void;
  setOverwriteConfirmDontAskAgain: (val: boolean) => void;
  setPendingAnchor: (anchor: ViewportAnchor | null) => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  scrollMode: 'vertical',
  readingTheme: readInitialReadingTheme(),
  darkPaperInvert: false,
  immersiveControlsHidden: false,
  leftHandedMode: readBoolPref(LEFT_HANDED_KEY, false),
  navigatorOpen: false,
  navigatorTab: 'pages',
  outline: [],
  docCanCopyText: true,
  docRevision: 1,
  pageRevisions: {},
  fastScrolling: false,

  searchOpen: false,
  searchQuery: '',
  searchMatchCase: false,
  searchWholeWord: false,
  searchScanning: false,
  searchScannedPages: 0,
  searchTotalPages: 0,
  searchHits: [],
  activeSearchHitIndex: -1,

  goToPageOpen: false,
  openSourceLicensesOpen: false,
  saveWorkflowOpen: false,
  firstTimeEditHintSeen: readBoolPref(EDIT_HINT_KEY, false),
  overwriteConfirmDontAskAgain: readBoolPref(OVERWRITE_CONFIRM_KEY, false),
  pendingAnchor: null,

  setScrollMode: (scrollMode) => set({ scrollMode }),
  setReadingThemePref: (readingTheme) => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(READING_THEME_KEY, readingTheme);
      }
    } catch {
      // Ignore
    }
    set({ readingTheme });
  },
  setDarkPaperInvert: (darkPaperInvert) => set({ darkPaperInvert }),
  setImmersiveControlsHidden: (immersiveControlsHidden) => set({ immersiveControlsHidden }),
  toggleImmersiveControls: () =>
    set((s) => ({ immersiveControlsHidden: !s.immersiveControlsHidden })),
  setLeftHandedMode: (leftHandedMode) => {
    writeBoolPref(LEFT_HANDED_KEY, leftHandedMode);
    set({ leftHandedMode });
  },
  setNavigatorOpen: (navigatorOpen) => set({ navigatorOpen }),
  setNavigatorTab: (navigatorTab) => set({ navigatorTab }),
  setDocumentViewerMeta: ({ outline, canCopyText }) =>
    set((s) => ({
      outline,
      docCanCopyText: canCopyText,
      docRevision: s.docRevision + 1,
      pageRevisions: {},
      navigatorTab: outline.length === 0 && s.navigatorTab === 'outline' ? 'pages' : s.navigatorTab,
    })),
  bumpPageRevision: (pageId) =>
    set((s) => ({
      pageRevisions: {
        ...s.pageRevisions,
        [pageId]: (s.pageRevisions[pageId] ?? 0) + 1,
      },
    })),
  setFastScrolling: (fastScrolling) =>
    set((s) => (s.fastScrolling === fastScrolling ? s : { fastScrolling })),

  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchOptions: (opts) =>
    set((s) => ({
      searchMatchCase: opts.matchCase ?? s.searchMatchCase,
      searchWholeWord: opts.wholeWord ?? s.searchWholeWord,
    })),
  resetSearchResults: (totalPages) =>
    set({
      searchScanning: totalPages > 0,
      searchScannedPages: 0,
      searchTotalPages: totalPages,
      searchHits: [],
      activeSearchHitIndex: -1,
    }),
  appendSearchChunk: (chunk) =>
    set((s) => {
      const merged = chunk.hits.length > 0 ? [...s.searchHits, ...chunk.hits] : s.searchHits;
      // Sort results by document page order then match index
      if (chunk.hits.length > 0) {
        merged.sort(
          (a, b) => a.pageIndex - b.pageIndex || a.matchIndexInPage - b.matchIndexInPage,
        );
      }
      return {
        searchHits: merged,
        searchScanning: !chunk.done,
        searchScannedPages: chunk.scannedPages,
        searchTotalPages: chunk.totalPages,
        activeSearchHitIndex:
          s.activeSearchHitIndex < 0 && merged.length > 0 ? 0 : s.activeSearchHitIndex,
      };
    }),
  setActiveSearchHitIndex: (activeSearchHitIndex) => set({ activeSearchHitIndex }),
  stepSearchHit: (delta) => {
    const s = get();
    if (s.searchHits.length === 0) return null;
    const len = s.searchHits.length;
    const cur = s.activeSearchHitIndex < 0 ? 0 : s.activeSearchHitIndex;
    const nextIdx = (cur + delta + len) % len;
    set({ activeSearchHitIndex: nextIdx });
    return s.searchHits[nextIdx] ?? null;
  },

  setGoToPageOpen: (goToPageOpen) => set({ goToPageOpen }),
  setOpenSourceLicensesOpen: (openSourceLicensesOpen) => set({ openSourceLicensesOpen }),
  setSaveWorkflowOpen: (saveWorkflowOpen) => set({ saveWorkflowOpen }),
  markFirstTimeEditHintSeen: () => {
    writeBoolPref(EDIT_HINT_KEY, true);
    set({ firstTimeEditHintSeen: true });
  },
  setOverwriteConfirmDontAskAgain: (val) => {
    writeBoolPref(OVERWRITE_CONFIRM_KEY, val);
    set({ overwriteConfirmDontAskAgain: val });
  },
  setPendingAnchor: (pendingAnchor) => set({ pendingAnchor }),
}));
