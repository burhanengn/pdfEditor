import { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Layers } from 'lucide-react';
import type { PdfOutlineNode } from '@/engine/pdfium/pdfiumTypes';
import { useLayoutClass } from '@/hooks/useLayoutClass';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';
import { Sheet } from '../common/Sheet';
import { ThumbnailItem } from '../sidebar/ThumbnailItem';
import { VirtualThumbnailGrid } from '../sidebar/VirtualThumbnailGrid';

function OutlineTreeNode({
  node,
  depth,
  onJumpToPage,
}: {
  node: PdfOutlineNode;
  depth: number;
  onJumpToPage: (pageIndex: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className="flex min-h-[44px] items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={expanded ? 'Collapse section' : 'Expand section'}
            onClick={() => setExpanded((v) => !v)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-8 w-4 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => {
            if (node.pageIndex !== null) {
              onJumpToPage(node.pageIndex);
            }
          }}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="truncate font-medium">{node.title}</span>
          {node.pageIndex !== null && (
            <span className="shrink-0 text-xs tabular-nums text-slate-400">
              {node.pageIndex + 1}
            </span>
          )}
        </button>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <OutlineTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onJumpToPage={onJumpToPage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface NavigatorDrawerProps {
  onJumpToPage: (pageIndex: number) => void;
}

export function NavigatorDrawer({ onJumpToPage }: NavigatorDrawerProps) {
  const { t } = useI18n();
  const { layoutClass } = useLayoutClass();
  const pages = useEditorStore((s) => s.pages);
  const appMode = useEditorStore((s) => s.appMode);
  const activePageId = useEditorStore((s) => s.activePageId);
  const selectedPageIds = useEditorStore((s) => s.selectedPageIds);
  const setActivePage = useEditorStore((s) => s.setActivePage);
  const selectPageWithModifiers = useEditorStore((s) => s.selectPageWithModifiers);
  const rotatePages = useEditorStore((s) => s.rotatePages);
  const duplicatePages = useEditorStore((s) => s.duplicatePages);
  const deletePages = useEditorStore((s) => s.deletePages);

  const navigatorOpen = useViewerStore((s) => s.navigatorOpen);
  const setNavigatorOpen = useViewerStore((s) => s.setNavigatorOpen);
  const navigatorTab = useViewerStore((s) => s.navigatorTab);
  const setNavigatorTab = useViewerStore((s) => s.setNavigatorTab);
  const outline = useViewerStore((s) => s.outline);

  if (pages.length === 0) return null;

  const hasOutline = outline.length > 0;
  const effectiveTab = hasOutline ? navigatorTab : 'pages';

  const content = (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasOutline && (
        <div className="flex border-b border-slate-200 px-3 py-1.5 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setNavigatorTab('pages')}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${
              effectiveTab === 'pages'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <Layers className="h-4 w-4" />
            <span>{t('nav.pages')}</span>
          </button>
          <button
            type="button"
            onClick={() => setNavigatorTab('outline')}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold ${
              effectiveTab === 'outline'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'
            }`}
          >
            <FileText className="h-4 w-4" />
            <span>{t('nav.outline')}</span>
          </button>
        </div>
      )}

      {effectiveTab === 'outline' && hasOutline ? (
        <div className="flex-1 overflow-y-auto p-2">
          {outline.map((node) => (
            <OutlineTreeNode
              key={node.id}
              node={node}
              depth={0}
              onJumpToPage={(idx) => {
                onJumpToPage(idx);
                if (layoutClass !== 'expanded') setNavigatorOpen(false);
              }}
            />
          ))}
        </div>
      ) : (
        <VirtualThumbnailGrid
          pages={pages}
          columns={layoutClass === 'compact' ? 3 : 2}
          estimateRowHeightPx={195}
          gapPx={10}
          className="p-2.5"
          renderItem={(page, idx) => (
            <ThumbnailItem
              key={page.id}
              page={page}
              pageIndex={idx}
              isActive={activePageId === page.id || selectedPageIds.includes(page.id)}
              totalPages={pages.length}
              scale={0.18}
              showEditActions={appMode === 'edit'}
              testIdPrefix="nav-thumb-"
              onSelect={(mods) => {
                if (appMode === 'edit') {
                  selectPageWithModifiers(page.id, mods);
                } else {
                  setActivePage(page.id);
                }
                if (!mods.shiftKey && !mods.ctrlOrMetaKey) {
                  onJumpToPage(idx);
                  if (layoutClass !== 'expanded') setNavigatorOpen(false);
                }
              }}
              onRotateCW={() => rotatePages([page.id], 90)}
              onDuplicate={() => duplicatePages([page.id])}
              onDelete={() => deletePages([page.id])}
            />
          )}
        />
      )}
    </div>
  );

  // Mobile/Tablet uses unified Sheet (Full detent)
  if (layoutClass !== 'expanded') {
    return (
      <Sheet
        open={navigatorOpen}
        onClose={() => setNavigatorOpen(false)}
        title={effectiveTab === 'outline' ? t('nav.outline') : `${t('nav.pages')} (${pages.length})`}
        detent="full"
        allowedDetents={['half', 'full']}
        side="left"
        testId="viewer-navigator-sheet"
      >
        {content}
      </Sheet>
    );
  }

  return null;
}
