import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, RotateCcw, X } from 'lucide-react';
import type { ImageAddElement, ImageReplacementElement } from '@/types/elements';
import type { RectBox, RotationAngle } from '@/types/pdf';
import { deltaDisplayToBase, rectBaseToDisplayFrame } from '@/engine/coordinates';

type CropHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const CROP_HANDLES: Array<{ id: CropHandleId; style: React.CSSProperties; cursor: string }> = [
  { id: 'nw', style: { left: -6, top: -6 }, cursor: 'nwse-resize' },
  { id: 'n', style: { left: '50%', top: -5, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
  { id: 'ne', style: { right: -6, top: -6 }, cursor: 'nesw-resize' },
  { id: 'e', style: { right: -5, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
  { id: 'se', style: { right: -6, bottom: -6 }, cursor: 'nwse-resize' },
  { id: 's', style: { left: '50%', bottom: -5, transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
  { id: 'sw', style: { left: -6, bottom: -6 }, cursor: 'nesw-resize' },
  { id: 'w', style: { left: -5, top: '50%', transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
];

interface ImageCropOverlayProps {
  element: ImageAddElement | ImageReplacementElement;
  baseWidth: number;
  baseHeight: number;
  userRotation: RotationAngle;
  zoom: number;
  onApplyCrop: (relCrop: RectBox) => void;
  onCancel: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function ImageCropOverlay({
  element,
  baseWidth,
  baseHeight,
  userRotation,
  zoom,
  onApplyCrop,
  onCancel,
}: ImageCropOverlayProps) {
  const [relCrop, setRelCrop] = useState<RectBox>({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);

  const frame = rectBaseToDisplayFrame(
    { x: element.x, y: element.y, width: element.width, height: element.height },
    element.rotation,
    baseWidth,
    baseHeight,
    userRotation,
    zoom,
  );

  const applyAspectPreset = (ratio: number | null) => {
    setAspectRatio(ratio);
    if (!ratio) return;
    const targetVisualAspect = ratio;
    const elW = Math.max(1, element.width);
    const elH = Math.max(1, element.height);
    const currentAspect = (relCrop.width * elW) / Math.max(1, relCrop.height * elH);
    const cx = relCrop.x + relCrop.width / 2;
    const cy = relCrop.y + relCrop.height / 2;
    let nextW = relCrop.width;
    let nextH = relCrop.height;
    if (currentAspect > targetVisualAspect) {
      nextW = (nextH * elH * targetVisualAspect) / elW;
    } else {
      nextH = (nextW * elW) / (targetVisualAspect * elH);
    }
    nextW = clamp(nextW, 0.08, 1);
    nextH = clamp(nextH, 0.08, 1);
    setRelCrop({
      x: clamp(cx - nextW / 2, 0, 1 - nextW),
      y: clamp(cy - nextH / 2, 0, 1 - nextH),
      width: nextW,
      height: nextH,
    });
  };

  const handleDragStart = (handleId: CropHandleId, e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startCrop = { ...relCrop };

    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try {
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    };

    const onMove = (me: PointerEvent) => {
      const baseDelta = deltaDisplayToBase(
        me.clientX - startClientX,
        me.clientY - startClientY,
        userRotation,
        zoom,
      );
      const rad = (-element.rotation * Math.PI) / 180;
      const localDx = baseDelta.x * Math.cos(rad) - baseDelta.y * Math.sin(rad);
      const localDy = baseDelta.x * Math.sin(rad) + baseDelta.y * Math.cos(rad);
      const normDx = localDx / Math.max(1, element.width);
      const normDy = localDy / Math.max(1, element.height);

      let x0 = startCrop.x;
      let y0 = startCrop.y;
      let x1 = startCrop.x + startCrop.width;
      let y1 = startCrop.y + startCrop.height;

      const minSpan = 0.06;
      if (handleId.includes('w')) x0 = clamp(x0 + normDx, 0, x1 - minSpan);
      if (handleId.includes('e')) x1 = clamp(x1 + normDx, x0 + minSpan, 1);
      if (handleId.includes('n')) y0 = clamp(y0 + normDy, 0, y1 - minSpan);
      if (handleId.includes('s')) y1 = clamp(y1 + normDy, y0 + minSpan, 1);

      let w = x1 - x0;
      let h = y1 - y0;
      if (aspectRatio) {
        const elW = Math.max(1, element.width);
        const elH = Math.max(1, element.height);
        if (handleId === 'n' || handleId === 's') {
          w = clamp((h * elH * aspectRatio) / elW, minSpan, 1 - x0);
        } else {
          h = clamp((w * elW) / (aspectRatio * elH), minSpan, 1 - y0);
        }
      }

      setRelCrop({ x: x0, y: y0, width: w, height: h });
    };

    const onUp = () => {
      cleanup();
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const handleFramePanStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startCrop = { ...relCrop };

    const cleanup = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', cleanup);
      target.removeEventListener('pointercancel', cleanup);
      try {
        if (target.hasPointerCapture(e.pointerId)) {
          target.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    };

    const onMove = (me: PointerEvent) => {
      const baseDelta = deltaDisplayToBase(
        me.clientX - startClientX,
        me.clientY - startClientY,
        userRotation,
        zoom,
      );
      const rad = (-element.rotation * Math.PI) / 180;
      const localDx = baseDelta.x * Math.cos(rad) - baseDelta.y * Math.sin(rad);
      const localDy = baseDelta.x * Math.sin(rad) + baseDelta.y * Math.cos(rad);
      const normDx = localDx / Math.max(1, element.width);
      const normDy = localDy / Math.max(1, element.height);

      setRelCrop({
        x: clamp(startCrop.x + normDx, 0, 1 - startCrop.width),
        y: clamp(startCrop.y + normDy, 0, 1 - startCrop.height),
        width: startCrop.width,
        height: startCrop.height,
      });
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', cleanup);
    target.addEventListener('pointercancel', cleanup);
  };

  return (
    <div
      data-testid="image-crop-overlay"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        position: 'absolute',
        left: `${frame.left}px`,
        top: `${frame.top}px`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        transform: `rotate(${frame.rotation}deg)`,
        transformOrigin: 'center center',
        zIndex: 540,
      }}
      className="select-none"
    >
      {/* Dim outer regions outside the crop box using 4 crisp strips */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 bg-slate-950/55"
        style={{ height: `${relCrop.y * 100}%` }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 bg-slate-950/55"
        style={{ top: `${(relCrop.y + relCrop.height) * 100}%` }}
      />
      <div
        className="pointer-events-none absolute left-0 bg-slate-950/55"
        style={{
          top: `${relCrop.y * 100}%`,
          height: `${relCrop.height * 100}%`,
          width: `${relCrop.x * 100}%`,
        }}
      />
      <div
        className="pointer-events-none absolute right-0 bg-slate-950/55"
        style={{
          top: `${relCrop.y * 100}%`,
          height: `${relCrop.height * 100}%`,
          left: `${(relCrop.x + relCrop.width) * 100}%`,
        }}
      />

      {/* Interactive Crop Frame */}
      <div
        data-testid="image-crop-frame"
        onPointerDown={handleFramePanStart}
        style={{
          left: `${relCrop.x * 100}%`,
          top: `${relCrop.y * 100}%`,
          width: `${relCrop.width * 100}%`,
          height: `${relCrop.height * 100}%`,
        }}
        className="absolute cursor-move border-2 border-cyan-400 shadow-[0_0_0_1px_rgba(15,23,42,0.5)]"
      >
        {/* Rule of thirds guide hairlines */}
        <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/35" />
        <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/35" />
        <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/35" />
        <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/35" />

        {CROP_HANDLES.map((h) => (
          <div
            key={h.id}
            data-testid={`crop-handle-${h.id}`}
            onPointerDown={(e) => handleDragStart(h.id, e)}
            style={{ ...h.style, cursor: h.cursor }}
            className="absolute h-3 w-3 rounded-sm border border-cyan-600 bg-white shadow"
          />
        ))}
      </div>

      {/* Floating Crop Action Bar */}
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{ transform: `rotate(${-frame.rotation}deg)` }}
        className="absolute -bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-slate-700 bg-slate-900/95 px-2 py-1 text-[11px] text-white shadow-xl backdrop-blur"
      >
        <button
          type="button"
          onClick={() => applyAspectPreset(null)}
          className={`rounded-full px-2 py-0.5 font-medium transition ${
            aspectRatio === null ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          Serbest
        </button>
        <button
          type="button"
          onClick={() => applyAspectPreset(1)}
          className={`rounded-full px-1.5 py-0.5 font-medium transition ${
            aspectRatio === 1 ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          1:1
        </button>
        <button
          type="button"
          onClick={() => applyAspectPreset(4 / 3)}
          className={`rounded-full px-1.5 py-0.5 font-medium transition ${
            aspectRatio === 4 / 3 ? 'bg-cyan-600 text-white' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          4:3
        </button>
        <span className="mx-0.5 h-3.5 w-px bg-slate-700" />
        <button
          type="button"
          onClick={() => {
            setAspectRatio(null);
            setRelCrop({ x: 0, y: 0, width: 1, height: 1 });
          }}
          title="Sıfırla"
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <RotateCcw className="h-3 w-3" />
        </button>
        <button
          type="button"
          data-testid="crop-cancel-btn"
          onClick={onCancel}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-3 w-3" />
          İptal
        </button>
        <button
          type="button"
          data-testid="crop-apply-btn"
          onClick={() => onApplyCrop(relCrop)}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 font-semibold text-white hover:bg-emerald-500"
        >
          <Check className="h-3 w-3" />
          Kırp
        </button>
      </div>
    </div>
  );
}
