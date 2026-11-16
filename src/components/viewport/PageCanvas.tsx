import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Check, Layers, X } from 'lucide-react';
import {
  getElementLayerTier,
  type CanvasElement,
  type HighlightElement,
  type StrokeElement,
  type TextAddElement,
  type VectorPathElement,
  type VectorShapeElement,
} from '@/types/elements';
import type {
  DetectedImageObject,
  DetectedTextBlock,
  DetectedVectorShape,
  PageMeta,
  Point,
  RectBox,
} from '@/types/pdf';
import {
  axisAlignedRectBaseToDisplay,
  getDisplayDimensions,
  pointBaseToDisplay,
  pointDisplayToBase,
  pointInRotatedRect,
  rectBaseToDisplayFrame,
  resolveSmartHitAtPoint,
  type SmartHitResult,
} from '@/engine/coordinates';
import { calibrateDomTextMetrics, resolveFontDisplayStatus } from '@/engine/fonts';
import { getImageClipMaskSvgPath } from '@/engine/imageMask';
import { computePageNumberLayout } from '@/engine/pageNumbers';
import { pointsToSmoothSvgPath } from '@/engine/pdfCompiler';
import { pdfjsService } from '@/engine/pdfjsService';
import {
  constrainSegmentAngle45,
  findNearestOpenPathEndpoint,
  pathPointsToSvgPath,
  shapeToSvgPath,
  strokeDashToArray,
  type OpenPathSnapHit,
} from '@/engine/vectorShapes';
import { wasmWorkerClient } from '@/engine/wasmWorkerClient';
import { perfMetrics } from '@/engine/perfMetrics';
import { getSourceDocBytes } from '@/engine/sourceDocRegistry';
import { useEditorStore } from '@/store/useEditorStore';
import { createId } from '@/utils/id';
import { ImageCropOverlay } from './ImageCropOverlay';
import { InlineTextEditor } from './InlineTextEditor';
import { PathNodeEditorOverlay } from './PathNodeEditorOverlay';
import { SelectionOverlay } from './SelectionOverlay';

interface PageCanvasProps {
  page: PageMeta;
  pageIndex: number;
  zoom: number;
}

function isUnmodifiedBehindImage(
  el: CanvasElement,
  extractedImages?: DetectedImageObject[],
): boolean {
  if (el.kind !== 'image-replacement' || !el.behindContent || el.deleted) return false;
  const orig = extractedImages?.find((img) => img.id === el.originalImageId);
  const origOpacity = orig?.opacity ?? 1;
  const origRot = orig?.rotation ?? 0;
  return (
    Math.abs(el.x - el.originalRect.x) < 0.25 &&
    Math.abs(el.y - el.originalRect.y) < 0.25 &&
    Math.abs(el.width - el.originalRect.width) < 0.25 &&
    Math.abs(el.height - el.originalRect.height) < 0.25 &&
    Math.abs(el.rotation - origRot) < 0.25 &&
    Math.abs(el.opacity - origOpacity) < 0.02
  );
}

function isUnmodifiedBehindShape(
  el: CanvasElement,
  extractedShapes?: DetectedVectorShape[],
): boolean {
  if (el.kind !== 'shape-replacement' || !el.behindContent || el.deleted) return false;
  const orig = extractedShapes?.find((s) => s.id === el.originalShapeId);
  if (!orig) return false;
  return (
    Math.abs(el.x - el.originalRect.x) < 0.25 &&
    Math.abs(el.y - el.originalRect.y) < 0.25 &&
    Math.abs(el.width - el.originalRect.width) < 0.25 &&
    Math.abs(el.height - el.originalRect.height) < 0.25 &&
    Math.abs(el.rotation) < 0.25 &&
    Math.abs(el.opacity - orig.opacity) < 0.02 &&
    (el.fillColor ?? 'transparent') === (orig.fillColor ?? 'transparent') &&
    (el.strokeColor ?? undefined) === (orig.strokeColor ?? undefined) &&
    Math.abs(el.strokeWidth - orig.strokeWidth) < 0.1
  );
}

