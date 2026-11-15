import { useRef } from 'react';
import {
  ArrowRight,
  Circle,
  Diamond,
  FilePlus2,
  FileSignature,
  FolderOpen,
  Hash,
  Highlighter,
  ImagePlus,
  Layers,
  LayoutGrid,
  Link2,
  Magnet,
  Maximize2,
  Minus,
  Moon,
  MousePointer2,
  PenTool,
  Redo2,
  Scissors,
  Shapes,
  ShieldAlert,
  SlidersHorizontal,
  Spline,
  Square,
  Sun,
  Triangle,
  Type,
  Undo2,
  Download,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  exportCurrentPdf,
  insertImageFileOnPage,
  mergePdfFile,
  openPdfFile,
} from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';
import type { VectorShapeType, VectorStrokeDash } from '@/types/elements';
import type { ToolMode, ZoomMode } from '@/types/pdf';
import { BrandLogo } from '../BrandLogo';

const QUICK_COLORS = ['#ef4444', '#2563eb', '#0f172a', '#16a34a', '#facc15'];

export function TopToolbar() {
  const documentName = useEditorStore((s) => s.documentName);
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const theme = useEditorStore((s) => s.theme);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);
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
  const toggleTheme = useEditorStore((s) => s.toggleTheme);
  const setSnapEnabled = useEditorStore((s) => s.setSnapEnabled);
  const setDrawStyle = useEditorStore((s) => s.setDrawStyle);
  const setHighlightStyle = useEditorStore((s) => s.setHighlightStyle);
  const setShapeStyle = useEditorStore((s) => s.setShapeStyle);
  const setPathToolStyle = useEditorStore((s) => s.setPathToolStyle);
  const joinVectorPaths = useEditorStore((s) => s.joinVectorPaths);
  const setSignatureModalOpen = useEditorStore((s) => s.setSignatureModalOpen);
  const setSplitModalOpen = useEditorStore((s) => s.setSplitModalOpen);
  const setOrganizeModalOpen = useEditorStore((s) => s.setOrganizeModalOpen);
  const setPageNumberingModalOpen = useEditorStore((s) => s.setPageNumberingModalOpen);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const pageNumbering = useEditorStore((s) => s.pageNumbering);
  const pendingSignaturePlacement = useEditorStore((s) => s.pendingSignaturePlacement);
  const cancelPendingSignaturePlacement = useEditorStore(
    (s) => s.cancelPendingSignaturePlacement,
  );
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const selectBackgroundMode = useEditorStore((s) => s.selectBackgroundMode);
  const setSelectBackgroundMode = useEditorStore((s) => s.setSelectBackgroundMode);

  const openInputRef = useRef<HTMLInputElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const hasPages = pages.length > 0;

  const toolButtons: Array<{
    id: ToolMode;
    label: string;
    icon: typeof MousePointer2;
    onClick?: () => void;
  }> = [
    { id: 'select', label: 'Select / Edit', icon: MousePointer2 },
    { id: 'text', label: 'Add Text', icon: Type },
    {
      id: 'image',
      label: 'Add Image',
      icon: ImagePlus,
      onClick: () => imageInputRef.current?.click(),
    },
    { id: 'shape', label: 'Shapes', icon: Shapes },
    { id: 'path', label: 'Line / Path', icon: Spline },
    { id: 'draw', label: 'Draw', icon: PenTool },
    { id: 'highlight', label: 'Annotate', icon: Highlighter },
    {
      id: 'signature',
      label: 'Sign',
      icon: FileSignature,
      onClick: () => setSignatureModalOpen(true),
    },
    {
      id: 'organize',
      label: 'Organize',
      icon: LayoutGrid,
      onClick: () => setOrganizeModalOpen(true),
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
    <header className="safe-pt z-30 flex flex-col border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="flex h-12 items-center justify-between gap-1.5 px-2 sm:gap-2 sm:px-2.5">
        {/* Left: Brand & File Actions */}
        <div className="flex min-w-0 shrink-0 items-center gap-1">
          <div
            data-testid="brand-logo-container"
            className="flex shrink-0 items-center gap-2 pr-1"
          >
            <BrandLogo variant="mark" className="h-7 w-7 shrink-0 md:hidden" />
            <BrandLogo variant="horizontal-auto" className="hidden h-8 w-auto shrink-0 md:block" />
            {hasPages && (
              <span
                title={documentName}
                className="hidden max-w-[110px] truncate rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300 2xl:inline"
              >
                {documentName}
              </span>
            )}
          </div>

          <div className="h-5 w-px shrink-0 bg-slate-200 dark:bg-slate-800" />

          <button
            type="button"
            onClick={() => openInputRef.current?.click()}
            data-testid="toolbar-open-btn"
            title="Open PDF File"
            className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FolderOpen className="h-4 w-4 md:h-3.5 md:w-3.5" />
            <span className="hidden sm:inline">Open</span>
          </button>
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

          <button
            type="button"
            disabled={!hasPages}
            onClick={() => mergeInputRef.current?.click()}
            data-testid="toolbar-merge-btn"
            title="Merge PDFs"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800 md:inline-flex"
          >
            <FilePlus2 className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Merge</span>
          </button>
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

          <button
            type="button"
            disabled={!hasPages}
            onClick={() => setSplitModalOpen(true)}
            data-testid="toolbar-split-btn"
            title="Split / Extract Pages"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800 md:inline-flex"
          >
            <Scissors className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Split</span>
          </button>

          <button
            type="button"
            disabled={!hasPages}
            onClick={() => setPageNumberingModalOpen(true)}
            data-testid="toolbar-page-numbers-btn"
            title="Sayfa Numarası Ekle (Page Numbers)"
            className={`hidden shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:opacity-40 md:inline-flex ${
              pageNumbering?.enabled
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            <Hash className="h-3.5 w-3.5" />
            <span className="hidden 2xl:inline">Page #</span>
          </button>

          {pendingSignaturePlacement && (
            <button
              type="button"
              data-testid="cancel-signature-placement-btn"
              onClick={cancelPendingSignaturePlacement}
              className="hidden shrink-0 items-center gap-1 rounded-lg border border-blue-500/50 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-500/40 dark:bg-blue-950/70 dark:text-blue-200 md:inline-flex"
            >
              Click page to place • Cancel (Esc)
            </button>
          )}

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

        {/* Center: Primary Editing Tool Modes (Desktop & Tablet >= 768px; Mobile uses Bottom Dock Tools sheet) */}
        <div className="hidden shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-800 dark:bg-slate-900 md:flex">
          {toolButtons.map((btn) => {
            const Icon = btn.icon;
            const active = toolMode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                disabled={!hasPages && btn.id !== 'signature'}
                title={btn.label}
                data-testid={`tool-${btn.id}`}
                onClick={() => {
                  if (btn.onClick) {
                    btn.onClick();
                  } else {
                    setToolMode(btn.id);
                  }
                }}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden lg:inline">{btn.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            disabled={!hasPages}
            aria-pressed={selectBackgroundMode}
            title="Arka Planı Seç (Arka Plan Görsellerini Düzenle)"
            data-testid="toggle-select-background"
            onClick={() => setSelectBackgroundMode(!selectBackgroundMode)}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
              selectBackgroundMode
                ? 'bg-amber-500/20 text-amber-600 ring-1 ring-amber-400/50 dark:text-amber-300'
                : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Arka Planı Seç</span>
          </button>
        </div>

        {/* Right: Undo/Redo, Zoom, Snap, Theme, Export */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              disabled={!canUndo}
              onClick={undo}
              title="Undo (Ctrl+Z)"
              data-testid="undo-btn"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={redo}
              title="Redo (Ctrl+Y)"
              data-testid="redo-btn"
              className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Redo2 className="h-4 w-4" />
            </button>
          </div>

          <div className="h-5 w-px bg-slate-200 dark:bg-slate-800" />

          {/* Zoom cluster */}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              disabled={!hasPages}
              onClick={() => setZoom(zoom - 0.15, 'custom')}
              title="Zoom Out"
              data-testid="zoom-out-btn"
              className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <select
              disabled={!hasPages}
              value={zoomMode === 'custom' ? '' : zoomMode}
              onChange={(e) => handleZoomSelect(e.target.value)}
              aria-label="Zoom level"
              data-testid="zoom-select"
              className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {zoomMode === 'custom' && (
                <option value="">{Math.round(zoom * 100)}%</option>
              )}
              <option value="fit-width">Fit Width ({Math.round(zoom * 100)}%)</option>
              <option value="fit-page">Fit Page</option>
              <option value="0.5">50%</option>
              <option value="0.75">75%</option>
              <option value="1">100%</option>
              <option value="1.25">125%</option>
              <option value="1.5">150%</option>
              <option value="2">200%</option>
              <option value="3">300%</option>
              <option value="4">400%</option>
              <option value="5">500%</option>
            </select>
            <button
              type="button"
              disabled={!hasPages}
              onClick={() => setZoom(zoom + 0.15, 'custom')}
              title="Zoom In"
              data-testid="zoom-in-btn"
              className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={!hasPages}
              onClick={() => setZoomMode('fit-page')}
              title="Fit Page"
              className="rounded-lg p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-35 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSnapEnabled(!snapEnabled)}
            title={snapEnabled ? 'Snap Guides: On' : 'Snap Guides: Off'}
            className={`hidden rounded-lg p-1.5 transition sm:inline-flex ${
              snapEnabled
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
            }`}
          >
            <Magnet className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setMobileSheet(mobileSheet === 'inspector' ? 'none' : 'inspector')}
            title="Properties / Özelleştir"
            data-testid="tablet-inspector-btn"
            className={`hidden rounded-lg p-1.5 transition md:inline-flex lg:hidden ${
              mobileSheet === 'inspector'
                ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            title="Toggle Light / Dark Theme"
            data-testid="theme-toggle-btn"
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <button
            type="button"
            disabled={!hasPages || isLoading}
            onClick={() => void exportCurrentPdf()}
            data-testid="export-pdf-btn"
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-40 sm:px-3"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export PDF</span>
            <span className="sm:hidden">PDF</span>
          </button>
        </div>
      </div>

      {/* Contextual sub-toolbar for Draw / Annotate */}
      {hasPages && toolMode === 'draw' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4">
          <span className="font-medium text-slate-500 dark:text-slate-400">Freehand Ink:</span>
          <div className="flex items-center gap-1.5">
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setDrawStyle({ color: c })}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded-full border ${
                  drawColor === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-400'
                }`}
              />
            ))}
            <input
              type="color"
              value={drawColor}
              onChange={(e) => setDrawStyle({ color: e.target.value })}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
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

      {hasPages && toolMode === 'shape' && (
        <div
          data-testid="shape-subtoolbar"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4"
        >
          <span className="font-medium text-slate-500 dark:text-slate-400">Şekil:</span>
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'rect', label: 'Kare', icon: Square },
                { id: 'ellipse', label: 'Yuvarlak', icon: Circle },
                { id: 'triangle', label: 'Üçgen', icon: Triangle },
                { id: 'diamond', label: 'Elmas', icon: Diamond },
                { id: 'arrow', label: 'Ok', icon: ArrowRight },
              ] as Array<{ id: VectorShapeType; label: string; icon: typeof Square }>
            ).map((opt) => {
              const Icon = opt.icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`shape-preset-${opt.id}`}
                  onClick={() => setShapeStyle({ preset: opt.id })}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                    activeShapePreset === opt.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Dolgu:</span>
            <button
              type="button"
              data-testid="shape-fill-transparent"
              onClick={() =>
                setShapeStyle({
                  fillColor: shapeFillColor === 'transparent' ? '#3b82f6' : 'transparent',
                })
              }
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                shapeFillColor === 'transparent'
                  ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Boş
            </button>
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setShapeStyle({ fillColor: c })}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded-full border ${
                  shapeFillColor === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-400'
                }`}
              />
            ))}
            <input
              type="color"
              value={shapeFillColor === 'transparent' ? '#3b82f6' : shapeFillColor}
              onChange={(e) => setShapeStyle({ fillColor: e.target.value })}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 dark:text-slate-400">Kenarlık:</span>
            <input
              type="color"
              value={shapeStrokeColor === 'transparent' ? '#1e3a8a' : shapeStrokeColor}
              onChange={(e) => setShapeStyle({ strokeColor: e.target.value })}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
            <input
              type="range"
              min={0}
              max={12}
              step={0.5}
              value={shapeStrokeWidth}
              onChange={(e) => setShapeStyle({ strokeWidth: Number(e.target.value) })}
              className="w-16 accent-blue-600"
            />
            <span className="w-8 text-[11px] text-slate-600 dark:text-slate-300">
              {shapeStrokeWidth}pt
            </span>
          </div>

          {activeShapePreset === 'rect' && (
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span>Köşe: {shapeBorderRadius}pt</span>
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

      {hasPages && toolMode === 'path' && (
        <div
          data-testid="path-subtoolbar"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4"
        >
          <span className="font-medium text-slate-500 dark:text-slate-400">Çizgi & Yol:</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid="path-mode-line"
              onClick={() => setPathToolStyle({ mode: 'line' })}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                activePathMode === 'line'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Minus className="h-3 w-3" />
              Düz Çizgi
            </button>
            <button
              type="button"
              data-testid="path-mode-pen"
              onClick={() => setPathToolStyle({ mode: 'pen' })}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                activePathMode === 'pen'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Spline className="h-3 w-3" />
              Kalem (Path)
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {QUICK_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setShapeStyle({ strokeColor: c })}
                style={{ backgroundColor: c }}
                className={`h-4 w-4 rounded-full border ${
                  shapeStrokeColor === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-400'
                }`}
              />
            ))}
            <input
              type="color"
              value={shapeStrokeColor === 'transparent' ? '#0f172a' : shapeStrokeColor}
              onChange={(e) => setShapeStyle({ strokeColor: e.target.value })}
              className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </div>

          <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
            <span>Kalınlık: {shapeStrokeWidth}pt</span>
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
            aria-label="Çizgi Stili"
            className="h-6 rounded border border-slate-300 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="solid">Düz</option>
            <option value="dashed">Kesikli</option>
            <option value="dotted">Noktalı</option>
          </select>

          {activePathMode === 'pen' && (
            <button
              type="button"
              onClick={() => setPathToolStyle({ smooth: !pathSmoothDefault })}
              className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                pathSmoothDefault
                  ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Yumuşak Eğri
            </button>
          )}
          <span className="hidden text-[10px] text-slate-400 xl:inline">
            Uç noktaya yaklaşınca otomatik yapışır &amp; birleşir (Shift: 45° açı)
          </span>
        </div>
      )}

      {hasPages &&
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
                {selectedPaths.length} yol seçildi:
              </span>
              <button
                type="button"
                data-testid="toolbar-join-paths-btn"
                onClick={() => joinVectorPaths(selectedPaths.map((p) => p.id))}
                className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-blue-500"
              >
                <Link2 className="h-3 w-3" />
                Yolları Birleştir (Join)
              </button>
            </div>
          );
        })()}

      {hasPages && toolMode === 'highlight' && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-900 sm:px-4">
          <span className="font-medium text-slate-500 dark:text-slate-400">Annotation Mode:</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setHighlightStyle({ shape: 'highlight' })}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                highlightShape === 'highlight'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Highlighter className="h-3 w-3" />
              Highlight
            </button>
            <button
              type="button"
              onClick={() => setHighlightStyle({ shape: 'rect' })}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                highlightShape === 'rect'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Square className="h-3 w-3" />
              Box
            </button>
            <button
              type="button"
              onClick={() => setHighlightStyle({ shape: 'redact' })}
              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium ${
                highlightShape === 'redact'
                  ? 'bg-red-600 text-white'
                  : 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <ShieldAlert className="h-3 w-3" />
              Redact (Permanent)
            </button>
          </div>
          {highlightShape !== 'redact' && (
            <div className="flex items-center gap-1.5">
              {QUICK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setHighlightStyle({ color: c })}
                  style={{ backgroundColor: c }}
                  className={`h-4 w-4 rounded-full border ${
                    highlightColor === c
                      ? 'ring-2 ring-blue-500 ring-offset-1'
                      : 'border-slate-400'
                  }`}
                />
              ))}
              <input
                type="color"
                value={highlightColor}
                onChange={(e) => setHighlightStyle({ color: e.target.value })}
                className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </div>
          )}
        </div>
      )}
    </header>
  );
}
