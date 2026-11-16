import {
  FileSignature,
  Highlighter,
  Layers,
  MousePointer2,
  PenTool,
  Share2,
  SlidersHorizontal,
  Type,
  Wrench,
} from 'lucide-react';
import { useEditorStore, type MobileSheetTab } from '@/store/useEditorStore';

export function MobileBottomDock() {
  const pages = useEditorStore((s) => s.pages);
  const appMode = useEditorStore((s) => s.appMode);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const toolMode = useEditorStore((s) => s.toolMode);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const setSignatureModalOpen = useEditorStore((s) => s.setSignatureModalOpen);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const setMobileSheet = useEditorStore((s) => s.setMobileSheet);
  const setMobileInspectorSnap = useEditorStore((s) => s.setMobileInspectorSnap);

  // Viewer mode has zero persistent editing dock clutter (02 §7, 03 §2.4)
  if (appMode !== 'edit' || pages.length === 0) return null;

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
      aria-label="Editor Tool Strip"
      data-testid="mobile-bottom-dock"
      style={{ touchAction: 'pan-x' }}
      className="safe-pb z-30 shrink-0 border-t border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 md:hidden"
    >
      <div className="flex h-14 items-center gap-1 overflow-x-auto px-2">
        <button
          type="button"
          data-testid="mobile-tool-select"
          onClick={() => setToolMode('select')}
          className={`flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            toolMode === 'select'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <MousePointer2 className="h-5 w-5" />
          <span>Select</span>
        </button>

        <button
          type="button"
          data-testid="mobile-tool-text-quick"
          onClick={() => setToolMode('text')}
          className={`flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            toolMode === 'text'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <Type className="h-5 w-5" />
          <span>Text</span>
        </button>

        <button
          type="button"
          data-testid="mobile-tool-draw-quick"
          onClick={() => setToolMode('draw')}
          className={`flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            toolMode === 'draw'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <PenTool className="h-5 w-5" />
          <span>Draw</span>
        </button>

        <button
          type="button"
          data-testid="mobile-tool-highlight-quick"
          onClick={() => setToolMode('highlight')}
          className={`flex min-h-[44px] min-w-[56px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            toolMode === 'highlight'
              ? 'bg-blue-600 text-white'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <Highlighter className="h-5 w-5" />
          <span>Mark</span>
        </button>

        <button
          type="button"
          data-testid="mobile-tool-sign-quick"
          onClick={() => setSignatureModalOpen(true)}
          className="flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          <FileSignature className="h-5 w-5" />
          <span>Sign</span>
        </button>

        <button
          type="button"
          data-testid="mobile-dock-tools"
          onClick={() => toggleTab('tools')}
          className={`flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            mobileSheet === 'tools'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <Wrench className="h-5 w-5" />
          <span>More</span>
        </button>

        <button
          type="button"
          data-testid="mobile-dock-pages"
          onClick={() => toggleTab('pages')}
          className={`flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            mobileSheet === 'pages'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <Layers className="h-5 w-5" />
          <span>Pages</span>
        </button>

        <button
          type="button"
          data-testid="mobile-dock-inspector"
          onClick={() => toggleTab('inspector')}
          className={`relative flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            mobileSheet === 'inspector'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <SlidersHorizontal className="h-5 w-5" />
          {hasSelection && (
            <span className="absolute right-2 top-1.5 h-2 w-2 rounded-full bg-emerald-500" />
          )}
          <span>Props</span>
        </button>

        <button
          type="button"
          data-testid="mobile-dock-export"
          onClick={() => toggleTab('export')}
          className={`flex min-h-[44px] min-w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-xs font-medium ${
            mobileSheet === 'export'
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
          }`}
        >
          <Share2 className="h-5 w-5" />
          <span>Share</span>
        </button>
      </div>
    </nav>
  );
}
