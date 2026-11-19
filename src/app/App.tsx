import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, History, Layers, Loader2, Pencil, SlidersHorizontal, X } from 'lucide-react';
import { MobileBottomDock } from '@/components/mobile/MobileBottomDock';
import { ThumbnailSidebar } from '@/components/sidebar/ThumbnailSidebar';
import { TopToolbar } from '@/components/toolbar/TopToolbar';
import { FloatingViewerControls } from '@/components/viewer/FloatingViewerControls';
import { NavigatorDrawer } from '@/components/viewer/NavigatorDrawer';
import { PwaUpdateToast } from '@/components/viewer/PwaUpdateToast';
import { SearchBar } from '@/components/viewer/SearchBar';
import {
  GoToPageModal,
  OpenSourceLicensesModal,
  SaveWorkflowModal,
} from '@/components/viewer/ViewerModals';
import {
  DocumentViewport,
  type DocumentViewportHandle,
} from '@/components/viewport/DocumentViewport';
import { pdfiumScheduler } from '@/engine/pdfium/renderScheduler';
import {
  bindAutosaveAndBeforeUnload,
  clearAutosaveSession,
  loadAutosaveSession,
  restoreAutosaveSession,
  type RecoverableSessionSummary,
} from '@/engine/sessionPersistence';
import { useLayoutClass } from '@/hooks/useLayoutClass';
import { useI18n } from '@/i18n/useI18n';
import { usePwaLaunchAndShare } from '@/pwa/usePwaLaunchAndShare';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';
import { blobRegistry } from '@/utils/blobRegistry';
import { loadUserCustomFonts } from '@/utils/customFontStorage';

// Lazy-loaded EditorShell & heavy dialogs so initial Viewer JS stays tiny (01 §6.1, 02 §6)
const RightInspector = lazy(() =>
  import('@/components/inspector/RightInspector').then((m) => ({ default: m.RightInspector })),
);
const ObjectsPanel = lazy(() =>
  import('@/components/editor/ObjectsPanel').then((m) => ({ default: m.ObjectsPanel })),
);
const ContextualBar = lazy(() =>
  import('@/components/editor/ContextualBar').then((m) => ({ default: m.ContextualBar })),
);
const MobileExportSheet = lazy(() =>
  import('@/components/mobile/MobileExportSheet').then((m) => ({ default: m.MobileExportSheet })),
);
const MobileInspectorSheet = lazy(() =>
  import('@/components/mobile/MobileInspectorSheet').then((m) => ({
    default: m.MobileInspectorSheet,
  })),
);
const MobilePagesSheet = lazy(() =>
  import('@/components/mobile/MobilePagesSheet').then((m) => ({ default: m.MobilePagesSheet })),
);
const MobileToolsSheet = lazy(() =>
  import('@/components/mobile/MobileToolsSheet').then((m) => ({ default: m.MobileToolsSheet })),
);
const PageNumberingModal = lazy(() =>
  import('@/components/modals/PageNumberingModal').then((m) => ({ default: m.PageNumberingModal })),
);
const PageOrganizeModal = lazy(() =>
  import('@/components/modals/PageOrganizeModal').then((m) => ({ default: m.PageOrganizeModal })),
);
const PasswordModal = lazy(() =>
  import('@/components/modals/PasswordModal').then((m) => ({ default: m.PasswordModal })),
);
const RotateCopyModal = lazy(() =>
  import('@/components/modals/RotateCopyModal').then((m) => ({ default: m.RotateCopyModal })),
);
const SignatureModal = lazy(() =>
  import('@/components/modals/SignatureModal').then((m) => ({ default: m.SignatureModal })),
);
const SplitExtractModal = lazy(() =>
  import('@/components/modals/SplitExtractModal').then((m) => ({ default: m.SplitExtractModal })),
);
const CanvasContextMenu = lazy(() =>
  import('@/components/viewport/CanvasContextMenu').then((m) => ({ default: m.CanvasContextMenu })),
);

