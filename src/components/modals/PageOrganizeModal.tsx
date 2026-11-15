import { useRef, useState } from 'react';
import {
  Copy,
  FilePlus2,
  RotateCcw,
  RotateCw,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import { FilePlus } from 'lucide-react';
import { insertBlankPageInDocument, mergePdfFile } from '@/engine/documentController';
import { useEditorStore } from '@/store/useEditorStore';
import { ThumbnailItem } from '@/components/sidebar/ThumbnailItem';

export function PageOrganizeModal() {
  const open = useEditorStore((s) => s.organizeModalOpen);
  const setOpen = useEditorStore((s) => s.setOrganizeModalOpen);
  const pages = useEditorStore((s) => s.pages);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);
  const selectPageWithModifiers = useEditorStore((s) => s.selectPageWithModifiers);
  const setSelectedPages = useEditorStore((s) => s.setSelectedPages);
  const reorderPages = useEditorStore((s) => s.reorderPages);
  const rotatePages = useEditorStore((s) => s.rotatePages);
  const duplicatePages = useEditorStore((s) => s.duplicatePages);
  const deletePages = useEditorStore((s) => s.deletePages);
  const setSplitModalOpen = useEditorStore((s) => s.setSplitModalOpen);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const mergeInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const targetIds = selectedPageIds.length > 0 ? selectedPageIds : pages.slice(0, 1).map((p) => p.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="organize-modal-title"
    >
      <div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div>
            <h2
              id="organize-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Organize Pages ({pages.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Drag cards to reorder. Ctrl/Cmd+Click to select multiple pages for batch actions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedPages(pages.map((p) => p.id))}
              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => rotatePages(targetIds, -90)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Rotate Left
            </button>
            <button
              type="button"
              onClick={() => rotatePages(targetIds, 90)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Rotate Right
            </button>
            <button
              type="button"
              onClick={() => duplicatePages(targetIds)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Copy className="h-3.5 w-3.5" />
              Duplicate
            </button>
            <button
              type="button"
              data-testid="organize-add-blank-page-btn"
              onClick={() => void insertBlankPageInDocument()}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
            >
              <FilePlus className="h-3.5 w-3.5" />
              + Boş Sayfa
            </button>
            <button
              type="button"
              disabled={pages.length - targetIds.length < 1}
              onClick={() => deletePages(targetIds)}
              className="inline-flex items-center gap-1 rounded-lg border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
            <button
              type="button"
              onClick={() => mergeInputRef.current?.click()}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              Merge PDF
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
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setSplitModalOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
            >
              <Scissors className="h-3.5 w-3.5" />
              Split / Extract
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label="Close organizer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {pages.map((page, index) => (
            <div
              key={page.id}
              draggable
              onDragStart={(e) => {
                setDragIndex(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDropIndex(index);
              }}
              onDrop={(e) => {
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
              className={`rounded-xl p-1 transition ${
                dropIndex === index ? 'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-slate-950' : ''
              }`}
            >
              <ThumbnailItem
                page={page}
                pageIndex={index}
                isActive={selectedPageIds.includes(page.id)}
                totalPages={pages.length}
                scale={0.28}
                onSelect={(mods) => selectPageWithModifiers(page.id, mods)}
                onRotateCW={() => rotatePages([page.id], 90)}
                onDuplicate={() => duplicatePages([page.id])}
                onDelete={() => deletePages([page.id])}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
