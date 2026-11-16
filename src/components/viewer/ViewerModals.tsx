import { useState } from 'react';
import { AlertTriangle, Check, Copy, FileDown, ShieldCheck, X } from 'lucide-react';
import {
  canOverwritePrimaryFile,
  overwriteOriginalPdf,
  savePdfAsCopy,
} from '@/engine/documentController';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';

export function GoToPageModal({ onJumpToPage }: { onJumpToPage: (idx: number) => void }) {
  const { t } = useI18n();
  const open = useViewerStore((s) => s.goToPageOpen);
  const setOpen = useViewerStore((s) => s.setGoToPageOpen);
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);

  const curIdx = Math.max(
    1,
    pages.findIndex((p) => p.id === activePageId) + 1,
  );
  const [val, setVal] = useState(String(curIdx));

  if (!open || pages.length === 0) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(val, 10);
    if (!Number.isNaN(num)) {
      const clamped = Math.max(1, Math.min(pages.length, num));
      onJumpToPage(clamped - 1);
      setOpen(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('nav.goToPage')}
      onClick={() => setOpen(false)}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {t('nav.goToPage')}
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('action.close')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className="block text-xs text-slate-500 dark:text-slate-400">
          1 – {pages.length}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={pages.length}
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base font-medium tabular-nums text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="min-h-[44px] rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
          >
            {t('action.cancel')}
          </button>
          <button
            type="submit"
            className="min-h-[44px] rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-500"
          >
            {t('nav.goToPage')}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * K7 Save Workflow Modal:
 * - Default primary action: "Save as copy"
 * - Secondary action: "Overwrite original" with first-use confirmation + "Don't ask again"
 */
export function SaveWorkflowModal() {
  const { t } = useI18n();
  const open = useViewerStore((s) => s.saveWorkflowOpen);
  const setOpen = useViewerStore((s) => s.setSaveWorkflowOpen);
  const dontAsk = useViewerStore((s) => s.overwriteConfirmDontAskAgain);
  const setDontAsk = useViewerStore((s) => s.setOverwriteConfirmDontAskAgain);

  const [confirmStep, setConfirmStep] = useState(false);
  const [dontAskChecked, setDontAskChecked] = useState(dontAsk);

  if (!open) return null;

  const canOverwrite = canOverwritePrimaryFile();

  const handleSaveAsCopy = () => {
    setOpen(false);
    setConfirmStep(false);
    void savePdfAsCopy();
  };

  const handleOverwriteClick = () => {
    if (!canOverwrite) {
      handleSaveAsCopy();
      return;
    }
    if (dontAsk) {
      setOpen(false);
      void overwriteOriginalPdf();
      return;
    }
    setConfirmStep(true);
  };

  const handleConfirmOverwrite = () => {
    if (dontAskChecked) {
      setDontAsk(true);
    }
    setOpen(false);
    setConfirmStep(false);
    void overwriteOriginalPdf();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('action.save')}
      onClick={() => {
        setConfirmStep(false);
        setOpen(false);
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        {!confirmStep ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('action.save')}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={t('action.close')}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                data-testid="save-as-copy-btn"
                onClick={handleSaveAsCopy}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow hover:bg-blue-500"
              >
                <Copy className="h-5 w-5" />
                <span>{t('action.saveAsCopy')}</span>
              </button>
              <button
                type="button"
                data-testid="save-overwrite-btn"
                disabled={!canOverwrite}
                onClick={handleOverwriteClick}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileDown className="h-5 w-5" />
                <span>{t('action.overwriteOriginal')}</span>
              </button>
              {!canOverwrite && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Original file handle is read-only in this browser context; saving as a copy preserves your original file.
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {t('save.overwriteConfirmTitle')}
              </h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('save.overwriteConfirmBody')}
            </p>
            <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={dontAskChecked}
                onChange={(e) => setDontAskChecked(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-blue-600"
              />
              <span>{t('save.dontAskAgain')}</span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmStep(false)}
                className="min-h-[44px] rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700 dark:border-slate-700 dark:text-slate-200"
              >
                {t('action.cancel')}
              </button>
              <button
                type="button"
                data-testid="confirm-overwrite-btn"
                onClick={handleConfirmOverwrite}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-500"
              >
                <Check className="h-4 w-4" />
                <span>{t('action.overwriteOriginal')}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function OpenSourceLicensesModal() {
  const { t } = useI18n();
  const open = useViewerStore((s) => s.openSourceLicensesOpen);
  const setOpen = useViewerStore((s) => s.setOpenSourceLicensesOpen);

  if (!open) return null;

  const libs = [
    { name: 'PDFium', license: 'Apache-2.0 / BSD-3-Clause', note: 'Core PDF rendering, text, search, and document engine' },
    { name: '@embedpdf/pdfium', license: 'MIT', note: 'WebAssembly PDFium wrapper' },
    { name: 'pdfium-render', license: 'MIT / Apache-2.0', note: 'Rust idiomatic PDFium bindings' },
    { name: 'React & Zustand', license: 'MIT', note: 'Web UI and state management' },
    { name: 'Lucide Icons', license: 'ISC', note: 'Vector UI iconography' },
    { name: 'DejaVu & Liberation Fonts', license: 'Bitstream Vera / SIL OFL', note: 'Offline Unicode font fallback pack' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.licenses')}
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {t('settings.licenses')}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('action.close')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="max-h-[60vh] divide-y divide-slate-200 overflow-y-auto dark:divide-slate-800">
          {libs.map((l) => (
            <div key={l.name} className="py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {l.name}
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {l.license}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{l.note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
