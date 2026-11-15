import { useEffect, useRef } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { RightInspector } from '@/components/inspector/RightInspector';
import { MobileBottomDock } from '@/components/mobile/MobileBottomDock';
import { MobileExportSheet } from '@/components/mobile/MobileExportSheet';
import { MobileInspectorSheet } from '@/components/mobile/MobileInspectorSheet';
import { MobilePagesSheet } from '@/components/mobile/MobilePagesSheet';
import { MobileToolsSheet } from '@/components/mobile/MobileToolsSheet';
import { PageNumberingModal } from '@/components/modals/PageNumberingModal';
import { PageOrganizeModal } from '@/components/modals/PageOrganizeModal';
import { PasswordModal } from '@/components/modals/PasswordModal';
import { RotateCopyModal } from '@/components/modals/RotateCopyModal';
import { SignatureModal } from '@/components/modals/SignatureModal';
import { SplitExtractModal } from '@/components/modals/SplitExtractModal';
import { ThumbnailSidebar } from '@/components/sidebar/ThumbnailSidebar';
import { TopToolbar } from '@/components/toolbar/TopToolbar';
import { CanvasContextMenu } from '@/components/viewport/CanvasContextMenu';
import {
  DocumentViewport,
  type DocumentViewportHandle,
} from '@/components/viewport/DocumentViewport';
import { exportCurrentPdf } from '@/engine/documentController';
import { pdfjsService } from '@/engine/pdfjsService';
import { wasmWorkerClient } from '@/engine/wasmWorkerClient';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useEditorStore } from '@/store/useEditorStore';
import { blobRegistry } from '@/utils/blobRegistry';
import { loadUserCustomFonts } from '@/utils/customFontStorage';

export default function App() {
  const theme = useEditorStore((s) => s.theme);
  const isLoading = useEditorStore((s) => s.isLoading);
  const loadingMessage = useEditorStore((s) => s.loadingMessage);
  const errorBanner = useEditorStore((s) => s.errorBanner);
  const setErrorBanner = useEditorStore((s) => s.setErrorBanner);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setMobileInspectorSnap = useEditorStore((s) => s.setMobileInspectorSnap);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const isDesktopLg = useMediaQuery('(min-width: 1024px)');
  const prevSelectionLenRef = useRef(0);

  const viewportRef = useRef<DocumentViewportHandle | null>(null);

  // Auto-surface collapsed contextual inspector bar when selecting an element on mobile/tablet
  useEffect(() => {
    const prevLen = prevSelectionLenRef.current;
    const nextLen = selectedElementIds.length;
    prevSelectionLenRef.current = nextLen;

    if (isDesktopLg) {
      if (useEditorStore.getState().mobileSheet !== 'none') {
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
  }, [selectedElementIds, isDesktopLg, setMobileSheet, setMobileInspectorSnap]);

  // Sync Tailwind dark class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Pre-warm Wasm Worker & hydrate user-uploaded custom fonts on mount
  useEffect(() => {
    wasmWorkerClient.call('ping', {}).catch(() => {
      // Lazy retry on user action if pre-warm interrupted
    });
    loadUserCustomFonts()
      .then((fonts) => {
        if (fonts.length > 0) {
          useEditorStore.getState().setUserFonts(fonts);
        }
      })
      .catch(() => {
        // Ignore IndexedDB unavailability
      });
    return () => {
      blobRegistry.revokeAll();
      void pdfjsService.releaseAllDocuments();
    };
  }, []);

  // Global desktop keyboard shortcuts
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

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void exportCurrentPdf();
        return;
      }

      if (isTyping) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          state.redo();
        } else {
          state.undo();
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        state.redo();
        return;
      }

      if (mod && e.key.toLowerCase() === 'c') {
        if (state.selectedElementIds.length > 0) {
          e.preventDefault();
          state.copySelected();
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'd') {
        if (state.selectedElementIds.length > 0) {
          e.preventDefault();
          state.duplicateElements(state.selectedElementIds);
        }
        return;
      }

      if (mod && e.key.toLowerCase() === 'v') {
        if (state.clipboard.length > 0) {
          e.preventDefault();
          state.pasteClipboard();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (state.selectedElementIds.length > 0) {
          e.preventDefault();
          state.deleteElements(state.selectedElementIds);
        }
        return;
      }

      if (e.key === 'Escape') {
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
        state.selectElements([]);
        state.setEditingTextElementId(null);
        state.setToolMode('select');
        return;
      }

      if (
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
  }, []);

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden overscroll-none bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopToolbar />

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
            className="rounded p-0.5 hover:bg-red-700"
            aria-label="Dismiss error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ThumbnailSidebar
          onScrollToPage={(idx) => viewportRef.current?.scrollToPage(idx)}
        />
        <DocumentViewport ref={viewportRef} />
        {isDesktopLg && <RightInspector variant="desktop" />}
      </div>

      {!isDesktopLg && mobileSheet === 'inspector' && <MobileInspectorSheet />}
      <MobileBottomDock />
      {mobileSheet === 'pages' && (
        <MobilePagesSheet
          onScrollToPage={(idx) => viewportRef.current?.scrollToPage(idx)}
        />
      )}
      {mobileSheet === 'tools' && <MobileToolsSheet />}
      {mobileSheet === 'export' && <MobileExportSheet />}

      {/* Modals & Context Menu */}
      <CanvasContextMenu />
      <RotateCopyModal />
      <PasswordModal />
      <SignatureModal />
      <SplitExtractModal />
      <PageOrganizeModal />
      <PageNumberingModal />

      {/* Global Wasm Worker busy overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 backdrop-blur-[2px]">
          <div className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-5 py-3.5 text-xs font-medium text-white shadow-2xl">
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
            <span>{loadingMessage || 'Processing PDF in Wasm Worker…'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
