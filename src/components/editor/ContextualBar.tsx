import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Bold,
  Crop,
  Italic,
  Minus,
  Plus,
  Spline,
  Trash2,
} from 'lucide-react';
import { useLayoutClass } from '@/hooks/useLayoutClass';
import { pointIsSmooth } from '@/engine/vectorShapes';
import { useEditorStore } from '@/store/useEditorStore';
import type { AlignAction } from '@/utils/alignment';

/**
 * Contextual Selection Strip (02 §5.5, 03 §2.4):
 * Shows up to 6 high-frequency controls for the selected element(s) without crowding persistent chrome.
 */
export function ContextualBar() {
  const { layoutClass } = useLayoutClass();
  const appMode = useEditorStore((s) => s.appMode);
  const mobileSheet = useEditorStore((s) => s.mobileSheet);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const editingPathElementId = useEditorStore((s) => s.editingPathElementId);
  const selectedPathVertexIndices = useEditorStore((s) => s.selectedPathVertexIndices);
  const elements = useEditorStore((s) => s.elements);
  const updateElements = useEditorStore((s) => s.updateElements);
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const setCroppingImageElementId = useEditorStore((s) => s.setCroppingImageElementId);
  const alignSelectedElements = useEditorStore((s) => s.alignSelectedElements);
  const togglePathVerticesSmooth = useEditorStore((s) => s.togglePathVerticesSmooth);
  const deletePathVertices = useEditorStore((s) => s.deletePathVertices);

  if (appMode !== 'edit' || selectedElementIds.length === 0) return null;
  if (layoutClass !== 'expanded' && mobileSheet === 'inspector') return null;

  const selected = elements.filter((el) => selectedElementIds.includes(el.id));
  if (selected.length === 0) return null;

  const first = selected[0];
  const isCompact = layoutClass === 'compact';

  return (
    <div
      data-testid="contextual-bar"
      role="toolbar"
      aria-label="Selection contextual controls"
      className={
        isCompact
          ? 'fixed bottom-[calc(env(safe-area-inset-bottom,0px)+64px)] left-2 right-2 z-30 flex h-12 items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 px-2 shadow-xl backdrop-blur touch-pan-x dark:border-slate-700 dark:bg-slate-900/95'
          : 'fixed bottom-4 left-1/2 z-30 flex h-12 -translate-x-1/2 items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-3 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95'
      }
    >
      {selected.length === 1 && (first.kind === 'text-add' || first.kind === 'text-edit') && (
        <>
          <button
            type="button"
            aria-label="Decrease font size"
            onClick={() =>
              updateElements(
                [{ id: first.id, patch: { fontSize: Math.max(6, first.fontSize - 1) } }],
                true,
              )
            }
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span className="px-1 text-xs font-semibold tabular-nums">{Math.round(first.fontSize)}</span>
          <button
            type="button"
            aria-label="Increase font size"
            onClick={() =>
              updateElements(
                [{ id: first.id, patch: { fontSize: Math.min(96, first.fontSize + 1) } }],
                true,
              )
            }
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Bold"
            onClick={() => updateElements([{ id: first.id, patch: { bold: !first.bold } }], true)}
            className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg ${
              first.bold ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Italic"
            onClick={() =>
              updateElements([{ id: first.id, patch: { italic: !first.italic } }], true)
            }
            className={`flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg ${
              first.italic ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Cycle text align"
            onClick={() => {
              const nextAlign =
                first.align === 'left'
                  ? 'center'
                  : first.align === 'center'
                    ? 'right'
                    : 'left';
              updateElements([{ id: first.id, patch: { align: nextAlign } }], true);
            }}
            className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {first.align === 'center' ? (
              <AlignCenter className="h-4 w-4" />
            ) : first.align === 'right' ? (
              <AlignRight className="h-4 w-4" />
            ) : (
              <AlignLeft className="h-4 w-4" />
            )}
          </button>
        </>
      )}

      {selected.length === 1 && (first.kind === 'image' || first.kind === 'image-replacement') && (
        <button
          type="button"
          onClick={() => setCroppingImageElementId(first.id)}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Crop className="h-4 w-4" />
          <span>Crop</span>
        </button>
      )}

      {selected.length === 1 && (
        <label className="inline-flex min-h-[40px] items-center gap-1.5 px-2 text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            {Math.round(first.opacity * 100)}%
          </span>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={first.opacity}
            aria-label="Opacity"
            onChange={(e) =>
              updateElements([{ id: first.id, patch: { opacity: Number(e.target.value) } }], true)
            }
            className="w-16 accent-blue-600"
          />
        </label>
      )}

      {selected.length === 1 &&
        first.kind === 'path' &&
        editingPathElementId === first.id &&
        selectedPathVertexIndices.length > 0 && (() => {
          const allVertsSmooth = selectedPathVertexIndices.every((idx) =>
            first.points[idx] ? pointIsSmooth(first.points[idx], Boolean(first.smooth)) : false,
          );
          return (
            <>
              <span className="px-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                {selectedPathVertexIndices.length} nokta
              </span>
              <button
                type="button"
                data-testid="contextual-vertex-smooth-btn"
                title={allVertsSmooth ? 'Seçili noktaları keskin yap' : 'Seçili noktaları eğri yap'}
                onClick={() =>
                  togglePathVerticesSmooth(
                    first.id,
                    selectedPathVertexIndices,
                    !allVertsSmooth,
                  )
                }
                className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold ${
                  allVertsSmooth
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <Spline className="h-3.5 w-3.5" />
                <span>{allVertsSmooth ? 'Keskin' : 'Eğri'}</span>
              </button>
              {first.points.length - selectedPathVertexIndices.length >= 2 && (
                <button
                  type="button"
                  data-testid="contextual-vertex-delete-btn"
                  title="Seçili noktaları sil"
                  onClick={() => deletePathVertices(first.id, selectedPathVertexIndices)}
                  className="inline-flex min-h-[36px] items-center justify-center rounded-lg px-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          );
        })()}

      {selected.length > 1 && (
        <>
          <span className="shrink-0 px-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            {selected.length} seçili
          </span>
          {(
            [
              ['left', AlignStartVertical, 'Sola Hizala'],
              ['center-h', AlignCenterVertical, 'Yatay Ortala'],
              ['right', AlignEndVertical, 'Sağa Hizala'],
              ['top', AlignStartHorizontal, 'Üste Hizala'],
              ['center-v', AlignCenterHorizontal, 'Dikey Ortala'],
              ['bottom', AlignEndHorizontal, 'Alta Hizala'],
            ] as Array<[AlignAction, typeof AlignStartVertical, string]>
          ).map(([action, Icon, label]) => (
            <button
              key={action}
              type="button"
              aria-label={label}
              title={label}
              data-testid={`contextual-align-${action}`}
              onClick={() => alignSelectedElements(action)}
              className="flex min-h-[36px] min-w-[34px] shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Icon className="h-4 w-4" />
            </button>
          ))}
          {selected.length >= 3 && (
            <>
              <button
                type="button"
                aria-label="Yatay Eşit Dağıt"
                title="Yatay Eşit Dağıt"
                data-testid="contextual-align-distribute-h"
                onClick={() => alignSelectedElements('distribute-h')}
                className="flex min-h-[36px] min-w-[34px] shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <AlignHorizontalDistributeCenter className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label="Dikey Eşit Dağıt"
                title="Dikey Eşit Dağıt"
                data-testid="contextual-align-distribute-v"
                onClick={() => alignSelectedElements('distribute-v')}
                className="flex min-h-[36px] min-w-[34px] shrink-0 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <AlignVerticalDistributeCenter className="h-4 w-4" />
              </button>
            </>
          )}
        </>
      )}

      <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-slate-700" />

      <button
        type="button"
        aria-label="Delete selected"
        onClick={() => deleteElements(selectedElementIds)}
        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
