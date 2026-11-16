import { useRef } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  FilePlus2,
  LayoutGrid,
  RotateCw,
  Scissors,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { FilePlus } from 'lucide-react';
import { insertBlankPageInDocument, mergePdfFile } from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';
import { ThumbnailItem } from '../sidebar/ThumbnailItem';
import { VirtualThumbnailGrid } from '../sidebar/VirtualThumbnailGrid';

interface MobilePagesSheetProps {
  onScrollToPage: (pageIndex: number) => void;
}

export function MobilePagesSheet({ onScrollToPage }: MobilePagesSheetProps) {
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const togglePageSelection = useEditorStore((s) => s.togglePageSelection);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const rotatePages = useEditorStore((s) => s.rotatePages);
  const duplicatePages = useEditorStore((s) => s.duplicatePages);
  const deletePages = useEditorStore((s) => s.deletePages);
  const setSplitModalOpen = useEditorStore((s) => s.setSplitModalOpen);
  const setOrganizeModalOpen = useEditorStore((s) => s.setOrganizeModalOpen);

  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const targetPageIds =
    selectedPageIds.length > 0 ? selectedPageIds : activePageId ? [activePageId] : [];

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/60 backdrop-blur-[1px] md:hidden"
      onClick={() => setMobileSheet('none')}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Sayfalar"
        data-testid="mobile-pages-sheet"
        onClick={(e) => e.stopPropagation()}
        className="safe-pb flex max-h-[84dvh] w-full flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sayfalar ({pages.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selectedPageIds.length} seçili • atlamak için sayfaya dokunun
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setMobileSheet('none');
                setOrganizeModalOpen(true);
              }}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              Tam Ekran
            </button>
            <button
              type="button"
              aria-label="Sayfa panelini kapat"
              onClick={() => setMobileSheet('none')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Touch Action Row */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
          <button
            type="button"
            data-testid="mobile-add-blank-page-btn"
            onClick={() => void insertBlankPageInDocument()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            <FilePlus className="h-4 w-4" />
            + Boş Sayfa
          </button>
          <button
            type="button"
            onClick={() => mergeInputRef.current?.click()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <FilePlus2 className="h-4 w-4" />
            PDF Ekle
          </button>
          <input
            ref={mergeInputRef}
            type="file"
            accept="application/pdf,.pdf"
            data-testid="mobile-merge-pdf-input"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void mergePdfFile(f);
              e.target.value = '';
            }}
          />

          <button
            type="button"
            onClick={() => {
              setMobileSheet('none');
              setSplitModalOpen(true);
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Scissors className="h-4 w-4" />
            Böl / Ayır
          </button>

          <button
            type="button"
            disabled={targetPageIds.length === 0}
            onClick={() => rotatePages(targetPageIds, 90)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <RotateCw className="h-4 w-4" />
            90°
          </button>

          <button
            type="button"
            disabled={targetPageIds.length === 0 || targetPageIds.length >= pages.length}
            onClick={() => deletePages(targetPageIds)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-600 disabled:opacity-40 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
            Sil
          </button>
        </div>

        {/* Virtualized Thumbnail Grid */}
        <VirtualThumbnailGrid
          pages={pages}
          columns={2}
          estimateRowHeightPx={265}
          gapPx={12}
          className="p-3"
          renderItem={(page, idx) => {
            const selected = selectedPageIds.includes(page.id);
            return (
              <div key={page.id} className="relative flex flex-col gap-1.5">
                <div className="relative">
                  <ThumbnailItem
                    page={page}
                    pageIndex={idx}
                    isActive={selected}
                    totalPages={pages.length}
                    scale={0.23}
                    testIdPrefix="mobile-page-thumb-"
                    onSelect={() => {
                      setActivePage(page.id);
                      onScrollToPage(idx);
                      setMobileSheet('none');
                    }}
                    onRotateCW={() => rotatePages([page.id], 90)}
                    onDuplicate={() => duplicatePages([page.id])}
                    onDelete={() => deletePages([page.id])}
                  />
                  <button
                    type="button"
                    aria-label={`Sayfa ${idx + 1} çoklu seçim`}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePageSelection(page.id, true);
                    }}
                    className="absolute left-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-lg bg-white/90 text-blue-600 shadow dark:bg-slate-900/90"
                  >
                    {selected ? (
                      <CheckSquare className="h-5 w-5" />
                    ) : (
                      <Square className="h-5 w-5 text-slate-400" />
                    )}
                  </button>
                </div>

                {/* Touch Reorder Controls */}
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => reorderPages(idx, idx - 1)}
                    aria-label={`Sayfa ${idx + 1} yukarı taşı`}
                    className="flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 disabled:opacity-35 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <ArrowUp className="h-4 w-4" />
                    Önceki
                  </button>
                  <button
                    type="button"
                    disabled={idx === pages.length - 1}
                    onClick={() => reorderPages(idx, idx + 1)}
                    aria-label={`Sayfa ${idx + 1} aşağı taşı`}
                    className="flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-600 disabled:opacity-35 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                  >
                    <ArrowDown className="h-4 w-4" />
                    Sonraki
                  </button>
                </div>
              </div>
            );
          }}
        />
      </section>
    </div>
  );
}
