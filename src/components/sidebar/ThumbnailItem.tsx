import { useEffect, useRef } from 'react';
import { Copy, RotateCw, Trash2 } from 'lucide-react';
import type { PageMeta } from '@/types/pdf';
import { getDisplayDimensions } from '@/engine/coordinates';
import { pdfjsService } from '@/engine/pdfjsService';
import { useEditorStore } from '@/store/useEditorStore';

interface ThumbnailItemProps {
  page: PageMeta;
  pageIndex: number;
  isActive: boolean;
  totalPages: number;
  scale?: number;
  testIdPrefix?: string;
  onSelect: (modifiers: { shiftKey: boolean; ctrlOrMetaKey: boolean }) => void;
  onRotateCW: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function ThumbnailItem({
  page,
  pageIndex,
  isActive,
  totalPages,
  scale = 0.22,
  testIdPrefix = 'thumbnail-page-',
  onSelect,
  onRotateCW,
  onDuplicate,
  onDelete,
}: ThumbnailItemProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceBytes = useEditorStore((s) => s.sourceDocs[page.sourceDocId]?.bytes);

  const dims = getDisplayDimensions(page.baseWidth, page.baseHeight, page.userRotation, scale);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sourceBytes) return;

    const handle = pdfjsService.renderPageToCanvas({
      sourceDocId: page.sourceDocId,
      bytes: sourceBytes,
      sourcePageIndex: page.sourcePageIndex,
      canvas,
      zoom: scale,
      userRotation: page.userRotation,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });

    handle.promise.catch(() => {
      // Cancelled or released during fast scroll
    });

    return () => {
      handle.cancel();
    };
  }, [page.sourceDocId, page.sourcePageIndex, page.userRotation, scale, sourceBytes]);

  return (
    <div
      role="option"
      aria-selected={isActive}
      aria-label={`Page ${pageIndex + 1}`}
      tabIndex={0}
      data-testid={`${testIdPrefix}${pageIndex + 1}`}
      onClick={(e) =>
        onSelect({ shiftKey: e.shiftKey, ctrlOrMetaKey: e.ctrlKey || e.metaKey })
      }
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect({ shiftKey: e.shiftKey, ctrlOrMetaKey: e.ctrlKey || e.metaKey });
        }
      }}
      className={`group relative flex flex-col items-center rounded-lg border p-2 transition select-none ${
        isActive
          ? 'border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30'
          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
      }`}
    >
      <div
        className="relative flex items-center justify-center overflow-hidden rounded bg-white shadow-sm ring-1 ring-slate-200 dark:ring-slate-700"
        style={{
          width: `${Math.max(40, Math.round(dims.width))}px`,
          height: `${Math.max(40, Math.round(dims.height))}px`,
          maxWidth: '100%',
        }}
      >
        <canvas ref={canvasRef} className="block max-h-full max-w-full object-contain" />
      </div>

      <div className="mt-1.5 flex w-full items-center justify-between px-1">
        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
          Page {pageIndex + 1}
        </span>
        {page.userRotation !== 0 && (
          <span className="rounded bg-slate-200 px-1 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            {page.userRotation}°
          </span>
        )}
      </div>

      {/* Hover Quick Actions */}
      <div className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-md border border-slate-200 bg-white/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900/95">
        <button
          type="button"
          title="Rotate 90° CW"
          aria-label={`Rotate page ${pageIndex + 1} clockwise`}
          onClick={(e) => {
            e.stopPropagation();
            onRotateCW();
          }}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <RotateCw className="h-3 w-3" />
        </button>
        <button
          type="button"
          title="Duplicate Page"
          aria-label={`Duplicate page ${pageIndex + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            onDuplicate();
          }}
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <Copy className="h-3 w-3" />
        </button>
        {totalPages > 1 && (
          <button
            type="button"
            title="Delete Page"
            aria-label={`Delete page ${pageIndex + 1}`}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/60 dark:hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
