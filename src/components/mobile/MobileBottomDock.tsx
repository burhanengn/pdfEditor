import { Layers, Share2, SlidersHorizontal, Wrench } from 'lucide-react';
import { useEditorStore, type MobileSheetTab } from '@/store/useEditorStore';

export function MobileBottomDock() {
  const pages = useEditorStore((s) => s.pages);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const toolMode = useEditorStore((s) => s.toolMode);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setMobileInspectorSnap = useEditorStore((s) => s.setMobileInspectorSnap);

  const hasPages = pages.length > 0;
  const hasSelection = selectedElementIds.length > 0;

  const toggleTab = (tab: Exclude<MobileSheetTab, 'none'>) => {
    if (mobileSheet === tab) {
      setMobileSheet('none');
      return;
    }
    if (tab === 'inspector') {
      setMobileInspectorSnap('half');
    }
    setMobileSheet(tab);
  };

  return (
    <nav
      aria-label="Mobile Bottom Navigation"
      data-testid="mobile-bottom-dock"
      className="safe-pb z-30 shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
    >
      <div className="grid h-16 grid-cols-4 items-center px-1.5">
        <button
          type="button"
          disabled={!hasPages}
          data-testid="mobile-dock-pages"
          onClick={() => toggleTab('pages')}
          className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition disabled:opacity-40 ${
            mobileSheet === 'pages'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <div className="relative">
            <Layers className="h-5 w-5" />
            {hasPages && (
              <span className="absolute -right-2.5 -top-1 rounded-full bg-slate-200 px-1 text-[9px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {pages.length}
              </span>
            )}
          </div>
          <span>Sayfalar</span>
        </button>

        <button
          type="button"
          data-testid="mobile-dock-tools"
          onClick={() => toggleTab('tools')}
          className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition ${
            mobileSheet === 'tools'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <div className="relative">
            <Wrench className="h-5 w-5" />
            {toolMode !== 'select' && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-blue-500" />
            )}
          </div>
          <span>Araçlar</span>
        </button>

        <button
          type="button"
          disabled={!hasPages}
          data-testid="mobile-dock-inspector"
          onClick={() => toggleTab('inspector')}
          className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition disabled:opacity-40 ${
            mobileSheet === 'inspector'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <div className="relative">
            <SlidersHorizontal className="h-5 w-5" />
            {hasSelection && (
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </div>
          <span>Özellikler</span>
        </button>

        <button
          type="button"
          disabled={!hasPages}
          data-testid="mobile-dock-export"
          onClick={() => toggleTab('export')}
          className={`relative flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-medium transition disabled:opacity-40 ${
            mobileSheet === 'export'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <Share2 className="h-5 w-5" />
          <span>Paylaş</span>
        </button>
      </div>
    </nav>
  );
}
