import { useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Check, Plus } from 'lucide-react';
import type { VectorPathElement } from '@/types/elements';
import type { Point, RotationAngle } from '@/types/pdf';
import { pointBaseToDisplay, pointDisplayToBase } from '@/engine/coordinates';
import {
  denormalizePathPoints,
  findNearestOpenPathEndpoint,
  type OpenPathSnapHit,
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
    initialPts: Point[],
    index: number,
    alreadyBegunTransaction: boolean,
  ) => {
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const originPt = initialPts[index];
    if (!alreadyBegunTransaction) {
      beginTransaction();
    }

    let aborted = false;
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
      if (me.shiftKey) {
        if (Math.abs(cur.x - originPt.x) >= Math.abs(cur.y - originPt.y)) {
          cur = { x: cur.x, y: originPt.y };
        } else {
          cur = { x: originPt.x, y: cur.y };
        }
      }

      activeSnap = null;
      const snapRadius = 11 / Math.max(0.25, zoom);
      const isOpenEndpoint = !element.closed && (index === 0 || index === workingPts.length - 1);

      if (isOpenEndpoint) {
        // Check closing onto opposite end of same path
        if (workingPts.length >= 3) {
          const otherEnd = index === 0 ? workingPts[workingPts.length - 1] : workingPts[0];
          if (Math.hypot(cur.x - otherEnd.x, cur.y - otherEnd.y) <= snapRadius) {
            cur = { ...otherEnd };
            activeSnap = { point: otherEnd, kind: 'self-close' };
          }
        }
        // Else check magnetic snap onto another open path endpoint on the same page
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

      setSnapTarget(activeSnap ? { point: activeSnap.point, kind: activeSnap.kind } : null);
      workingPts[index] = cur;
      updatePathPoints(element.id, workingPts, { recordHistory: false });
    };

    const onUp = () => {
      if (aborted) return;
      cleanup();
      setSnapTarget(null);

      if (activeSnap?.kind === 'self-close' && workingPts.length >= 3) {
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
      const next = absPts.filter((_, i) => i !== index);
      updatePathPoints(element.id, next, { recordHistory: true });
      return;
    }

    startAnchorDrag(e, absPts, index, false);
  };

  const handleMidpointPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, segIdx: number) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (useEditorStore.getState().activeTouchCount >= 2 || useEditorStore.getState().isPinching) {
      return;
    }
    e.stopPropagation();

    const a = absPts[segIdx];
    const b = absPts[(segIdx + 1) % absPts.length];
    const mid: Point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };

    beginTransaction();
    const inserted = [...absPts.slice(0, segIdx + 1), mid, ...absPts.slice(segIdx + 1)];
    updatePathPoints(element.id, inserted, { recordHistory: false });
    startAnchorDrag(e, inserted, segIdx + 1, true);
  };

  const dispPts = absPts.map(toDispPt);
  const segCount = element.closed ? absPts.length : absPts.length - 1;
  const topMostDispY = Math.min(...dispPts.map((p) => p.y));
  const avgDispX = dispPts.reduce((sum, p) => sum + p.x, 0) / dispPts.length;
  const snapDisp = snapTarget ? toDispPt(snapTarget.point) : null;

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

      {/* Primary vertex anchor handles */}
      {dispPts.map((p, idx) => (
        <button
          key={`anchor-${idx}`}
          type="button"
          data-testid={`path-anchor-handle-${idx}`}
          title="Sürükle: Noktayı taşı (Alt+Tık / Çift tık: Sil)"
          onPointerDown={(e) => handleAnchorPointerDown(e, idx)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (absPts.length > 2) {
              updatePathPoints(
                element.id,
                absPts.filter((_, i) => i !== idx),
                { recordHistory: true },
              );
            }
          }}
          style={{
            position: 'absolute',
            left: `${p.x - 6}px`,
            top: `${p.y - 6}px`,
            touchAction: 'none',
          }}
          className={`pointer-events-auto h-3 w-3 rounded-full border-2 shadow-sm transition-transform hover:scale-125 ${
            idx === 0
              ? 'border-emerald-600 bg-white ring-1 ring-emerald-400/50'
              : 'border-blue-600 bg-white'
          }`}
        />
      ))}

      {/* Compact inline bar to exit node mode cleanly */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${Math.max(8, Math.min(baseWidth * zoom - 190, avgDispX - 85))}px`,
          top: `${Math.max(8, topMostDispY - 38)}px`,
        }}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-blue-500/40 bg-slate-900/95 px-2.5 py-1 text-xs font-medium text-white shadow-xl"
      >
        <span className="text-slate-300">Nokta Düzenle</span>
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
