import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Check, Plus, Spline, Trash2 } from 'lucide-react';
import type { VectorPathElement } from '@/types/elements';
import type { Point, RotationAngle } from '@/types/pdf';
import { pointBaseToDisplay, pointDisplayToBase } from '@/engine/coordinates';
import {
  denormalizePathPoints,
  findNearestOpenPathEndpoint,
  pointIsSmooth,
  type OpenPathSnapHit,
  type PathPoint,
} from '@/engine/vectorShapes';
import { useEditorStore } from '@/store/useEditorStore';

interface PathNodeEditorOverlayProps {
  element: VectorPathElement;
  peerPaths: VectorPathElement[];
  baseWidth: number;
  baseHeight: number;
  userRotation: RotationAngle;
  zoom: number;
  layerRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  beginTransaction: () => void;
  commitTransaction: () => void;
  abortTransaction: () => void;
  updatePathPoints: (
    id: string,
    absPoints: Point[],
    options?: { closed?: boolean; recordHistory?: boolean },
  ) => void;
  joinVectorPaths: (ids: string[]) => VectorPathElement | null;
}

export function PathNodeEditorOverlay({
  element,
  peerPaths,
  baseWidth,
  baseHeight,
  userRotation,
  zoom,
  layerRef,
  onClose,
  beginTransaction,
  commitTransaction,
  abortTransaction,
  updatePathPoints,
  joinVectorPaths,
}: PathNodeEditorOverlayProps) {
  const [snapTarget, setSnapTarget] = useState<{
    point: Point;
    kind: 'self-close' | 'join-peer';
  } | null>(null);
  const selectedIndices = useEditorStore((s) => s.selectedPathVertexIndices);
  const setSelectedPathVertexIndices = useEditorStore((s) => s.setSelectedPathVertexIndices);
  const togglePathVerticesSmooth = useEditorStore((s) => s.togglePathVerticesSmooth);
  const deletePathVertices = useEditorStore((s) => s.deletePathVertices);

  const absPts = denormalizePathPoints(element);
  if (absPts.length < 2) return null;

  const toBasePt = (clientX: number, clientY: number): Point => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return pointDisplayToBase(
      clientX - rect.left,
      clientY - rect.top,
      baseWidth,
      baseHeight,
      userRotation,
      zoom,
    );
  };

  const toDispPt = (pt: Point) => pointBaseToDisplay(pt.x, pt.y, baseWidth, baseHeight, userRotation, zoom);

  const startAnchorDrag = (
    e: ReactPointerEvent<HTMLButtonElement>,
    initialPts: PathPoint[],
    index: number,
    activeSelected: number[],
    alreadyBegunTransaction: boolean,
  ) => {
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic test pointer events
    }

    const originPt = initialPts[index];
    const movingIndices =
      activeSelected.length > 1 && activeSelected.includes(index) ? activeSelected : [index];
    const movingIndexSet = new Set(movingIndices);
    if (!alreadyBegunTransaction) {
      beginTransaction();
    }

    let aborted = false;
    let didMove = false;
    let workingPts = initialPts.map((p) => ({ ...p }));
    let activeSnap: { point: Point; kind: 'self-close' | 'join-peer'; peerId?: string } | null =
      null;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', abortGesture);
      window.removeEventListener('gullac:multitouch-start', abortGesture);
      try {
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore if released
      }
    };

    const abortGesture = () => {
      if (aborted) return;
      aborted = true;
      cleanup();
      setSnapTarget(null);
      abortTransaction();
    };

    const onMove = (me: PointerEvent) => {
      const store = useEditorStore.getState();
      if (aborted || store.isPinching || store.activeTouchCount >= 2) {
        abortGesture();
        return;
      }

      let cur = toBasePt(me.clientX, me.clientY);
      if (me.shiftKey && movingIndices.length === 1) {
        if (Math.abs(cur.x - originPt.x) >= Math.abs(cur.y - originPt.y)) {
          cur = { x: cur.x, y: originPt.y };
        } else {
          cur = { x: originPt.x, y: cur.y };
        }
      }

      activeSnap = null;
      const snapRadius = 11 / Math.max(0.25, zoom);
      const isSingleOpenEndpoint =
        movingIndices.length === 1 &&
        !element.closed &&
        (index === 0 || index === workingPts.length - 1);

      if (isSingleOpenEndpoint) {
        if (workingPts.length >= 3) {
          const otherEnd = index === 0 ? workingPts[workingPts.length - 1] : workingPts[0];
          if (Math.hypot(cur.x - otherEnd.x, cur.y - otherEnd.y) <= snapRadius) {
            cur = { ...otherEnd };
            activeSnap = { point: otherEnd, kind: 'self-close' };
          }
        }
        if (!activeSnap) {
          const peerHit: OpenPathSnapHit | null = findNearestOpenPathEndpoint(
            cur,
            peerPaths,
            snapRadius,
            new Set([element.id]),
          );
          if (peerHit) {
            cur = { ...peerHit.point };
            activeSnap = {
              point: peerHit.point,
              kind: 'join-peer',
              peerId: peerHit.elementId,
            };
          }
        }
      }

      const dx = cur.x - originPt.x;
      const dy = cur.y - originPt.y;
      if (Math.hypot(dx, dy) >= 1) {
        didMove = true;
      }
      setSnapTarget(activeSnap ? { point: activeSnap.point, kind: activeSnap.kind } : null);
      workingPts = initialPts.map((pt, i) =>
        movingIndexSet.has(i) ? { ...pt, x: pt.x + dx, y: pt.y + dy } : { ...pt },
      );
      updatePathPoints(element.id, workingPts, { recordHistory: false });
    };

    const onUp = () => {
      if (aborted) return;
      cleanup();
      setSnapTarget(null);

      if (!didMove) {
        abortTransaction();
        return;
      }

      if (activeSnap?.kind === 'self-close' && workingPts.length >= 3 && movingIndices.length === 1) {
        const trimmed = index === 0 ? workingPts.slice(1) : workingPts.slice(0, -1);
        updatePathPoints(element.id, trimmed, { closed: true, recordHistory: false });
        commitTransaction();
        return;
      }

      commitTransaction();

      if (activeSnap?.kind === 'join-peer' && activeSnap.peerId) {
        joinVectorPaths([element.id, activeSnap.peerId]);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', abortGesture);
    window.addEventListener('gullac:multitouch-start', abortGesture);
  };

  const handleAnchorPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (useEditorStore.getState().activeTouchCount >= 2 || useEditorStore.getState().isPinching) {
      return;
    }
    e.stopPropagation();

    if (e.altKey && absPts.length > 2) {
      deletePathVertices(element.id, [index]);
      return;
    }

    let nextSelected: number[];
    if (e.shiftKey) {
      nextSelected = selectedIndices.includes(index)
        ? selectedIndices.filter((i) => i !== index)
        : [...selectedIndices, index];
      setSelectedPathVertexIndices(nextSelected);
      if (!nextSelected.includes(index)) return;
    } else if (selectedIndices.includes(index) && selectedIndices.length > 1) {
      nextSelected = selectedIndices;
    } else {
      nextSelected = [index];
      setSelectedPathVertexIndices(nextSelected);
    }

    startAnchorDrag(e, absPts, index, nextSelected, false);
  };

  const handleMidpointPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, segIdx: number) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (useEditorStore.getState().activeTouchCount >= 2 || useEditorStore.getState().isPinching) {
      return;
    }
    e.stopPropagation();

    const a = absPts[segIdx];
    const b = absPts[(segIdx + 1) % absPts.length];
    const mid: PathPoint = {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      smooth: pointIsSmooth(element.points[segIdx], Boolean(element.smooth)),
    };

    beginTransaction();
    const inserted = [...absPts.slice(0, segIdx + 1), mid, ...absPts.slice(segIdx + 1)];
    updatePathPoints(element.id, inserted, { recordHistory: false });
    setSelectedPathVertexIndices([segIdx + 1]);
    startAnchorDrag(e, inserted, segIdx + 1, [segIdx + 1], true);
  };

  const dispPts = absPts.map(toDispPt);
  const segCount = element.closed ? absPts.length : absPts.length - 1;
  const topMostDispY = Math.min(...dispPts.map((p) => p.y));
  const avgDispX = dispPts.reduce((sum, p) => sum + p.x, 0) / dispPts.length;
  const snapDisp = snapTarget ? toDispPt(snapTarget.point) : null;
  const allSelectedSmooth =
    selectedIndices.length > 0 &&
    selectedIndices.every((idx) =>
      element.points[idx] ? pointIsSmooth(element.points[idx], Boolean(element.smooth)) : false,
    );

  return (
    <div data-testid={`path-node-editor-${element.id}`} className="pointer-events-none absolute inset-0" style={{ zIndex: 525 }}>
      {/* Skeleton wireframe guide connecting path anchors */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <path
          d={`M ${dispPts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}${element.closed ? ' Z' : ''}`}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={1.25}
          strokeDasharray="4 3"
        />
        {snapDisp && (
          <circle
            cx={snapDisp.x}
            cy={snapDisp.y}
            r={10}
            fill={snapTarget?.kind === 'join-peer' ? 'rgba(16, 185, 129, 0.25)' : 'rgba(59, 130, 246, 0.25)'}
            stroke={snapTarget?.kind === 'join-peer' ? '#10b981' : '#3b82f6'}
            strokeWidth={2}
          />
        )}
      </svg>

      {/* Midpoint '+' handles to insert new vertices on any segment */}
      {Array.from({ length: segCount }).map((_, idx) => {
        const a = dispPts[idx];
        const b = dispPts[(idx + 1) % dispPts.length];
        if (Math.hypot(b.x - a.x, b.y - a.y) < 18) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <button
            key={`mid-${idx}`}
            type="button"
            data-testid={`path-midpoint-handle-${idx}`}
            title="Sürükle veya tıkla: Yeni nokta ekle"
            onPointerDown={(e) => handleMidpointPointerDown(e, idx)}
            style={{
              position: 'absolute',
              left: `${mx - 7}px`,
              top: `${my - 7}px`,
              touchAction: 'none',
            }}
            className="pointer-events-auto flex h-3.5 w-3.5 items-center justify-center rounded-full border border-blue-500 bg-white/95 text-blue-600 shadow hover:scale-125"
          >
            <Plus className="h-2.5 w-2.5" />
          </button>
        );
      })}

      {/* Primary vertex anchor handles (circle = smooth corner, diamond = sharp corner) */}
      {dispPts.map((p, idx) => {
        const isVertSmooth = pointIsSmooth(element.points[idx], Boolean(element.smooth));
        const isVertSelected = selectedIndices.includes(idx);
        return (
          <button
            key={`anchor-${idx}`}
            type="button"
            data-testid={`path-anchor-handle-${idx}`}
            title="Sürükle: Taşı (Shift+Tık: Çoklu Seç, Alt+Tık / Çift tık: Sil)"
            onPointerDown={(e) => handleAnchorPointerDown(e, idx)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              if (absPts.length > 2) {
                deletePathVertices(element.id, [idx]);
              }
            }}
            style={{
              position: 'absolute',
              left: `${p.x - 6}px`,
              top: `${p.y - 6}px`,
              touchAction: 'none',
              transform: !isVertSmooth ? (isVertSelected ? 'rotate(45deg) scale(1.2)' : 'rotate(45deg)') : undefined,
            }}
            className={`pointer-events-auto h-3 w-3 border-2 shadow-sm transition-transform hover:scale-125 ${
              isVertSmooth ? 'rounded-full' : 'rounded-[1px]'
            } ${
              isVertSelected
                ? 'border-white bg-blue-600 ring-2 ring-blue-500 scale-125'
                : idx === 0
                  ? 'border-emerald-600 bg-white ring-1 ring-emerald-400/50'
                  : 'border-blue-600 bg-white'
            }`}
          />
        );
      })}

      {/* Compact inline bar with per-vertex Smooth/Sharp, Delete & Done */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${Math.max(8, Math.min(baseWidth * zoom - 290, avgDispX - 135))}px`,
          top: `${Math.max(8, topMostDispY - 40)}px`,
        }}
        className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-blue-500/40 bg-slate-900/95 px-2.5 py-1 text-xs font-medium text-white shadow-xl"
      >
        <span className="text-slate-300">
          {selectedIndices.length > 0 ? `${selectedIndices.length} nokta` : 'Nokta Düzenle'}
        </span>
        {selectedIndices.length > 0 && (
          <>
            <button
              type="button"
              data-testid="toggle-selected-vertices-smooth-btn"
              onClick={() => togglePathVerticesSmooth(element.id, selectedIndices, !allSelectedSmooth)}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                allSelectedSmooth
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              <Spline className="h-3 w-3" />
              {allSelectedSmooth ? 'Keskin' : 'Eğri'}
            </button>
            {absPts.length - selectedIndices.length >= 2 && (
              <button
                type="button"
                data-testid="delete-selected-vertices-btn"
                onClick={() => deletePathVertices(element.id, selectedIndices)}
                title="Seçili noktaları sil"
                className="inline-flex items-center gap-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-xs font-semibold text-white hover:bg-rose-500"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </>
        )}
        <button
          type="button"
          data-testid="finish-path-edit-btn"
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-500"
        >
          <Check className="h-3 w-3" />
          Tamam
        </button>
      </div>
    </div>
  );
}
