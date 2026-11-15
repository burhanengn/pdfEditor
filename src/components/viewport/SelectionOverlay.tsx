import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Lock, RotateCw, Unlock } from 'lucide-react';
import type { CanvasElement } from '@/types/elements';
import type { RectBox, RotationAngle, SnapGuide } from '@/types/pdf';
import {
  computeRotatedResizeCursor,
  computeRotatedResizeRect,
  deltaDisplayToBase,
  pointBaseToDisplay,
  rectBaseToDisplayFrame,
  type ResizeHandle,
} from '@/engine/coordinates';
import { useEditorStore } from '@/store/useEditorStore';
import { computeSnapPosition } from '@/utils/snapGuides';

const HANDLE_LIST: Array<{
  id: ResizeHandle;
  style: React.CSSProperties;
}> = [
  { id: 'nw', style: { left: -5, top: -5 } },
  { id: 'n', style: { left: '50%', top: -5, transform: 'translateX(-50%)' } },
  { id: 'ne', style: { right: -5, top: -5 } },
  { id: 'e', style: { right: -5, top: '50%', transform: 'translateY(-50%)' } },
  { id: 'se', style: { right: -5, bottom: -5 } },
  { id: 's', style: { left: '50%', bottom: -5, transform: 'translateX(-50%)' } },
  { id: 'sw', style: { left: -5, bottom: -5 } },
  { id: 'w', style: { left: -5, top: '50%', transform: 'translateY(-50%)' } },
];

interface SelectionOverlayProps {
  element: CanvasElement;
  siblingRects: RectBox[];
  baseWidth: number;
  baseHeight: number;
  userRotation: RotationAngle;
  zoom: number;
  selectBackgroundMode?: boolean;
  onSmartForegroundFallback?: (
    clientX: number,
    clientY: number,
    isCoarsePointer: boolean,
  ) => boolean;
  onUnlockElement?: () => void;
  onStartTextEdit?: () => void;
  onAltClickCycle?: (clientX: number, clientY: number) => void;
}

