import { Eye, Layers, Lock, Trash2, Unlock } from 'lucide-react';
import { getElementLayerTier, type CanvasElement } from '@/types/elements';
import { useEditorStore } from '@/store/useEditorStore';

const TIER_LABELS: Array<{ tier: number; title: string }> = [
  { tier: 4, title: 'Foreground (Annotations & Signatures)' },
  { tier: 3, title: 'Content (Text & Shapes)' },
  { tier: 2, title: 'Midground (Images)' },
  { tier: 1, title: 'Background' },
];

export function ObjectsPanel() {
  const activePageId = useEditorStore((s) => s.activePageId);
  const pages = useEditorStore((s) => s.pages);
  const allElements = useEditorStore((s) => s.elements);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const selectElements = useEditorStore((s) => s.selectElements);
  const updateElements = useEditorStore((s) => s.updateElements);
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const extraction = useEditorStore((s) => (activePageId ? s.pageExtractions[activePageId] : undefined));
  const promoteDetectedImage = useEditorStore((s) => s.promoteDetectedImage);
  const promoteDetectedShape = useEditorStore((s) => s.promoteDetectedShape);

  const pageId = activePageId ?? pages[0]?.id;
  if (!pageId) return null;

  const pageElements = allElements.filter(
    (el) =>
      el.pageId === pageId &&
      !(
        (el.kind === 'text-edit' ||
          el.kind === 'image-replacement' ||
          el.kind === 'shape-replacement') &&
        el.deleted
      ),
  );

  const labelForElement = (el: CanvasElement): string => {
    switch (el.kind) {
      case 'text-add':
      case 'text-edit':
        return el.text.trim().slice(0, 26) || 'Text block';
      case 'image':
      case 'image-replacement':
        return el.name || 'Image';
      case 'signature':
        return el.label || 'Signature';
      case 'shape':
        return `Shape (${el.shapeType})`;
      case 'shape-replacement':
        return 'Background shape';
      case 'path':
        return el.closed ? 'Closed path' : 'Line / Path';
      case 'stroke':
        return 'Freehand ink';
      case 'highlight':
        return el.shape === 'redact' ? 'Redaction' : 'Highlight';
    }
  };

  return (
    <div data-testid="objects-panel" className="flex flex-col gap-3 p-3 text-xs">
      <div className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        <Layers className="h-4 w-4" />
        <span>Objects ({pageElements.length})</span>
      </div>

      {TIER_LABELS.map(({ tier, title }) => {
        const items = pageElements
          .filter((el) => getElementLayerTier(el) === tier)
          .sort((a, b) => b.zIndex - a.zIndex);
        if (items.length === 0) return null;

        return (
          <div key={tier} className="space-y-1">
            <div className="px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {title}
            </div>
            {items.map((el) => {
              const selected = selectedElementIds.includes(el.id);
              return (
                <div
                  key={el.id}
                  onClick={() => selectElements([el.id])}
                  className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 transition ${
                    selected
                      ? 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate font-medium">{labelForElement(el)}</span>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label={el.locked ? 'Unlock object' : 'Lock object'}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateElements([{ id: el.id, patch: { locked: !el.locked } }], true);
                      }}
                      className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                    >
                      {el.locked ? <Lock className="h-4 w-4 text-amber-500" /> : <Unlock className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      aria-label="Delete object"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteElements([el.id]);
                      }}
                      className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-950/50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Background detected objects selectable directly from Objects panel (02 §5.6) */}
      {extraction && (extraction.images.some((i) => i.isBackgroundLayer) || (extraction.shapes ?? []).some((s) => s.isBackgroundLayer)) && (
        <div className="space-y-1 border-t border-slate-200 pt-2 dark:border-slate-800">
          <div className="px-1 text-xs font-semibold text-slate-500 dark:text-slate-400">
            Detected Background Layers
          </div>
          {extraction.images
            .filter((i) => i.isBackgroundLayer)
            .map((img) => (
              <button
                key={img.id}
                type="button"
                onClick={() => promoteDetectedImage(img, true)}
                className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-left hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <span className="truncate">{img.resourceName}</span>
                <Eye className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            ))}
          {(extraction.shapes ?? [])
            .filter((s) => s.isBackgroundLayer)
            .map((shp) => (
              <button
                key={shp.id}
                type="button"
                onClick={() => promoteDetectedShape(shp, true)}
                className="flex min-h-[44px] w-full items-center justify-between rounded-lg border border-dashed border-slate-300 px-2.5 py-1.5 text-left hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                <span className="truncate">Background Shape #{shp.operatorIndex}</span>
                <Eye className="h-4 w-4 shrink-0 text-slate-400" />
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
