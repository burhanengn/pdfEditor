import { useEffect, useState } from 'react';
import { Check, Hash, Trash2, X } from 'lucide-react';
import { FONT_OPTIONS } from '@/engine/fonts';
import { DEFAULT_PAGE_NUMBERING_CONFIG, formatPageNumberLabel } from '@/engine/pageNumbers';
import { useEditorStore } from '@/store/useEditorStore';
import type {
  FontFamilyOption,
  PageNumberingConfig,
  PageNumberingFormat,
  PageNumberingPosition,
} from '@/types/pdf';

const POSITION_OPTIONS: Array<{ id: PageNumberingPosition; label: string }> = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-center', label: 'Top Center' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-center', label: 'Bottom Center' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

const FORMAT_OPTIONS: Array<{ id: PageNumberingFormat; label: string }> = [
  { id: 'number', label: '1, 2, 3' },
  { id: 'number-of-total', label: '1 / N' },
  { id: 'page-number', label: 'Sayfa 1' },
  { id: 'page-number-of-total', label: 'Sayfa 1 / N' },
  { id: 'roman-lower', label: 'i, ii, iii (Roman)' },
  { id: 'roman-upper', label: 'I, II, III (Roman)' },
];

export function PageNumberingModal() {
  const open = useEditorStore((s) => s.pageNumberingModalOpen);
  const setOpen = useEditorStore((s) => s.setPageNumberingModalOpen);
  const pageNumbering = useEditorStore((s) => s.pageNumbering);
  const setPageNumbering = useEditorStore((s) => s.setPageNumbering);
  const userFonts = useEditorStore((s) => s.userFonts);
  const pagesCount = useEditorStore((s) => s.pages.length);

  const [draft, setDraft] = useState<PageNumberingConfig>(DEFAULT_PAGE_NUMBERING_CONFIG);

  useEffect(() => {
    if (open) {
      setDraft(pageNumbering ? { ...pageNumbering } : { ...DEFAULT_PAGE_NUMBERING_CONFIG, enabled: true });
    }
  }, [open, pageNumbering]);

  if (!open) return null;

  const sampleIdx = Math.max(0, (draft.startFromPage || 1) - 1);
  const samplePreview =
    formatPageNumberLabel(sampleIdx, Math.max(sampleIdx + 1, pagesCount), {
      ...draft,
      enabled: true,
    }) ?? '1';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pgnum-modal-title"
    >
      <div className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-blue-600" />
            <div>
              <h2
                id="pgnum-modal-title"
                className="text-sm font-semibold text-slate-900 dark:text-slate-100"
              >
                Sayfa Numarası Ekle (Dynamic Page Numbers)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Automatically updates when pages are reordered, duplicated, or deleted.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close page numbering dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          {/* Position 2x3 Grid */}
          <div>
            <label className="mb-1.5 block font-medium text-slate-700 dark:text-slate-300">
              Position on Page
            </label>
            <div className="grid grid-cols-3 gap-2">
              {POSITION_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`pgnum-pos-${opt.id}`}
                  onClick={() => setDraft((d) => ({ ...d, position: opt.id }))}
                  className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                    draft.position === opt.id
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Format
              </label>
              <select
                value={draft.format}
                data-testid="pgnum-format-select"
                onChange={(e) =>
                  setDraft((d) => ({ ...d, format: e.target.value as PageNumberingFormat }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {FORMAT_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Font Family
              </label>
              <select
                value={draft.fontFamily}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, fontFamily: e.target.value as FontFamilyOption }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                {userFonts.length > 0 && (
                  <optgroup label="My Uploaded Fonts">
                    {userFonts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Standard & Built-in Fonts">
                  {FONT_OPTIONS.filter((f) => f.category !== 'script').map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Size (pt)
              </label>
              <input
                type="number"
                min={6}
                max={36}
                value={draft.fontSize}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    fontSize: Math.max(6, Math.min(36, Number(e.target.value) || 10)),
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Side Margin (pt)
              </label>
              <input
                type="number"
                min={8}
                max={120}
                value={draft.marginX}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    marginX: Math.max(8, Math.min(120, Number(e.target.value) || 36)),
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Edge Margin (pt)
              </label>
              <input
                type="number"
                min={8}
                max={120}
                value={draft.marginY}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    marginY: Math.max(8, Math.min(120, Number(e.target.value) || 26)),
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 items-end gap-3">
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Start From Page
              </label>
              <input
                type="number"
                min={1}
                max={Math.max(1, pagesCount)}
                value={draft.startFromPage}
                data-testid="pgnum-start-from-input"
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    startFromPage: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                First Number
              </label>
              <input
                type="number"
                min={1}
                value={draft.startNumber}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    startNumber: Math.max(1, Number(e.target.value) || 1),
                  }))
                }
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700 dark:text-slate-300">
                Color
              </label>
              <input
                type="color"
                value={draft.color}
                onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value }))}
                className="h-8 w-full cursor-pointer rounded-lg border border-slate-200 bg-transparent p-0.5 dark:border-slate-700"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={draft.startFromPage === 2}
              data-testid="pgnum-skip-cover-checkbox"
              onChange={(e) =>
                setDraft((d) => ({ ...d, startFromPage: e.target.checked ? 2 : 1 }))
              }
              className="rounded accent-blue-600"
            />
            Skip cover page (start numbering from page 2 as {draft.startNumber})
          </label>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60">
            <span className="text-xs text-slate-500 dark:text-slate-400">Preview:</span>
            <span
              data-testid="pgnum-sample-preview"
              style={{ color: draft.color }}
              className="font-semibold"
            >
              {samplePreview}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950">
          <button
            type="button"
            data-testid="pgnum-remove-btn"
            onClick={() => {
              setPageNumbering(null);
              setOpen(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove Numbers
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="pgnum-apply-btn"
              onClick={() => {
                setPageNumbering({ ...draft, enabled: true });
                setOpen(false);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
            >
              <Check className="h-3.5 w-3.5" />
              Apply Numbers
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
