import { Download, Share2, X } from 'lucide-react';
import {
  canUseWebSharePdf,
  exportCurrentPdf,
  shareCurrentPdf,
} from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';

export function MobileExportSheet() {
  const documentName = useEditorStore((s) => s.documentName);
  const pages = useEditorStore((s) => s.pages);
  const isLoading = useEditorStore((s) => s.isLoading);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);

  const webShareSupported = canUseWebSharePdf();

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col justify-end bg-slate-950/60 backdrop-blur-[1px] md:hidden"
      onClick={() => setMobileSheet('none')}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Dışa Aktar ve Paylaş"
        data-testid="mobile-export-sheet"
        onClick={(e) => e.stopPropagation()}
        className="safe-pb w-full rounded-t-2xl border-t border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <div className="min-w-0 pr-2">
            <h2 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
              Dışa Aktar & Paylaş
            </h2>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
              {documentName} • {pages.length} sayfa
            </p>
          </div>
          <button
            type="button"
            aria-label="Dışa aktarma panelini kapat"
            onClick={() => setMobileSheet('none')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-2.5 p-4">
          <button
            type="button"
            disabled={isLoading || pages.length === 0}
            data-testid="mobile-download-pdf-btn"
            onClick={() => {
              setMobileSheet('none');
              void exportCurrentPdf();
            }}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            <span>PDF İndir (Download)</span>
          </button>

          <button
            type="button"
            disabled={isLoading || pages.length === 0}
            data-testid="mobile-share-pdf-btn"
            onClick={() => {
              setMobileSheet('none');
              void shareCurrentPdf();
            }}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            <Share2 className="h-4 w-4 text-blue-500" />
            <span>
              {webShareSupported ? 'Paylaş (WhatsApp / Mail / AirDrop)' : 'Paylaş veya İndir'}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
