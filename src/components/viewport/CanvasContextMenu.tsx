import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Clipboard,
  Copy,
  CopyPlus,
  Crop,
  Edit3,
  FlipHorizontal2,
  FlipVertical2,
  Layers,
  Lock,
  PenTool,
  RefreshCw,
  RotateCw,
  Scissors,
  Shapes,
  Spline,
  Trash2,
  Type,
  Unlock,
} from 'lucide-react';
import type {
  CanvasElement,
  TextAddElement,
  VectorPathElement,
  VectorShapeElement,
} from '@/types/elements';
import {
  findOverlappingImagesForMask,
  findOverlappingMasksForImage,
  isImageMaskTarget,
  isVectorMaskCandidate,
} from '@/engine/imageMask';
import { denormalizePathPoints } from '@/engine/vectorShapes';
import { useEditorStore } from '@/store/useEditorStore';
import { createId } from '@/utils/id';

const SHAPE_NAMES: Record<string, string> = {
  rect: 'Dikdörtgen',
  ellipse: 'Daire',
  triangle: 'Üçgen',
  diamond: 'Elmas',
  arrow: 'Ok',
};

function describeMaskLabel(el: CanvasElement): string {
  if (el.kind === 'shape') return SHAPE_NAMES[el.shapeType] ?? 'Şekil';
  if (el.kind === 'shape-replacement') return 'Dikdörtgen';
  if (el.kind === 'path') return el.closed ? 'Kapalı Yol' : 'Çizgi / Yol';
  return 'Şekil';
}

