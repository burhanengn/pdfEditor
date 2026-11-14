import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Check, Copy, Eraser, Feather, PenTool, Sparkles, Trash2, Type, Upload, X } from 'lucide-react';
import type {
  SavedSignature,
  SignatureVariant,
  SignatureVectorPath,
} from '@/types/elements';
import { useEditorStore, type SignatureBatchScope } from '@/store/useEditorStore';
import { createId } from '@/utils/id';
import {
  applyOrganicInkFilterToDataUrl,
  ARCHIVAL_INK_PRESETS,
  buildRealisticInkVectorPaths,
  generateRealisticInkPng,
  renderRealisticInkToCanvas,
  type InkTimedPoint,
} from '@/utils/realisticInk';
import {
  loadSavedSignatures,
  persistSavedSignatures,
  processUploadedSignatureImage,
  renderTypedSignatureToPng,
  TYPED_SIGNATURE_STYLES,
} from '@/utils/signatureStorage';

const INK_COLORS = ARCHIVAL_INK_PRESETS.map((p) => p.color);

interface StrokeBuffer {
  points: InkTimedPoint[];
  color: string;
  strokeWidth: number;
}

function strokePointsToSvgPath(points: InkTimedPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${(points[0].x + 0.5).toFixed(1)} ${(points[0].y + 0.5).toFixed(1)}`;
  }
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

export function SignatureModal() {
  const open = useEditorStore((s) => s.signatureModalOpen);
  const setOpen = useEditorStore((s) => s.setSignatureModalOpen);
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const savedSignatures = useEditorStore((s) => s.savedSignatures);
  const setSavedSignatures = useEditorStore((s) => s.setSavedSignatures);
  const addSavedSignature = useEditorStore((s) => s.addSavedSignature);
  const removeSavedSignature = useEditorStore((s) => s.removeSavedSignature);
  const startPendingSignaturePlacement = useEditorStore(
    (s) => s.startPendingSignaturePlacement,
  );
  const applySignatureToPages = useEditorStore((s) => s.applySignatureToPages);

  const [variant, setVariant] = useState<SignatureVariant>('signature');
  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [inkColor, setInkColor] = useState<string>(ARCHIVAL_INK_PRESETS[0].color);
  const [penSize, setPenSize] = useState(3);
  const [realisticInk, setRealisticInk] = useState(true);
  const [label, setLabel] = useState('');
  const [saveToVault, setSaveToVault] = useState(true);
  const [vaultFilter, setVaultFilter] = useState<'all' | SignatureVariant>('all');

  // Batch multi-page placement state
  const [batchScopeMode, setBatchScopeMode] = useState<SignatureBatchScope['mode']>('all');
  const [batchRangeExpr, setBatchRangeExpr] = useState('2-5');

  // Draw tab state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<StrokeBuffer[]>([]);
  const activeStrokeRef = useRef<StrokeBuffer | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

  // Type tab state
  const [typedText, setTypedText] = useState('Alex Mercer');
  const [typedStyleId, setTypedStyleId] = useState<string>(TYPED_SIGNATURE_STYLES[0].id);

  // Upload tab state
  const [uploadedPreview, setUploadedPreview] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    setSavedSignatures(loadSavedSignatures());
  }, [setSavedSignatures]);

  useEffect(() => {
    persistSavedSignatures(savedSignatures);
  }, [savedSignatures]);

  useEffect(() => {
    if (!uploadedFile) return;
    let cancelled = false;
    processUploadedSignatureImage(uploadedFile, removeWhiteBg)
      .then((res) => {
        if (!cancelled) {
          setUploadedPreview(res);
          setUploadError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setUploadError(err instanceof Error ? err.message : 'Upload processing error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uploadedFile, removeWhiteBg]);

  if (!open) return null;

  const redrawCanvas = (useRealistic = realisticInk) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const allStrokes = activeStrokeRef.current
      ? [...strokesRef.current, activeStrokeRef.current]
      : strokesRef.current;

    if (useRealistic) {
      const grouped = new Map<number, typeof allStrokes>();
      allStrokes.forEach((s) => {
        const list = grouped.get(s.strokeWidth) ?? [];
        list.push(s);
        grouped.set(s.strokeWidth, list);
      });
      for (const [w, group] of grouped.entries()) {
        renderRealisticInkToCanvas(
          ctx,
          group.map((s) => ({ points: s.points, color: s.color })),
          w,
          inkColor,
        );
      }
      return;
    }

    for (const stroke of allStrokes) {
      if (stroke.points.length === 0) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x + 0.5, stroke.points[0].y + 0.5);
      } else {
        for (let i = 1; i < stroke.points.length - 1; i++) {
          const mx = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
          const my = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, mx, my);
        }
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last.x, last.y);
      }
      ctx.stroke();
    }
  };

  const getCanvasPoint = (e: PointerEvent<HTMLCanvasElement>): InkTimedPoint => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      t: performance.now(),
      pressure: e.pressure && e.pressure > 0 ? e.pressure : undefined,
    };
  };

  const handleDrawPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = getCanvasPoint(e);
    activeStrokeRef.current = { points: [pt], color: inkColor, strokeWidth: penSize };
    setHasDrawing(true);
    redrawCanvas();
  };

  const handleDrawPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!activeStrokeRef.current) return;
    activeStrokeRef.current.points.push(getCanvasPoint(e));
    redrawCanvas();
  };

  const handleDrawPointerUp = () => {
    if (!activeStrokeRef.current) return;
    strokesRef.current.push(activeStrokeRef.current);
    activeStrokeRef.current = null;
    redrawCanvas();
  };

  const clearDrawing = () => {
    strokesRef.current = [];
    activeStrokeRef.current = null;
    setHasDrawing(false);
    redrawCanvas();
  };

  const computePlacementDimensions = (sig: SavedSignature) => {
    const targetPage = pages.find((p) => p.id === activePageId) ?? pages[0];
    const pageW = targetPage?.baseWidth ?? 612;
    const isInitials = (sig.variant ?? 'signature') === 'initials';
    const defaultW = isInitials
      ? Math.min(88, Math.max(48, pageW * 0.14))
      : Math.min(190, Math.max(96, pageW * 0.32));
    const ratio = sig.height / Math.max(1, sig.width);
    const defaultH = Math.max(20, Math.round(defaultW * ratio));
    return { widthPt: Math.round(defaultW), heightPt: defaultH };
  };

  const enterInteractivePlacement = (sig: SavedSignature) => {
    const clonedSig: SavedSignature = {
      ...sig,
      templateId: sig.templateId ?? sig.id,
      variant: sig.variant ?? 'signature',
      svgPaths: sig.svgPaths ? sig.svgPaths.map((p) => ({ ...p })) : undefined,
    };
    const { widthPt, heightPt } = computePlacementDimensions(clonedSig);
    startPendingSignaturePlacement({
      signature: clonedSig,
      widthPt,
      heightPt,
      realisticInk: Boolean(clonedSig.realisticInk),
    });
    setOpen(false);
  };

  const buildCreatedSignature = async (): Promise<SavedSignature | null> => {
    const templateId = createId('tmpl');
    const isInitials = variant === 'initials';
    const defaultLabel = isInitials ? 'My Initials (Paraf)' : 'My Signature';

    if (tab === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas || strokesRef.current.length === 0) return null;

      let dataUrl = canvas.toDataURL('image/png');
      let svgPaths: SignatureVectorPath[];

      if (realisticInk) {
        const hiRes = generateRealisticInkPng(
          strokesRef.current.map((s) => ({ points: s.points, color: s.color })),
          penSize,
          inkColor,
          canvas.width,
          canvas.height,
          2,
        );
        dataUrl = hiRes.dataUrl;
        svgPaths = buildRealisticInkVectorPaths(
          strokesRef.current.map((s) => ({ points: s.points, color: s.color })),
          penSize,
          inkColor,
        );
      } else {
        svgPaths = strokesRef.current.map((s) => ({
          d: strokePointsToSvgPath(s.points),
          strokeWidth: s.strokeWidth,
          color: s.color,
        }));
      }

      return {
        id: createId('sig'),
        templateId,
        variant,
        label: label.trim() || defaultLabel,
        mode: 'draw',
        createdAt: Date.now(),
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        realisticInk,
        svgPaths,
        viewBoxWidth: canvas.width,
        viewBoxHeight: canvas.height,
        inkColor,
      };
    }

    if (tab === 'type') {
      const trimmed = typedText.trim();
      if (!trimmed) return null;
      const style =
        TYPED_SIGNATURE_STYLES.find((s) => s.id === typedStyleId) ?? TYPED_SIGNATURE_STYLES[0];
      const rendered = renderTypedSignatureToPng(trimmed, style.fontCss, inkColor);
      const finalDataUrl = realisticInk
        ? await applyOrganicInkFilterToDataUrl(
            rendered.dataUrl,
            inkColor,
            rendered.width * 2,
            rendered.height * 2,
          )
        : rendered.dataUrl;
      return {
        id: createId('sig'),
        templateId,
        variant,
        label: label.trim() || trimmed,
        mode: 'type',
        createdAt: Date.now(),
        dataUrl: finalDataUrl,
        width: rendered.width,
        height: rendered.height,
        realisticInk,
        typedText: trimmed,
        typedFont: style.fontCss,
        inkColor,
      };
    }

    if (tab === 'upload' && uploadedPreview) {
      const finalDataUrl = realisticInk
        ? await applyOrganicInkFilterToDataUrl(
            uploadedPreview.dataUrl,
            inkColor,
            uploadedPreview.width,
            uploadedPreview.height,
          )
        : uploadedPreview.dataUrl;
      return {
        id: createId('sig'),
        templateId,
        variant,
        label: label.trim() || uploadedFile?.name || defaultLabel,
        mode: 'upload',
        createdAt: Date.now(),
        dataUrl: finalDataUrl,
        width: uploadedPreview.width,
        height: uploadedPreview.height,
        realisticInk,
      };
    }

    return null;
  };

  const handleCreateAndPlace = async () => {
    const created = await buildCreatedSignature();
    if (!created) return;
    if (saveToVault) {
      addSavedSignature(created);
    }
    if (pages.length > 0) {
      enterInteractivePlacement(created);
    } else {
      setOpen(false);
    }
  };

  const handleCreateAndApplyAll = async () => {
    if (pages.length === 0) return;
    const created = await buildCreatedSignature();
    if (!created) return;
    if (saveToVault) {
      addSavedSignature(created);
    }
    const { widthPt, heightPt } = computePlacementDimensions(created);
    const scope: SignatureBatchScope = {
      mode: batchScopeMode,
      rangeExpr: batchScopeMode === 'range' ? batchRangeExpr : undefined,
    };
    const isInitials = created.variant === 'initials';
    applySignatureToPages(
      {
        signature: created,
        widthPt,
        heightPt,
        realisticInk: Boolean(created.realisticInk),
        xNorm: isInitials ? 0.86 : 0.76,
        yNorm: 0.9,
      },
      scope,
    );
    setOpen(false);
  };

  const canCreate =
    (tab === 'draw' && hasDrawing) ||
    (tab === 'type' && typedText.trim().length > 0) ||
    (tab === 'upload' && Boolean(uploadedPreview));

  const filteredVault = savedSignatures.filter((sig) =>
    vaultFilter === 'all' ? true : (sig.variant ?? 'signature') === vaultFilter,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-modal-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2
              id="signature-modal-title"
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              Signature Studio & Vault
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Draw, type, or upload a signature. Saved signatures persist locally in your browser.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Close signature modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-y-auto md:grid-cols-5">
          {/* Left: Creator */}
          <div className="space-y-3.5 p-6 md:col-span-3">
            {/* Variant Toggle: Signature (İmza) vs Initials (Paraf) */}
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  data-testid="signature-variant-signature"
                  onClick={() => {
                    setVariant('signature');
                    if (typedText.trim().length <= 4) setTypedText('Alex Mercer');
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    variant === 'signature'
                      ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  <Feather className="h-3 w-3" />
                  Signature (İmza)
                </button>
                <button
                  type="button"
                  data-testid="signature-variant-initials"
                  onClick={() => {
                    setVariant('initials');
                    if (typedText === 'Alex Mercer') setTypedText('AM');
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    variant === 'initials'
                      ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400'
                  }`}
                >
                  <Sparkles className="h-3 w-3" />
                  Initials (Paraf)
                </button>
              </div>

              <button
                type="button"
                data-testid="realistic-ink-toggle"
                onClick={() => {
                  const next = !realisticInk;
                  setRealisticInk(next);
                  redrawCanvas(next);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  realisticInk
                    ? 'border-blue-500/60 bg-blue-50 text-blue-700 dark:border-blue-500/50 dark:bg-blue-950/60 dark:text-blue-200'
                    : 'border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-400'
                }`}
                title="Fountain-pen velocity modulation, ink pooling & capillary paper feathering"
              >
                <Feather className="h-3 w-3" />
                Orijinal Görünümlü Ink {realisticInk ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setTab('draw')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                  tab === 'draw'
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <PenTool className="h-3.5 w-3.5" />
                Draw
              </button>
              <button
                type="button"
                onClick={() => setTab('type')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                  tab === 'type'
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Type className="h-3.5 w-3.5" />
                Type
              </button>
              <button
                type="button"
                onClick={() => setTab('upload')}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition ${
                  tab === 'upload'
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <Upload className="h-3.5 w-3.5" />
                Upload
              </button>
            </div>

            {tab !== 'upload' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Ink:
                  </span>
                  {INK_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setInkColor(c)}
                      style={{ backgroundColor: c }}
                      className={`h-6 w-6 rounded-full border-2 transition ${
                        inkColor === c
                          ? 'scale-110 border-blue-500 ring-2 ring-blue-500/30'
                          : 'border-slate-300 dark:border-slate-600'
                      }`}
                      aria-label={`Select ink color ${c}`}
                    />
                  ))}
                </div>

                {tab === 'draw' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                      Stroke:
                    </span>
                    <input
                      type="range"
                      min={1.5}
                      max={7}
                      step={0.5}
                      value={penSize}
                      onChange={(e) => setPenSize(Number(e.target.value))}
                      className="w-20 accent-blue-600"
                    />
                    <button
                      type="button"
                      onClick={clearDrawing}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Eraser className="h-3.5 w-3.5" />
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}

            {tab === 'draw' && (
              <div className="relative overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-white dark:border-slate-700">
                <canvas
                  ref={canvasRef}
                  width={540}
                  height={190}
                  data-testid="signature-draw-canvas"
                  onPointerDown={handleDrawPointerDown}
                  onPointerMove={handleDrawPointerMove}
                  onPointerUp={handleDrawPointerUp}
                  onPointerCancel={handleDrawPointerUp}
                  className="h-44 w-full cursor-crosshair touch-none"
                />
                {!hasDrawing && (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
                    Sign smoothly with mouse, trackpad, or touch
                  </div>
                )}
              </div>
            )}

            {tab === 'type' && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={typedText}
                  onChange={(e) => setTypedText(e.target.value)}
                  placeholder="Type your signature…"
                  data-testid="signature-type-input"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {TYPED_SIGNATURE_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => setTypedStyleId(style.id)}
                      className={`flex flex-col items-center justify-center rounded-lg border p-3 text-center transition ${
                        typedStyleId === style.id
                          ? 'border-blue-500 bg-blue-50/70 ring-2 ring-blue-500/20 dark:bg-blue-950/30'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-950'
                      }`}
                    >
                      <span
                        style={{ font: style.fontCss, color: inkColor, fontSize: '26px' }}
                        className="truncate max-w-full"
                      >
                        {typedText || 'Signature'}
                      </span>
                      <span className="mt-1 text-[10px] text-slate-400">{style.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {tab === 'upload' && (
              <div className="space-y-3">
                <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-blue-500 dark:border-slate-700">
                  <Upload className="mb-2 h-6 w-6 text-slate-400" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Click to select signature image (PNG, JPG, WebP)
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) setUploadedFile(f);
                    }}
                  />
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={removeWhiteBg}
                    onChange={(e) => setRemoveWhiteBg(e.target.checked)}
                    className="rounded accent-blue-600"
                  />
                  Auto-remove white background (transparent PNG)
                </label>

                {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

                {uploadedPreview && (
                  <div className="checkerboard-bg flex h-28 items-center justify-center rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                    <img
                      src={uploadedPreview.dataUrl}
                      alt="Uploaded signature preview"
                      className="max-h-24 object-contain"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={variant === 'initials' ? 'Paraf / Initials name…' : 'Signature name…'}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={saveToVault}
                  onChange={(e) => setSaveToVault(e.target.checked)}
                  className="rounded accent-blue-600"
                />
                Save to Vault
              </label>
              <button
                type="button"
                disabled={!canCreate}
                onClick={handleCreateAndPlace}
                data-testid="signature-place-btn"
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" />
                {pages.length > 0 ? 'Use & Place' : 'Save Template'}
              </button>
            </div>

            {pages.length > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60">
                <div className="flex items-center gap-2">
                  <Copy className="h-3.5 w-3.5 text-slate-500" />
                  <select
                    value={batchScopeMode}
                    onChange={(e) =>
                      setBatchScopeMode(e.target.value as SignatureBatchScope['mode'])
                    }
                    aria-label="Apply scope"
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <option value="all">All Pages (1–{pages.length})</option>
                    <option value="except-first">Exclude Cover (2–{pages.length})</option>
                    <option value="range">Custom Range</option>
                  </select>
                  {batchScopeMode === 'range' && (
                    <input
                      type="text"
                      value={batchRangeExpr}
                      onChange={(e) => setBatchRangeExpr(e.target.value)}
                      placeholder="e.g. 2-4, 6"
                      className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  )}
                </div>
                <button
                  type="button"
                  disabled={!canCreate}
                  data-testid="signature-apply-all-btn"
                  onClick={handleCreateAndApplyAll}
                  className="inline-flex items-center gap-1 rounded-md border border-blue-500/40 bg-blue-600/10 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-600/20 disabled:opacity-40 dark:text-blue-300"
                >
                  Apply to Selected Pages
                </button>
              </div>
            )}
          </div>

          {/* Right: Saved Signature Vault */}
          <div className="border-t border-slate-200 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-950/60 md:col-span-2 md:border-l md:border-t-0">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Vault ({savedSignatures.length})
              </h3>
              <div className="inline-flex rounded bg-slate-200/80 p-0.5 text-[10px] dark:bg-slate-800">
                {(['all', 'signature', 'initials'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setVaultFilter(f)}
                    className={`rounded px-1.5 py-0.5 font-medium capitalize ${
                      vaultFilter === f
                        ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                        : 'text-slate-500'
                    }`}
                  >
                    {f === 'initials' ? 'Paraf' : f}
                  </button>
                ))}
              </div>
            </div>
            {filteredVault.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-500">
                No saved {vaultFilter === 'initials' ? 'initials' : 'signatures'} yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredVault.map((sig) => (
                  <div
                    key={sig.id}
                    data-testid={`vault-item-${sig.id}`}
                    className="group rounded-lg border border-slate-200 bg-white p-2.5 shadow-sm transition hover:border-blue-400 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="checkerboard-bg mb-2 flex h-14 items-center justify-center rounded border border-slate-100 p-1 dark:border-slate-800">
                      <img
                        src={sig.dataUrl}
                        alt={sig.label}
                        className="max-h-12 object-contain"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">
                          {sig.label}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {(sig.variant ?? 'signature') === 'initials' ? 'Paraf' : 'İmza'}
                          {sig.realisticInk ? ' • Wet Ink' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {pages.length > 0 && (
                          <button
                            type="button"
                            onClick={() => enterInteractivePlacement(sig)}
                            className="rounded bg-blue-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                          >
                            Place
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeSavedSignature(sig.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/50"
                          aria-label={`Delete saved signature ${sig.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
