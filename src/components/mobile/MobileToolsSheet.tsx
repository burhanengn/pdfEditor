import { useRef } from 'react';
import {
  BoxSelect,
  FileSignature,
  Hash,
  Highlighter,
  ImagePlus,
  Layers,
  LayoutGrid,
  Maximize2,
  Minus,
  MousePointer2,
  PenTool,
  Shapes,
  Spline,
  Type,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { FilePlus } from 'lucide-react';
import {
  createBlankDocument,
  insertBlankPageInDocument,
  insertImageFileOnPage,
} from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';
import type { ToolMode } from '@/types/pdf';

export function MobileToolsSheet() {
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const toolMode = useEditorStore((s) => s.toolMode);
  const activeShapePreset = useEditorStore((s) => s.activeShapePreset);
  const activePathMode = useEditorStore((s) => s.activePathMode);
  const zoom = useEditorStore((s) => s.zoom);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const setShapeStyle = useEditorStore((s) => s.setShapeStyle);
  const setPathToolStyle = useEditorStore((s) => s.setPathToolStyle);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setZoomMode = useEditorStore((s) => s.setZoomMode);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setSignatureModalOpen = useEditorStore((s) => s.setSignatureModalOpen);
  const setPageNumberingModalOpen = useEditorStore((s) => s.setPageNumberingModalOpen);
  const setOrganizeModalOpen = useEditorStore((s) => s.setOrganizeModalOpen);
  const selectBackgroundMode = useEditorStore((s) => s.selectBackgroundMode);
  const setSelectBackgroundMode = useEditorStore((s) => s.setSelectBackgroundMode);
  const marqueeSelectMode = useEditorStore((s) => s.marqueeSelectMode);
  const setMarqueeSelectMode = useEditorStore((s) => s.setMarqueeSelectMode);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const hasPages = pages.length > 0;

  const chooseMode = (mode: ToolMode) => {
    setToolMode(mode);
    setMobileSheet('none');
  };

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/60 backdrop-blur-[1px] md:hidden"
      onClick={() => setMobileSheet('none')}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Araçlar"
        data-testid="mobile-tools-sheet"
        onClick={(e) => e.stopPropagation()}
        className="safe-pb flex max-h-[78dvh] w-full flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            PDF Araçları
          </h2>
          <button
            type="button"
            aria-label="Araçlar menüsünü kapat"
            onClick={() => setMobileSheet('none')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          {/* Blank Document / Blank Page */}
          <div className="space-y-2">
            {!hasPages ? (
              <button
                type="button"
                data-testid="mobile-new-blank-btn"
                onClick={() => {
                  setMobileSheet('none');
                  void createBlankDocument();
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
              >
                <FilePlus className="h-4 w-4" />
                Boş PDF ile Başla
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="mobile-tools-new-blank-btn"
                  onClick={() => {
                    setMobileSheet('none');
                    void createBlankDocument();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  <FilePlus className="h-4 w-4 text-emerald-500" />
                  Yeni Boş PDF
                </button>
                <button
                  type="button"
                  data-testid="mobile-tools-add-blank-page-btn"
                  onClick={() => {
                    setMobileSheet('none');
                    void insertBlankPageInDocument();
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                >
                  <FilePlus className="h-4 w-4" />
                  + Boş Sayfa
                </button>
              </div>
            )}
          </div>
          {/* Edit & Add */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Düzenle & Ekle
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-select"
                onClick={() => chooseMode('select')}
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'select'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <MousePointer2 className="h-4 w-4 shrink-0" />
                <span>Seç / Düzenle</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-text"
                onClick={() => chooseMode('text')}
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'text'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Type className="h-4 w-4 shrink-0" />
                <span>Metin Ekle</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-image"
                onClick={() => imageInputRef.current?.click()}
                className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <ImagePlus className="h-4 w-4 shrink-0" />
                <span>Görsel Ekle</span>
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                data-testid="mobile-insert-image-input"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  const targetPage = activePageId ?? pages[0]?.id;
                  if (f && targetPage) {
                    void insertImageFileOnPage(f, targetPage);
                    setMobileSheet('none');
                  }
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-draw"
                onClick={() => chooseMode('draw')}
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'draw'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <PenTool className="h-4 w-4 shrink-0" />
                <span>Çizim (Ink)</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-shape-rect"
                onClick={() => {
                  setShapeStyle({ preset: 'rect' });
                  chooseMode('shape');
                }}
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'shape' && activeShapePreset === 'rect'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Shapes className="h-4 w-4 shrink-0" />
                <span>Kare / Yuvarlak Şekil</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-path-line"
                onClick={() => {
                  setPathToolStyle({ mode: 'line' });
                  chooseMode('path');
                }}
                className={`flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'path' && activePathMode === 'line'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Minus className="h-4 w-4 shrink-0" />
                <span>Düz Çizgi</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-path-pen"
                onClick={() => {
                  setPathToolStyle({ mode: 'pen' });
                  chooseMode('path');
                }}
                className={`col-span-2 flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'path' && activePathMode === 'pen'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Spline className="h-4 w-4 shrink-0" />
                <span>Kalem / Birleşen Yol (Path)</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-highlight"
                onClick={() => chooseMode('highlight')}
                className={`col-span-2 flex min-h-[48px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'highlight'
                    ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <Highlighter className="h-4 w-4 shrink-0" />
                <span>Vurgula / Kutu / Kalıcı Sansür</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-toggle-marquee-select"
                aria-pressed={toolMode === 'select' && marqueeSelectMode}
                onClick={() => {
                  if (toolMode !== 'select') {
                    setToolMode('select');
                    setMarqueeSelectMode(true);
                  } else {
                    setMarqueeSelectMode(!marqueeSelectMode);
                  }
                  setMobileSheet('none');
                }}
                className={`col-span-2 flex min-h-[48px] items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  toolMode === 'select' && marqueeSelectMode
                    ? 'border-blue-500 bg-blue-500/20 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <BoxSelect className="h-4 w-4 shrink-0" />
                  <span>Alan Seç (Çoklu Kutu Seçimi)</span>
                </span>
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold dark:bg-white/10">
                  {toolMode === 'select' && marqueeSelectMode ? 'Açık' : 'Kapalı'}
                </span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-toggle-select-background"
                aria-pressed={selectBackgroundMode}
                onClick={() => {
                  setSelectBackgroundMode(!selectBackgroundMode);
                  setMobileSheet('none');
                }}
                className={`col-span-2 flex min-h-[48px] items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left font-medium transition disabled:opacity-40 ${
                  selectBackgroundMode
                    ? 'border-amber-500 bg-amber-500/20 text-amber-600 dark:text-amber-300'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Layers className="h-4 w-4 shrink-0" />
                  <span>Arka Plan Görsellerini Seç</span>
                </span>
                <span className="rounded-full bg-black/10 px-2 py-0.5 text-xs font-semibold dark:bg-white/10">
                  {selectBackgroundMode ? 'Açık' : 'Kapalı'}
                </span>
              </button>
            </div>
          </div>

          {/* Signature & Document Actions */}
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              İmza & Belge
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                data-testid="mobile-tool-signature"
                onClick={() => {
                  setMobileSheet('none');
                  setSignatureModalOpen(true);
                }}
                className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <FileSignature className="h-4 w-4 text-blue-500" />
                <span>İmza & Paraf Ekle</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-page-numbers"
                onClick={() => {
                  setMobileSheet('none');
                  setPageNumberingModalOpen(true);
                }}
                className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <Hash className="h-4 w-4 text-blue-500" />
                <span>Sayfa Numaraları</span>
              </button>

              <button
                type="button"
                disabled={!hasPages}
                data-testid="mobile-tool-organize"
                onClick={() => {
                  setMobileSheet('none');
                  setOrganizeModalOpen(true);
                }}
                className="flex min-h-[48px] items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <LayoutGrid className="h-4 w-4 text-blue-500" />
                <span>Sayfa Yönetimi</span>
              </button>
            </div>
          </div>

          {/* Zoom Controls */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Görünüm & Yakınlaştırma
              </span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {Math.round(zoom * 100)}%
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                disabled={!hasPages}
                onClick={() => setZoom(zoom - 0.2, 'custom')}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={!hasPages}
                onClick={() => {
                  setZoomMode('fit-width');
                  setMobileSheet('none');
                }}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                Genişlik
              </button>
              <button
                type="button"
                disabled={!hasPages}
                onClick={() => {
                  setZoomMode('fit-page');
                  setMobileSheet('none');
                }}
                className="flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Tam
              </button>
              <button
                type="button"
                disabled={!hasPages}
                onClick={() => setZoom(zoom + 0.2, 'custom')}
                className="flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 disabled:opacity-40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
