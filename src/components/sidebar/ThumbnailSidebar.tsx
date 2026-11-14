import { useRef, useState, type DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FilePlus2, Layers } from 'lucide-react';
import { mergePdfFile } from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';
import { ThumbnailItem } from './ThumbnailItem';

interface ThumbnailSidebarProps {
  onScrollToPage: (pageIndex: number) => void;
}

export function ThumbnailSidebar({ onScrollToPage }: ThumbnailSidebarProps) {
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);
  const selectPageWithModifiers = useEditorStore((s) => s.selectPageWithModifiers);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const rotatePages = useEditorStore((s) => s.rotatePages);
  const duplicatePages = useEditorStore((s) => s.duplicatePages);
  const deletePages = useEditorStore((s) => s.deletePages);

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
      className={`relative hidden h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950 md:flex ${
        fileDropActive ? 'ring-2 ring-inset ring-blue-500' : ''
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Pages ({pages.length})
          </span>
        </div>
        <button
          type="button"
          title="Merge PDF into document"
          onClick={() => mergeInputRef.current?.click()}
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/50"
        >
          <FilePlus2 className="h-3.5 w-3.5" />
          Merge
        </button>
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

      {pages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-slate-400">
          Open a PDF to view page thumbnails
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
                    draggable
                    onDragStart={(e) => {
                      setDragIndex(index);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(index));
                    }}
                    onDragOver={(e) => {
                      if (!e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        setDropIndex(index);
                      }
                    }}
                    onDrop={(e) => {
                      if (e.dataTransfer.types.includes('Files')) return;
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
                      onSelect={(mods) => {
                        selectPageWithModifiers(page.id, mods);
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