export function CanvasContextMenu() {
  const menu = useEditorStore((s) => s.contextMenu);
  const elements = useEditorStore((s) => s.elements);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clipboard = useEditorStore((s) => s.clipboard);
  const lastRotateCopyConfig = useEditorStore((s) => s.lastRotateCopyConfig);
  const activeShapePreset = useEditorStore((s) => s.activeShapePreset);
  const shapeFillColor = useEditorStore((s) => s.shapeFillColor);
  const shapeStrokeColor = useEditorStore((s) => s.shapeStrokeColor);
  const shapeStrokeWidth = useEditorStore((s) => s.shapeStrokeWidth);
  const shapeBorderRadius = useEditorStore((s) => s.shapeBorderRadius);
  const shapeStrokeDash = useEditorStore((s) => s.shapeStrokeDash);
  const shapeOpacity = useEditorStore((s) => s.shapeOpacity);

  const setContextMenu = useEditorStore((s) => s.setContextMenu);
  const setEditingTextElementId = useEditorStore((s) => s.setEditingTextElementId);
  const setEditingPathElementId = useEditorStore((s) => s.setEditingPathElementId);
  const setCroppingImageElementId = useEditorStore((s) => s.setCroppingImageElementId);
  const openRotateCopyDialog = useEditorStore((s) => s.openRotateCopyDialog);
  const copySelected = useEditorStore((s) => s.copySelected);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const duplicateElements = useEditorStore((s) => s.duplicateElements);
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const bringToFront = useEditorStore((s) => s.bringToFront);
  const sendToBack = useEditorStore((s) => s.sendToBack);
  const stepLayer = useEditorStore((s) => s.stepLayer);
  const updateElements = useEditorStore((s) => s.updateElements);
  const rotateElements = useEditorStore((s) => s.rotateElements);
  const reflectElements = useEditorStore((s) => s.reflectElements);
  const rotateAndDuplicateElements = useEditorStore((s) => s.rotateAndDuplicateElements);
  const joinVectorPaths = useEditorStore((s) => s.joinVectorPaths);
  const applyImageClippingMask = useEditorStore((s) => s.applyImageClippingMask);
  const flipImageClipMaskSide = useEditorStore((s) => s.flipImageClipMaskSide);
  const releaseImageCropAndMask = useEditorStore((s) => s.releaseImageCropAndMask);
  const addElement = useEditorStore((s) => s.addElement);
  const setToolMode = useEditorStore((s) => s.setToolMode);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(pad, Math.min(vw - rect.width - pad, menu.clientX));
    const top = Math.max(pad, Math.min(vh - rect.height - pad, menu.clientY));
    setCoords({ left, top });
  }, [menu, selectedElementIds]);

  useEffect(() => {
    if (!menu) return;
    const handleOutside = (e: PointerEvent) => {
      if (menuRef.current && menuRef.current.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    const handleDismiss = () => setContextMenu(null);

    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('keydown', handleEsc);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('keydown', handleEsc);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [menu, setContextMenu]);

  if (!menu) return null;

  const selected = elements.filter(
    (el) => selectedElementIds.includes(el.id) && !('deleted' in el && el.deleted),
  );
  const pageElements = elements.filter(
    (el) => el.pageId === menu.pageId && !('deleted' in el && el.deleted),
  );
  const single = selected.length === 1 ? selected[0] : null;
  const targetIds = selected.map((el) => el.id);
  const allLocked = selected.length > 0 && selected.every((el) => Boolean(el.locked));
  const anyTransformable = selected.some(
    (el) =>
      el.kind === 'shape' ||
      el.kind === 'path' ||
      el.kind === 'image' ||
      el.kind === 'image-replacement' ||
      el.kind === 'signature' ||
      el.kind === 'highlight',
  );

  // Illustrator-style Clipping Mask matchers
  const singleImage = single && isImageMaskTarget(single) ? single : null;
  const overlappingMasks = singleImage
    ? findOverlappingMasksForImage(singleImage, pageElements)
    : [];

  const singleMask = single && isVectorMaskCandidate(single) ? single : null;
  const overlappingImages = singleMask
    ? findOverlappingImagesForMask(singleMask, pageElements)
    : [];

  const selectedImages = selected.filter(isImageMaskTarget);
  const selectedMasks = selected.filter(isVectorMaskCandidate);
  const selectedPairMatch =
    selectedImages.length === 1 && selectedMasks.length === 1
      ? {
          image: selectedImages[0],
          mask: selectedMasks[0],
          isOpenLineCut: selectedMasks[0].kind === 'path' && !selectedMasks[0].closed,
        }
      : null;

  const selectedPaths = selected.filter((el): el is VectorPathElement => el.kind === 'path');

  // Nearest open peer path for single open path join suggestion
  let nearestPeerPath: VectorPathElement | null = null;
  if (single?.kind === 'path' && !single.closed) {
    const myPts = denormalizePathPoints(single);
    const myEnds = [myPts[0], myPts[myPts.length - 1]].filter(Boolean);
    const peers = pageElements.filter(
      (el): el is VectorPathElement =>
        el.kind === 'path' && el.id !== single.id && !el.closed && !el.locked,
    );
    let bestDist = Infinity;
    for (const p of peers) {
      const pPts = denormalizePathPoints(p);
      for (const a of myEnds) {
        for (const b of [pPts[0], pPts[pPts.length - 1]].filter(Boolean)) {
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < bestDist) {
            bestDist = d;
            nearestPeerPath = p;
          }
        }
      }
    }
  }

  const closeAnd = (fn: () => void) => {
    setContextMenu(null);
    fn();
  };

  const handleAddTextHere = () => {
    const id = createId('txt');
    const nextZ = pageElements.reduce((m, e) => Math.max(m, e.zIndex), 300) + 1;
    const nextEl: TextAddElement = {
      id,
      pageId: menu.pageId,
      kind: 'text-add',
      x: Math.max(20, menu.pageX - 20),
      y: Math.max(20, menu.pageY - 12),
      width: 180,
      height: 28,
      rotation: 0,
      opacity: 1,
      zIndex: nextZ,
      text: 'Yeni Metin',
      fontFamily: 'Inter',
      fontSize: 13,
      color: '#0f172a',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.3,
    };
    addElement(nextEl, true);
    setToolMode('select');
    setEditingTextElementId(id);
  };

  const handleAddShapeHere = () => {
    const id = createId('shp');
    const nextZ = pageElements.reduce((m, e) => Math.max(m, e.zIndex), 400) + 1;
    const nextEl: VectorShapeElement = {
      id,
      pageId: menu.pageId,
      kind: 'shape',
      shapeType: activeShapePreset,
      x: Math.max(12, menu.pageX - 45),
      y: Math.max(12, menu.pageY - 35),
      width: 90,
      height: 70,
      rotation: 0,
      opacity: shapeOpacity,
      zIndex: nextZ,
      fillColor: shapeFillColor,
      strokeColor: shapeStrokeColor,
      strokeWidth: shapeStrokeWidth,
      strokeDash: shapeStrokeDash,
      borderRadius: activeShapePreset === 'rect' ? shapeBorderRadius : 0,
    };
    addElement(nextEl, true);
    setToolMode('select');
  };

  const itemCls =
    'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-blue-50 hover:text-blue-700 dark:text-slate-200 dark:hover:bg-blue-500/20 dark:hover:text-blue-300';
  const accentCls =
    'flex w-full items-center justify-between gap-2 rounded-lg bg-blue-50/90 px-2.5 py-1.5 text-left text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25';

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="canvas-context-menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
      }}
      className="fixed z-50 w-64 max-w-[calc(100vw-20px)] overflow-hidden rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-2xl backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/95"
    >
      {/* Empty page menu */}
      {selected.length === 0 ? (
        <div className="space-y-0.5">
          <div className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Sayfa İşlemleri
          </div>
          {clipboard.length > 0 && (
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-paste-here"
              onClick={() =>
                closeAnd(() => pasteClipboard({ pageId: menu.pageId, x: menu.pageX, y: menu.pageY }))
              }
              className={accentCls}
            >
              <span className="inline-flex items-center gap-2">
                <Clipboard className="h-3.5 w-3.5" />
                Buraya Yapıştır ({clipboard.length})
              </span>
              <span className="text-xs text-blue-500/80">Ctrl+V</span>
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            data-testid="ctx-add-text-here"
            onClick={() => closeAnd(handleAddTextHere)}
            className={itemCls}
          >
            <span className="inline-flex items-center gap-2">
              <Type className="h-3.5 w-3.5 text-slate-400" />
              Buraya Metin Ekle
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="ctx-add-shape-here"
            onClick={() => closeAnd(handleAddShapeHere)}
            className={itemCls}
          >
            <span className="inline-flex items-center gap-2">
              <Shapes className="h-3.5 w-3.5 text-slate-400" />
              Buraya Şekil Ekle
            </span>
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Header badge */}
          <div className="flex items-center justify-between px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <span>
              {selected.length > 1
                ? `${selected.length} Öğe Seçili`
                : single?.kind === 'shape'
                  ? SHAPE_NAMES[single.shapeType] ?? 'Şekil'
                  : single?.kind === 'path'
                    ? 'Vektör Çizgi / Yol'
                    : single && isImageMaskTarget(single)
                      ? 'Görsel'
                      : single?.kind === 'text-add' || single?.kind === 'text-edit'
                        ? 'Metin'
                        : single?.kind === 'signature'
                          ? 'İmza / Paraf'
                          : 'Öğe'}
            </span>
            {single?.locked && <Lock className="h-3 w-3 text-amber-500" />}
          </div>

          {/* Illustrator Multi-Select Clipping Pair */}
          {selectedPairMatch && (
            <div className="space-y-1 border-b border-slate-100 pb-1 dark:border-slate-800">
              {selectedPairMatch.isOpenLineCut ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="ctx-clip-selected-pair"
                    onClick={() =>
                      closeAnd(() =>
                        applyImageClippingMask(
                          selectedPairMatch.image.id,
                          selectedPairMatch.mask.id,
                          'a',
                        ),
                      )
                    }
                    className={accentCls}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Scissors className="h-3.5 w-3.5" />
                      Çizgiyle Görseli Kırp (1. Taraf)
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="ctx-clip-selected-pair-b"
                    onClick={() =>
                      closeAnd(() =>
                        applyImageClippingMask(
                          selectedPairMatch.image.id,
                          selectedPairMatch.mask.id,
                          'b',
                        ),
                      )
                    }
                    className={accentCls}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Scissors className="h-3.5 w-3.5" />
                      Çizgiyle Görseli Kırp (2. Taraf)
                    </span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="ctx-clip-selected-pair"
                  onClick={() =>
                    closeAnd(() =>
                      applyImageClippingMask(
                        selectedPairMatch.image.id,
                        selectedPairMatch.mask.id,
                        'a',
                      ),
                    )
                  }
                  className={accentCls}
                >
                  <span className="inline-flex items-center gap-2">
                    <Scissors className="h-3.5 w-3.5" />
                    Seçili Şekille Görseli Kırp
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Join Paths (Multi-select paths) */}
          {selectedPaths.length >= 2 && (
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-join-selected-paths"
              onClick={() => closeAnd(() => joinVectorPaths(selectedPaths.map((p) => p.id)))}
              className={accentCls}
            >
              <span className="inline-flex items-center gap-2">
                <Spline className="h-3.5 w-3.5" />
                Seçili Yolları Birleştir ({selectedPaths.length})
              </span>
            </button>
          )}

          {/* Text edit */}
          {(single?.kind === 'text-add' || single?.kind === 'text-edit') && !single.locked && (
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-edit-text"
              onClick={() => closeAnd(() => setEditingTextElementId(single.id))}
              className={accentCls}
            >
              <span className="inline-flex items-center gap-2">
                <Edit3 className="h-3.5 w-3.5" />
                Metni Düzenle
              </span>
            </button>
          )}

          {/* Image Crop & Overlapping Shape/Line Clipping Mask */}
          {singleImage && !singleImage.locked && (
            <div className="space-y-1 border-b border-slate-100 pb-1 dark:border-slate-800">
              <button
                type="button"
                role="menuitem"
                data-testid="ctx-crop-image"
                onClick={() => closeAnd(() => setCroppingImageElementId(singleImage.id))}
                className={accentCls}
              >
                <span className="inline-flex items-center gap-2">
                  <Crop className="h-3.5 w-3.5" />
                  Görseli Kırp (Dikdörtgen)
                </span>
              </button>

              {overlappingMasks.slice(0, 2).map((match, idx) =>
                match.isOpenLineCut ? (
                  <div key={match.mask.id} className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={idx === 0 ? 'ctx-clip-line-side-a' : undefined}
                      onClick={() =>
                        closeAnd(() => applyImageClippingMask(singleImage.id, match.mask.id, 'a'))
                      }
                      className="flex items-center justify-center gap-1 rounded-lg border border-indigo-400/50 bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
                    >
                      <Scissors className="h-3 w-3" />
                      Çizgi Kırp 1
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid={idx === 0 ? 'ctx-clip-line-side-b' : undefined}
                      onClick={() =>
                        closeAnd(() => applyImageClippingMask(singleImage.id, match.mask.id, 'b'))
                      }
                      className="flex items-center justify-center gap-1 rounded-lg border border-indigo-400/50 bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
                    >
                      <Scissors className="h-3 w-3" />
                      Çizgi Kırp 2
                    </button>
                  </div>
                ) : (
                  <button
                    key={match.mask.id}
                    type="button"
                    role="menuitem"
                    data-testid={idx === 0 ? 'ctx-clip-by-shape' : undefined}
                    onClick={() =>
                      closeAnd(() => applyImageClippingMask(singleImage.id, match.mask.id, 'a'))
                    }
                    className={accentCls}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Scissors className="h-3.5 w-3.5" />
                      {describeMaskLabel(match.mask)} ile Kırp (Maskele)
                    </span>
                  </button>
                ),
              )}

              {singleImage.clipMask?.openCutPoints && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="ctx-flip-mask-side"
                  onClick={() => closeAnd(() => flipImageClipMaskSide(singleImage.id))}
                  className={itemCls}
                >
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 text-indigo-500" />
                    Diğer Tarafı Tut (Maskeyi Çevir)
                  </span>
                </button>
              )}

              {(singleImage.cropRect || singleImage.clipMask) && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="ctx-release-mask"
                  onClick={() => closeAnd(() => releaseImageCropAndMask(singleImage.id, true))}
                  className={itemCls}
                >
                  <span className="inline-flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-amber-500" />
                    Kırpmayı / Maskeyi Çöz
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Vector Shape / Path over an Image -> Illustrator Mask Trigger + Path actions */}
          {singleMask && !singleMask.locked && (
            <div className="space-y-1 border-b border-slate-100 pb-1 dark:border-slate-800">
              {overlappingImages.slice(0, 1).map((match) =>
                match.isOpenLineCut ? (
                  <div key={match.image.id} className="grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="ctx-mask-image-line-a"
                      onClick={() =>
                        closeAnd(() => applyImageClippingMask(match.image.id, singleMask.id, 'a'))
                      }
                      className="flex items-center justify-center gap-1 rounded-lg border border-indigo-400/50 bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
                    >
                      <Scissors className="h-3 w-3" />
                      Görseli Böl 1
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="ctx-mask-image-line-b"
                      onClick={() =>
                        closeAnd(() => applyImageClippingMask(match.image.id, singleMask.id, 'b'))
                      }
                      className="flex items-center justify-center gap-1 rounded-lg border border-indigo-400/50 bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
                    >
                      <Scissors className="h-3 w-3" />
                      Görseli Böl 2
                    </button>
                  </div>
                ) : (
                  <button
                    key={match.image.id}
                    type="button"
                    role="menuitem"
                    data-testid="ctx-mask-image-with-shape"
                    onClick={() =>
                      closeAnd(() => applyImageClippingMask(match.image.id, singleMask.id, 'a'))
                    }
                    className={accentCls}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Scissors className="h-3.5 w-3.5" />
                      Alttaki Görseli Bununla Kırp
                    </span>
                  </button>
                ),
              )}

              {single?.kind === 'path' && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="ctx-edit-path-nodes"
                    onClick={() => closeAnd(() => setEditingPathElementId(single.id))}
                    className={itemCls}
                  >
                    <span className="inline-flex items-center gap-2">
                      <PenTool className="h-3.5 w-3.5 text-cyan-500" />
                      Noktaları / Yolu Düzenle
                    </span>
                  </button>
                  {nearestPeerPath && (
                    <button
                      type="button"
                      role="menuitem"
                      data-testid="ctx-join-nearest-path"
                      onClick={() => closeAnd(() => joinVectorPaths([single.id, nearestPeerPath!.id]))}
                      className={itemCls}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Spline className="h-3.5 w-3.5 text-emerald-500" />
                        En Yakın Çizgiyle Birleştir
                      </span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Transform section: Reflect, Rotate, Rotate & Copy */}
          {anyTransformable && !allLocked && (
            <div className="space-y-1 border-b border-slate-100 pb-1.5 dark:border-slate-800">
              <div className="px-2.5 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Dönüştür (Döndür / Yansıt)
              </div>
              <div className="grid grid-cols-2 gap-1 px-1">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="ctx-reflect-x"
                  onClick={() => closeAnd(() => reflectElements(targetIds, 'horizontal'))}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-blue-500/20"
                >
                  <FlipHorizontal2 className="h-3.5 w-3.5" />
                  Yatay Yansıt
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid="ctx-reflect-y"
                  onClick={() => closeAnd(() => reflectElements(targetIds, 'vertical'))}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-blue-500/20"
                >
                  <FlipVertical2 className="h-3.5 w-3.5" />
                  Dikey Yansıt
                </button>
              </div>

              <div className="grid grid-cols-4 gap-1 px-1">
                {[
                  { deg: -90, label: '-90°', testid: 'ctx-rotate-n90' },
                  { deg: 45, label: '+45°', testid: 'ctx-rotate-45' },
                  { deg: 90, label: '+90°', testid: 'ctx-rotate-90' },
                  { deg: 180, label: '180°', testid: 'ctx-rotate-180' },
                ].map((opt) => (
                  <button
                    key={opt.deg}
                    type="button"
                    role="menuitem"
                    data-testid={opt.testid}
                    onClick={() => closeAnd(() => rotateElements(targetIds, opt.deg))}
                    className="rounded-md border border-slate-200 bg-white py-1 text-xs font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-blue-500/20"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                role="menuitem"
                data-testid="ctx-rotate-copy"
                onClick={() => closeAnd(() => openRotateCopyDialog(targetIds))}
                className={itemCls}
              >
                <span className="inline-flex items-center gap-2">
                  <RotateCw className="h-3.5 w-3.5 text-blue-500" />
                  Döndürerek Kopyala…
                </span>
                <span className="text-xs text-slate-400">Rozet / Açı</span>
              </button>

              {lastRotateCopyConfig && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="ctx-repeat-rotate-copy"
                  onClick={() =>
                    closeAnd(() =>
                      rotateAndDuplicateElements(
                        targetIds,
                        lastRotateCopyConfig.angleDeg,
                        1,
                        lastRotateCopyConfig.pivot,
                      ),
                    )
                  }
                  className={itemCls}
                >
                  <span className="inline-flex items-center gap-2">
                    <CopyPlus className="h-3.5 w-3.5 text-emerald-500" />
                    Tekrar Döndür &amp; Kopyala ({lastRotateCopyConfig.angleDeg}°)
                  </span>
                </button>
              )}
            </div>
          )}

          {/* Clipboard & Duplicate */}
          <div className="space-y-0.5 border-b border-slate-100 pb-1 dark:border-slate-800">
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-copy"
              onClick={() => closeAnd(() => copySelected())}
              className={itemCls}
            >
              <span className="inline-flex items-center gap-2">
                <Copy className="h-3.5 w-3.5 text-slate-400" />
                Kopyala
              </span>
              <span className="text-xs text-slate-400">Ctrl+C</span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-duplicate"
              onClick={() => closeAnd(() => duplicateElements(targetIds))}
              className={itemCls}
            >
              <span className="inline-flex items-center gap-2">
                <CopyPlus className="h-3.5 w-3.5 text-slate-400" />
                Çoğalt (Aynısından Ekle)
              </span>
              <span className="text-xs text-slate-400">Ctrl+D</span>
            </button>
            {clipboard.length > 0 && (
              <button
                type="button"
                role="menuitem"
                data-testid="ctx-paste"
                onClick={() =>
                  closeAnd(() => pasteClipboard({ pageId: menu.pageId, x: menu.pageX, y: menu.pageY }))
                }
                className={itemCls}
              >
                <span className="inline-flex items-center gap-2">
                  <Clipboard className="h-3.5 w-3.5 text-slate-400" />
                  Yapıştır
                </span>
                <span className="text-xs text-slate-400">Ctrl+V</span>
              </button>
            )}
          </div>

          {/* Layer Ordering */}
          <div className="space-y-1 border-b border-slate-100 pb-1 dark:border-slate-800">
            <div className="px-2.5 pt-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Katman Sırası
            </div>
            <div className="grid grid-cols-4 gap-1 px-1">
              <button
                type="button"
                role="menuitem"
                data-testid="ctx-layer-front"
                title="En Üste Getir"
                onClick={() => closeAnd(() => bringToFront(targetIds))}
                className="flex flex-col items-center rounded-md border border-slate-200 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowUpToLine className="h-3.5 w-3.5" />
                Üst
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="ctx-layer-forward"
                title="Bir Öne Getir"
                onClick={() => closeAnd(() => stepLayer(targetIds, 'forward'))}
                className="flex flex-col items-center rounded-md border border-slate-200 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowUp className="h-3.5 w-3.5" />
                Öne
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="ctx-layer-backward"
                title="Bir Arkaya Gönder"
                onClick={() => closeAnd(() => stepLayer(targetIds, 'backward'))}
                className="flex flex-col items-center rounded-md border border-slate-200 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowDown className="h-3.5 w-3.5" />
                Arka
              </button>
              <button
                type="button"
                role="menuitem"
                data-testid="ctx-layer-back"
                title="En Alta Gönder"
                onClick={() => closeAnd(() => sendToBack(targetIds))}
                className="flex flex-col items-center rounded-md border border-slate-200 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                Alt
              </button>
            </div>
          </div>

          {/* Lock & Delete */}
          <div className="space-y-0.5 pt-0.5">
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-lock-toggle"
              onClick={() =>
                closeAnd(() =>
                  updateElements(
                    targetIds.map((id) => ({ id, patch: { locked: !allLocked } })),
                    true,
                  ),
                )
              }
              className={itemCls}
            >
              <span className="inline-flex items-center gap-2">
                {allLocked ? (
                  <Unlock className="h-3.5 w-3.5 text-amber-500" />
                ) : (
                  <Lock className="h-3.5 w-3.5 text-slate-400" />
                )}
                {allLocked ? 'Kilidi Aç' : 'Kilitle'}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="ctx-delete"
              onClick={() => closeAnd(() => deleteElements(targetIds))}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/15"
            >
              <span className="inline-flex items-center gap-2">
                <Trash2 className="h-3.5 w-3.5" />
                Sil
              </span>
              <span className="text-xs opacity-70">Del</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