export function SelectionOverlay({
  element,
  siblingRects,
  baseWidth,
  baseHeight,
  userRotation,
  zoom,
  selectBackgroundMode = false,
  onSmartForegroundFallback,
  onUnlockElement,
  onStartTextEdit,
  onAltClickCycle,
}: SelectionOverlayProps) {
  const beginTransaction = useEditorStore((s) => s.beginTransaction);
  const commitTransaction = useEditorStore((s) => s.commitTransaction);
  const abortTransaction = useEditorStore((s) => s.abortTransaction);
  const updateElements = useEditorStore((s) => s.updateElements);
  const snapEnabled = useEditorStore((s) => s.snapEnabled);

  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [liveAngle, setLiveAngle] = useState<number | null>(null);

  const frame = rectBaseToDisplayFrame(
    { x: element.x, y: element.y, width: element.width, height: element.height },
    element.rotation,
    baseWidth,
    baseHeight,
    userRotation,
    zoom,
  );

  const handleMovePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (useEditorStore.getState().activeTouchCount >= 2 || useEditorStore.getState().isPinching) {
      return;
    }
    if (e.altKey && onAltClickCycle) {
      e.stopPropagation();
      onAltClickCycle(e.clientX, e.clientY);
      return;
    }
    if (element.isBackgroundLayer && !selectBackgroundMode && onSmartForegroundFallback) {
      const isCoarse =
        e.pointerType === 'touch' ||
        (typeof window !== 'undefined' &&
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(pointer: coarse)').matches);
      if (onSmartForegroundFallback(e.clientX, e.clientY, isCoarse)) {
        e.stopPropagation();
        return;
      }
    }
    if (element.locked) {
      e.stopPropagation();
      return;
    }
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startRect: RectBox = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    beginTransaction();

    let aborted = false;

    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', abortGesture);
      window.removeEventListener('gullac:multitouch-start', abortGesture);
      try {
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore if pointer capture already released
      }
    };

    const abortGesture = () => {
      if (aborted) return;
      aborted = true;
      cleanup();
      setGuides([]);
      abortTransaction();
    };

    const onMove = (moveEvent: PointerEvent) => {
      const store = useEditorStore.getState();
      if (aborted || store.isPinching || store.activeTouchCount >= 2) {
        abortGesture();
        return;
      }
      const dxPx = moveEvent.clientX - startClientX;
      const dyPx = moveEvent.clientY - startClientY;
      const baseDelta = deltaDisplayToBase(dxPx, dyPx, userRotation, zoom);
      const rawRect: RectBox = {
        ...startRect,
        x: startRect.x + baseDelta.x,
        y: startRect.y + baseDelta.y,
      };
      const snapped = computeSnapPosition(
        rawRect,
        baseWidth,
        baseHeight,
        siblingRects,
        snapEnabled && !moveEvent.altKey,
      );
      setGuides(snapped.guides);
      updateElements(
        [{ id: element.id, patch: { x: snapped.x, y: snapped.y } }],
        false,
      );
    };

    const onUp = () => {
      if (aborted) return;
      cleanup();
      setGuides([]);
      commitTransaction();
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', abortGesture);
    window.addEventListener('gullac:multitouch-start', abortGesture);
  };

  const handleResizePointerDown = (
    handle: ResizeHandle,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0 || !e.isPrimary || element.locked) return;
    if (useEditorStore.getState().activeTouchCount >= 2 || useEditorStore.getState().isPinching) {
      return;
    }
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startRect: RectBox = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    };

    const aspectLocked =
      'aspectLocked' in element ? Boolean(element.aspectLocked) : false;

    beginTransaction();

    let aborted = false;

    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', abortGesture);
      window.removeEventListener('gullac:multitouch-start', abortGesture);
      try {
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore if pointer capture already released
      }
    };

    const abortGesture = () => {
      if (aborted) return;
      aborted = true;
      cleanup();
      abortTransaction();
    };

    const onMove = (moveEvent: PointerEvent) => {
      const store = useEditorStore.getState();
      if (aborted || store.isPinching || store.activeTouchCount >= 2) {
        abortGesture();
        return;
      }
      const dxPx = moveEvent.clientX - startClientX;
      const dyPx = moveEvent.clientY - startClientY;
      const nextRect = computeRotatedResizeRect({
        startRect,
        handle,
        dxPx,
        dyPx,
        frameRotationDeg: frame.rotation,
        userRotation,
        zoom,
        aspectLocked,
        shiftKey: moveEvent.shiftKey,
        minSize: 12,
      });

      const isHorizontalResize = handle.includes('e') || handle.includes('w');
      const isTextEl = element.kind === 'text-edit' || element.kind === 'text-add';
      updateElements(
        [
          {
            id: element.id,
            patch:
              isTextEl && isHorizontalResize
                ? { ...nextRect, widthResizedByUser: true }
                : nextRect,
          },
        ],
        false,
      );
    };

    const onUp = () => {
      if (aborted) return;
      cleanup();
      commitTransaction();
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', abortGesture);
    window.addEventListener('gullac:multitouch-start', abortGesture);
  };

  const handleRotatePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary || element.locked) return;
    if (useEditorStore.getState().activeTouchCount >= 2 || useEditorStore.getState().isPinching) {
      return;
    }
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const parentRect = target.closest('[data-page-canvas-layer]')?.getBoundingClientRect();
    if (!parentRect) return;

    const centerClientX = parentRect.left + frame.centerX;
    const centerClientY = parentRect.top + frame.centerY;
    const startPointerAngle =
      (Math.atan2(e.clientY - centerClientY, e.clientX - centerClientX) * 180) / Math.PI;
    const startRotation = element.rotation;

    beginTransaction();

    let aborted = false;

    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', abortGesture);
      window.removeEventListener('gullac:multitouch-start', abortGesture);
      try {
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore if pointer capture already released
      }
    };

    const abortGesture = () => {
      if (aborted) return;
      aborted = true;
      cleanup();
      setLiveAngle(null);
      abortTransaction();
    };

    const onMove = (moveEvent: PointerEvent) => {
      const store = useEditorStore.getState();
      if (aborted || store.isPinching || store.activeTouchCount >= 2) {
        abortGesture();
        return;
      }
      const curAngle =
        (Math.atan2(moveEvent.clientY - centerClientY, moveEvent.clientX - centerClientX) * 180) /
        Math.PI;
      let nextRot = startRotation + (curAngle - startPointerAngle);
      if (moveEvent.shiftKey) {
        nextRot = Math.round(nextRot / 15) * 15;
      }
      // Normalize to [-180, 180]
      nextRot = ((((nextRot + 180) % 360) + 360) % 360) - 180;
      const rounded = Math.round(nextRot * 10) / 10;
      setLiveAngle(rounded);
      updateElements([{ id: element.id, patch: { rotation: rounded } }], false);
    };

    const onUp = () => {
      if (aborted) return;
      cleanup();
      setLiveAngle(null);
      commitTransaction();
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', abortGesture);
    window.addEventListener('gullac:multitouch-start', abortGesture);
  };

  return (
    <>
      {/* Snap alignment guides */}
      {guides.map((g, idx) => {
        const p1 =
          g.orientation === 'vertical'
            ? pointBaseToDisplay(g.position, g.start, baseWidth, baseHeight, userRotation, zoom)
            : pointBaseToDisplay(g.start, g.position, baseWidth, baseHeight, userRotation, zoom);
        const p2 =
          g.orientation === 'vertical'
            ? pointBaseToDisplay(g.position, g.end, baseWidth, baseHeight, userRotation, zoom)
            : pointBaseToDisplay(g.end, g.position, baseWidth, baseHeight, userRotation, zoom);

        const left = Math.min(p1.x, p2.x);
        const top = Math.min(p1.y, p2.y);
        const width = Math.max(1, Math.abs(p2.x - p1.x));
        const height = Math.max(1, Math.abs(p2.y - p1.y));

        return (
          <div
            key={`${g.orientation}-${idx}`}
              style={{
                position: 'absolute',
                left: `${left}px`,
                top: `${top}px`,
                width: `${width}px`,
                height: `${height}px`,
                zIndex: 510,
              }}
            className="pointer-events-none bg-fuchsia-500/80"
          />
        );
      })}

      {/* Selection bounding frame */}
      <div
        data-testid={`selection-box-${element.id}`}
        onPointerDown={handleMovePointerDown}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartTextEdit?.();
        }}
        style={{
          position: 'absolute',
          left: `${frame.left}px`,
          top: `${frame.top}px`,
          width: `${frame.width}px`,
          height: `${frame.height}px`,
          transform: `rotate(${frame.rotation}deg)`,
          transformOrigin: 'center center',
          zIndex: element.isBackgroundLayer && !selectBackgroundMode ? 290 : 500,
          touchAction: element.locked ? 'pan-x pan-y' : 'none',
        }}
        className={
          element.locked
            ? 'cursor-not-allowed border-2 border-dashed border-amber-500 shadow-[0_0_0_1px_rgba(255,255,255,0.45)]'
            : 'cursor-move border-2 border-blue-500 shadow-[0_0_0_1px_rgba(255,255,255,0.6)]'
        }
      >
        {element.locked && (
          <div
            data-testid={`locked-badge-${element.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ zIndex: 515 }}
            className="absolute -top-7 left-0 flex items-center gap-1.5 rounded-md bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-slate-950 shadow"
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span>Kilitli</span>
            {onUnlockElement && (
              <button
                type="button"
                data-testid={`unlock-element-btn-${element.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onUnlockElement();
                }}
                className="inline-flex items-center gap-0.5 rounded bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200 hover:bg-slate-900"
              >
                <Unlock className="h-2.5 w-2.5" />
                Kilidi Aç
              </button>
            )}
          </div>
        )}
        {/* Top Rotation Stem & Handle */}
        {!element.locked && (
          <div
            onPointerDown={handleRotatePointerDown}
            data-testid="rotate-handle"
            title="Drag to rotate (Hold Shift to snap 15°)"
            style={{
              position: 'absolute',
              left: '50%',
              top: -28,
              transform: 'translateX(-50%)',
              touchAction: 'none',
            }}
            className="touch-handle-target relative flex cursor-grab flex-col items-center active:cursor-grabbing"
          >
            <div className="flex h-5 w-5 items-center justify-center rounded-full border border-blue-500 bg-white text-blue-600 shadow">
              <RotateCw className="h-3 w-3" />
            </div>
            <div className="h-2.5 w-0.5 bg-blue-500" />
          </div>
        )}

        {liveAngle !== null && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: -54,
              transform: 'translateX(-50%)',
            }}
            className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow"
          >
            {liveAngle.toFixed(0)}°
          </div>
        )}

        {/* 8 Resize Handles */}
        {!element.locked &&
          HANDLE_LIST.map((h) => {
            const dynamicCursor = computeRotatedResizeCursor(h.id, frame.rotation);
            const isCorner = h.id.length === 2;
            return (
              <div
                key={h.id}
                data-testid={`resize-handle-${h.id}`}
                data-cursor={dynamicCursor}
                onPointerDown={(e) => handleResizePointerDown(h.id, e)}
                style={{
                  position: 'absolute',
                  width: 10,
                  height: 10,
                  cursor: dynamicCursor,
                  touchAction: 'none',
                  zIndex: isCorner ? 2 : 1,
                  ...h.style,
                }}
                className="touch-handle-target rounded-sm border border-blue-600 bg-white shadow-sm hover:scale-125"
              />
            );
          })}
      </div>
    </>
  );
}
