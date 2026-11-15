import { useRef, useState, type ChangeEvent } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bold,
  Copy,
  Edit3,
  Hash,
  Image as ImageIcon,
  Italic,
  Layers,
  Link2Off,
  Lock,
  Plus,
  Repeat,
  RotateCcw,
  RotateCw,
  Subscript,
  Superscript,
  Trash2,
  Type as TypeIcon,
  Unlock,
  Upload,
} from 'lucide-react';
import { removeUserCustomFont, uploadCustomFontFiles } from '@/engine/documentController';
import {
  FONT_OPTIONS,
  isBuiltinFontFamily,
  resolveFontDisplayStatus,
} from '@/engine/fonts';
import { useEditorStore, type SignatureBatchScope } from '@/store/useEditorStore';
import { getElementLayerTier, type CanvasElement } from '@/types/elements';
import type { BuiltinFontFamilyOption, FontFamilyOption, FontSourceKind } from '@/types/pdf';
import { dispatchInlineRichFormat } from '../viewport/InlineTextEditor';

const SWATCHES = ['#0f172a', '#1d4ed8', '#dc2626', '#15803d', '#9333ea', '#facc15', '#ffffff'];

export interface RightInspectorProps {
  variant?: 'desktop' | 'sheet';
}

export function RightInspector({ variant = 'desktop' }: RightInspectorProps = {}) {
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);
  const elements = useEditorStore((s) => s.elements);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const editingTextElementId = useEditorStore((s) => s.editingTextElementId);
  const pageExtractions = useEditorStore((s) => s.pageExtractions);

  const updateElements = useEditorStore((s) => s.updateElements);
  const deleteElements = useEditorStore((s) => s.deleteElements);
  const bringToFront = useEditorStore((s) => s.bringToFront);
  const sendToBack = useEditorStore((s) => s.sendToBack);
  const stepLayer = useEditorStore((s) => s.stepLayer);
  const setEditingTextElementId = useEditorStore((s) => s.setEditingTextElementId);

  const rotatePages = useEditorStore((s) => s.rotatePages);
  const duplicatePages = useEditorStore((s) => s.duplicatePages);
  const deletePages = useEditorStore((s) => s.deletePages);
  const startEditDetectedText = useEditorStore((s) => s.startEditDetectedText);
  const promoteDetectedImage = useEditorStore((s) => s.promoteDetectedImage);
  const applyImageToPages = useEditorStore((s) => s.applyImageToPages);
  const unlinkRepeatingImage = useEditorStore((s) => s.unlinkRepeatingImage);
  const applySignatureToPages = useEditorStore((s) => s.applySignatureToPages);
  const pageNumbering = useEditorStore((s) => s.pageNumbering);
  const setPageNumberingModalOpen = useEditorStore((s) => s.setPageNumberingModalOpen);
  const userFonts = useEditorStore((s) => s.userFonts);
  const extractedFonts = useEditorStore((s) => s.extractedFonts);

  const fontInputRef = useRef<HTMLInputElement | null>(null);
  const [repeatScope, setRepeatScope] = useState<'all' | 'odd' | 'even'>('all');
  const [sigBatchMode, setSigBatchMode] = useState<SignatureBatchScope['mode']>('all');
  const [sigBatchRange, setSigBatchRange] = useState('2-5');
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);
  const [fontFeedback, setFontFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const activePageIndex = pages.findIndex((p) => p.id === activePageId);
  const activePage = activePageIndex >= 0 ? pages[activePageIndex] : pages[0];
  const selectedEl: CanvasElement | undefined =
    selectedElementIds.length > 0
      ? elements.find((e) => e.id === selectedElementIds[0])
      : undefined;

  const patchSelected = (patch: Partial<CanvasElement>, recordHistory = true) => {
    if (!selectedEl) return;
    updateElements([{ id: selectedEl.id, patch }], recordHistory);
  };

  const docExtractedFonts = activePage
    ? extractedFonts.filter((f) => f.sourceDocId === activePage.sourceDocId && f.unicodeUsable)
    : [];

  const handleFontFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    e.target.value = '';
    try {
      const { addedIds, matchedBlocks } = await uploadCustomFontFiles(files);
      const countText =
        matchedBlocks > 0
          ? ` — auto-matched ${matchedBlocks} block${matchedBlocks > 1 ? 's' : ''}`
          : '';
      setFontFeedback({
        kind: 'ok',
        text: `Loaded ${files.map((f) => f.name).join(', ')}${countText}`,
      });
      if (selectedEl && addedIds.length === 1 && matchedBlocks === 0 && selectedEl.kind === 'text-add') {
        const added = useEditorStore.getState().userFonts.find((u) => u.id === addedIds[0]);
        if (added) {
          patchSelected({
            fontFamily: added.id,
            fallbackFontFamily: added.fallbackFamily,
            fontSource: 'user',
            isCustomFont: true,
          });
        }
      }
    } catch (err) {
      setFontFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Failed to load custom font file.',
      });
    }
  };

  if (!activePage) {
    if (variant === 'sheet') {
      return (
        <div className="flex w-full flex-col bg-white p-4 dark:bg-slate-950">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Inspector
          </div>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Open a PDF document to inspect page metrics and edit element properties.
          </p>
        </div>
      );
    }
    return (
      <aside className="hidden w-72 shrink-0 flex-col border-l border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 lg:flex">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Inspector
        </div>
        <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Open a PDF document to inspect page metrics and edit element properties.
        </p>
      </aside>
    );
  }

  if (!selectedEl) {
    const extraction = pageExtractions[activePage.id];
    const editedBlocks = new Set(
      elements
        .filter((e) => e.pageId === activePage.id && e.kind === 'text-edit')
        .map((e) => (e.kind === 'text-edit' ? e.originalBlockId : '')),
    );
    const promotedImages = new Set(
      elements
        .filter((e) => e.pageId === activePage.id && e.kind === 'image-replacement')
        .map((e) => (e.kind === 'image-replacement' ? e.originalImageId : '')),
    );

    const Wrapper = variant === 'sheet' ? 'div' : 'aside';
    const wrapperProps =
      variant === 'sheet'
        ? {
            'data-testid': 'mobile-inspector-content',
            className: 'flex w-full flex-col bg-white dark:bg-slate-950',
          }
        : {
            'data-testid': 'right-inspector',
            className:
              'hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:flex',
          };

    return (
      <Wrapper {...wrapperProps}>
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Page Properties
          </div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Page {activePageIndex >= 0 ? activePageIndex + 1 : 1} of {pages.length}
          </div>
        </div>

        <div className="space-y-5 p-4 text-xs">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
            <div>
              <div className="text-[10px] text-slate-400">Width</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {Math.round(activePage.baseWidth)} pt
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Height</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {Math.round(activePage.baseHeight)} pt
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Rotation</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {(activePage.intrinsicRotation + activePage.userRotation) % 360}°
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-400">Overlays</div>
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                {elements.filter((e) => e.pageId === activePage.id).length}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Page Actions
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => rotatePages([activePage.id], -90)}
                className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                90° CCW
              </button>
              <button
                type="button"
                onClick={() => rotatePages([activePage.id], 90)}
                className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <RotateCw className="h-3.5 w-3.5" />
                90° CW
              </button>
              <button
                type="button"
                onClick={() => rotatePages([activePage.id], 180)}
                className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <RotateCw className="h-3.5 w-3.5" />
                180°
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => duplicatePages([activePage.id])}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-2 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <Copy className="h-3.5 w-3.5" />
                Duplicate
              </button>
              <button
                type="button"
                disabled={pages.length <= 1}
                onClick={() => deletePages([activePage.id])}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-red-200 py-2 font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
            <button
              type="button"
              data-testid="inspector-page-numbers-btn"
              onClick={() => setPageNumberingModalOpen(true)}
              className={`mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 font-medium transition ${
                pageNumbering?.enabled
                  ? 'border-blue-500/60 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900'
              }`}
            >
              <Hash className="h-3.5 w-3.5" />
              {pageNumbering?.enabled ? 'Edit Page Numbers (Active)' : 'Add Page Numbers'}
            </button>
          </div>

          {extraction && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <span>Detected Text ({extraction.textBlocks.length})</span>
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                  {extraction.textBlocks.slice(0, 20).map((blk) => (
                    <button
                      key={blk.id}
                      type="button"
                      onClick={() => startEditDetectedText(blk)}
                      className="flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left hover:border-blue-400 hover:bg-blue-50/40 dark:border-slate-800 dark:hover:bg-slate-900"
                    >
                      <TypeIcon className="h-3 w-3 shrink-0 text-blue-500" />
                      <span className="truncate text-[11px] text-slate-700 dark:text-slate-300">
                        {blk.text}
                      </span>
                      {editedBlocks.has(blk.id) && (
                        <span className="ml-auto shrink-0 rounded bg-blue-500/15 px-1 text-[9px] text-blue-500">
                          Edited
                        </span>
                      )}
                    </button>
                  ))}
                  {extraction.textBlocks.length === 0 && (
                    <p className="text-[11px] text-slate-400">No text blocks detected on page.</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Embedded Images ({extraction.images.length})
                </div>
                <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
                  {extraction.images.map((img, i) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => promoteDetectedImage(img, true)}
                      className="flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-left hover:border-emerald-400 hover:bg-emerald-50/40 dark:border-slate-800 dark:hover:bg-slate-900"
                    >
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span className="truncate text-[11px] text-slate-700 dark:text-slate-300">
                        Image #{i + 1} ({img.pixelWidth}×{img.pixelHeight})
                      </span>
                      {promotedImages.has(img.id) && (
                        <span className="ml-auto shrink-0 rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-500">
                          Active
                        </span>
                      )}
                    </button>
                  ))}
                  {extraction.images.length === 0 && (
                    <p className="text-[11px] text-slate-400">No embedded XObject images.</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 border-t border-slate-200 pt-3 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Custom Fonts ({userFonts.length})
                  </span>
                  <button
                    type="button"
                    data-testid="upload-custom-font-btn"
                    onClick={() => fontInputRef.current?.click()}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <Upload className="h-3 w-3" />
                    Add Font
                  </button>
                  <input
                    ref={fontInputRef}
                    type="file"
                    accept=".ttf,.otf,.woff"
                    multiple
                    data-testid="upload-custom-font-input"
                    onChange={handleFontFileChange}
                    className="hidden"
                  />
                </div>
                {fontFeedback && (
                  <p
                    data-testid="font-upload-status"
                    className={`rounded px-2 py-1 text-[10px] ${
                      fontFeedback.kind === 'err'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {fontFeedback.text}
                  </p>
                )}
                {docExtractedFonts.length > 0 && (
                  <div className="space-y-1">
                    {docExtractedFonts.map((ef) => (
                      <div
                        key={ef.id}
                        className="flex items-center justify-between rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        <span className="truncate">{ef.displayName}</span>
                        <span className="ml-1 shrink-0 text-[9px] text-emerald-600 dark:text-emerald-400">
                          Extracted
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {userFonts.length > 0 && (
                  <div className="space-y-1">
                    {userFonts.map((uf) => (
                      <div
                        key={uf.id}
                        className="flex items-center justify-between rounded bg-blue-500/10 px-2 py-1 text-[10px] text-blue-700 dark:text-blue-300"
                      >
                        <span className="truncate">{uf.name}</span>
                        <button
                          type="button"
                          onClick={() => void removeUserCustomFont(uf.id)}
                          title={`Remove ${uf.name}`}
                          className="ml-1 rounded p-0.5 text-slate-500 hover:bg-red-500/20 hover:text-red-500"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {docExtractedFonts.length === 0 && userFonts.length === 0 && (
                  <p className="text-[10px] text-slate-400">
                    Upload .ttf / .otf / .woff fonts to match custom PDF typography cleanly.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </Wrapper>
    );
  }

  const isText = selectedEl.kind === 'text-add' || selectedEl.kind === 'text-edit';
  const isImageLike =
    selectedEl.kind === 'image' ||
    selectedEl.kind === 'image-replacement' ||
    selectedEl.kind === 'signature';

  const SelectedWrapper = variant === 'sheet' ? 'div' : 'aside';
  const selectedWrapperProps =
    variant === 'sheet'
      ? {
          'data-testid': 'mobile-inspector-content',
          className: 'flex w-full flex-col bg-white dark:bg-slate-950',
        }
      : {
          'data-testid': 'right-inspector',
          className:
            'hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:flex',
        };

  return (
    <SelectedWrapper {...selectedWrapperProps}>
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Selected Element
          </div>
          <div className="text-xs font-semibold capitalize text-slate-900 dark:text-slate-100">
            {selectedEl.kind.replace('-', ' ')}
          </div>
        </div>
        <button
          type="button"
          onClick={() => deleteElements([selectedEl.id])}
          data-testid="inspector-delete-btn"
          title="Delete Element (Delete)"
          className="rounded-lg p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-5 p-4 text-xs">
        {/* Text Properties */}
        {isText && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Typography
              </span>
              <button
                type="button"
                onClick={() => setEditingTextElementId(selectedEl.id)}
                className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-500/20 dark:text-blue-400"
              >
                <Edit3 className="h-3 w-3" />
                Edit Inline
              </button>
            </div>

            <div>
              <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                Text Content
              </label>
              <textarea
                rows={2}
                value={selectedEl.text}
                data-testid="inspector-text-content"
                onChange={(e) => patchSelected({ text: e.target.value, runs: undefined })}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-slate-500 dark:text-slate-400">
                  Font Family
                </label>
                <button
                  type="button"
                  data-testid="upload-custom-font-btn"
                  onClick={() => fontInputRef.current?.click()}
                  className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
                >
                  <Plus className="h-3 w-3" />
                  Add Font
                </button>
                <input
                  ref={fontInputRef}
                  type="file"
                  accept=".ttf,.otf,.woff"
                  multiple
                  data-testid="upload-custom-font-input"
                  onChange={handleFontFileChange}
                  className="hidden"
                />
              </div>
              <select
                value={selectedEl.fontFamily}
                data-testid="inspector-font-family"
                onChange={(e) => {
                  const nextId = e.target.value as FontFamilyOption;
                  if (nextId.startsWith('user:')) {
                    const uf = userFonts.find((u) => u.id === nextId);
                    patchSelected({
                      fontFamily: nextId,
                      fallbackFontFamily: uf?.fallbackFamily ?? selectedEl.fallbackFontFamily ?? 'Helvetica',
                      fontSource: 'user' as FontSourceKind,
                      isCustomFont: true,
                    });
                  } else if (nextId.startsWith('embedded:')) {
                    const ef = extractedFonts.find((f) => f.id === nextId);
                    patchSelected({
                      fontFamily: nextId,
                      fallbackFontFamily: ef?.fallbackFamily ?? selectedEl.fallbackFontFamily ?? 'Helvetica',
                      fontSource: 'embedded' as FontSourceKind,
                      isCustomFont: true,
                    });
                  } else {
                    const nextBuiltin = (isBuiltinFontFamily(nextId) ? nextId : 'Helvetica') as BuiltinFontFamilyOption;
                    patchSelected({
                      fontFamily: nextBuiltin,
                      fallbackFontFamily: nextBuiltin,
                      fontSource: 'builtin' as FontSourceKind,
                    });
                  }
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              >
                {docExtractedFonts.length > 0 && (
                  <optgroup label="Document Embedded Fonts">
                    {docExtractedFonts.map((ef) => (
                      <option key={ef.id} value={ef.id}>
                        {ef.displayName} (Embedded)
                      </option>
                    ))}
                  </optgroup>
                )}
                {userFonts.length > 0 && (
                  <optgroup label="My Uploaded Fonts">
                    {userFonts.map((uf) => (
                      <option key={uf.id} value={uf.id}>
                        {uf.name} (Custom)
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Standard & Built-in Fonts">
                  {FONT_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            {fontFeedback && (
              <div
                data-testid="font-upload-status"
                className={`rounded-lg px-2.5 py-1.5 text-[11px] ${
                  fontFeedback.kind === 'err'
                    ? 'border border-red-400/50 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-950/40 dark:text-red-300'
                    : 'border border-emerald-400/50 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-200'
                }`}
              >
                {fontFeedback.text}
              </div>
            )}

            {(() => {
              const fontStatus = resolveFontDisplayStatus({
                fontFamily: selectedEl.fontFamily,
                fallbackFontFamily: selectedEl.fallbackFontFamily,
                originalFontName: selectedEl.originalFontName,
                isCustomFont: selectedEl.isCustomFont,
                text: selectedEl.text,
                userFonts,
                extractedFonts,
              });
              if (fontStatus.status === 'embedded-complete' || fontStatus.status === 'user-complete') {
                return (
                  <div
                    data-testid="inspector-custom-font-active"
                    className="rounded-lg border border-emerald-400/50 bg-emerald-50 px-2.5 py-2 text-[11px] text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950/50 dark:text-emerald-200"
                  >
                    {fontStatus.status === 'user-complete'
                      ? `Custom font (${fontStatus.label}) active — full local editing & export.`
                      : `Extracted embedded PDF font (${fontStatus.label}) active.`}
                  </div>
                );
              }
              if (
                fontStatus.status === 'embedded-partial' ||
                fontStatus.status === 'user-partial' ||
                fontStatus.status === 'fallback'
              ) {
                return (
                  <div
                    data-testid="inspector-custom-font-warning"
                    className="space-y-1.5 rounded-lg border border-amber-400/50 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/50 dark:text-amber-200"
                  >
                    <div>
                      {fontStatus.status === 'fallback' ? (
                        <>
                          Embedded custom font
                          {selectedEl.originalFontName ? ` (${selectedEl.originalFontName})` : ''} has
                          restricted encoding — using closest visual match [{fontStatus.fallbackLabel}].
                        </>
                      ) : (
                        <>
                          {fontStatus.label} is a subset missing [
                          {fontStatus.missingChars.slice(0, 6).join(', ')}] — fallback [
                          {fontStatus.fallbackLabel}] used for those glyphs.
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => fontInputRef.current?.click()}
                      className="inline-flex items-center gap-1 rounded bg-amber-600/20 px-2 py-0.5 text-[10px] font-medium hover:bg-amber-600/30"
                    >
                      <Upload className="h-3 w-3" />
                      Upload matching .ttf / .otf font
                    </button>
                  </div>
                );
              }
              return null;
            })()}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Size (pt)
                </label>
                <input
                  type="number"
                  min={6}
                  max={144}
                  value={selectedEl.fontSize}
                  data-testid="inspector-font-size"
                  onChange={(e) =>
                    patchSelected({ fontSize: Math.max(6, Math.min(144, Number(e.target.value) || 12)) })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Line Height
                </label>
                <input
                  type="number"
                  min={0.9}
                  max={2.5}
                  step={0.05}
                  value={selectedEl.lineHeight}
                  onChange={(e) =>
                    patchSelected({
                      lineHeight: Math.max(0.9, Math.min(2.5, Number(e.target.value) || 1.2)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Char Spacing (pt)
                </label>
                <input
                  type="number"
                  min={-2}
                  max={10}
                  step={0.2}
                  value={selectedEl.letterSpacing ?? 0}
                  onChange={(e) =>
                    patchSelected({
                      letterSpacing: Math.max(-2, Math.min(10, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                  Width Scale
                </label>
                <input
                  type="number"
                  min={0.65}
                  max={1.5}
                  step={0.05}
                  value={selectedEl.horizontalScale ?? 1}
                  onChange={(e) =>
                    patchSelected({
                      horizontalScale: Math.max(0.65, Math.min(1.5, Number(e.target.value) || 1)),
                    })
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Bold"
                  data-testid="inspector-bold-btn"
                  data-keep-inline-editor="true"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const sel = window.getSelection();
                    if (
                      editingTextElementId === selectedEl.id &&
                      sel &&
                      !sel.isCollapsed
                    ) {
                      dispatchInlineRichFormat({ elementId: selectedEl.id, toggleBold: true });
                    } else {
                      patchSelected({ bold: !selectedEl.bold });
                    }
                  }}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.bold
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Bold className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Italic"
                  data-testid="inspector-italic-btn"
                  data-keep-inline-editor="true"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const sel = window.getSelection();
                    if (
                      editingTextElementId === selectedEl.id &&
                      sel &&
                      !sel.isCollapsed
                    ) {
                      dispatchInlineRichFormat({ elementId: selectedEl.id, toggleItalic: true });
                    } else {
                      patchSelected({ italic: !selectedEl.italic });
                    }
                  }}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.italic
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Italic className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Superscript (select characters in inline editor)"
                  data-testid="inspector-super-btn"
                  data-keep-inline-editor="true"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (editingTextElementId !== selectedEl.id) {
                      setEditingTextElementId(selectedEl.id);
                    } else {
                      dispatchInlineRichFormat({ elementId: selectedEl.id, script: 'super' });
                    }
                  }}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.runs?.some((r) => r.script === 'super')
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Superscript className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Subscript (select characters in inline editor)"
                  data-testid="inspector-sub-btn"
                  data-keep-inline-editor="true"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    if (editingTextElementId !== selectedEl.id) {
                      setEditingTextElementId(selectedEl.id);
                    } else {
                      dispatchInlineRichFormat({ elementId: selectedEl.id, script: 'sub' });
                    }
                  }}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.runs?.some((r) => r.script === 'sub')
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <Subscript className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title="Align Left"
                  data-testid="inspector-align-left-btn"
                  onClick={() => patchSelected({ align: 'left' })}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.align === 'left'
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <AlignLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Align Center"
                  data-testid="inspector-align-center-btn"
                  onClick={() => patchSelected({ align: 'center' })}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.align === 'center'
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <AlignCenter className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Align Right"
                  data-testid="inspector-align-right-btn"
                  onClick={() => patchSelected({ align: 'right' })}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.align === 'right'
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <AlignRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Justify (Two-Side)"
                  data-testid="inspector-align-justify-btn"
                  onClick={() => patchSelected({ align: 'justify' })}
                  className={`rounded-md border p-1.5 ${
                    selectedEl.align === 'justify'
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
                  }`}
                >
                  <AlignJustify className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] text-slate-500 dark:text-slate-400">
                Text Color
              </label>
              <div className="flex items-center gap-1.5">
                {SWATCHES.slice(0, 6).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => patchSelected({ color: c })}
                    style={{ backgroundColor: c }}
                    className={`h-5 w-5 rounded-full border ${
                      selectedEl.color === c
                        ? 'ring-2 ring-blue-500 ring-offset-1'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  />
                ))}
                <input
                  type="color"
                  value={selectedEl.color}
                  onChange={(e) => patchSelected({ color: e.target.value })}
                  className="h-6 w-7 cursor-pointer rounded border border-slate-300 bg-transparent p-0 dark:border-slate-700"
                />
              </div>
            </div>
          </div>
        )}

        {/* Stroke / Highlight Style */}
        {selectedEl.kind === 'stroke' && (
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Stroke Style
            </div>
            <div className="flex items-center gap-1.5">
              {SWATCHES.slice(0, 6).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => patchSelected({ strokeColor: c })}
                  style={{ backgroundColor: c }}
                  className="h-5 w-5 rounded-full border border-slate-300"
                />
              ))}
              <input
                type="color"
                value={selectedEl.strokeColor}
                onChange={(e) => patchSelected({ strokeColor: e.target.value })}
                className="h-6 w-7 cursor-pointer rounded border border-slate-300 bg-transparent p-0"
              />
            </div>
            <div>
              <label className="mb-1 flex justify-between text-[11px] text-slate-500">
                <span>Stroke Width</span>
                <span>{selectedEl.strokeWidth} pt</span>
              </label>
              <input
                type="range"
                min={1}
                max={16}
                step={0.5}
                value={selectedEl.strokeWidth}
                onChange={(e) => patchSelected({ strokeWidth: Number(e.target.value) })}
                className="w-full accent-blue-600"
              />
            </div>
          </div>
        )}

        {selectedEl.kind === 'highlight' && (
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Annotation Style
            </div>
            <div className="flex items-center gap-1.5">
              {SWATCHES.slice(0, 6).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    patchSelected(
                      selectedEl.shape === 'rect'
                        ? { strokeColor: c, fillColor: c }
                        : { fillColor: c },
                    )
                  }
                  style={{ backgroundColor: c }}
                  className="h-5 w-5 rounded-full border border-slate-300"
                />
              ))}
            </div>
          </div>
        )}

        {/* Image / Signature Options */}
        {isImageLike && (
          <div className="space-y-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Asset Options
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900">
              <span className="text-slate-600 dark:text-slate-300">Aspect Lock</span>
              <button
                type="button"
                onClick={() => patchSelected({ aspectLocked: !selectedEl.aspectLocked })}
                className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[11px] font-medium shadow-sm dark:bg-slate-800"
              >
                {selectedEl.aspectLocked ? (
                  <>
                    <Lock className="h-3 w-3 text-blue-500" />
                    Locked
                  </>
                ) : (
                  <>
                    <Unlock className="h-3 w-3 text-slate-400" />
                    Free
                  </>
                )}
              </button>
            </div>

            {(selectedEl.kind === 'image' || selectedEl.kind === 'image-replacement') &&
              pages.length > 1 && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                      Her Sayfaya Ekle (Repeat Header/Watermark)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={repeatScope}
                      onChange={(e) => setRepeatScope(e.target.value as 'all' | 'odd' | 'even')}
                      data-testid="inspector-repeat-scope"
                      className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="all">All Pages (1–{pages.length})</option>
                      <option value="odd">Odd Pages Only</option>
                      <option value="even">Even Pages Only</option>
                    </select>
                    <button
                      type="button"
                      data-testid="inspector-repeat-image-btn"
                      onClick={() => {
                        applyImageToPages(
                          selectedEl.id,
                          repeatScope,
                          selectedEl.behindContent,
                        );
                        setBatchFeedback('Applied to selected pages.');
                      }}
                      className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                    >
                      <Repeat className="h-3 w-3" />
                      Repeat
                    </button>
                  </div>
                  {selectedEl.repeatGroupId && (
                    <div className="flex items-center justify-between pt-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                      <span>Linked across {selectedEl.repeatScope ?? 'all'} pages</span>
                      <button
                        type="button"
                        onClick={() => unlinkRepeatingImage(selectedEl.id)}
                        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                      >
                        <Link2Off className="h-2.5 w-2.5" />
                        Unlink Page
                      </button>
                    </div>
                  )}
                </div>
              )}

            {selectedEl.kind === 'signature' && pages.length > 1 && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                  Apply {selectedEl.variant === 'initials' ? 'Paraf' : 'Signature'} to Pages
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={sigBatchMode}
                    onChange={(e) =>
                      setSigBatchMode(e.target.value as SignatureBatchScope['mode'])
                    }
                    className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="all">All Pages</option>
                    <option value="except-first">Exclude Cover Page</option>
                    <option value="range">Custom Range</option>
                  </select>
                  <button
                    type="button"
                    data-testid="inspector-apply-sig-pages-btn"
                    onClick={() => {
                      const count = applySignatureToPages(
                        { sourceElementId: selectedEl.id },
                        {
                          mode: sigBatchMode,
                          rangeExpr: sigBatchMode === 'range' ? sigBatchRange : undefined,
                        },
                      );
                      setBatchFeedback(`Placed on ${count} other page(s).`);
                    }}
                    className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-blue-500"
                  >
                    Apply
                  </button>
                </div>
                {sigBatchMode === 'range' && (
                  <input
                    type="text"
                    value={sigBatchRange}
                    onChange={(e) => setSigBatchRange(e.target.value)}
                    placeholder="e.g. 2-4, 6"
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-[11px] dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                )}
              </div>
            )}

            {batchFeedback && (
              <div className="text-[10px] font-medium text-blue-600 dark:text-blue-400">
                {batchFeedback}
              </div>
            )}
          </div>
        )}

        {/* Opacity */}
        <div>
          <label className="mb-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Opacity</span>
            <span>{Math.round(selectedEl.opacity * 100)}%</span>
          </label>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={selectedEl.opacity}
            data-testid="inspector-opacity-slider"
            onChange={(e) => patchSelected({ opacity: Number(e.target.value) })}
            className="w-full accent-blue-600"
          />
        </div>

        {/* Geometry: X / Y / W / H / Rotation */}
        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Layout & Transform (pt)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] text-slate-400">X</label>
              <input
                type="number"
                value={Math.round(selectedEl.x)}
                data-testid="inspector-x-input"
                onChange={(e) => patchSelected({ x: Number(e.target.value) || 0 })}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-slate-400">Y</label>
              <input
                type="number"
                value={Math.round(selectedEl.y)}
                data-testid="inspector-y-input"
                onChange={(e) => patchSelected({ y: Number(e.target.value) || 0 })}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-slate-400">Width</label>
              <input
                type="number"
                min={8}
                value={Math.round(selectedEl.width)}
                data-testid="inspector-w-input"
                onChange={(e) =>
                  patchSelected({
                    width: Math.max(8, Number(e.target.value) || 8),
                    ...(selectedEl.kind === 'text-edit' || selectedEl.kind === 'text-add'
                      ? { widthResizedByUser: true }
                      : {}),
                  })
                }
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-slate-400">Height</label>
              <input
                type="number"
                min={8}
                value={Math.round(selectedEl.height)}
                data-testid="inspector-h-input"
                onChange={(e) =>
                  patchSelected({ height: Math.max(8, Number(e.target.value) || 8) })
                }
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-0.5 block text-[10px] text-slate-400">Rotation (°)</label>
              <input
                type="number"
                value={Math.round(selectedEl.rotation)}
                data-testid="inspector-rotation-input"
                onChange={(e) => patchSelected({ rotation: Number(e.target.value) || 0 })}
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={() => patchSelected({ rotation: 0 })}
              className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              Reset 0°
            </button>
          </div>
        </div>

        {/* Layer Order */}
        <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Layer Order
            </span>
            <span
              data-testid="inspector-layer-tier-badge"
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              Tier {getElementLayerTier(selectedEl)}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            <button
              type="button"
              title="Bring to Front"
              onClick={() => bringToFront([selectedEl.id])}
              className="flex flex-col items-center rounded border border-slate-200 py-1.5 text-[10px] text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <ArrowUpToLine className="h-3.5 w-3.5" />
              Front
            </button>
            <button
              type="button"
              title="Bring Forward"
              onClick={() => stepLayer([selectedEl.id], 'forward')}
              className="flex flex-col items-center rounded border border-slate-200 py-1.5 text-[10px] text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <ArrowUp className="h-3.5 w-3.5" />
              Fwd
            </button>
            <button
              type="button"
              title="Send Backward"
              onClick={() => stepLayer([selectedEl.id], 'backward')}
              className="flex flex-col items-center rounded border border-slate-200 py-1.5 text-[10px] text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <ArrowDown className="h-3.5 w-3.5" />
              Back
            </button>
            <button
              type="button"
              title="Send to Back"
              onClick={() => sendToBack([selectedEl.id])}
              className="flex flex-col items-center rounded border border-slate-200 py-1.5 text-[10px] text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Bottom
            </button>
          </div>
          <div className="space-y-1.5">
            <button
              type="button"
              data-testid="inspector-lock-layer-toggle"
              aria-pressed={!!selectedEl.locked}
              onClick={() => patchSelected({ locked: !selectedEl.locked })}
              className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                selectedEl.locked
                  ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900'
              }`}
            >
              {selectedEl.locked ? (
                <>
                  <Unlock className="h-3.5 w-3.5" />
                  Kilidi Aç (Katman Kilitli)
                </>
              ) : (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Katmanı Kilitle
                </>
              )}
            </button>

            {(selectedEl.kind === 'image' || selectedEl.kind === 'image-replacement') && (
              <>
                <button
                  type="button"
                  data-testid="inspector-background-layer-toggle"
                  aria-pressed={!!selectedEl.isBackgroundLayer}
                  onClick={() => patchSelected({ isBackgroundLayer: !selectedEl.isBackgroundLayer })}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                    selectedEl.isBackgroundLayer
                      ? 'border-amber-500 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Arka Plan Katmanı {selectedEl.isBackgroundLayer ? '(Aktif)' : ''}
                </button>
                <button
                  type="button"
                  data-testid="inspector-behind-content-toggle"
                  aria-pressed={!!selectedEl.behindContent}
                  onClick={() => patchSelected({ behindContent: !selectedEl.behindContent })}
                  className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                    selectedEl.behindContent
                      ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900'
                  }`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  {selectedEl.behindContent
                    ? 'Behind PDF Content (Watermark)'
                    : 'Place Behind PDF Content'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </SelectedWrapper>
  );
}