export function PageCanvas({ page, pageIndex, zoom }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);

  const sourceByteLength = useEditorStore((s) => s.sourceDocs[page.sourceDocId]?.byteLength ?? 0);
  const sourceBytes = getSourceDocBytes(page.sourceDocId);
  const appMode = useEditorStore((s) => s.appMode);
  const analysisRequested = useEditorStore((s) => Boolean(s.analysisRequestedPages[page.id]));
  const toolMode = useEditorStore((s) => s.toolMode);
  const allElements = useEditorStore((s) => s.elements);
  const userFonts = useEditorStore((s) => s.userFonts);
  const extractedFonts = useEditorStore((s) => s.extractedFonts);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const editingTextElementId = useEditorStore((s) => s.editingTextElementId);
  const editingPathElementId = useEditorStore((s) => s.editingPathElementId);
  const croppingImageElementId = useEditorStore((s) => s.croppingImageElementId);
  const extraction = useEditorStore((s) => s.pageExtractions[page.id]);

  const drawColor = useEditorStore((s) => s.drawColor);
  const drawWidth = useEditorStore((s) => s.drawWidth);
  const drawOpacity = useEditorStore((s) => s.drawOpacity);
  const highlightColor = useEditorStore((s) => s.highlightColor);
  const highlightShape = useEditorStore((s) => s.highlightShape);

  const activeShapePreset = useEditorStore((s) => s.activeShapePreset);
  const activePathMode = useEditorStore((s) => s.activePathMode);
  const shapeFillColor = useEditorStore((s) => s.shapeFillColor);
  const shapeStrokeColor = useEditorStore((s) => s.shapeStrokeColor);
  const shapeStrokeWidth = useEditorStore((s) => s.shapeStrokeWidth);
  const shapeBorderRadius = useEditorStore((s) => s.shapeBorderRadius);
  const shapeStrokeDash = useEditorStore((s) => s.shapeStrokeDash);
  const shapeOpacity = useEditorStore((s) => s.shapeOpacity);
  const pathClosedDefault = useEditorStore((s) => s.pathClosedDefault);
  const pathSmoothDefault = useEditorStore((s) => s.pathSmoothDefault);

  const setActivePage = useEditorStore((s) => s.setActivePage);
  const selectElements = useEditorStore((s) => s.selectElements);
  const setEditingTextElementId = useEditorStore((s) => s.setEditingTextElementId);
  const setEditingPathElementId = useEditorStore((s) => s.setEditingPathElementId);
  const setCroppingImageElementId = useEditorStore((s) => s.setCroppingImageElementId);
  const setContextMenu = useEditorStore((s) => s.setContextMenu);
  const applyImageCrop = useEditorStore((s) => s.applyImageCrop);
  const setPageExtraction = useEditorStore((s) => s.setPageExtraction);
  const addElement = useEditorStore((s) => s.addElement);
  const extendOrJoinPathWithSegment = useEditorStore((s) => s.extendOrJoinPathWithSegment);
  const joinVectorPaths = useEditorStore((s) => s.joinVectorPaths);
  const updatePathPoints = useEditorStore((s) => s.updatePathPoints);
  const beginTransaction = useEditorStore((s) => s.beginTransaction);
  const commitTransaction = useEditorStore((s) => s.commitTransaction);
  const abortTransaction = useEditorStore((s) => s.abortTransaction);
  const setToolMode = useEditorStore((s) => s.setToolMode);
  const startEditDetectedText = useEditorStore((s) => s.startEditDetectedText);
  const promoteDetectedImage = useEditorStore((s) => s.promoteDetectedImage);
  const promoteDetectedShape = useEditorStore((s) => s.promoteDetectedShape);
  const updateElements = useEditorStore((s) => s.updateElements);
  const selectBackgroundMode = useEditorStore((s) => s.selectBackgroundMode);
  const isPinching = useEditorStore((s) => s.isPinching);
  const pendingSignaturePlacement = useEditorStore((s) => s.pendingSignaturePlacement);
  const placeSignatureAt = useEditorStore((s) => s.placeSignatureAt);
  const pageNumbering = useEditorStore((s) => s.pageNumbering);
  const totalPages = useEditorStore((s) => s.pages.length);

  const [hoveredTextId, setHoveredTextId] = useState<string | null>(null);
  const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
  const [hoveredShapeId, setHoveredShapeId] = useState<string | null>(null);
  const [hoverBasePoint, setHoverBasePoint] = useState<{ x: number; y: number } | null>(null);
  const [bgLongPressPrompt, setBgLongPressPrompt] = useState<{
    x: number;
    y: number;
    image?: DetectedImageObject;
    shape?: DetectedVectorShape;
  } | null>(null);
  const suppressNextDetectedTextClickRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const lastRasterContextKeyRef = useRef<string>('');
  const wasPinchingRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  // Live MuPDF stream-stripped page preview so deleted/moved images & edited text
  // reveal authentic underlying table lines, shading, and graphics without white mask patches.
  const [cleanPreview, setCleanPreview] = useState<{
    key: string;
    docId: string;
    bytes: Uint8Array;
  } | null>(null);
  const [renderedStripKey, setRenderedStripKey] = useState<string>('');
  const [canvasPaperTransparent, setCanvasPaperTransparent] = useState<boolean>(true);
  const activeCleanDocIdRef = useRef<string | null>(null);

  // Live drawing / highlight / vector shape / path draft states
  const [draftStrokePoints, setDraftStrokePoints] = useState<Array<{ x: number; y: number }> | null>(
    null,
  );
  const [draftRect, setDraftRect] = useState<RectBox | null>(null);
  const [draftShapeRect, setDraftShapeRect] = useState<RectBox | null>(null);
  const [draftLineSegment, setDraftLineSegment] = useState<{
    start: Point;
    end: Point;
    startSnap: OpenPathSnapHit | null;
    endSnap: OpenPathSnapHit | null;
  } | null>(null);
  const [penDraftPoints, setPenDraftPoints] = useState<Point[] | null>(null);
  const [penStartSnap, setPenStartSnap] = useState<OpenPathSnapHit | null>(null);
  const [penHoverSnap, setPenHoverSnap] = useState<{
    kind: 'self-close' | 'join-peer';
    point: Point;
    hit?: OpenPathSnapHit;
  } | null>(null);

  const pagePaths = useMemo(
    () =>
      allElements.filter(
        (el): el is VectorPathElement => el.pageId === page.id && el.kind === 'path',
      ),
    [allElements, page.id],
  );

  useEffect(() => {
    if (toolMode !== 'path' || activePathMode !== 'pen') {
      setPenDraftPoints(null);
      setPenStartSnap(null);
      setPenHoverSnap(null);
    }
  }, [toolMode, activePathMode]);

  const finishPenDraft = (closeLoop = false) => {
    if (!penDraftPoints || penDraftPoints.length < 2) {
      setPenDraftPoints(null);
      setPenStartSnap(null);
      setPenHoverSnap(null);
      return;
    }
    const isClosed = closeLoop || pathClosedDefault;
    extendOrJoinPathWithSegment(
      penDraftPoints,
      page.id,
      penStartSnap,
      null,
      {
        strokeColor: shapeStrokeColor,
        strokeWidth: shapeStrokeWidth,
        strokeDash: shapeStrokeDash,
        fillColor: isClosed ? shapeFillColor : 'transparent',
        opacity: shapeOpacity,
        smooth: pathSmoothDefault,
        closed: isClosed,
      },
    );
    setPenDraftPoints(null);
    setPenStartSnap(null);
    setPenHoverSnap(null);
  };

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (editingPathElementId && ev.key === 'Escape') {
        ev.preventDefault();
        setEditingPathElementId(null);
        return;
      }
      if (!penDraftPoints) return;
      if (ev.key === 'Escape') {
        ev.preventDefault();
        setPenDraftPoints(null);
        setPenStartSnap(null);
        setPenHoverSnap(null);
      } else if (ev.key === 'Enter') {
        ev.preventDefault();
        finishPenDraft(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const displayDims = getDisplayDimensions(
    page.baseWidth,
    page.baseHeight,
    page.userRotation,
    zoom,
  );

  const pageElements = useMemo(
    () =>
      allElements
        .filter((el) => el.pageId === page.id)
        .sort(
          (a, b) => getElementLayerTier(a) - getElementLayerTier(b) || a.zIndex - b.zIndex,
        ),
    [allElements, page.id],
  );

  const getCssZIndexForElement = (el: CanvasElement): number => {
    const tier = getElementLayerTier(el);
    return tier * 100 + Math.max(0, Math.min(89, el.zIndex));
  };

  const stripRequest = useMemo(() => {
    const textRects: RectBox[] = [];
    const imageRects: RectBox[] = [];
    const shapeRects: RectBox[] = [];
    for (const el of pageElements) {
      if (el.kind === 'text-edit') {
        textRects.push(el.originalRect);
      } else if (el.kind === 'image-replacement') {
        // Merely selecting a behind-content watermark without moving/resizing/deleting it
        // keeps it rendered cleanly in the PDF base canvas behind text and table borders.
        if (isUnmodifiedBehindImage(el, extraction?.images)) continue;
        imageRects.push(el.originalRect);
      } else if (el.kind === 'shape-replacement') {
        if (isUnmodifiedBehindShape(el, extraction?.shapes)) continue;
        const pad = Math.max(0.5, (el.originalStrokeWidth ?? 0) / 2 + 0.5);
        shapeRects.push({
          x: Math.max(0, el.originalRect.x - pad),
          y: Math.max(0, el.originalRect.y - pad),
          width: el.originalRect.width + pad * 2,
          height: el.originalRect.height + pad * 2,
        });
      }
    }
    const serialize = (r: RectBox) =>
      `${Math.round(r.x * 10)}:${Math.round(r.y * 10)}:${Math.round(r.width * 10)}:${Math.round(r.height * 10)}`;
    const tKey = textRects.map(serialize).sort().join('|');
    const iKey = imageRects.map(serialize).sort().join('|');
    const sKey = shapeRects.map(serialize).sort().join('|');
    const key = tKey || iKey || sKey ? `t[${tKey}]i[${iKey}]s[${sKey}]` : '';
    return { textRects, imageRects, shapeRects, key };
  }, [pageElements, extraction?.images, extraction?.shapes]);

  const hasVisibleBehindImages = useMemo(
    () =>
      pageElements.some(
        (el) =>
          (((el.kind === 'image' || el.kind === 'image-replacement') &&
            el.behindContent === true &&
            !(el.kind === 'image-replacement' && el.deleted) &&
            !isUnmodifiedBehindImage(el, extraction?.images)) ||
            (el.kind === 'shape-replacement' &&
              el.behindContent === true &&
              !el.deleted &&
              !isUnmodifiedBehindShape(el, extraction?.shapes))),
      ),
    [pageElements, extraction?.images, extraction?.shapes],
  );

  const latestStripRectsRef = useRef<{
    textRects: RectBox[];
    imageRects: RectBox[];
    shapeRects: RectBox[];
  }>({
    textRects: stripRequest.textRects,
    imageRects: stripRequest.imageRects,
    shapeRects: stripRequest.shapeRects,
  });
  latestStripRectsRef.current = {
    textRects: stripRequest.textRects,
    imageRects: stripRequest.imageRects,
    shapeRects: stripRequest.shapeRects,
  };

  // Prepare clean stripped 1-page PDF in MuPDF Worker whenever original text or images are edited/deleted
  useEffect(() => {
    if (!sourceByteLength) return;
    const reqKey = stripRequest.key;
    if (!reqKey) {
      setCleanPreview((prev) => {
        if (prev) void pdfjsService.releaseDocument(prev.docId);
        return null;
      });
      activeCleanDocIdRef.current = null;
      return;
    }

    let cancelled = false;
    const { textRects, imageRects, shapeRects } = latestStripRectsRef.current;
    wasmWorkerClient
      .call('prepareCleanPage', {
        sourceDocId: page.sourceDocId,
        sourcePageIndex: page.sourcePageIndex,
        textRects,
        imageRects,
        shapeRects,
      })
      .then(({ bytes }) => {
        if (cancelled) return;
        const docId = `${page.id}::clean::${reqKey}`;
        const prevId = activeCleanDocIdRef.current;
        if (prevId && prevId !== docId) {
          void pdfjsService.releaseDocument(prevId);
        }
        activeCleanDocIdRef.current = docId;
        setCleanPreview({ key: reqKey, docId, bytes });
      })
      .catch(() => {
        // Fallback keeps canvas intact if clean preview preparation fails
      });

    return () => {
      cancelled = true;
    };
  }, [sourceByteLength, page.id, page.sourceDocId, page.sourcePageIndex, stripRequest.key]);

  // Release stripped preview proxy on unmount
  useEffect(() => {
    return () => {
      if (activeCleanDocIdRef.current) {
        void pdfjsService.releaseDocument(activeCleanDocIdRef.current);
        activeCleanDocIdRef.current = null;
      }
    };
  }, []);

  const usingCleanDoc = Boolean(stripRequest.key && cleanPreview && cleanPreview.key === stripRequest.key);
  const renderDocId = usingCleanDoc ? cleanPreview!.docId : page.sourceDocId;
  const renderBytes = usingCleanDoc ? cleanPreview!.bytes : sourceBytes;
  const renderPageIndex = usingCleanDoc ? 0 : page.sourcePageIndex;
  const targetStripKeyForRender = usingCleanDoc ? cleanPreview!.key : '';

  // Render PDF page canvas via pdfjs-dist worker
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderBytes) return;
    if (isPinching) {
      wasPinchingRef.current = true;
      return;
    }

    const rasterContextKey = `${renderDocId}:${renderPageIndex}:${page.userRotation}:${targetStripKeyForRender}:${hasVisibleBehindImages ? 1 : 0}`;
    const isZoomOnlyChange =
      !wasPinchingRef.current && lastRasterContextKeyRef.current === rasterContextKey;
    wasPinchingRef.current = false;
    lastRasterContextKeyRef.current = rasterContextKey;
    const delayMs = isZoomOnlyChange ? 75 : 0;

    let cancelled = false;
    let activeHandle: { cancel: () => void } | null = null;
    let timerId: number | null = null;

    const startRender = () => {
      if (cancelled) return;
      const handle = pdfjsService.renderPageToCanvas({
        sourceDocId: renderDocId,
        bytes: renderBytes,
        sourcePageIndex: renderPageIndex,
        canvas,
        zoom,
        userRotation: page.userRotation,
        dpr: Math.min(window.devicePixelRatio || 1, 2),
        background: hasVisibleBehindImages ? 'rgba(0, 0, 0, 0)' : undefined,
      });
      activeHandle = handle;

      handle.promise
        .then(() => {
          if (!cancelled) {
            if (hasVisibleBehindImages && canvas.width > 4 && canvas.height > 4) {
              try {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  const a1 = ctx.getImageData(1, 1, 1, 1).data[3];
                  const a2 = ctx.getImageData(canvas.width - 2, 1, 1, 1).data[3];
                  const a3 = ctx.getImageData(1, canvas.height - 2, 1, 1).data[3];
                  const a4 = ctx.getImageData(canvas.width - 2, canvas.height - 2, 1, 1).data[3];
                  setCanvasPaperTransparent(a1 === 0 || a2 === 0 || a3 === 0 || a4 === 0);
                }
              } catch {
                setCanvasPaperTransparent(false);
              }
            } else {
              setCanvasPaperTransparent(true);
            }
            setRenderedStripKey(targetStripKeyForRender);
            if (pageIndex === 0) {
              perfMetrics.recordFirstPagePainted();
            }
          }
        })
        .catch(() => {
          // Cancelled during rapid scroll/zoom
        });
    };

    if (delayMs > 0) {
      timerId = window.setTimeout(startRender, delayMs);
    } else {
      startRender();
    }

    return () => {
      cancelled = true;
      if (timerId !== null) window.clearTimeout(timerId);
      activeHandle?.cancel();
    };
  }, [
    renderDocId,
    renderBytes,
    renderPageIndex,
    page.userRotation,
    zoom,
    targetStripKeyForRender,
    hasVisibleBehindImages,
    isPinching,
  ]);

  // Lazily extract MuPDF StructuredText paragraphs + PDF.js XObject images & table rules
  // ONLY when user has edit intent (appMode === 'edit' or explicit page analysis request) (F0.4).
  useEffect(() => {
    const activeBytes = getSourceDocBytes(page.sourceDocId);
    if (!activeBytes || extraction) return;
    if (appMode !== 'edit' && !analysisRequested) return;
    let cancelled = false;

    (async () => {
      const { images, shapes, horizontalRules, verticalRules, cellRects } =
        await pdfjsService.extractPageImagesAndRules(
          page.sourceDocId,
          activeBytes,
          page.sourcePageIndex,
          page.id,
        );
      if (cancelled) return;

      try {
        const { textBlocks } = await wasmWorkerClient.call('extractPageText', {
          sourceDocId: page.sourceDocId,
          sourcePageIndex: page.sourcePageIndex,
          pageId: page.id,
          horizontalRules,
          verticalRules,
          cellRects,
        });
        if (!cancelled) {
          setPageExtraction(page.id, {
            textBlocks,
            images,
            shapes,
            horizontalRules,
            verticalRules,
            cellRects,
          });
        }
      } catch {
        const fallback = await pdfjsService.extractPageContent(
          page.sourceDocId,
          activeBytes,
          page.sourcePageIndex,
          page.id,
        );
        if (!cancelled) {
          setPageExtraction(page.id, {
            textBlocks: fallback.textBlocks,
            images,
            shapes: shapes ?? fallback.shapes,
            horizontalRules,
            verticalRules,
            cellRects,
          });
        }
      }
    })().catch(() => {
      // Ignore if document changed
    });

    return () => {
      cancelled = true;
    };
  }, [
    page.id,
    page.sourceDocId,
    page.sourcePageIndex,
    sourceByteLength,
    appMode,
    analysisRequested,
    extraction,
    setPageExtraction,
  ]);

  const isBaseStripped =
    stripRequest.key.length > 0 && renderedStripKey === stripRequest.key;

  // Transitional mask ONLY during ~15ms before clean-stripped canvas completes for edited text;
  // deleted/moved images never draw an opaque white box so underlying tables stay visible.
  const maskedOriginalRects = useMemo(() => {
    if (isBaseStripped) return [];
    const masks: Array<{ id: string; rect: RectBox; color: string }> = [];
    for (const el of pageElements) {
      if (el.kind === 'text-edit') {
        masks.push({ id: `mask-${el.id}`, rect: el.originalRect, color: el.maskColor ?? '#ffffff' });
      }
    }
    return masks;
  }, [pageElements, isBaseStripped]);

  const editedBlockIds = useMemo(
    () =>
      new Set(
        pageElements
          .filter((el) => el.kind === 'text-edit')
          .map((el) => el.originalBlockId),
      ),
    [pageElements],
  );

  const promotedImageIds = useMemo(
    () =>
      new Set(
        pageElements
          .filter((el) => el.kind === 'image-replacement')
          .map((el) => el.originalImageId),
      ),
    [pageElements],
  );

  const promotedShapeIds = useMemo(
    () =>
      new Set(
        pageElements
          .filter((el) => el.kind === 'shape-replacement')
          .map((el) => el.originalShapeId),
      ),
    [pageElements],
  );

  const visibleElements = useMemo(
    () =>
      pageElements.filter(
        (el) =>
          !(
            (el.kind === 'text-edit' ||
              el.kind === 'image-replacement' ||
              el.kind === 'shape-replacement') &&
            el.deleted
          ),
      ),
    [pageElements],
  );

  const getBasePointFromEvent = (clientX: number, clientY: number) => {
    const rect = layerRef.current!.getBoundingClientRect();
    const dx = clientX - rect.left;
    const dy = clientY - rect.top;
    return pointDisplayToBase(dx, dy, page.baseWidth, page.baseHeight, page.userRotation, zoom);
  };

  const sampleCanvasBackgroundColor = (dispRect: RectBox): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '#ffffff';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return '#ffffff';

    const scaleX = canvas.width / Math.max(1, displayDims.width);
    const scaleY = canvas.height / Math.max(1, displayDims.height);
    const samplePoints = [
      { x: Math.round((dispRect.x - 2) * scaleX), y: Math.round((dispRect.y + dispRect.height / 2) * scaleY) },
      { x: Math.round((dispRect.x + dispRect.width + 2) * scaleX), y: Math.round((dispRect.y + dispRect.height / 2) * scaleY) },
      { x: Math.round((dispRect.x + dispRect.width / 2) * scaleX), y: Math.round((dispRect.y - 2) * scaleY) },
      { x: Math.round((dispRect.x + dispRect.width / 2) * scaleX), y: Math.round((dispRect.y + dispRect.height + 2) * scaleY) },
    ];

    const buckets = new Map<string, number>();
    for (const pt of samplePoints) {
      const px = Math.max(0, Math.min(canvas.width - 1, pt.x));
      const py = Math.max(0, Math.min(canvas.height - 1, pt.y));
      try {
        const data = ctx.getImageData(px, py, 1, 1).data;
        const hex = `#${data[0].toString(16).padStart(2, '0')}${data[1].toString(16).padStart(2, '0')}${data[2].toString(16).padStart(2, '0')}`;
        buckets.set(hex, (buckets.get(hex) ?? 0) + 1);
      } catch {
        // Ignore readback error
      }
    }

    let bestColor = '#ffffff';
    let bestCount = -1;
    for (const [hex, count] of buckets.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestColor = hex;
      }
    }
    return bestColor;
  };

  const handleAltCycleAtClientPoint = (clientX: number, clientY: number) => {
    const pt = getBasePointFromEvent(clientX, clientY);
    type HitCandidate =
      | { kind: 'element'; element: CanvasElement; tier: number; zIndex: number }
      | { kind: 'detected-text'; block: DetectedTextBlock; tier: number; zIndex: number }
      | { kind: 'detected-image'; img: DetectedImageObject; tier: number; zIndex: number }
      | { kind: 'detected-shape'; shp: DetectedVectorShape; tier: number; zIndex: number };

    const candidates: HitCandidate[] = [];
    for (const el of visibleElements) {
      if (
        pointInRotatedRect(
          pt.x,
          pt.y,
          { x: el.x, y: el.y, width: el.width, height: el.height },
          el.rotation,
          2,
        )
      ) {
        candidates.push({
          kind: 'element',
          element: el,
          tier: getElementLayerTier(el),
          zIndex: getCssZIndexForElement(el),
        });
      }
    }

    if (extraction) {
      for (const block of extraction.textBlocks) {
        if (editedBlockIds.has(block.id)) continue;
        if (pointInRotatedRect(pt.x, pt.y, block, 0, 2)) {
          candidates.push({ kind: 'detected-text', block, tier: 3, zIndex: 305 });
        }
      }
      for (const img of extraction.images) {
        if (promotedImageIds.has(img.id)) continue;
        if (pointInRotatedRect(pt.x, pt.y, img, 0, 2)) {
          const isBg = Boolean(img.isHeaderOrBackground || img.behindContent);
          candidates.push({
            kind: 'detected-image',
            img,
            tier: isBg ? 1 : 2,
            zIndex: isBg ? 105 : 205,
          });
        }
      }
      for (const shp of extraction.shapes ?? []) {
        if (promotedShapeIds.has(shp.id)) continue;
        if (pointInRotatedRect(pt.x, pt.y, shp, 0, 2)) {
          const isBg = Boolean(shp.isHeaderOrBackground || shp.behindContent);
          candidates.push({
            kind: 'detected-shape',
            shp,
            tier: isBg ? 1 : 2,
            zIndex: isBg ? 104 : 204,
          });
        }
      }
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => b.tier - a.tier || b.zIndex - a.zIndex);
    const activeSelId = selectedElementIds[0];
    const currIdx = candidates.findIndex(
      (c) => c.kind === 'element' && c.element.id === activeSelId,
    );
    const nextIdx = currIdx >= 0 ? (currIdx + 1) % candidates.length : Math.min(1, candidates.length - 1);
    const chosen = candidates[nextIdx];

    setActivePage(page.id);
    if (chosen.kind === 'element') {
      setEditingTextElementId(null);
      selectElements([chosen.element.id]);
    } else if (chosen.kind === 'detected-image') {
      setEditingTextElementId(null);
      promoteDetectedImage(chosen.img, true);
    } else if (chosen.kind === 'detected-shape') {
      setEditingTextElementId(null);
      promoteDetectedShape(chosen.shp, true);
    } else {
      const disp = axisAlignedRectBaseToDisplay(
        {
          x: chosen.block.x,
          y: chosen.block.y,
          width: chosen.block.width,
          height: chosen.block.height,
        },
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      startEditDetectedText(chosen.block, sampleCanvasBackgroundColor(disp));
    }
  };

  const isCoarsePointerEvent = (pointerType?: string): boolean =>
    pointerType === 'touch' ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches);

  const dispatchSmartHit = (
    hit: Exclude<SmartHitResult, null>,
    forceBg: boolean,
  ): boolean => {
    setActivePage(page.id);
    if (hit.kind === 'element') {
      setEditingTextElementId(null);
      selectElements([hit.element.id]);
      return true;
    }
    if (hit.kind === 'detected-text') {
      const disp = axisAlignedRectBaseToDisplay(
        {
          x: hit.block.x,
          y: hit.block.y,
          width: hit.block.width,
          height: hit.block.height,
        },
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      startEditDetectedText(hit.block, sampleCanvasBackgroundColor(disp));
      return true;
    }
    if (hit.kind === 'detected-image') {
      setEditingTextElementId(null);
      return Boolean(promoteDetectedImage(hit.image, false));
    }
    if (hit.kind === 'detected-shape') {
      setEditingTextElementId(null);
      return Boolean(promoteDetectedShape(hit.shape, false));
    }
    if (hit.kind === 'background-element') {
      if (!forceBg && !selectBackgroundMode && hit.element.locked) {
        return false;
      }
      setEditingTextElementId(null);
      selectElements([hit.element.id]);
      return true;
    }
    if (hit.kind === 'background-detected-image') {
      if (!forceBg && !selectBackgroundMode) {
        return false;
      }
      setEditingTextElementId(null);
      return Boolean(promoteDetectedImage(hit.image, true));
    }
    if (hit.kind === 'background-detected-shape') {
      if (!forceBg && !selectBackgroundMode) {
        return false;
      }
      setEditingTextElementId(null);
      return Boolean(promoteDetectedShape(hit.shape, true));
    }
    return false;
  };

  const resolveForegroundHitAtClientPoint = (
    clientX: number,
    clientY: number,
    isCoarse: boolean,
  ): boolean => {
    const pt = getBasePointFromEvent(clientX, clientY);
    const hit = resolveSmartHitAtPoint({
      point: pt,
      zoom,
      isCoarsePointer: isCoarse,
      selectBackgroundMode: false,
      altKey: false,
      elements: visibleElements,
      detectedTextBlocks: extraction?.textBlocks ?? [],
      detectedImages: extraction?.images ?? [],
      detectedShapes: extraction?.shapes ?? [],
      replacedBlockIds: editedBlockIds,
      replacedImageIds: promotedImageIds,
      replacedShapeIds: promotedShapeIds,
    });
    if (
      hit &&
      (hit.kind === 'element' ||
        hit.kind === 'detected-text' ||
        hit.kind === 'detected-image' ||
        hit.kind === 'detected-shape')
    ) {
      return dispatchSmartHit(hit, false);
    }
    return false;
  };

  const handleLayerContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (useEditorStore.getState().appMode !== 'edit') return;
    e.preventDefault();
    e.stopPropagation();
    setActivePage(page.id);
    setBgLongPressPrompt(null);
    const pt = getBasePointFromEvent(e.clientX, e.clientY);

    // Preserve active multi-selection (e.g., Shift+clicked Shape + Image pairs) when
    // right-clicking any selected member; for single selection, let smart hit-testing pick
    // whichever topmost element sits directly beneath the cursor.
    const hitsExistingSelection =
      selectedElementIds.length > 1 &&
      visibleElements.some(
        (el) => selectedElementIds.includes(el.id) && pointInRotatedRect(pt.x, pt.y, el, el.rotation, 4),
      );
    if (!hitsExistingSelection) {
      const hit = resolveSmartHitAtPoint({
        point: pt,
        zoom,
        isCoarsePointer: false,
        selectBackgroundMode,
        altKey: e.altKey,
        elements: visibleElements,
        detectedTextBlocks: extraction?.textBlocks ?? [],
        detectedImages: extraction?.images ?? [],
        detectedShapes: extraction?.shapes ?? [],
        replacedBlockIds: editedBlockIds,
        replacedImageIds: promotedImageIds,
        replacedShapeIds: promotedShapeIds,
      });

      if (!hit) {
        selectElements([]);
        setEditingTextElementId(null);
      } else if (hit.kind === 'detected-text') {
        const disp = axisAlignedRectBaseToDisplay(
          {
            x: hit.block.x,
            y: hit.block.y,
            width: hit.block.width,
            height: hit.block.height,
          },
          page.baseWidth,
          page.baseHeight,
          page.userRotation,
          zoom,
        );
        startEditDetectedText(hit.block, sampleCanvasBackgroundColor(disp));
        // Promote cleanly so context actions work without trapping focus in an open textarea
        setEditingTextElementId(null);
      } else if (hit.kind === 'background-detected-image' || hit.kind === 'background-detected-shape') {
        if (selectBackgroundMode || e.altKey) {
          dispatchSmartHit(hit, true);
        } else {
          selectElements([]);
          setEditingTextElementId(null);
        }
      } else {
        dispatchSmartHit(hit, e.altKey);
      }
    }

    setContextMenu({
      pageId: page.id,
      pageX: pt.x,
      pageY: pt.y,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  };

  const handleLayerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const storeState = useEditorStore.getState();
    if (e.button !== 0 || !e.isPrimary || storeState.activeTouchCount >= 2 || storeState.isPinching) {
      return;
    }
    setActivePage(page.id);
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setBgLongPressPrompt(null);

    if (pendingSignaturePlacement) {
      e.stopPropagation();
      e.preventDefault();
      const pt = getBasePointFromEvent(e.clientX, e.clientY);
      placeSignatureAt(page.id, pt.x, pt.y);
      setHoverBasePoint(null);
      return;
    }

    if (storeState.appMode === 'view' && toolMode === 'select') {
      selectElements([]);
      setEditingTextElementId(null);
      return;
    }

    if (toolMode === 'select') {
      const pt = getBasePointFromEvent(e.clientX, e.clientY);
      const hit = resolveSmartHitAtPoint({
        point: pt,
        zoom,
        isCoarsePointer: isCoarsePointerEvent(e.pointerType),
        selectBackgroundMode,
        altKey: e.altKey,
        elements: visibleElements,
        detectedTextBlocks: extraction?.textBlocks ?? [],
        detectedImages: extraction?.images ?? [],
        detectedShapes: extraction?.shapes ?? [],
        replacedBlockIds: editedBlockIds,
        replacedImageIds: promotedImageIds,
        replacedShapeIds: promotedShapeIds,
      });

      if (!hit) {
        selectElements([]);
        setEditingTextElementId(null);
        return;
      }

      if (
        hit.kind === 'element' ||
        hit.kind === 'detected-text' ||
        hit.kind === 'detected-image' ||
        hit.kind === 'detected-shape'
      ) {
        dispatchSmartHit(hit, e.altKey);
        return;
      }

      if (hit.kind === 'background-element') {
        if (!dispatchSmartHit(hit, e.altKey || !hit.element.locked)) {
          selectElements([]);
          setEditingTextElementId(null);
        }
        return;
      }

      // hit.kind === 'background-detected-image' or 'background-detected-shape'
      const bgTarget = hit.kind === 'background-detected-image' ? hit.image : hit.shape;
      const bgAreaRatio =
        (bgTarget.width * bgTarget.height) / Math.max(1, page.baseWidth * page.baseHeight);
      const isCoarse = isCoarsePointerEvent(e.pointerType);
      const allowDirectPromote =
        selectBackgroundMode ||
        e.altKey ||
        (hit.kind === 'background-detected-shape'
          ? bgAreaRatio < (isCoarse ? 0.35 : 0.65)
          : bgAreaRatio < 0.65 && !isCoarse);
      if (allowDirectPromote) {
        dispatchSmartHit(hit, true);
        return;
      }

      // Open empty area over an unpromoted full background: deselect immediately and allow 500ms hold to reveal "Arka Planı Seç"
      selectElements([]);
      setEditingTextElementId(null);
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = layerRef.current?.getBoundingClientRect();
      const dispX = rect ? e.clientX - rect.left : 40;
      const dispY = rect ? e.clientY - rect.top : 40;
      const bgPromptTarget =
        hit.kind === 'background-detected-image'
          ? { image: hit.image }
          : { shape: hit.shape };

      const cancelHold = () => {
        if (longPressTimerRef.current !== null) {
          window.clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        window.removeEventListener('pointermove', onHoldMove);
        window.removeEventListener('pointerup', cancelHold);
        window.removeEventListener('pointercancel', cancelHold);
        window.removeEventListener('gullac:multitouch-start', cancelHold);
      };

      const onHoldMove = (me: PointerEvent) => {
        if (Math.hypot(me.clientX - startX, me.clientY - startY) > 8) {
          cancelHold();
        }
      };

      window.addEventListener('pointermove', onHoldMove);
      window.addEventListener('pointerup', cancelHold);
      window.addEventListener('pointercancel', cancelHold);
      window.addEventListener('gullac:multitouch-start', cancelHold);
      longPressTimerRef.current = window.setTimeout(() => {
        cancelHold();
        const s = useEditorStore.getState();
        if (s.isPinching || s.activeTouchCount >= 2) return;
        setBgLongPressPrompt({ x: dispX, y: dispY, ...bgPromptTarget });
      }, 500);
      return;
    }

    if (toolMode === 'text') {
      return;
    }

    if (toolMode === 'shape') {
      const targetEl = e.currentTarget;
      targetEl.setPointerCapture(e.pointerId);
      const startPt = getBasePointFromEvent(e.clientX, e.clientY);
      setDraftShapeRect({ x: startPt.x, y: startPt.y, width: 1, height: 1 });

      let latestRect: RectBox = { x: startPt.x, y: startPt.y, width: 1, height: 1 };
      let maxDragDist = 0;
      let aborted = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', abortGesture);
        window.removeEventListener('gullac:multitouch-start', abortGesture);
        try {
          if (targetEl.hasPointerCapture(e.pointerId)) {
            targetEl.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore if released
        }
      };

      const abortGesture = () => {
        if (aborted) return;
        aborted = true;
        cleanup();
        setDraftShapeRect(null);
      };

      const onMove = (me: PointerEvent) => {
        const store = useEditorStore.getState();
        if (aborted || store.isPinching || store.activeTouchCount >= 2) {
          abortGesture();
          return;
        }
        const curPt = getBasePointFromEvent(me.clientX, me.clientY);
        let dx = curPt.x - startPt.x;
        let dy = curPt.y - startPt.y;
        maxDragDist = Math.max(maxDragDist, Math.hypot(dx, dy));
        if (me.shiftKey) {
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          dx = dx >= 0 ? side : -side;
          dy = dy >= 0 ? side : -side;
        }
        latestRect = {
          x: Math.min(startPt.x, startPt.x + dx),
          y: Math.min(startPt.y, startPt.y + dy),
          width: Math.max(2, Math.abs(dx)),
          height: Math.max(2, Math.abs(dy)),
        };
        setDraftShapeRect(latestRect);
      };

      const onUp = () => {
        if (aborted) return;
        cleanup();
        setDraftShapeRect(null);

        const rectToCreate: RectBox =
          maxDragDist < 5
            ? {
                x: Math.max(8, Math.min(page.baseWidth - 104, startPt.x - 48)),
                y: Math.max(
                  8,
                  Math.min(
                    page.baseHeight - (activeShapePreset === 'rect' ? 76 : 104),
                    startPt.y - (activeShapePreset === 'rect' ? 34 : 48),
                  ),
                ),
                width: 96,
                height: activeShapePreset === 'rect' ? 68 : 96,
              }
            : latestRect;

        if (rectToCreate.width >= 6 && rectToCreate.height >= 6) {
          const shapeEl: VectorShapeElement = {
            id: createId('shp'),
            pageId: page.id,
            kind: 'shape',
            shapeType: activeShapePreset,
            x: rectToCreate.x,
            y: rectToCreate.y,
            width: rectToCreate.width,
            height: rectToCreate.height,
            rotation: 0,
            opacity: shapeOpacity,
            zIndex: 0,
            fillColor: shapeFillColor,
            strokeColor: shapeStrokeColor,
            strokeWidth: shapeStrokeWidth,
            strokeDash: shapeStrokeDash,
            borderRadius: activeShapePreset === 'rect' ? shapeBorderRadius : 0,
          };
          addElement(shapeEl, true);
          setToolMode('select');
        }
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', abortGesture);
      window.addEventListener('gullac:multitouch-start', abortGesture);
      return;
    }

    if (toolMode === 'path') {
      const snapRadius = 11 / Math.max(0.25, zoom);

      if (activePathMode === 'line') {
        const targetEl = e.currentTarget;
        targetEl.setPointerCapture(e.pointerId);
        const rawStart = getBasePointFromEvent(e.clientX, e.clientY);
        const startSnap = findNearestOpenPathEndpoint(rawStart, pagePaths, snapRadius);
        const startPt = startSnap ? startSnap.point : rawStart;

        let latestEnd = { ...startPt };
        let latestEndSnap: OpenPathSnapHit | null = null;
        let aborted = false;
        setDraftLineSegment({
          start: startPt,
          end: startPt,
          startSnap,
          endSnap: null,
        });

        const cleanup = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', abortGesture);
          window.removeEventListener('gullac:multitouch-start', abortGesture);
          try {
            if (targetEl.hasPointerCapture(e.pointerId)) {
              targetEl.releasePointerCapture(e.pointerId);
            }
          } catch {
            // ignore if released
          }
        };

        const abortGesture = () => {
          if (aborted) return;
          aborted = true;
          cleanup();
          setDraftLineSegment(null);
        };

        const onMove = (me: PointerEvent) => {
          const store = useEditorStore.getState();
          if (aborted || store.isPinching || store.activeTouchCount >= 2) {
            abortGesture();
            return;
          }
          let cur = getBasePointFromEvent(me.clientX, me.clientY);
          if (me.shiftKey) {
            cur = constrainSegmentAngle45(startPt, cur);
          }
          const endSnap = findNearestOpenPathEndpoint(cur, pagePaths, snapRadius);
          if (endSnap) {
            cur = endSnap.point;
          }
          latestEnd = cur;
          latestEndSnap = endSnap;
          setDraftLineSegment({
            start: startPt,
            end: cur,
            startSnap,
            endSnap,
          });
        };

        const onUp = () => {
          if (aborted) return;
          cleanup();
          setDraftLineSegment(null);
          if (Math.hypot(latestEnd.x - startPt.x, latestEnd.y - startPt.y) >= 4) {
            extendOrJoinPathWithSegment(
              [startPt, latestEnd],
              page.id,
              startSnap,
              latestEndSnap,
              {
                strokeColor: shapeStrokeColor,
                strokeWidth: shapeStrokeWidth,
                strokeDash: shapeStrokeDash,
                fillColor: 'transparent',
                opacity: shapeOpacity,
                smooth: false,
                closed: false,
              },
            );
          }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', abortGesture);
        window.addEventListener('gullac:multitouch-start', abortGesture);
        return;
      }

      // Pen multi-vertex path drafting mode
      e.stopPropagation();
      const rawPt = getBasePointFromEvent(e.clientX, e.clientY);

      if (!penDraftPoints || penDraftPoints.length === 0) {
        const startSnap = findNearestOpenPathEndpoint(rawPt, pagePaths, snapRadius);
        const firstPt = startSnap ? startSnap.point : rawPt;
        setPenStartSnap(startSnap);
        setPenDraftPoints([firstPt]);
        setHoverBasePoint(firstPt);
        return;
      }

      const lastPlaced = penDraftPoints[penDraftPoints.length - 1];
      let nextPt = e.shiftKey ? constrainSegmentAngle45(lastPlaced, rawPt) : rawPt;

      // Close loop if clicking back near Anchor #0 with >= 3 placed points
      if (penDraftPoints.length >= 3) {
        const dStart = Math.hypot(
          nextPt.x - penDraftPoints[0].x,
          nextPt.y - penDraftPoints[0].y,
        );
        if (dStart <= snapRadius) {
          finishPenDraft(true);
          return;
        }
      }

      // Snap and auto-join onto another open path endpoint on the page
      const peerEndSnap = findNearestOpenPathEndpoint(nextPt, pagePaths, snapRadius);
      if (peerEndSnap && penDraftPoints.length >= 1) {
        const combined = [...penDraftPoints, peerEndSnap.point];
        extendOrJoinPathWithSegment(combined, page.id, penStartSnap, peerEndSnap, {
          strokeColor: shapeStrokeColor,
          strokeWidth: shapeStrokeWidth,
          strokeDash: shapeStrokeDash,
          fillColor: pathClosedDefault ? shapeFillColor : 'transparent',
          opacity: shapeOpacity,
          smooth: pathSmoothDefault,
          closed: pathClosedDefault,
        });
        setPenDraftPoints(null);
        setPenStartSnap(null);
        setPenHoverSnap(null);
        return;
      }

      if (Math.hypot(nextPt.x - lastPlaced.x, nextPt.y - lastPlaced.y) >= 2.5) {
        setPenDraftPoints([...penDraftPoints, nextPt]);
      }
      return;
    }

    if (toolMode === 'draw') {
      const targetEl = e.currentTarget;
      targetEl.setPointerCapture(e.pointerId);
      const startPt = getBasePointFromEvent(e.clientX, e.clientY);
      const pts = [startPt];
      setDraftStrokePoints(pts);

      let aborted = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', abortGesture);
        window.removeEventListener('gullac:multitouch-start', abortGesture);
        try {
          if (targetEl.hasPointerCapture(e.pointerId)) {
            targetEl.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore if capture already released
        }
      };

      const abortGesture = () => {
        if (aborted) return;
        aborted = true;
        cleanup();
        pts.length = 0;
        setDraftStrokePoints(null);
      };

      const onMove = (me: PointerEvent) => {
        const store = useEditorStore.getState();
        if (aborted || store.isPinching || store.activeTouchCount >= 2) {
          abortGesture();
          return;
        }
        pts.push(getBasePointFromEvent(me.clientX, me.clientY));
        setDraftStrokePoints([...pts]);
      };

      const onUp = () => {
        if (aborted) return;
        cleanup();

        if (pts.length >= 2) {
          const minX = Math.min(...pts.map((p) => p.x));
          const maxX = Math.max(...pts.map((p) => p.x));
          const minY = Math.min(...pts.map((p) => p.y));
          const maxY = Math.max(...pts.map((p) => p.y));
          const w = Math.max(8, maxX - minX);
          const h = Math.max(8, maxY - minY);

          const strokeEl: StrokeElement = {
            id: createId('stroke'),
            pageId: page.id,
            kind: 'stroke',
            x: minX,
            y: minY,
            width: w,
            height: h,
            rotation: 0,
            opacity: drawOpacity,
            zIndex: 0,
            points: pts.map((p) => ({
              x: (p.x - minX) / w,
              y: (p.y - minY) / h,
            })),
            strokeColor: drawColor,
            strokeWidth: drawWidth,
          };
          addElement(strokeEl, true);
        }
        setDraftStrokePoints(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', abortGesture);
      window.addEventListener('gullac:multitouch-start', abortGesture);
      return;
    }

    if (toolMode === 'highlight') {
      const targetEl = e.currentTarget;
      targetEl.setPointerCapture(e.pointerId);
      const startPt = getBasePointFromEvent(e.clientX, e.clientY);
      setDraftRect({ x: startPt.x, y: startPt.y, width: 1, height: 1 });

      let latestRect: RectBox = { x: startPt.x, y: startPt.y, width: 1, height: 1 };
      let aborted = false;

      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', abortGesture);
        window.removeEventListener('gullac:multitouch-start', abortGesture);
        try {
          if (targetEl.hasPointerCapture(e.pointerId)) {
            targetEl.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore if capture already released
        }
      };

      const abortGesture = () => {
        if (aborted) return;
        aborted = true;
        cleanup();
        setDraftRect(null);
      };

      const onMove = (me: PointerEvent) => {
        const store = useEditorStore.getState();
        if (aborted || store.isPinching || store.activeTouchCount >= 2) {
          abortGesture();
          return;
        }
        const curPt = getBasePointFromEvent(me.clientX, me.clientY);
        latestRect = {
          x: Math.min(startPt.x, curPt.x),
          y: Math.min(startPt.y, curPt.y),
          width: Math.abs(curPt.x - startPt.x),
          height: Math.abs(curPt.y - startPt.y),
        };
        setDraftRect(latestRect);
      };

      const onUp = () => {
        if (aborted) return;
        cleanup();
        if (latestRect.width >= 6 && latestRect.height >= 6) {
          const el: HighlightElement = {
            id: createId('ann'),
            pageId: page.id,
            kind: 'highlight',
            shape: highlightShape,
            x: latestRect.x,
            y: latestRect.y,
            width: latestRect.width,
            height: latestRect.height,
            rotation: 0,
            opacity: highlightShape === 'highlight' ? 0.38 : highlightShape === 'redact' ? 1 : 0.85,
            zIndex: 0,
            fillColor: highlightShape === 'redact' ? '#000000' : highlightColor,
            strokeColor: highlightShape === 'rect' ? highlightColor : undefined,
            strokeWidth: highlightShape === 'rect' ? 2 : 0,
          };
          addElement(el, true);
          setToolMode('select');
        }
        setDraftRect(null);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', abortGesture);
      window.addEventListener('gullac:multitouch-start', abortGesture);
    }
  };

  const renderElement = (el: CanvasElement) => {
    const isEditingThis = editingTextElementId === el.id;
    if (isEditingThis && (el.kind === 'text-add' || el.kind === 'text-edit')) {
      return (
        <InlineTextEditor
          key={el.id}
          element={el}
          baseWidth={page.baseWidth}
          baseHeight={page.baseHeight}
          userRotation={page.userRotation}
          zoom={zoom}
          isBaseStripped={isBaseStripped}
          onFinish={() => setEditingTextElementId(null)}
        />
      );
    }

    const frame = rectBaseToDisplayFrame(
      { x: el.x, y: el.y, width: el.width, height: el.height },
      el.rotation,
      page.baseWidth,
      page.baseHeight,
      page.userRotation,
      zoom,
    );

    const isSelected = selectedElementIds.includes(el.id);

    const handleSelect = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (pendingSignaturePlacement) return;
      if (toolMode !== 'select') return;
      e.stopPropagation();
      setActivePage(page.id);
      if (e.altKey) {
        handleAltCycleAtClientPoint(e.clientX, e.clientY);
        return;
      }
      const isBehindEl =
        (el.kind === 'image' ||
          el.kind === 'image-replacement' ||
          el.kind === 'shape-replacement' ||
          el.kind === 'shape' ||
          el.kind === 'path') &&
        Boolean(el.behindContent);
      if ((el.isBackgroundLayer || isBehindEl) && !selectBackgroundMode) {
        const claimed = resolveForegroundHitAtClientPoint(
          e.clientX,
          e.clientY,
          isCoarsePointerEvent(e.pointerType),
        );
        if (claimed) return;
      }
      if (e.shiftKey) {
        const exists = selectedElementIds.includes(el.id);
        const nextSel = exists
          ? selectedElementIds.length > 1
            ? selectedElementIds.filter((id) => id !== el.id)
            : selectedElementIds
          : [...selectedElementIds, el.id];
        selectElements(nextSel);
      } else {
        selectElements([el.id]);
      }
    };

    if (el.kind === 'text-add' || el.kind === 'text-edit') {
      const fontStatus = resolveFontDisplayStatus({
        fontFamily: el.fontFamily,
        fallbackFontFamily: el.fallbackFontFamily,
        originalFontName: el.originalFontName,
        isCustomFont: el.isCustomFont,
        text: el.text,
        userFonts,
        extractedFonts,
      });
      const hScale =
        el.horizontalScale && Math.abs(el.horizontalScale - 1) > 0.005 ? el.horizontalScale : 1;
      const hasHScale = Math.abs(hScale - 1) > 0.005;
      const letterSpacingPx =
        el.letterSpacing && el.letterSpacing !== 0
          ? `${(el.letterSpacing * zoom).toFixed(3)}px`
          : undefined;
      const calibration = calibrateDomTextMetrics({
        sampleText: el.text,
        targetPdfWidthPt: 0,
        fontSizePt: el.fontSize,
        lineHeight: el.lineHeight,
        baselineOffsetPt: el.baselineOffset,
        fontFamily: el.fontFamily,
        cssFontFamily: fontStatus.cssFamily,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? 'italic' : 'normal',
        initialHorizontalScale: hScale,
      });
      const topOffsetPx = calibration.topOffsetPt * zoom;

      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          onDoubleClick={(e) => {
            if (toolMode !== 'select') return;
            e.stopPropagation();
            selectElements([el.id]);
            setEditingTextElementId(el.id);
          }}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            minHeight: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: el.opacity,
            zIndex: getCssZIndexForElement(el),
            boxSizing: 'border-box',
            padding: 0,
            border: 0,
            margin: 0,
            fontFamily: fontStatus.cssFamily,
            fontSize: `${el.fontSize * zoom}px`,
            fontWeight: el.bold ? 700 : 400,
            fontStyle: el.italic ? 'italic' : 'normal',
            letterSpacing: letterSpacingPx,
            color: el.color,
            lineHeight: el.lineHeight,
            textAlign: el.align,
            fontKerning: 'normal',
            backgroundColor: el.kind === 'text-add' ? el.backgroundColor : undefined,
          }}
          className={`select-none ${
            toolMode === 'select' && !isSelected ? 'hover:ring-1 hover:ring-blue-400/70' : ''
          }`}
        >
          <div
            style={{
              position: 'relative',
              top: `${topOffsetPx}px`,
              width: hasHScale ? `${100 / hScale}%` : '100%',
              transform: hasHScale ? `scaleX(${hScale})` : undefined,
              transformOrigin: 'left top',
              padding: 0,
              border: 0,
              margin: 0,
              boxSizing: 'border-box',
              fontKerning: 'normal',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              wordBreak: 'normal',
            }}
          >
            {el.runs && el.runs.length > 0
              ? el.runs.map((run, idx) => {
                  const rBold = run.bold ?? el.bold;
                  const rItalic = run.italic ?? el.italic;
                  const style = {
                    fontWeight: rBold ? 700 : 400,
                    fontStyle: rItalic ? ('italic' as const) : ('normal' as const),
                  };
                  if (run.script === 'super') {
                    return (
                      <sup
                        key={idx}
                        style={{
                          ...style,
                          fontSize: '0.60em',
                          position: 'static',
                          top: 0,
                          bottom: 'auto',
                          verticalAlign: '0.48em',
                          lineHeight: 0,
                        }}
                      >
                        {run.text}
                      </sup>
                    );
                  }
                  if (run.script === 'sub') {
                    return (
                      <sub
                        key={idx}
                        style={{
                          ...style,
                          fontSize: '0.60em',
                          position: 'static',
                          top: 'auto',
                          bottom: 0,
                          verticalAlign: '-0.22em',
                          lineHeight: 0,
                        }}
                      >
                        {run.text}
                      </sub>
                    );
                  }
                  return (
                    <span key={idx} style={style}>
                      {run.text}
                    </span>
                  );
                })
              : el.text}
          </div>
        </div>
      );
    }

    if (el.kind === 'image' || el.kind === 'image-replacement' || el.kind === 'signature') {
      const isBehindImage =
        (el.kind === 'image' || el.kind === 'image-replacement') && el.behindContent === true;
      const keepOriginalBehindInCanvas =
        el.kind === 'image-replacement' && isUnmodifiedBehindImage(el, extraction?.images);
      const tierZIndex = getCssZIndexForElement(el);
      const rawImageZIndex = isBehindImage
        ? keepOriginalBehindInCanvas || canvasPaperTransparent
          ? 5
          : 12
        : tierZIndex;
      const imageZIndex =
        el.isBackgroundLayer && !selectBackgroundMode
          ? Math.min(rawImageZIndex, 50)
          : rawImageZIndex;
      const flipScaleX = (el.kind === 'image' || el.kind === 'image-replacement') && el.flipX ? -1 : 1;
      const flipScaleY = (el.kind === 'image' || el.kind === 'image-replacement') && el.flipY ? -1 : 1;
      const innerFlipTransform =
        flipScaleX !== 1 || flipScaleY !== 1 ? `scale(${flipScaleX}, ${flipScaleY})` : undefined;

      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: keepOriginalBehindInCanvas ? 1 : el.opacity,
            zIndex: imageZIndex,
            mixBlendMode:
              isBehindImage && !keepOriginalBehindInCanvas && !canvasPaperTransparent
                ? 'multiply'
                : 'normal',
          }}
          className="select-none"
        >
          {keepOriginalBehindInCanvas ? null : el.kind === 'signature' &&
            !el.realisticInk &&
            el.svgPaths &&
            el.viewBoxWidth &&
            el.viewBoxHeight ? (
            <svg
              viewBox={`0 0 ${el.viewBoxWidth} ${el.viewBoxHeight}`}
              preserveAspectRatio="none"
              className="h-full w-full overflow-visible"
            >
              {el.svgPaths.map((p, idx) => (
                <path
                  key={idx}
                  d={p.d}
                  fill={p.fill ? p.color : 'none'}
                  stroke={p.strokeWidth > 0 ? p.color : 'none'}
                  strokeWidth={p.strokeWidth}
                  opacity={p.opacity ?? 1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </svg>
          ) : (el.kind === 'image' || el.kind === 'image-replacement') &&
            (el.cropRect || el.clipMask?.unitSvgPath) ? (
            (() => {
              const crop = el.cropRect ?? { x: 0, y: 0, width: 1, height: 1 };
              const elW = Math.max(1, el.width);
              const elH = Math.max(1, el.height);
              const imgW = elW / Math.max(0.02, crop.width);
              const imgH = elH / Math.max(0.02, crop.height);
              const imgX = -(crop.x / Math.max(0.02, crop.width)) * elW;
              const imgY = -(crop.y / Math.max(0.02, crop.height)) * elH;
              const clipPathD = getImageClipMaskSvgPath(el.clipMask, elW, elH);
              const clipId = `imgclip_${el.id}`;
              const cx = elW / 2;
              const cy = elH / 2;
              const gTransform =
                flipScaleX !== 1 || flipScaleY !== 1
                  ? `translate(${cx} ${cy}) scale(${flipScaleX} ${flipScaleY}) translate(${-cx} ${-cy})`
                  : undefined;

              return (
                <svg
                  viewBox={`0 0 ${elW} ${elH}`}
                  preserveAspectRatio="none"
                  className="pointer-events-none h-full w-full overflow-hidden"
                >
                  {clipPathD && (
                    <defs>
                      <clipPath id={clipId}>
                        <path d={clipPathD} />
                      </clipPath>
                    </defs>
                  )}
                  <g transform={gTransform}>
                    <image
                      href={el.previewUrl}
                      x={imgX}
                      y={imgY}
                      width={imgW}
                      height={imgH}
                      preserveAspectRatio="none"
                      clipPath={clipPathD ? `url(#${clipId})` : undefined}
                    />
                  </g>
                </svg>
              );
            })()
          ) : (
            <img
              src={el.previewUrl}
              alt={el.kind === 'signature' ? el.label : el.name}
              draggable={false}
              style={innerFlipTransform ? { transform: innerFlipTransform } : undefined}
              className="h-full w-full object-fill pointer-events-none"
            />
          )}
        </div>
      );
    }

    if (el.kind === 'stroke') {
      const d = pointsToSmoothSvgPath(el.points, el.width, el.height);
      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: el.opacity,
            zIndex: getCssZIndexForElement(el),
          }}
        >
          <svg
            viewBox={`0 0 ${el.width} ${el.height}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            <path
              d={d}
              fill="none"
              stroke={el.strokeColor}
              strokeWidth={el.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    }

    if (el.kind === 'shape-replacement') {
      const isBehindShape = el.behindContent === true;
      const keepOriginalBehindInCanvas = isUnmodifiedBehindShape(el, extraction?.shapes);
      const tierZIndex = getCssZIndexForElement(el);
      const rawShapeZIndex = isBehindShape
        ? keepOriginalBehindInCanvas || canvasPaperTransparent
          ? 5
          : 12
        : tierZIndex;
      const shapeZIndex =
        el.isBackgroundLayer && !selectBackgroundMode
          ? Math.min(rawShapeZIndex, 50)
          : rawShapeZIndex;

      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: keepOriginalBehindInCanvas ? 1 : el.opacity,
            backgroundColor: keepOriginalBehindInCanvas
              ? 'transparent'
              : el.fillColor === 'transparent'
                ? 'transparent'
                : el.fillColor,
            border:
              !keepOriginalBehindInCanvas && el.strokeColor && el.strokeWidth > 0
                ? `${el.strokeWidth * zoom}px solid ${el.strokeColor}`
                : undefined,
            boxSizing: 'border-box',
            zIndex: shapeZIndex,
          }}
          className="cursor-pointer select-none"
        />
      );
    }

    if (el.kind === 'shape') {
      const d = shapeToSvgPath(el.shapeType, el.width, el.height, el.borderRadius ?? 0);
      const dashArr = strokeDashToArray(el.strokeDash, el.strokeWidth);
      const hasStroke = el.strokeColor !== 'transparent' && el.strokeWidth > 0;
      const shapeZ =
        el.behindContent || el.isBackgroundLayer
          ? canvasPaperTransparent
            ? 5
            : 12
          : getCssZIndexForElement(el);
      const shapeFlipX = el.flipX ? -1 : 1;
      const shapeFlipY = el.flipY ? -1 : 1;
      const shapeFlipTransform =
        shapeFlipX !== 1 || shapeFlipY !== 1
          ? `scale(${shapeFlipX}, ${shapeFlipY})`
          : undefined;
      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: el.opacity,
            zIndex: shapeZ,
          }}
          className="cursor-pointer select-none"
        >
          <svg
            viewBox={`0 0 ${Math.max(1, el.width)} ${Math.max(1, el.height)}`}
            preserveAspectRatio="none"
            style={
              shapeFlipTransform
                ? { transform: shapeFlipTransform, transformOrigin: 'center center' }
                : undefined
            }
            className="h-full w-full overflow-visible"
          >
            <path
              d={d}
              fill={el.fillColor === 'transparent' ? 'none' : el.fillColor}
              stroke={hasStroke ? el.strokeColor : 'none'}
              strokeWidth={hasStroke ? el.strokeWidth : 0}
              strokeDasharray={hasStroke && dashArr ? dashArr.join(' ') : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        </div>
      );
    }

    if (el.kind === 'path') {
      const d = pathPointsToSvgPath(el.points, el.width, el.height, el.closed, el.smooth);
      const dashArr = strokeDashToArray(el.strokeDash, el.strokeWidth);
      const hasStroke = el.strokeColor !== 'transparent' && el.strokeWidth > 0;
      const pathZ =
        el.behindContent || el.isBackgroundLayer
          ? canvasPaperTransparent
            ? 5
            : 12
          : getCssZIndexForElement(el);
      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          onDoubleClick={(ev) => {
            if (toolMode !== 'select' || el.locked) return;
            ev.stopPropagation();
            selectElements([el.id]);
            setEditingPathElementId(el.id);
          }}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: el.opacity,
            zIndex: pathZ,
          }}
          className="cursor-pointer select-none"
        >
          <svg
            viewBox={`0 0 ${Math.max(1, el.width)} ${Math.max(1, el.height)}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={Math.max(14, el.strokeWidth + 10)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={d}
              fill={el.closed && el.fillColor !== 'transparent' ? el.fillColor : 'none'}
              stroke={hasStroke ? el.strokeColor : 'none'}
              strokeWidth={hasStroke ? el.strokeWidth : 0}
              strokeDasharray={hasStroke && dashArr ? dashArr.join(' ') : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    }

    if (el.kind === 'highlight') {
      return (
        <div
          key={el.id}
          data-testid={`canvas-element-${el.id}`}
          data-layer-tier={getElementLayerTier(el)}
          onPointerDown={handleSelect}
          style={{
            position: 'absolute',
            left: `${frame.left}px`,
            top: `${frame.top}px`,
            width: `${frame.width}px`,
            height: `${frame.height}px`,
            transform: `rotate(${frame.rotation}deg)`,
            transformOrigin: 'center center',
            opacity: el.opacity,
            backgroundColor: el.shape === 'rect' ? 'transparent' : el.fillColor,
            border:
              el.shape === 'rect' && el.strokeColor
                ? `${(el.strokeWidth ?? 2) * zoom}px solid ${el.strokeColor}`
                : undefined,
            zIndex: getCssZIndexForElement(el),
          }}
        />
      );
    }

    return null;
  };

  const renderDetectedOverlays = () => {
    if (appMode !== 'edit' || toolMode !== 'select' || pendingSignaturePlacement || !extraction) return null;

    return (
      <>
        {(extraction.shapes ?? []).map((shp: DetectedVectorShape) => {
          if (promotedShapeIds.has(shp.id)) return null;
          const disp = axisAlignedRectBaseToDisplay(
            { x: shp.x, y: shp.y, width: shp.width, height: shp.height },
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          );
          const hovered = hoveredShapeId === shp.id;
          const isBg = Boolean(
            shp.isBackgroundLayer || shp.isHeaderOrBackground || shp.behindContent,
          );
          const areaRatio =
            (shp.width * shp.height) / Math.max(1, page.baseWidth * page.baseHeight);
          const isolateBg = isBg && !selectBackgroundMode && areaRatio >= 0.65;
          return (
            <div
              key={shp.id}
              data-testid={`detected-shape-${shp.id}`}
              data-detected-shape="true"
              data-layer-tier={isBg ? 1 : 2}
              data-background-layer={isBg ? 'true' : 'false'}
              onMouseEnter={() => {
                if (!isolateBg) setHoveredShapeId(shp.id);
              }}
              onMouseLeave={() => {
                if (!isolateBg) setHoveredShapeId(null);
              }}
              onPointerDown={(e) => {
                if (isolateBg || e.button !== 0) return;
                e.stopPropagation();
                if (e.altKey) {
                  handleAltCycleAtClientPoint(e.clientX, e.clientY);
                  return;
                }
                const isCoarse = isCoarsePointerEvent(e.pointerType);
                if (!selectBackgroundMode && isCoarse && areaRatio >= 0.35) {
                  return;
                }
                promoteDetectedShape(shp, selectBackgroundMode || !isCoarse || areaRatio < 0.35);
              }}
              style={{
                position: 'absolute',
                left: `${disp.x}px`,
                top: `${disp.y}px`,
                width: `${disp.width}px`,
                height: `${disp.height}px`,
                zIndex: isolateBg ? 10 : isBg ? 104 : 204,
                pointerEvents: isolateBg ? 'none' : 'auto',
              }}
              title={
                isolateBg
                  ? undefined
                  : 'Click to edit background shape color, border, size, or position'
              }
              className={
                isolateBg
                  ? 'border border-transparent'
                  : `cursor-pointer transition ${
                      hovered
                        ? 'border-2 border-dashed border-indigo-400 bg-indigo-500/10'
                        : 'border border-transparent hover:border-indigo-400/50'
                    }`
              }
            />
          );
        })}

        {extraction.images.map((img: DetectedImageObject) => {
          if (promotedImageIds.has(img.id)) return null;
          const disp = axisAlignedRectBaseToDisplay(
            { x: img.x, y: img.y, width: img.width, height: img.height },
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          );
          const hovered = hoveredImageId === img.id;
          const isBg = Boolean(
            img.isBackgroundLayer || img.isHeaderOrBackground || img.behindContent,
          );
          const isolateBg = isBg && !selectBackgroundMode;
          return (
            <div
              key={img.id}
              data-testid={`detected-image-${img.id}`}
              data-detected-image="true"
              data-layer-tier={isBg ? 1 : 2}
              data-background-layer={isBg ? 'true' : 'false'}
              onMouseEnter={() => {
                if (!isolateBg) setHoveredImageId(img.id);
              }}
              onMouseLeave={() => {
                if (!isolateBg) setHoveredImageId(null);
              }}
              onPointerDown={(e) => {
                if (isolateBg) return;
                if (e.button !== 0) return;
                e.stopPropagation();
                if (e.altKey) {
                  handleAltCycleAtClientPoint(e.clientX, e.clientY);
                  return;
                }
                promoteDetectedImage(img, selectBackgroundMode);
              }}
              style={{
                position: 'absolute',
                left: `${disp.x}px`,
                top: `${disp.y}px`,
                width: `${disp.width}px`,
                height: `${disp.height}px`,
                zIndex: isolateBg ? 10 : isBg ? 105 : 205,
                pointerEvents: isolateBg ? 'none' : 'auto',
              }}
              title={
                isolateBg
                  ? undefined
                  : 'Click to select, move, resize, rotate, or delete embedded image'
              }
              className={
                isolateBg
                  ? 'border border-transparent'
                  : `cursor-pointer transition ${
                      hovered
                        ? 'border-2 border-dashed border-emerald-500 bg-emerald-500/10'
                        : 'border border-transparent hover:border-emerald-400/50'
                    }`
              }
            />
          );
        })}

        {extraction.textBlocks.map((block: DetectedTextBlock) => {
          if (editedBlockIds.has(block.id)) return null;
          const disp = axisAlignedRectBaseToDisplay(
            { x: block.x, y: block.y, width: block.width, height: block.height },
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          );
          const hovered = hoveredTextId === block.id;
          return (
            <div
              key={block.id}
              data-testid={`detected-text-${block.id}`}
              data-detected-text="true"
              data-layer-tier={3}
              onMouseEnter={() => setHoveredTextId(block.id)}
              onMouseLeave={() => setHoveredTextId(null)}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                if (e.altKey) {
                  suppressNextDetectedTextClickRef.current = true;
                  handleAltCycleAtClientPoint(e.clientX, e.clientY);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (suppressNextDetectedTextClickRef.current) {
                  suppressNextDetectedTextClickRef.current = false;
                  return;
                }
                startEditDetectedText(block, sampleCanvasBackgroundColor(disp));
              }}
              style={{
                position: 'absolute',
                left: `${disp.x}px`,
                top: `${disp.y}px`,
                width: `${disp.width}px`,
                height: `${disp.height}px`,
                zIndex: 305,
              }}
              title="Click to edit PDF text in-place"
              className={`cursor-text rounded-[2px] transition ${
                hovered
                  ? 'border border-dashed border-blue-500 bg-blue-500/10'
                  : 'border border-transparent'
              }`}
            />
          );
        })}
      </>
    );
  };

  const renderDraftPreview = () => {
    if (draftStrokePoints && draftStrokePoints.length > 0) {
      const dispPts = draftStrokePoints.map((pt) => {
        const disp = rectBaseToDisplayFrame(
          { x: pt.x, y: pt.y, width: 0, height: 0 },
          0,
          page.baseWidth,
          page.baseHeight,
          page.userRotation,
          zoom,
        );
        return { x: disp.centerX, y: disp.centerY };
      });
      const d =
        dispPts.length === 1
          ? `M ${dispPts[0].x} ${dispPts[0].y} L ${dispPts[0].x + 0.5} ${dispPts[0].y + 0.5}`
          : `M ${dispPts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`;
      return (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ zIndex: 45 }}
        >
          <path
            d={d}
            fill="none"
            stroke={drawColor}
            strokeWidth={drawWidth * zoom}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={drawOpacity}
          />
        </svg>
      );
    }

    if (draftShapeRect) {
      const disp = axisAlignedRectBaseToDisplay(
        draftShapeRect,
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      const d = shapeToSvgPath(
        activeShapePreset,
        Math.max(1, disp.width),
        Math.max(1, disp.height),
        activeShapePreset === 'rect' ? shapeBorderRadius * zoom : 0,
      );
      const dashArr = strokeDashToArray(shapeStrokeDash, shapeStrokeWidth);
      const hasStroke = shapeStrokeColor !== 'transparent' && shapeStrokeWidth > 0;
      return (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          style={{ zIndex: 45 }}
        >
          <g transform={`translate(${disp.x.toFixed(1)}, ${disp.y.toFixed(1)})`}>
            <path
              d={d}
              fill={shapeFillColor === 'transparent' ? 'none' : shapeFillColor}
              stroke={hasStroke ? shapeStrokeColor : '#3b82f6'}
              strokeWidth={hasStroke ? shapeStrokeWidth * zoom : 1.5}
              strokeDasharray={
                hasStroke && dashArr
                  ? dashArr.map((v) => (v * zoom).toFixed(1)).join(' ')
                  : undefined
              }
              opacity={shapeOpacity}
              strokeLinejoin="round"
            />
          </g>
        </svg>
      );
    }

    if (draftLineSegment) {
      const p1 = pointBaseToDisplay(
        draftLineSegment.start.x,
        draftLineSegment.start.y,
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      const p2 = pointBaseToDisplay(
        draftLineSegment.end.x,
        draftLineSegment.end.y,
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      const dashArr = strokeDashToArray(shapeStrokeDash, shapeStrokeWidth);
      return (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          style={{ zIndex: 45 }}
        >
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={shapeStrokeColor === 'transparent' ? '#0f172a' : shapeStrokeColor}
            strokeWidth={Math.max(1, shapeStrokeWidth) * zoom}
            strokeDasharray={dashArr ? dashArr.map((v) => (v * zoom).toFixed(1)).join(' ') : undefined}
            strokeLinecap="round"
            opacity={shapeOpacity}
          />
          {draftLineSegment.startSnap && (
            <circle
              cx={p1.x}
              cy={p1.y}
              r={8}
              fill="rgba(16, 185, 129, 0.25)"
              stroke="#10b981"
              strokeWidth={2}
            />
          )}
          {draftLineSegment.endSnap && (
            <circle
              cx={p2.x}
              cy={p2.y}
              r={8}
              fill="rgba(16, 185, 129, 0.25)"
              stroke="#10b981"
              strokeWidth={2}
            />
          )}
        </svg>
      );
    }

    if (penDraftPoints && penDraftPoints.length > 0) {
      const dispPts = penDraftPoints.map((pt) =>
        pointBaseToDisplay(pt.x, pt.y, page.baseWidth, page.baseHeight, page.userRotation, zoom),
      );
      const hoverDisp = hoverBasePoint
        ? pointBaseToDisplay(
            hoverBasePoint.x,
            hoverBasePoint.y,
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          )
        : null;
      const snapDisp = penHoverSnap
        ? pointBaseToDisplay(
            penHoverSnap.point.x,
            penHoverSnap.point.y,
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          )
        : null;
      const dashArr = strokeDashToArray(shapeStrokeDash, shapeStrokeWidth);
      const d = `M ${dispPts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L ')}`;
      return (
        <>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
            style={{ zIndex: 45 }}
          >
            <path
              d={d}
              fill="none"
              stroke={shapeStrokeColor === 'transparent' ? '#0f172a' : shapeStrokeColor}
              strokeWidth={Math.max(1, shapeStrokeWidth) * zoom}
              strokeDasharray={dashArr ? dashArr.map((v) => (v * zoom).toFixed(1)).join(' ') : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={shapeOpacity}
            />
            {hoverDisp && (
              <line
                x1={dispPts[dispPts.length - 1].x}
                y1={dispPts[dispPts.length - 1].y}
                x2={snapDisp ? snapDisp.x : hoverDisp.x}
                y2={snapDisp ? snapDisp.y : hoverDisp.y}
                stroke="#3b82f6"
                strokeWidth={Math.max(1.5, shapeStrokeWidth * 0.7 * zoom)}
                strokeDasharray="5 4"
                strokeLinecap="round"
              />
            )}
            {dispPts.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i === 0 ? 5 : 4}
                fill="#ffffff"
                stroke={i === 0 ? '#10b981' : '#3b82f6'}
                strokeWidth={2}
              />
            ))}
            {snapDisp && (
              <circle
                cx={snapDisp.x}
                cy={snapDisp.y}
                r={9}
                fill={
                  penHoverSnap?.kind === 'join-peer'
                    ? 'rgba(16, 185, 129, 0.25)'
                    : 'rgba(59, 130, 246, 0.25)'
                }
                stroke={penHoverSnap?.kind === 'join-peer' ? '#10b981' : '#3b82f6'}
                strokeWidth={2}
              />
            )}
          </svg>
          {penDraftPoints.length >= 2 && (
            <div
              onPointerDown={(ev) => ev.stopPropagation()}
              style={{
                position: 'absolute',
                left: `${Math.max(8, dispPts[dispPts.length - 1].x - 65)}px`,
                top: `${Math.max(8, dispPts[dispPts.length - 1].y + 14)}px`,
                zIndex: 540,
              }}
              className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/95 px-2.5 py-1 text-xs font-medium text-white shadow-xl"
            >
              <button
                type="button"
                data-testid="pen-finish-btn"
                onClick={(ev) => {
                  ev.stopPropagation();
                  finishPenDraft(false);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-blue-500"
              >
                <Check className="h-3 w-3" />
                Tamamla
              </button>
              <button
                type="button"
                data-testid="pen-cancel-btn"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setPenDraftPoints(null);
                  setPenStartSnap(null);
                  setPenHoverSnap(null);
                }}
                className="inline-flex items-center gap-0.5 rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-600"
              >
                <X className="h-3 w-3" />
                İptal
              </button>
            </div>
          )}
        </>
      );
    }

    if (draftRect) {
      const disp = axisAlignedRectBaseToDisplay(
        draftRect,
        page.baseWidth,
        page.baseHeight,
        page.userRotation,
        zoom,
      );
      return (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${disp.x}px`,
            top: `${disp.y}px`,
            width: `${disp.width}px`,
            height: `${disp.height}px`,
            backgroundColor:
              highlightShape === 'redact'
                ? '#000000'
                : highlightShape === 'highlight'
                  ? highlightColor
                  : 'transparent',
            opacity: highlightShape === 'highlight' ? 0.38 : 1,
            border: highlightShape === 'rect' ? `2px solid ${highlightColor}` : undefined,
            zIndex: 45,
          }}
        />
      );
    }

    return null;
  };

  const renderGhostSignaturePreview = () => {
    if (!pendingSignaturePlacement || !hoverBasePoint) return null;
    const { signature, widthPt, heightPt } = pendingSignaturePlacement;
    const disp = axisAlignedRectBaseToDisplay(
      {
        x: hoverBasePoint.x - widthPt / 2,
        y: hoverBasePoint.y - heightPt / 2,
        width: widthPt,
        height: heightPt,
      },
      page.baseWidth,
      page.baseHeight,
      page.userRotation,
      zoom,
    );
    return (
      <div
        data-testid="signature-ghost-preview"
        className="pointer-events-none absolute border-2 border-dashed border-blue-500/80 bg-blue-500/5 rounded"
        style={{
          left: `${disp.x}px`,
          top: `${disp.y}px`,
          width: `${disp.width}px`,
          height: `${disp.height}px`,
          opacity: 0.72,
          zIndex: 520,
        }}
      >
        <img
          src={signature.dataUrl}
          alt="Signature placement preview"
          className="h-full w-full object-fill"
        />
        <span className="absolute -top-5 left-0 rounded bg-blue-600 px-1.5 py-0.5 text-xs font-medium text-white shadow whitespace-nowrap">
          Click to place (Esc to cancel)
        </span>
      </div>
    );
  };

  const pageNumberBox = useMemo(() => {
    if (!pageNumbering?.enabled) return null;
    const rotated = page.userRotation === 90 || page.userRotation === 270;
    const effW = rotated ? page.baseHeight : page.baseWidth;
    const effH = rotated ? page.baseWidth : page.baseHeight;
    return computePageNumberLayout(effW, effH, pageIndex, totalPages, pageNumbering);
  }, [pageNumbering, page.baseWidth, page.baseHeight, page.userRotation, pageIndex, totalPages]);

  const cursorClass = pendingSignaturePlacement
    ? 'cursor-crosshair'
    : toolMode === 'text'
      ? 'cursor-text'
      : toolMode === 'draw' || toolMode === 'highlight' || toolMode === 'shape' || toolMode === 'path'
        ? 'cursor-crosshair'
        : 'cursor-default';

  return (
    <div className="flex flex-col items-center">
      <div
        ref={layerRef}
        data-page-canvas-layer="true"
        data-testid={`pdf-page-${pageIndex + 1}`}
        onPointerDown={handleLayerPointerDown}
        onContextMenu={handleLayerContextMenu}
        onPointerMove={(e) => {
          if (pendingSignaturePlacement) {
            setHoverBasePoint(getBasePointFromEvent(e.clientX, e.clientY));
            return;
          }
          if (toolMode === 'path' && activePathMode === 'pen' && penDraftPoints) {
            const rawPt = getBasePointFromEvent(e.clientX, e.clientY);
            const last = penDraftPoints[penDraftPoints.length - 1];
            const pt = e.shiftKey && last ? constrainSegmentAngle45(last, rawPt) : rawPt;
            setHoverBasePoint(pt);
            const snapRadius = 11 / Math.max(0.25, zoom);
            if (
              penDraftPoints.length >= 3 &&
              Math.hypot(pt.x - penDraftPoints[0].x, pt.y - penDraftPoints[0].y) <= snapRadius
            ) {
              setPenHoverSnap({ kind: 'self-close', point: penDraftPoints[0] });
            } else {
              const peerHit = findNearestOpenPathEndpoint(pt, pagePaths, snapRadius);
              setPenHoverSnap(peerHit ? { kind: 'join-peer', point: peerHit.point, hit: peerHit } : null);
            }
          }
        }}
        onPointerLeave={() => {
          if (hoverBasePoint) setHoverBasePoint(null);
          if (penHoverSnap) setPenHoverSnap(null);
        }}
        onDoubleClick={(e) => {
          if (toolMode === 'path' && activePathMode === 'pen' && penDraftPoints && penDraftPoints.length >= 2) {
            e.stopPropagation();
            finishPenDraft(false);
          }
        }}
        onClick={(e) => {
          if (useEditorStore.getState().isPinching) return;
          if (pendingSignaturePlacement) return;
          if (toolMode !== 'text') return;
          const pt = getBasePointFromEvent(e.clientX, e.clientY);
          const newText: TextAddElement = {
            id: createId('txt'),
            pageId: page.id,
            kind: 'text-add',
            x: Math.max(8, Math.min(page.baseWidth - 150, pt.x)),
            y: Math.max(8, Math.min(page.baseHeight - 36, pt.y - 10)),
            width: 180,
            height: 30,
            rotation: 0,
            opacity: 1,
            zIndex: 0,
            text: 'Type text here',
            fontFamily: 'Helvetica',
            fontSize: 15,
            color: '#0f172a',
            bold: false,
            italic: false,
            align: 'left',
            lineHeight: 1.2,
          };
          addElement(newText, true);
          setToolMode('select');
          setEditingTextElementId(newText.id);
        }}
        style={{
          width: `${displayDims.width}px`,
          height: `${displayDims.height}px`,
          touchAction:
            toolMode === 'draw' ||
            toolMode === 'highlight' ||
            toolMode === 'shape' ||
            toolMode === 'path'
              ? 'none'
              : undefined,
        }}
        className={`relative overflow-hidden bg-white shadow-xl ring-1 ring-slate-300 dark:ring-slate-700 ${cursorClass}`}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: 'relative',
            zIndex: 10,
            width: `${displayDims.width}px`,
            height: `${displayDims.height}px`,
          }}
          className="pointer-events-none block"
        />

        {/* Live masks over modified/deleted PDF text or embedded images */}
        {maskedOriginalRects.map((m) => {
          const disp = axisAlignedRectBaseToDisplay(
            m.rect,
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          );
          return (
            <div
              key={m.id}
              style={{
                position: 'absolute',
                left: `${disp.x - 1}px`,
                top: `${disp.y - 1}px`,
                width: `${disp.width + 2}px`,
                height: `${disp.height + 2}px`,
                backgroundColor: m.color,
                zIndex: 10,
              }}
              className="pointer-events-none"
            />
          );
        })}

        {renderDetectedOverlays()}

        {visibleElements.map(renderElement)}

        {renderDraftPreview()}

        {renderGhostSignaturePreview()}

        {pageNumberBox && pageNumbering && (
          <div
            data-testid={`page-number-preview-${pageIndex + 1}`}
            className="pointer-events-none select-none"
            style={{
              position: 'absolute',
              left: `${pageNumberBox.x * zoom}px`,
              top: `${pageNumberBox.y * zoom}px`,
              width: `${pageNumberBox.width * zoom}px`,
              height: `${pageNumberBox.height * zoom}px`,
              fontFamily: resolveFontDisplayStatus({
                fontFamily: pageNumbering.fontFamily,
                text: pageNumberBox.text,
                userFonts,
                extractedFonts,
              }).cssFamily,
              fontSize: `${pageNumbering.fontSize * zoom}px`,
              color: pageNumbering.color,
              opacity: pageNumbering.opacity,
              textAlign: pageNumberBox.align,
              lineHeight: 1.2,
              zIndex: 480,
            }}
          >
            {pageNumberBox.text}
          </div>
        )}

        {/* Active selection overlay(s), image crop overlay, or direct vector path anchor editor */}
        {toolMode === 'select' &&
          !pendingSignaturePlacement &&
          visibleElements
            .filter((el) => selectedElementIds.includes(el.id) && editingTextElementId !== el.id)
            .map((sel) =>
              (sel.kind === 'image' || sel.kind === 'image-replacement') &&
              croppingImageElementId === sel.id ? (
                <ImageCropOverlay
                  key={`crop-${sel.id}`}
                  element={sel}
                  baseWidth={page.baseWidth}
                  baseHeight={page.baseHeight}
                  userRotation={page.userRotation}
                  zoom={zoom}
                  onApplyCrop={(relCrop) => applyImageCrop(sel.id, relCrop)}
                  onCancel={() => setCroppingImageElementId(null)}
                />
              ) : sel.kind === 'path' && editingPathElementId === sel.id ? (
                <PathNodeEditorOverlay
                  key={`node-${sel.id}`}
                  element={sel}
                  peerPaths={pagePaths}
                  baseWidth={page.baseWidth}
                  baseHeight={page.baseHeight}
                  userRotation={page.userRotation}
                  zoom={zoom}
                  layerRef={layerRef}
                  onClose={() => setEditingPathElementId(null)}
                  beginTransaction={beginTransaction}
                  commitTransaction={commitTransaction}
                  abortTransaction={abortTransaction}
                  updatePathPoints={updatePathPoints}
                  joinVectorPaths={joinVectorPaths}
                />
              ) : (
                <SelectionOverlay
                  key={`sel-${sel.id}`}
                  element={sel}
                  siblingRects={visibleElements
                    .filter((other) => other.id !== sel.id)
                    .map((other) => ({
                      x: other.x,
                      y: other.y,
                      width: other.width,
                      height: other.height,
                    }))}
                  baseWidth={page.baseWidth}
                  baseHeight={page.baseHeight}
                  userRotation={page.userRotation}
                  zoom={zoom}
                  selectBackgroundMode={selectBackgroundMode}
                  onSmartForegroundFallback={resolveForegroundHitAtClientPoint}
                  onUnlockElement={() =>
                    updateElements([{ id: sel.id, patch: { locked: false } }], true)
                  }
                  onAltClickCycle={(cx, cy) => handleAltCycleAtClientPoint(cx, cy)}
                  onStartTextEdit={
                    sel.kind === 'text-add' || sel.kind === 'text-edit'
                      ? () => setEditingTextElementId(sel.id)
                      : sel.kind === 'path'
                        ? () => setEditingPathElementId(sel.id)
                        : undefined
                  }
                />
              ),
            )}

        {bgLongPressPrompt && (
          <button
            type="button"
            data-testid="bg-longpress-select-pill"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (bgLongPressPrompt.image) {
                promoteDetectedImage(bgLongPressPrompt.image, true);
              } else if (bgLongPressPrompt.shape) {
                promoteDetectedShape(bgLongPressPrompt.shape, true);
              }
              setBgLongPressPrompt(null);
            }}
            style={{
              position: 'absolute',
              left: `${Math.max(12, Math.min(displayDims.width - 150, bgLongPressPrompt.x - 65))}px`,
              top: `${Math.max(12, bgLongPressPrompt.y - 42)}px`,
              zIndex: 540,
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/60 bg-slate-900/95 px-3 py-1.5 text-xs font-semibold text-amber-200 shadow-xl backdrop-blur hover:bg-slate-800"
          >
            <Layers className="h-3.5 w-3.5 text-amber-400" />
            <span>Arka Planı Seç</span>
          </button>
        )}
      </div>

      <div className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        Page {pageIndex + 1}
      </div>
    </div>
  );
}
