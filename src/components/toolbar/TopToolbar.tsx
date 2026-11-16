import { useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  Circle,
  Diamond,
  Download,
  Eye,
  FilePlus,
  FilePlus2,
  FileSignature,
  FolderOpen,
  Globe,
  Hand,
  Hash,
  Highlighter,
  ImagePlus,
  Layers,
  LayoutGrid,
  Link2,
  Maximize2,
  Minus,
  Moon,
  MoreVertical,
  MousePointer2,
  PanelLeft,
  Pencil,
  PenTool,
  Printer,
  Redo2,
  Scissors,
  Search,
  Share2,
  Shapes,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Spline,
  Square,
  Sun,
  Triangle,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  createBlankDocument,
  insertImageFileOnPage,
  mergePdfFile,
  openPdfFile,
  openPdfWithPickerFallback,
  shareCurrentPdf,
} from '@/engine/documentController';
import { hasUnsavedSessionChanges } from '@/engine/sessionPersistence';
import { useLayoutClass } from '@/hooks/useLayoutClass';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';
import type { VectorShapeType, VectorStrokeDash } from '@/types/elements';
import type { ReadingTheme, ToolMode, ZoomMode } from '@/types/pdf';
import { BrandLogo } from '../BrandLogo';

const QUICK_COLORS = ['#ef4444', '#2563eb', '#0f172a', '#16a34a', '#facc15'];

interface TopToolbarProps {
  previewMode?: boolean;
  onTogglePreview?: () => void;
  onRequestModeSwitch?: (nextMode: 'view' | 'edit') => void;
}

