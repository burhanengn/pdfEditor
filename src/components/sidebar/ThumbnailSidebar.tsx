import { useRef, useState, type DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FilePlus, FilePlus2, FileText, Layers } from 'lucide-react';
import { createBlankDocument, insertBlankPageInDocument, mergePdfFile } from '@/engine/documentController';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';
import { ThumbnailItem } from './ThumbnailItem';

interface ThumbnailSidebarProps {
  onScrollToPage: (pageIndex: number) => void;
}

export function ThumbnailSidebar({ onScrollToPage }: ThumbnailSidebarProps) {
  const { t } = useI18n();
  const pages = useEditorStore((s) => s.pages);
  const appMode = useEditorStore((s) => s.appMode);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);
  const selectPageWithModifiers = useEditorStore((s) => s.selectPageWithModifiers);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const rotatePages = useEditorStore((s) => s.rotatePages);
  const duplicatePages = useEditorStore((s) => s.duplicatePages);
  const deletePages = useEditorStore((s) => s.deletePages);

  const navigatorOpen = useViewerStore((s) => s.navigatorOpen);
  const navigatorTab = useViewerStore((s) => s.navigatorTab);
  const setNavigatorTab = useViewerStore((s) => s.setNavigatorTab);
  const outline = useViewerStore((s) => s.outline);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [fileDropActive, setFileDropActive] = useState(false);

  const virtualizer = useVirtualizer({
    count: pages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 210,
    overscan: 6,
  });

  // In Viewer mode, drawer is collapsible and closed by default (02 §3.1)
  if (appMode === 'view' && !navigatorOpen) {
    return null;
  }

  const hasOutline = outline.length > 0;
  const activeTab = hasOutline ? navigatorTab : 'pages';

  const handleSidebarDrop = (e: DragEvent<HTMLDivElement>) => {
    setFileDropActive(false);
    const files = [...(e.dataTransfer.files ?? [])].filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    if (files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        for (const f of files) {
          await mergePdfFile(f);
        }
      })();
    }
  };

  return (
    <aside
      data-testid="thumbnail-sidebar"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setFileDropActive(true);
        }
      }}
      onDragLeave={() => setFileDropActive(false)}
      onDrop={handleSidebarDrop}
      className={`relative hidden h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 md:flex ${
        fileDropActive ? 'ring-2 ring-inset ring-blue-500' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          <Layers className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            {t('nav.pages')} ({pages.length})
          </span>
        </div>
        {appMode === 'edit' && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              title="Insert blank page"
              data-testid="sidebar-add-blank-page-btn"
              onClick={() => void insertBlankPageInDocument()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
            >
              <FilePlus className="h-3.5 w-3.5" />
              <span>+</span>
            </button>
            <button
              type="button"
              title="Merge PDF into document"
              onClick={() => mergeInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              <span>Merge</span>
            </button>
          </div>
        )}
        <input
          ref={mergeInputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void mergePdfFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {hasOutline && (
        <div className="flex border-b border-slate-200 p-1 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setNavigatorTab('pages')}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold ${
              activeTab === 'pages'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            {t('nav.pages')}
          </button>
          <button
            type="button"
            onClick={() => setNavigatorTab('outline')}
            className={`inline-flex flex-1 items-center justify-center gap-1 rounded-md py-1.5 text-xs font-semibold ${
              activeTab === 'outline'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>{t('nav.outline')}</span>
          </button>
        </div>
      )}

      {pages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 p-4 text-center text-xs text-slate-400">
          <span>Open a PDF or start with a blank page</span>
          <button
            type="button"
            data-testid="sidebar-blank-start-btn"
            onClick={() => void createBlankDocument()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700/50 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
          >
            <FilePlus className="h-3.5 w-3.5" />
            {t('action.startBlank')}
          </button>
        </div>
      ) : activeTab === 'outline' && hasOutline ? (
        <div className="flex-1 overflow-y-auto p-2 text-xs">
          {outline.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => {
                if (node.pageIndex !== null) onScrollToPage(node.pageIndex);
              }}
              className="flex min-h-[36px] w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-slate-700 hover:bg-slate-200/60 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <span className="truncate font-medium">{node.title}</span>
              {node.pageIndex !== null && (
                <span className="shrink-0 tabular-nums text-slate-400">{node.pageIndex + 1}</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-2.5 py-3">
          <div
            role="listbox"
            aria-label="Document pages"
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vItem) => {
              const index = vItem.index;
              const page = pages[index];
              const isActive =
                activePageId === page.id || selectedPageIds.includes(page.id);

              return (
                <div
                  key={page.id}
                  data-index={index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vItem.start}px)`,
                  }}
                  className="pb-2.5"
                >
                  <div
                    draggable={appMode === 'edit'}
                    onDragStart={(e) => {
                      if (appMode !== 'edit') return;
                      setDragIndex(index);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragOver={(e) => {
                      if (appMode === 'edit' && !e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        setDropIndex(index);
                      }
                    }}
                    onDrop={(e) => {
                      if (appMode !== 'edit' || e.dataTransfer.types.includes('Files')) return;
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== index) {
                        reorderPages(dragIndex, index);
                      }
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropIndex(null);
                    }}
                    className={`rounded-lg transition ${
                      dropIndex === index && dragIndex !== index
                        ? 'ring-2 ring-blue-500'
                        : ''
                    }`}
                  >
                    <ThumbnailItem
                      page={page}
                      pageIndex={index}
                      isActive={isActive}
                      totalPages={pages.length}
                      showEditActions={appMode === 'edit'}
                      onSelect={(mods) => {
                        if (appMode === 'edit') {
                          selectPageWithModifiers(page.id, mods);
                        } else {
                          setActivePage(page.id);
                        }
                        if (!mods.shiftKey && !mods.ctrlOrMetaKey) {
                          onScrollToPage(index);
                        }
                      }}
                      onRotateCW={() => rotatePages([page.id], 90)}
                      onDuplicate={() => duplicatePages([page.id])}
                      onDelete={() => deletePages([page.id])}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {fileDropActive && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-blue-600/15 backdrop-blur-[1px]">
          <div className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow">
            Drop PDF to Merge
          </div>
        </div>
      )}
    </aside>
  );
}
