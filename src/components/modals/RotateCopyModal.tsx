import { useEffect, useState } from 'react';
import { Copy, RotateCw, X } from 'lucide-react';
import type { RotateCopyPivot } from '@/types/elements';
import { useEditorStore } from '@/store/useEditorStore';

const ANGLE_PRESETS = [-90, -45, 15, 30, 45, 60, 90, 180];
const COPY_PRESETS = [1, 2, 3, 5, 7, 11];
const PIVOT_OPTIONS: Array<{ id: RotateCopyPivot; label: string }> = [
  { id: 'center', label: 'Merkez' },
  { id: 'top-center', label: 'Üst Kenar' },
  { id: 'bottom-center', label: 'Alt Uç' },
  { id: 'left-center', label: 'Sol Kenar' },
  { id: 'right-center', label: 'Sağ Kenar' },
];

export function RotateCopyModal() {
  const targetIds = useEditorStore((s) => s.rotateCopyDialogElementIds);
  const lastConfig = useEditorStore((s) => s.lastRotateCopyConfig);
  const openRotateCopyDialog = useEditorStore((s) => s.openRotateCopyDialog);
  const rotateElements = useEditorStore((s) => s.rotateElements);
  const rotateAndDuplicateElements = useEditorStore((s) => s.rotateAndDuplicateElements);

  const [angleDeg, setAngleDeg] = useState<number>(lastConfig?.angleDeg ?? 45);
  const [copies, setCopies] = useState<number>(lastConfig?.copies ?? 1);
  const [pivot, setPivot] = useState<RotateCopyPivot>(lastConfig?.pivot ?? 'center');

  useEffect(() => {
    if (!targetIds) return;
    setAngleDeg(lastConfig?.angleDeg ?? 45);
    setCopies(lastConfig?.copies ?? 1);
    setPivot(lastConfig?.pivot ?? 'center');
  }, [targetIds, lastConfig]);

  if (!targetIds || targetIds.length === 0) return null;

  const close = () => openRotateCopyDialog(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Döndür ve Döndürerek Kopyala"
      data-testid="rotate-copy-modal"
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <RotateCw className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Döndür &amp; Döndürerek Kopyala ({targetIds.length} öğe)
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Kapat"
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5 text-xs">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="rotate-copy-angle-input"
                className="font-medium text-slate-700 dark:text-slate-300"
              >
                Döndürme Açısı (°)
              </label>
              <span className="text-[11px] text-slate-400">
                Pozitif = Saat yönü, Negatif = Saat tersi
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="rotate-copy-angle-input"
                type="number"
                step={5}
                value={angleDeg}
                data-testid="rotate-copy-angle-input"
                onChange={(e) => setAngleDeg(Number(e.target.value) || 0)}
                className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <div className="flex flex-wrap gap-1">
                {ANGLE_PRESETS.map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => setAngleDeg(deg)}
                    className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                      angleDeg === deg
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {deg > 0 ? `+${deg}°` : `${deg}°`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="rotate-copy-count-input"
                className="font-medium text-slate-700 dark:text-slate-300"
              >
                Kopya Adedi
              </label>
              <span className="text-[11px] text-slate-400">
                Örn: 45° × 7 kopya = 8’li rozet
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="rotate-copy-count-input"
                type="number"
                min={1}
                max={24}
                value={copies}
                data-testid="rotate-copy-count-input"
                onChange={(e) => setCopies(Math.max(1, Math.min(24, Math.round(Number(e.target.value) || 1))))}
                className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-sm text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <div className="flex flex-wrap gap-1">
                {COPY_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCopies(n)}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                      copies === n
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {n}×
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block font-medium text-slate-700 dark:text-slate-300">
              Dönüş Noktası (Pivot)
            </span>
            <div className="grid grid-cols-5 gap-1">
              {PIVOT_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  data-testid={`rotate-copy-pivot-${opt.id}`}
                  onClick={() => setPivot(opt.id)}
                  className={`rounded-lg border px-1.5 py-1.5 text-[11px] font-medium transition ${
                    pivot === opt.id
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/60">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            İptal
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="rotate-only-apply-btn"
              onClick={() => {
                rotateElements(targetIds, angleDeg, pivot);
                close();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/50 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
            >
              <RotateCw className="h-3.5 w-3.5" />
              Sadece Döndür
            </button>
            <button
              type="button"
              data-testid="rotate-copy-apply-btn"
              onClick={() => {
                rotateAndDuplicateElements(targetIds, angleDeg, copies, pivot);
                close();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-500"
            >
              <Copy className="h-3.5 w-3.5" />
              Döndürerek Kopyala
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