export function TopToolbar({
  previewMode = false,
  onTogglePreview,
  onRequestModeSwitch,
}: TopToolbarProps) {
  const { locale, setLocale, t } = useI18n();
  const { layoutClass, isLandscapePhone } = useLayoutClass();

  const documentName = useEditorStore((s) => s.documentName);
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const appMode = useEditorStore((s) => s.appMode);
  const setAppModeStore = useEditorStore((s) => s.setAppMode);
  const toolMode = useEditorStore((s) => s.toolMode);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const setReadingTheme = useEditorStore((s) => s.setReadingTheme);
  const canUndo = useEditorStore((s) => s.canUndo);
  const canRedo = useEditorStore((s) => s.canRedo);
  const isLoading = useEditorStore((s) => s.isLoading);

  const drawColor = useEditorStore((s) => s.drawColor);
  const drawWidth = useEditorStore((s) => s.drawWidth);
  const highlightColor = useEditorStore((s) => s.highlightColor);
  const highlightShape = useEditorStore((s) => s.highlightShape);
  const activeShapePreset = useEditorStore((s) => s.activeShapePreset);
  const activePathMode = useEditorStore((s) => s.activePathMode);
  const shapeFillColor = useEditorStore((s) => s.shapeFillColor);
  const shapeStrokeColor = useEditorStore((s) => s.shapeStrokeColor);
  const shapeStrokeWidth = useEditorStore((s) => s.shapeStrokeWidth);
  const shapeBorderRadius = useEditorStore((s) => s.shapeBorderRadius);
  const shapeStrokeDash = useEditorStore((s) => s.shapeStrokeDash);
  const pathSmoothDefault = useEditorStore((s) => s.pathSmoothDefault);
  const elements = useEditorStore((s) => s.elements);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);

  const setToolMode = useEditorStore((s) => s.setToolMode);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setZoomMode = useEditorStore((s) => s.setZoomMode);
  const setDrawStyle = useEditorStore((s) => s.setDrawStyle);
  const setHighlightStyle = useEditorStore((s) => s.setHighlightStyle);
  const setShapeStyle = useEditorStore((s) => s.setShapeStyle);
  const setPathToolStyle = useEditorStore((s) => s.setPathToolStyle);
  const joinVectorPaths = useEditorStore((s) => s.joinVectorPaths);
  const setSignatureModalOpen = useEditorStore((s) => s.setSignatureModalOpen);
  const setSplitModalOpen = useEditorStore((s) => s.setSplitModalOpen);
  const setOrganizeModalOpen = useEditorStore((s) => s.setOrganizeModalOpen);
  const setPageNumberingModalOpen = useEditorStore((s) => s.setPageNumberingModalOpen);
  const selectBackgroundMode = useEditorStore((s) => s.selectBackgroundMode);
  const setSelectBackgroundMode = useEditorStore((s) => s.setSelectBackgroundMode);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const pendingSignaturePlacement = useEditorStore((s) => s.pendingSignaturePlacement);
  const cancelPendingSignaturePlacement = useEditorStore(
    (s) => s.cancelPendingSignaturePlacement,
  );
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);

  const readingTheme = useViewerStore((s) => s.readingTheme);
  const setReadingThemePref = useViewerStore((s) => s.setReadingThemePref);
  const darkPaperInvert = useViewerStore((s) => s.darkPaperInvert);
  const setDarkPaperInvert = useViewerStore((s) => s.setDarkPaperInvert);
  const navigatorOpen = useViewerStore((s) => s.navigatorOpen);
  const setNavigatorOpen = useViewerStore((s) => s.setNavigatorOpen);
  const searchOpen = useViewerStore((s) => s.searchOpen);
  const setSearchOpen = useViewerStore((s) => s.setSearchOpen);
  const immersiveHidden = useViewerStore((s) => s.immersiveControlsHidden);
  const leftHandedMode = useViewerStore((s) => s.leftHandedMode);
  const setLeftHandedMode = useViewerStore((s) => s.setLeftHandedMode);
  const scrollMode = useViewerStore((s) => s.scrollMode);
  const setScrollMode = useViewerStore((s) => s.setScrollMode);
  const setSaveWorkflowOpen = useViewerStore((s) => s.setSaveWorkflowOpen);
  const setOpenSourceLicensesOpen = useViewerStore((s) => s.setOpenSourceLicensesOpen);

  const [overflowOpen, setOverflowOpen] = useState(false);

  const openInputRef = useRef<HTMLInputElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const hasPages = pages.length > 0;
  const isCompact = layoutClass === 'compact';
  const dirty = hasUnsavedSessionChanges();

  // Hide compact Viewer top bar during immersive reading (02 §3.1)
  if (isCompact && appMode === 'view' && immersiveHidden && hasPages && !searchOpen && !overflowOpen) {
    return null;
  }

  const switchMode = (nextMode: 'view' | 'edit') => {
    if (onRequestModeSwitch) {
      onRequestModeSwitch(nextMode);
    } else {
      setAppModeStore(nextMode);
    }
  };

  const applyReadingTheme = (theme: ReadingTheme) => {
    setReadingThemePref(theme);
    setReadingTheme(theme);
  };

  const cycleReadingTheme = () => {
    if (appMode === 'edit') {
      applyReadingTheme(readingTheme === 'dark' ? 'light' : 'dark');
      return;
    }
    const next: ReadingTheme =
      readingTheme === 'light' ? 'dark' : readingTheme === 'dark' ? 'sepia' : 'light';
    applyReadingTheme(next);
  };

  const primaryEditTools: Array<{
    id: ToolMode;
    label: string;
    icon: typeof MousePointer2;
    onClick?: () => void;
  }> = [
    { id: 'select', label: 'Select', icon: MousePointer2 },
    { id: 'text', label: 'Text', icon: Type },
    {
      id: 'signature',
      label: 'Sign',
      icon: FileSignature,
      onClick: () => setSignatureModalOpen(true),
    },
    { id: 'draw', label: 'Draw', icon: PenTool },
    { id: 'highlight', label: 'Highlight', icon: Highlighter },
    { id: 'shape', label: 'Shape', icon: Shapes },
    {
      id: 'image',
      label: 'Image',
      icon: ImagePlus,
      onClick: () => imageInputRef.current?.click(),
    },
  ];

  const handleZoomSelect = (val: string) => {
    if (val === 'fit-width' || val === 'fit-page') {
      setZoomMode(val as ZoomMode);
    } else {
      const numeric = Number(val);
      if (!Number.isNaN(numeric)) {
        setZoom(numeric, 'custom');
      }
    }
  };

  return (
    <header
      className={`safe-pt z-40 flex flex-col border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 ${
        isLandscapePhone ? 'h-10' : ''
      }`}
    >
      <div
        className={`flex items-center justify-between gap-1.5 px-2 sm:px-3 ${
          isCompact ? 'h-12' : 'h-14'
        }`}
      >
        {/* LEFT CLUSTER */}
        <div className="flex min-w-0 items-center gap-1.5">
          {appMode === 'edit' && hasPages ? (
            <>
              <button
                type="button"
                data-testid="toggle-edit-mode-btn"
                onClick={() => switchMode('view')}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 sm:min-h-[36px]"
              >
                <Check className="h-4 w-4" />
                <span>{t('action.done')}</span>
              </button>
              <span
                className={`hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline-flex ${
                  dirty
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {dirty ? t('session.unsavedBadge') : t('session.savedBadge')}
              </span>
              <button
                type="button"
                onClick={() => void createBlankDocument()}
                data-testid="toolbar-new-blank-btn"
                title={t('action.startBlank')}
                className="hidden min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/50 sm:inline-flex"
              >
                <FilePlus className="h-4 w-4" />
              </button>
            </>
          ) : (
            <>
              {hasPages && (
                <button
                  type="button"
                  data-testid="navigator-toggle-btn"
                  onClick={() => setNavigatorOpen(!navigatorOpen)}
                  aria-label={t('nav.pages')}
                  title={t('nav.pages')}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg sm:min-h-[36px] sm:min-w-[36px] ${
                    navigatorOpen
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <PanelLeft className="h-5 w-5" />
                </button>
              )}

              <div
                data-testid="brand-logo-container"
                className="flex shrink-0 items-center gap-2 pr-1"
              >
                <BrandLogo variant="mark" className="h-7 w-7 shrink-0 md:hidden" />
                <BrandLogo variant="horizontal-auto" className="hidden h-8 w-auto shrink-0 md:block" />
              </div>

              {!hasPages && (
                <>
                  <button
                    type="button"
                    onClick={() => void openPdfWithPickerFallback(openInputRef.current)}
                    data-testid="toolbar-open-btn"
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 sm:min-h-[36px]"
                  >
                    <FolderOpen className="h-4 w-4" />
                    <span className="hidden sm:inline">{t('action.openPdf')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void createBlankDocument()}
                    data-testid="toolbar-new-blank-btn"
                    title={t('action.startBlank')}
                    className="hidden min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/50 sm:inline-flex"
                  >
                    <FilePlus className="h-4 w-4" />
                    <span>{t('action.startBlank')}</span>
                  </button>
                </>
              )}
            </>
          )}

          {hasPages && (
            <span
              title={documentName}
              className="max-w-[140px] truncate text-sm font-medium text-slate-800 dark:text-slate-200 sm:max-w-[200px]"
            >
              {documentName}
            </span>
          )}

          <input
            ref={openInputRef}
            type="file"
            accept="application/pdf,.pdf"
            data-testid="open-pdf-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openPdfFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={mergeInputRef}
            type="file"
            accept="application/pdf,.pdf"
            data-testid="merge-pdf-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void mergePdfFile(f);
              e.target.value = '';
            }}
          />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="insert-image-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              const targetPage = activePageId ?? pages[0]?.id;
              if (f && targetPage) void insertImageFileOnPage(f, targetPage);
              e.target.value = '';
            }}
          />
        </div>

        {/* CENTER CLUSTER: 7 Primary Tools ONLY in Editor mode on >= 768px (02 §4.3) */}
        {appMode === 'edit' && hasPages && (
          <div className="hidden shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-800 dark:bg-slate-900 md:flex">
            {primaryEditTools.map((btn) => {
              const Icon = btn.icon;
              const active = toolMode === btn.id;
              return (
                <button
                  key={btn.id}
                  type="button"
                  title={btn.label}
                  data-testid={`tool-${btn.id}`}
                  onClick={() => (btn.onClick ? btn.onClick() : setToolMode(btn.id))}
                  className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition ${
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden xl:inline">{btn.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              title="Line / Path"
              data-testid="tool-path"
              onClick={() => setToolMode('path')}
              className={`inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium ${
                toolMode === 'path'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Spline className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Organize Pages"
              data-testid="tool-organize"
              onClick={() => setOrganizeModalOpen(true)}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Select Background Layer"
              aria-pressed={selectBackgroundMode}
              data-testid="toggle-select-background"
              onClick={() => setSelectBackgroundMode(!selectBackgroundMode)}
              className={`inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium ${
                selectBackgroundMode
                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                  : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Layers className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Page Numbers"
              data-testid="toolbar-page-numbers-btn"
              onClick={() => setPageNumberingModalOpen(true)}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Hash className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Split / Extract"
              data-testid="toolbar-split-btn"
              onClick={() => setSplitModalOpen(true)}
              className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Scissors className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* RIGHT CLUSTER */}
        <div className="relative flex shrink-0 items-center gap-1">
          {pendingSignaturePlacement && (
            <button
              type="button"
              data-testid="cancel-signature-placement-btn"
              onClick={cancelPendingSignaturePlacement}
              className="hidden items-center gap-1 rounded-lg border border-blue-500/50 bg-blue-50 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:bg-blue-950/70 dark:text-blue-200 md:inline-flex"
            >
              {t('action.cancel')} (Esc)
            </button>
          )}

          {/* Shared desktop zoom controls (Viewer + Editor) */}
          {hasPages && (
            <div className="hidden items-center gap-1 md:flex">
              <button
                type="button"
                onClick={() => setZoom(zoom - 0.15, 'custom')}
                data-testid="zoom-out-btn"
                aria-label="Zoom out"
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <select
                value={zoomMode === 'custom' ? '' : zoomMode}
                onChange={(e) => handleZoomSelect(e.target.value)}
                aria-label="Zoom level"
                data-testid="zoom-select"
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium tabular-nums text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                {zoomMode === 'custom' && (
                  <option value="">{Math.round(zoom * 100)}%</option>
                )}
                <option value="fit-width">Fit Width ({Math.round(zoom * 100)}%)</option>
                <option value="fit-page">Fit Page</option>
                <option value="0.5">50%</option>
                <option value="0.75">75%</option>
                <option value="1">100%</option>
                <option value="1.5">150%</option>
                <option value="2">200%</option>
                <option value="3">300%</option>
                <option value="4">400%</option>
                <option value="5">500%</option>
              </select>
              <button
                type="button"
                onClick={() => setZoom(zoom + 0.15, 'custom')}
                data-testid="zoom-in-btn"
                aria-label="Zoom in"
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoomMode('fit-page')}
                title="Fit Page"
                aria-label="Fit Page"
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Editor undo/redo + preview + save */}
          {appMode === 'edit' && hasPages && (
            <>
              <button
                type="button"
                disabled={!canUndo}
                onClick={undo}
                title={`${t('action.undo')} (Ctrl+Z)`}
                data-testid="undo-btn"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800 sm:min-h-[36px] sm:min-w-[36px]"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={redo}
                title={`${t('action.redo')} (Ctrl+Y)`}
                data-testid="redo-btn"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800 sm:min-h-[36px] sm:min-w-[36px]"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              {onTogglePreview && (
                <button
                  type="button"
                  onClick={onTogglePreview}
                  aria-pressed={previewMode}
                  data-testid="editor-preview-btn"
                  title={t('action.preview')}
                  className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-lg px-2 text-xs font-medium sm:min-h-[36px] ${
                    previewMode
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Eye className="h-4 w-4" />
                  <span className="hidden lg:inline">{t('action.preview')}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMobileSheet(mobileSheet === 'inspector' ? 'none' : 'inspector')}
                title="Properties"
                data-testid="tablet-inspector-btn"
                className="hidden min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 md:inline-flex lg:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={isLoading}
                onClick={() => setSaveWorkflowOpen(true)}
                data-testid="export-pdf-btn"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-40 sm:min-h-[36px]"
              >
                <Download className="h-4 w-4" />
                <span>{t('action.save')}</span>
              </button>
            </>
          )}

          {/* Viewer controls: Search + Desktop Zoom + Primary Edit button + Overflow */}
          {appMode === 'view' && (
            <>
              {hasPages && (
                <button
                  type="button"
                  data-testid="viewer-search-btn"
                  onClick={() => setSearchOpen(!searchOpen)}
                  aria-label={t('action.search')}
                  title={`${t('action.search')} (Ctrl+F)`}
                  className={`flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg sm:min-h-[36px] sm:min-w-[36px] ${
                    searchOpen
                      ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <Search className="h-5 w-5 sm:h-4 sm:w-4" />
                </button>
              )}

              {/* Primary Viewer CTA on tablet/desktop (mobile uses thumb-zone FAB) */}
              {hasPages && (
                <button
                  type="button"
                  onClick={() => switchMode('edit')}
                  data-testid="toggle-edit-mode-btn"
                  title={`${t('action.editPdf')} (E)`}
                  className="hidden min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 md:inline-flex"
                >
                  <Pencil className="h-4 w-4" />
                  <span>{t('action.editPdf')}</span>
                </button>
              )}
            </>
          )}

          {/* Theme quick toggle on desktop */}
          <button
            type="button"
            onClick={cycleReadingTheme}
            title={`Theme: ${readingTheme}`}
            data-testid="theme-toggle-btn"
            className="hidden min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:inline-flex"
          >
            {readingTheme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>

          {/* Overflow Menu (...) */}
          <button
            type="button"
            data-testid="toolbar-overflow-btn"
            aria-label="More options"
            aria-expanded={overflowOpen}
            onClick={() => setOverflowOpen((v) => !v)}
            className="relative z-50 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:min-h-[36px] sm:min-w-[36px]"
          >
            <MoreVertical className="h-5 w-5" />
          </button>

          {overflowOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setOverflowOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 text-sm shadow-2xl dark:border-slate-800 dark:bg-slate-900"
              >
                {hasPages && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false);
                        openInputRef.current?.click();
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <FolderOpen className="h-4 w-4 text-slate-500" />
                      <span>{t('action.openPdf')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false);
                        setSaveWorkflowOpen(true);
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Download className="h-4 w-4 text-slate-500" />
                      <span>{t('action.saveAsCopy')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false);
                        void shareCurrentPdf();
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Share2 className="h-4 w-4 text-slate-500" />
                      <span>{t('action.share')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOverflowOpen(false);
                        window.print();
                      }}
                      className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Printer className="h-4 w-4 text-slate-500" />
                      <span>{t('action.print')}</span>
                    </button>
                    {appMode === 'edit' && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setOverflowOpen(false);
                            mergeInputRef.current?.click();
                          }}
                          className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <FilePlus2 className="h-4 w-4 text-slate-500" />
                          <span>Merge PDF</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverflowOpen(false);
                            setSplitModalOpen(true);
                          }}
                          className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Scissors className="h-4 w-4 text-slate-500" />
                          <span>Split / Extract</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setOverflowOpen(false);
                            setPageNumberingModalOpen(true);
                          }}
                          className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Hash className="h-4 w-4 text-slate-500" />
                          <span>Page Numbers</span>
                        </button>
                      </>
                    )}
                    <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
                  </>
                )}

                {/* Reading Themes: Light / Dark / Sepia */}
                <div className="px-3 py-1.5">
                  <div className="mb-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Reading Theme
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['light', 'dark', 'sepia'] as ReadingTheme[]).map((th) => (
                      <button
                        key={th}
                        type="button"
                        onClick={() => applyReadingTheme(th)}
                        className={`min-h-[36px] rounded-lg border px-2 text-xs font-medium ${
                          readingTheme === th
                            ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {t(`theme.${th}`)}
                      </button>
                    ))}
                  </div>
                  {readingTheme === 'dark' && (
                    <label className="mt-2 flex min-h-[36px] cursor-pointer items-center justify-between text-xs text-slate-600 dark:text-slate-300">
                      <span>Dark paper inversion</span>
                      <input
                        type="checkbox"
                        checked={darkPaperInvert}
                        onChange={(e) => setDarkPaperInvert(e.target.checked)}
                        className="h-4 w-4 accent-blue-600"
                      />
                    </label>
                  )}
                </div>

                {/* Scroll layout mode */}
                {hasPages && (
                  <div className="px-3 py-1.5">
                    <div className="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Scroll Mode
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        onClick={() => setScrollMode('vertical')}
                        className={`min-h-[36px] rounded-lg border px-2 text-xs font-medium ${
                          scrollMode === 'vertical'
                            ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Continuous
                      </button>
                      <button
                        type="button"
                        onClick={() => setScrollMode('page-snap')}
                        className={`min-h-[36px] rounded-lg border px-2 text-xs font-medium ${
                          scrollMode === 'page-snap'
                            ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Page Snap
                      </button>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  data-testid="locale-toggle-btn"
                  onClick={() => setLocale(locale === 'en' ? 'tr' : 'en')}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2.5">
                    <Globe className="h-4 w-4 text-slate-500" />
                    <span>{t('settings.language')}</span>
                  </span>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold dark:bg-slate-800">
                    {locale.toUpperCase()}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setLeftHandedMode(!leftHandedMode)}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-xl px-3 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span className="flex items-center gap-2.5">
                    <Hand className="h-4 w-4 text-slate-500" />
                    <span>{t('settings.leftHanded')}</span>
                  </span>
                  <span className="text-xs font-semibold text-blue-600">
                    {leftHandedMode ? 'ON' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setOverflowOpen(false);
                    setOpenSourceLicensesOpen(true);
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl px-3 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ShieldCheck className="h-4 w-4 text-slate-500" />
                  <span>{t('settings.licenses')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Contextual tool sub-toolbars (Editor mode only) */}
      {hasPages && appMode === 'edit' && toolMode === 'draw' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4">
          <span className="font-medium text-slate-500 dark:text-slate-400">Freehand Ink:</span>
          <div className="flex items-center gap-1.5">
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDrawStyle({ color: c })}
                style={{ backgroundColor: c }}
                className={`h-5 w-5 rounded-full border ${
                  drawColor === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-400'
                }`}
              />
            ))}
            <input
              type="color"
              value={drawColor}
              onChange={(e) => setDrawStyle({ color: e.target.value })}
              className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </div>
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
            <span>Width: {drawWidth}pt</span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={drawWidth}
              onChange={(e) => setDrawStyle({ width: Number(e.target.value) })}
              className="w-24 accent-blue-600"
            />
          </label>
        </div>
      )}

      {hasPages && appMode === 'edit' && toolMode === 'shape' && (
        <div
          data-testid="shape-subtoolbar"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4"
        >
          <span className="font-medium text-slate-500 dark:text-slate-400">Shape:</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'rect', label: 'Rect', icon: Square },
                { id: 'ellipse', label: 'Ellipse', icon: Circle },
                { id: 'triangle', label: 'Triangle', icon: Triangle },
                { id: 'diamond', label: 'Diamond', icon: Diamond },
                { id: 'arrow', label: 'Arrow', icon: ArrowRight },
              ] as Array<{ id: VectorShapeType; label: string; icon: typeof Square }>
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`shape-preset-${opt.id}`}
                  onClick={() => setShapeStyle({ preset: opt.id })}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
                    activeShapePreset === opt.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            data-testid="shape-fill-transparent"
            onClick={() =>
              setShapeStyle({
                fillColor: shapeFillColor === 'transparent' ? '#3b82f6' : 'transparent',
              })
            }
            className={`rounded border px-2 py-1 text-xs font-medium ${
              shapeFillColor === 'transparent'
                ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            No Fill
          </button>
          {activeShapePreset === 'rect' && (
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span>Radius: {shapeBorderRadius}pt</span>
              <input
                type="range"
                min={0}
                max={48}
                step={1}
                value={shapeBorderRadius}
                data-testid="shape-radius-slider"
                onChange={(e) => setShapeStyle({ borderRadius: Number(e.target.value) })}
                className="w-20 accent-blue-600"
              />
            </label>
          )}
        </div>
      )}

      {hasPages && appMode === 'edit' && toolMode === 'path' && (
        <div
          data-testid="path-subtoolbar"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4"
        >
          <button
            type="button"
            data-testid="path-mode-line"
            onClick={() => setPathToolStyle({ mode: 'line' })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
              activePathMode === 'line'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Minus className="h-3.5 w-3.5" />
            <span>Line</span>
          </button>
          <button
            type="button"
            data-testid="path-mode-pen"
            onClick={() => setPathToolStyle({ mode: 'pen' })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
              activePathMode === 'pen'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Spline className="h-3.5 w-3.5" />
            <span>Pen (Path)</span>
          </button>
          <input
            type="color"
            value={shapeStrokeColor === 'transparent' ? '#0f172a' : shapeStrokeColor}
            onChange={(e) => setShapeStyle({ strokeColor: e.target.value })}
            className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span>{shapeStrokeWidth}pt</span>
            <input
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={shapeStrokeWidth}
              onChange={(e) => setShapeStyle({ strokeWidth: Number(e.target.value) })}
              className="w-20 accent-blue-600"
            />
          </label>
          <select
            value={shapeStrokeDash}
            onChange={(e) => setShapeStyle({ strokeDash: e.target.value as VectorStrokeDash })}
            aria-label="Stroke style"
            className="h-7 rounded border border-slate-300 bg-white px-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
          {activePathMode === 'pen' && (
            <button
              type="button"
              onClick={() => setPathToolStyle({ smooth: !pathSmoothDefault })}
              className={`rounded border px-2 py-1 text-xs font-medium ${
                pathSmoothDefault
                  ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Smooth
            </button>
          )}
        </div>
      )}

      {hasPages &&
        appMode === 'edit' &&
        toolMode === 'select' &&
        selectedElementIds.length >= 2 &&
        (() => {
          const selectedPaths = elements.filter(
            (el) => el.kind === 'path' && selectedElementIds.includes(el.id),
          );
          if (selectedPaths.length < 2) return null;
          return (
            <div className="flex items-center gap-3 border-t border-blue-200 bg-blue-50/80 px-3 py-1 text-xs dark:border-blue-900/50 dark:bg-blue-950/40 sm:px-4">
              <span className="font-medium text-blue-700 dark:text-blue-300">
                {selectedPaths.length} paths selected
              </span>
              <button
                type="button"
                data-testid="toolbar-join-paths-btn"
                onClick={() => joinVectorPaths(selectedPaths.map((p) => p.id))}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>Join Paths</span>
              </button>
            </div>
          );
        })()}

      {hasPages && appMode === 'edit' && toolMode === 'highlight' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4">
          <button
            type="button"
            onClick={() => setHighlightStyle({ shape: 'highlight' })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
              highlightShape === 'highlight'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Highlighter className="h-3.5 w-3.5" />
            <span>Highlight</span>
          </button>
          <button
            type="button"
            onClick={() => setHighlightStyle({ shape: 'rect' })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
              highlightShape === 'rect'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <Square className="h-3.5 w-3.5" />
            <span>Box</span>
          </button>
          <button
            type="button"
            onClick={() => setHighlightStyle({ shape: 'redact' })}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${
              highlightShape === 'redact'
                ? 'bg-red-600 text-white'
                : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>Redact (Permanent)</span>
          </button>
          {highlightShape !== 'redact' && (
            <div className="flex items-center gap-1.5">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setHighlightStyle({ color: c })}
                  style={{ backgroundColor: c }}
                  className={`h-5 w-5 rounded-full border ${
                    highlightColor === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-400'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
