import { useEffect, useState, type FormEvent } from 'react';
import { FileArchive, FileOutput, Scissors, X } from 'lucide-react';
import { exportSplitDocuments } from '@/engine/documentController';
import { parsePageRangeExpression } from '@/engine/pageRange';
import { useEditorStore } from '@/store/useEditorStore';

export function SplitExtractModal() {
  const open = useEditorStore((s) => s.splitModalOpen);
  const setOpen = useEditorStore((s) => s.setSplitModalOpen);
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);

  const [rangeText, setRangeText] = useState('1');
  const [mode, setMode] = useState<'single-pdf' | 'split-zip-by-range' | 'split-zip-per-page'>(
    'single-pdf',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || pages.length === 0) return;
    if (selectedPageIds.length > 1) {
      const nums = selectedPageIds
        .map((id) => pages.findIndex((p) => p.id === id) + 1)
        .filter((n) => n > 0)
        .sort((a, b) => a - b);
      setRangeText(nums.join(', '));
    } else {
      const idx = pages.findIndex((p) => p.id === activePageId);
      setRangeText(String(idx >= 0 ? idx + 1 : 1));
    }
    setError(null);
  }, [open, pages, activePageId, selectedPageIds]);

  if (!open) return null;

  const parsedPreview = parsePageRangeExpression(rangeText, pages.length);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (parsedPreview.error) {
      setError(parsedPreview.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await exportSplitDocuments(rangeText, mode);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Split export failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500">
              <Scissors className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="split-modal-title"
                className="text-base font-semibold text-slate-900 dark:text-slate-100"
              >
                Split & Extract Pages
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Total pages in document: {pages.length}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close split modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="split-range-input"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Page Ranges (e.g. 1-3, 5, 7-9)
              </label>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => setRangeText(`1-${pages.length}`)}
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const odd = pages
                      .map((_, i) => i + 1)
                      .filter((n) => n % 2 === 1)
                      .join(', ');
                    setRangeText(odd);
                  }}
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Odd
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const even = pages
                      .map((_, i) => i + 1)
                      .filter((n) => n % 2 === 0)
                      .join(', ');
                    if (even) setRangeText(even);
                  }}
                  className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Even
                </button>
              </div>
            </div>
            <input
              id="split-range-input"
              type="text"
              value={rangeText}
              onChange={(e) => {
                setRangeText(e.target.value);
                setError(null);
              }}
              placeholder="1-3, 5"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
            {parsedPreview.error ? (
              <p className="mt-1.5 text-xs text-red-500">{parsedPreview.error}</p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                Selected {parsedPreview.allIndices.length} page(s) across{' '}
                {parsedPreview.groups.length} range group(s).
              </p>
            )}
          </div>

          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Output Format
            </span>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <input
                type="radio"
                name="split-mode"
                checked={mode === 'single-pdf'}
                onChange={() => setMode('single-pdf')}
                className="text-blue-600"
              />
              <FileOutput className="h-4 w-4 text-blue-500" />
              <div className="text-xs">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Single Extracted PDF
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Combine selected pages into one new PDF file
                </div>
              </div>
            </label>

            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <input
                type="radio"
                name="split-mode"
                checked={mode === 'split-zip-by-range'}
                onChange={() => setMode('split-zip-by-range')}
                className="text-blue-600"
              />
              <FileArchive className="h-4 w-4 text-emerald-500" />
              <div className="text-xs">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Split by Range Groups (.zip)
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Creates {parsedPreview.groups.length || 1} PDF file(s) bundled with JSZip
                </div>
              </div>
            </label>

            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50">
              <input
                type="radio"
                name="split-mode"
                checked={mode === 'split-zip-per-page'}
                onChange={() => setMode('split-zip-per-page')}
                className="text-blue-600"
              />
              <FileArchive className="h-4 w-4 text-violet-500" />
              <div className="text-xs">
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  One PDF Per Page (.zip)
                </div>
                <div className="text-slate-500 dark:text-slate-400">
                  Explode selected pages into individual PDFs in a ZIP archive
                </div>
              </div>
            </label>
          </div>

          {error && <p className="text-xs font-medium text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={Boolean(parsedPreview.error) || busy}
              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {busy ? 'Generating…' : mode === 'single-pdf' ? 'Extract PDF' : 'Export ZIP'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
