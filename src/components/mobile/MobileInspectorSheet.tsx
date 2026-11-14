import { ArrowUpToLine, ChevronDown, ChevronUp, Minus, Plus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { useEditorStore } from '@/store/useEditorStore';
import { RightInspector } from '../inspector/RightInspector';

export function MobileInspectorSheet() {
  const elements = useEditorStore((s) => s.elements);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const mobileInspectorSnap = useEditorStore((s) => s.mobileInspectorSnap);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setMobileInspectorSnap = useEditorStore((s) => s.setMobileInspectorSnap);
  const updateElements = useEditorStore((s) => s.updateElements);
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const bringToFront = useEditorStore((s) => s.bringToFront);

  const selectedEl =
    selectedElementIds.length > 0
      ? elements.find((e) => e.id === selectedElementIds[0])
      : undefined;

  if (mobileInspectorSnap === 'collapsed' && selectedEl) {
    const isText = selectedEl.kind === 'text-add' || selectedEl.kind === 'text-edit';
    const label =
      selectedEl.kind === 'signature'
        ? 'İmza'
        : isText
          ? 'Metin'
          : selectedEl.kind === 'stroke'
            ? 'Çizim'
            : selectedEl.kind === 'highlight'
              ? 'Açıklama'
              : 'Görsel';

    return (
      <div
        data-testid="mobile-inspector-collapsed"
        className="z-30 flex items-center justify-between gap-2 border-t border-slate-200 bg-white/95 px-3 py-1.5 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 lg:hidden"
      >
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <span className="shrink-0 rounded-md bg-blue-500/15 px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
            {label}
          </span>

          {isText && (
            <>
              <button
                type="button"
                aria-label="Yazı boyutunu küçült"
                onClick={() =>
                  updateElements(
                    [
                      {
                        id: selectedEl.id,
                        patch: { fontSize: Math.max(6, Math.round(selectedEl.fontSize - 1)) },
                      },
                    ],
                    true,
                  )
                }
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="min-w-[34px] text-center text-xs font-medium text-slate-700 dark:text-slate-200">
                {selectedEl.fontSize}pt
              </span>
              <button
                type="button"
                aria-label="Yazı boyutunu büyüt"
                onClick={() =>
                  updateElements(
                    [
                      {
                        id: selectedEl.id,
                        patch: { fontSize: Math.min(144, Math.round(selectedEl.fontSize + 1)) },
                      },
                    ],
                    true,
                  )
                }
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          <button
            type="button"
            aria-label="Öne getir"
            onClick={() => bringToFront([selectedEl.id])}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <ArrowUpToLine className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Seçili öğeyi sil"
            onClick={() => deleteElements(selectedElementIds)}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="mobile-inspector-expand-btn"
            onClick={() => setMobileInspectorSnap('half')}
            className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Detay</span>
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Özellikler çubuğunu kapat"
            data-testid="mobile-inspector-close-btn"
            onClick={() => setMobileSheet('none')}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/55 backdrop-blur-[1px] lg:hidden"
      onClick={() => setMobileSheet('none')}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Özellikler"
        data-testid="mobile-inspector-sheet"
        onClick={(e) => e.stopPropagation()}
        className="safe-pb flex h-[58dvh] max-h-[82dvh] w-full flex-col rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Özellikler & Katmanlar
          </span>
          <div className="flex items-center gap-1">
            {selectedEl && (
              <button
                type="button"
                aria-label="Mini çubuğa küçült"
                data-testid="mobile-inspector-collapse-btn"
                onClick={() => setMobileInspectorSnap('collapsed')}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              aria-label="Özellikler panelini kapat"
              data-testid="mobile-inspector-close-btn"
              onClick={() => setMobileSheet('none')}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <RightInspector variant="sheet" />
        </div>
      </section>
    </div>
  );
}