export default function App() {
  const { t } = useI18n();
  usePwaLaunchAndShare();
  const { layoutClass } = useLayoutClass();
  const isDesktopLg = layoutClass === 'expanded';

  const appMode = useEditorStore((s) => s.appMode);
  const setAppMode = useEditorStore((s) => s.setAppMode);
  const pages = useEditorStore((s) => s.pages);
  const isLoading = useEditorStore((s) => s.isLoading);
  const loadingMessage = useEditorStore((s) => s.loadingMessage);
  const errorBanner = useEditorStore((s) => s.errorBanner);
  const setErrorBanner = useEditorStore((s) => s.setErrorBanner);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setMobileInspectorSnap = useEditorStore((s) => s.setMobileInspectorSnap);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const passwordPrompt = useEditorStore((s) => s.passwordPrompt);

  const readingTheme = useViewerStore((s) => s.readingTheme);
  const leftHandedMode = useViewerStore((s) => s.leftHandedMode);
  const immersiveHidden = useViewerStore((s) => s.immersiveControlsHidden);
  const firstTimeEditHintSeen = useViewerStore((s) => s.firstTimeEditHintSeen);
  const markFirstTimeEditHintSeen = useViewerStore((s) => s.markFirstTimeEditHintSeen);

  const prevSelectionLenRef = useRef(0);
  const [recoverableSession, setRecoverableSession] =
    useState<RecoverableSessionSummary | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'props' | 'objects'>('props');
  const [showFirstEditHint, setShowFirstEditHint] = useState(false);

  const viewportRef = useRef<DocumentViewportHandle | null>(null);

  const handleModeSwitch = useCallback(
    (nextMode: 'view' | 'edit') => {
      const anchor = viewportRef.current?.captureAnchor();
      setPreviewMode(false);
      setAppMode(nextMode);
      if (nextMode === 'edit' && !firstTimeEditHintSeen) {
        setShowFirstEditHint(true);
        markFirstTimeEditHintSeen();
        window.setTimeout(() => setShowFirstEditHint(false), 5000);
      }
      if (anchor) {
        requestAnimationFrame(() => {
          viewportRef.current?.restoreAnchor(anchor);
        });
      }
    },
    [setAppMode, firstTimeEditHintSeen, markFirstTimeEditHintSeen],
  );

  // Auto-surface collapsed contextual inspector sheet on mobile/tablet when selecting in Edit mode
  useEffect(() => {
    const prevLen = prevSelectionLenRef.current;
    const nextLen = selectedElementIds.length;
    prevSelectionLenRef.current = nextLen;

    if (isDesktopLg || appMode !== 'edit') {
      if (isDesktopLg && useEditorStore.getState().mobileSheet !== 'none') {
        setMobileSheet('none');
      }
      return;
    }

    if (nextLen > 0 && prevLen === 0) {
      const curSheet = useEditorStore.getState().mobileSheet;
      if (curSheet === 'none' || curSheet === 'tools') {
        setMobileInspectorSnap('collapsed');
        setMobileSheet('inspector');
      }
    } else if (nextLen === 0 && prevLen > 0) {
      if (useEditorStore.getState().mobileSheet === 'inspector') {
        setMobileSheet('none');
      }
    }
  }, [selectedElementIds, isDesktopLg, appMode, setMobileSheet, setMobileInspectorSnap]);

  // Sync Tailwind dark & sepia theme classes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', readingTheme === 'dark');
    document.documentElement.classList.toggle('theme-sepia', readingTheme === 'sepia');
  }, [readingTheme]);

  // Hydrate custom fonts, check session recovery, & bind autosave/beforeunload
  useEffect(() => {
    loadUserCustomFonts()
      .then((fonts) => {
        if (fonts.length > 0) {
          useEditorStore.getState().setUserFonts(fonts);
        }
      })
      .catch(() => {});
    loadAutosaveSession()
      .then((summary) => {
        if (summary && useEditorStore.getState().pages.length === 0) {
          setRecoverableSession(summary);
        }
      })
      .catch(() => {});
    const unbindAutosave = bindAutosaveAndBeforeUnload();
    return () => {
      unbindAutosave();
      blobRegistry.revokeAll();
      pdfiumScheduler.closeAllDocuments();
    };
  }, []);

  // Global keyboard shortcuts (Viewer + Editor)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const state = useEditorStore.getState();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'f' && state.pages.length > 0) {
        e.preventDefault();
        useViewerStore.getState().setSearchOpen(true);
        return;
      }

      if (mod && e.key.toLowerCase() === 'g' && state.pages.length > 0) {
        e.preventDefault();
        useViewerStore.getState().setGoToPageOpen(true);
        return;
      }

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (state.pages.length > 0) {
          useViewerStore.getState().setSaveWorkflowOpen(true);
        }
        return;
      }

      if (isTyping) return;

      if (!mod && e.key.toLowerCase() === 'e' && state.pages.length > 0) {
        e.preventDefault();
        handleModeSwitch(state.appMode === 'view' ? 'edit' : 'view');
        return;
      }

      if (mod && (e.key === '=' || e.key === '+') && state.pages.length > 0) {
        e.preventDefault();
        state.setZoom(state.zoom + 0.15, 'custom');
        return;
      }
      if (mod && e.key === '-' && state.pages.length > 0) {
        e.preventDefault();
        state.setZoom(state.zoom - 0.15, 'custom');
        return;
      }
      if (mod && e.key === '0' && state.pages.length > 0) {
        e.preventDefault();
        state.setZoom(1, 'custom');
        return;
      }

      if (state.appMode === 'edit') {
        if (mod && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) state.redo();
          else state.undo();
          return;
        }
        if (mod && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          state.redo();
          return;
        }
        if (mod && e.key.toLowerCase() === 'c' && state.selectedElementIds.length > 0) {
          e.preventDefault();
          state.copySelected();
          return;
        }
        if (mod && e.key.toLowerCase() === 'd' && state.selectedElementIds.length > 0) {
          e.preventDefault();
          state.duplicateElements(state.selectedElementIds);
          return;
        }
        if (mod && e.key.toLowerCase() === 'v' && state.clipboard.length > 0) {
          e.preventDefault();
          state.pasteClipboard();
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedElementIds.length > 0) {
          e.preventDefault();
          if (state.editingPathElementId && state.selectedPathVertexIndices.length > 0) {
            state.deletePathVertices(state.editingPathElementId, state.selectedPathVertexIndices);
            return;
          }
          state.deleteElements(state.selectedElementIds);
          return;
        }
        if (
          !mod &&
          e.key.toLowerCase() === 's' &&
          state.editingPathElementId &&
          state.selectedPathVertexIndices.length > 0
        ) {
          e.preventDefault();
          state.togglePathVerticesSmooth(
            state.editingPathElementId,
            state.selectedPathVertexIndices,
          );
          return;
        }
      }

      if (e.key === 'Escape') {
        const viewerState = useViewerStore.getState();
        if (viewerState.saveWorkflowOpen) {
          viewerState.setSaveWorkflowOpen(false);
          return;
        }
        if (viewerState.goToPageOpen) {
          viewerState.setGoToPageOpen(false);
          return;
        }
        if (viewerState.openSourceLicensesOpen) {
          viewerState.setOpenSourceLicensesOpen(false);
          return;
        }
        if (viewerState.searchOpen) {
          viewerState.setSearchOpen(false);
          return;
        }
        if (state.contextMenu) {
          state.setContextMenu(null);
          return;
        }
        if (state.croppingImageElementId) {
          state.setCroppingImageElementId(null);
          return;
        }
        if (state.rotateCopyDialogElementIds) {
          state.openRotateCopyDialog(null);
          return;
        }
        if (state.pendingSignaturePlacement) {
          state.cancelPendingSignaturePlacement();
          return;
        }
        if (state.editingTextElementId) {
          state.setEditingTextElementId(null);
          return;
        }
        if (state.selectedElementIds.length > 0) {
          state.selectElements([]);
          return;
        }
        if (state.toolMode !== 'select') {
          state.setToolMode('select');
          return;
        }
        if (state.appMode === 'edit') {
          handleModeSwitch('view');
        }
        return;
      }

      if (
        state.appMode === 'edit' &&
        state.selectedElementIds.length > 0 &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        state.nudgeSelected(dx, dy);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleModeSwitch]);

  const showEditorChrome = appMode === 'edit' && !previewMode;

  return (
    <div
      className="flex h-dvh w-screen flex-col overflow-hidden overscroll-none bg-[var(--gp-surface)] text-[var(--gp-text-primary)]"
      data-preview-mode={previewMode ? 'true' : 'false'}
    >
      <TopToolbar
        previewMode={previewMode}
        onTogglePreview={() => setPreviewMode((p) => !p)}
        onRequestModeSwitch={handleModeSwitch}
      />

      {recoverableSession && pages.length === 0 && (
        <div
          data-testid="session-recovery-banner"
          role="region"
          aria-label={t('action.resumeSession')}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-500/30 bg-blue-50 px-4 py-2 text-xs text-slate-900 dark:bg-blue-950/60 dark:text-slate-100"
        >
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            <span className="font-medium">
              {t('session.recoveryPrompt', { name: recoverableSession.documentName })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="session-recovery-resume-btn"
              onClick={() => {
                const target = recoverableSession;
                setRecoverableSession(null);
                void restoreAutosaveSession(target);
              }}
              className="min-h-[36px] rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              {t('action.resumeSession')}
            </button>
            <button
              type="button"
              data-testid="session-recovery-discard-btn"
              onClick={() => {
                setRecoverableSession(null);
                void clearAutosaveSession();
              }}
              className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {t('action.discardSession')}
            </button>
          </div>
        </div>
      )}

      {showFirstEditHint && (
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 top-16 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white shadow-xl"
        >
          <span>{t('editor.firstTimeHint')}</span>
          <button
            type="button"
            onClick={() => setShowFirstEditHint(false)}
            aria-label={t('action.close')}
            className="rounded-full p-1 hover:bg-blue-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {errorBanner && (
        <div
          role="alert"
          className="flex items-center justify-between bg-red-600 px-4 py-2 text-xs font-medium text-white"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="rounded p-1 hover:bg-red-700"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <ThumbnailSidebar
          onScrollToPage={(idx) => viewportRef.current?.scrollToPage(idx)}
        />
        <DocumentViewport ref={viewportRef} />

        {isDesktopLg && showEditorChrome && pages.length > 0 && (
          <aside className="flex h-full w-80 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="flex border-b border-slate-200 p-1 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setInspectorTab('props')}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold ${
                  inspectorTab === 'props'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>Properties</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectorTab('objects')}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold ${
                  inspectorTab === 'objects'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Objects</span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Suspense fallback={null}>
                {inspectorTab === 'props' ? <RightInspector variant="desktop" /> : <ObjectsPanel />}
              </Suspense>
            </div>
          </aside>
        )}
      </div>

      {/* Viewer overlays */}
      <SearchBar onJumpToPage={(idx) => viewportRef.current?.scrollToPage(idx)} />
      <FloatingViewerControls onJumpToPage={(idx) => viewportRef.current?.scrollToPage(idx)} />
      <NavigatorDrawer onJumpToPage={(idx) => viewportRef.current?.scrollToPage(idx)} />
      <GoToPageModal onJumpToPage={(idx) => viewportRef.current?.scrollToPage(idx)} />
      <SaveWorkflowModal />
      <OpenSourceLicensesModal />
      <PwaUpdateToast />

      {/* Mobile Viewer Thumb-Zone FAB */}
      {pages.length > 0 && appMode === 'view' && !immersiveHidden && (
        <button
          type="button"
          data-testid="mobile-edit-fab"
          onClick={() => handleModeSwitch('edit')}
          aria-label={t('action.editPdf')}
          className={`fixed bottom-6 z-30 inline-flex min-h-[48px] items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xl hover:bg-blue-500 md:hidden ${
            leftHandedMode ? 'left-4' : 'right-4'
          }`}
        >
          <Pencil className="h-5 w-5" />
          <span>{t('action.editPdf')}</span>
        </button>
      )}

      {/* Persistent Mobile Editor Dock (outside Suspense so lazy sheets never flash-unmount it!) */}
      <MobileBottomDock />

      {/* Lazy Editor Shell & Sheets — isolated Suspense boundaries */}
      <Suspense fallback={null}>
        {showEditorChrome && <ContextualBar />}
        {!isDesktopLg && appMode === 'edit' && mobileSheet === 'inspector' && (
          <MobileInspectorSheet />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {mobileSheet === 'pages' && (
          <MobilePagesSheet
            onScrollToPage={(idx) => viewportRef.current?.scrollToPage(idx)}
          />
        )}
        {mobileSheet === 'tools' && <MobileToolsSheet />}
        {mobileSheet === 'export' && <MobileExportSheet />}
      </Suspense>
      <Suspense fallback={null}>
        {appMode === 'edit' && <CanvasContextMenu />}
        {appMode === 'edit' && <RotateCopyModal />}
        {passwordPrompt && <PasswordModal />}
        {appMode === 'edit' && <SignatureModal />}
        {appMode === 'edit' && <SplitExtractModal />}
        {appMode === 'edit' && <PageOrganizeModal />}
        {appMode === 'edit' && <PageNumberingModal />}
      </Suspense>

      {isLoading && (
        <div className="fixed bottom-4 left-4 z-[70] flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/95 px-4 py-3 text-xs font-medium text-white shadow-2xl">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span>{loadingMessage || 'Processing…'}</span>
        </div>
      )}
    </div>
  );
}
