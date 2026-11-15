import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import type { PageMeta, SourceDocument } from '@/types/pdf';
import { getElementLayerTier, type SavedSignature, type TextAddElement } from '@/types/elements';

function makeDoc(): { doc: SourceDocument; pages: PageMeta[] } {
  const doc: SourceDocument = {
    id: 'doc_1',
    name: 'test.pdf',
    bytes: new Uint8Array([1, 2, 3]),
    wasEncrypted: false,
    pageCount: 2,
  };
  const pages: PageMeta[] = [
    {
      id: 'p1',
      sourceDocId: 'doc_1',
      sourcePageIndex: 0,
      baseWidth: 612,
      baseHeight: 792,
      intrinsicRotation: 0,
      userRotation: 0,
      mediaBox: [0, 0, 612, 792],
      cropBox: [0, 0, 612, 792],
    },
    {
      id: 'p2',
      sourceDocId: 'doc_1',
      sourcePageIndex: 1,
      baseWidth: 612,
      baseHeight: 792,
      intrinsicRotation: 0,
      userRotation: 0,
      mediaBox: [0, 0, 612, 792],
      cropBox: [0, 0, 612, 792],
    },
  ];
  return { doc, pages };
}

describe('useEditorStore undo/redo and operations', () => {
  beforeEach(() => {
    useEditorStore.getState().resetDocument();
  });

  it('coalesces drag transactions into a single undoable step', () => {
    const { doc, pages } = makeDoc();
    useEditorStore.getState().loadInitialDocument(doc, pages);

    const el: TextAddElement = {
      id: 'txt_1',
      pageId: 'p1',
      kind: 'text-add',
      x: 50,
      y: 50,
      width: 120,
      height: 30,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      text: 'Hello',
      fontFamily: 'Helvetica',
      fontSize: 14,
      color: '#000000',
      bold: false,
      italic: false,
      align: 'left',
      lineHeight: 1.2,
    };

    useEditorStore.getState().addElement(el);
    expect(useEditorStore.getState().past).toHaveLength(1);

    // Simulate pointer drag across 5 frames inside one transaction
    useEditorStore.getState().beginTransaction();
    for (let step = 1; step <= 5; step++) {
      useEditorStore.getState().updateElements([{ id: 'txt_1', patch: { x: 50 + step * 10 } }]);
    }
    useEditorStore.getState().commitTransaction();

    expect(useEditorStore.getState().elements[0].x).toBe(100);
    expect(useEditorStore.getState().past).toHaveLength(2);

    // Single undo restores pre-drag x=50
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().elements[0].x).toBe(50);

    // Redo brings back x=100
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().elements[0].x).toBe(100);
  });

  it('rotates, reorders, duplicates, and deletes pages with undo/redo', () => {
    const { doc, pages } = makeDoc();
    useEditorStore.getState().loadInitialDocument(doc, pages);

    useEditorStore.getState().rotatePages(['p1'], 90);
    expect(useEditorStore.getState().pages[0].userRotation).toBe(90);

    useEditorStore.getState().reorderPages(0, 1);
    expect(useEditorStore.getState().pages.map((p) => p.id)).toEqual(['p2', 'p1']);

    useEditorStore.getState().duplicatePages(['p2']);
    expect(useEditorStore.getState().pages).toHaveLength(3);

    useEditorStore.getState().deletePages(['p1']);
    expect(useEditorStore.getState().pages).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().pages).toHaveLength(3);
  });

  it('marks text-edit and image-replacement as deleted rather than purging them', () => {
    const { doc, pages } = makeDoc();
    useEditorStore.getState().loadInitialDocument(doc, pages);

    const edit = useEditorStore.getState().startEditDetectedText({
      id: 'blk_1',
      pageId: 'p1',
      text: 'Original',
      x: 40,
      y: 60,
      width: 100,
      height: 16,
      fontSize: 12,
      fontFamily: 'Helvetica',
      rawFontName: 'Helvetica',
      bold: false,
      italic: false,
      color: '#111111',
      lineHeight: 1.2,
      baselineOffset: 10,
    });

    useEditorStore.getState().deleteElements([edit.id]);
    const stored = useEditorStore.getState().elements[0];
    expect(stored.kind).toBe('text-edit');
    if (stored.kind === 'text-edit') {
      expect(stored.deleted).toBe(true);
    }

    // Undo restores it as non-deleted
    useEditorStore.getState().undo();
    const restored = useEditorStore.getState().elements[0];
    if (restored.kind === 'text-edit') {
      expect(restored.deleted).toBeFalsy();
    }
  });

  it('supports Shift+Click contiguous range and Ctrl+Click toggle selection', () => {
    const doc: SourceDocument = {
      id: 'doc_multi',
      name: 'multi.pdf',
      bytes: new Uint8Array([1, 2, 3]),
      wasEncrypted: false,
      pageCount: 5,
    };
    const pages: PageMeta[] = Array.from({ length: 5 }, (_, i) => ({
      id: `mp_${i + 1}`,
      sourceDocId: 'doc_multi',
      sourcePageIndex: i,
      baseWidth: 595,
      baseHeight: 842,
      intrinsicRotation: 0,
      userRotation: 0,
      mediaBox: [0, 0, 595, 842],
      cropBox: [0, 0, 595, 842],
    }));
    useEditorStore.getState().loadInitialDocument(doc, pages);

    // Click p2 sets anchor
    useEditorStore.getState().selectPageWithModifiers('mp_2');
    expect(useEditorStore.getState().selectedPageIds).toEqual(['mp_2']);

    // Shift+Click p4 selects mp_2..mp_4
    useEditorStore.getState().selectPageWithModifiers('mp_4', { shiftKey: true });
    expect(useEditorStore.getState().selectedPageIds).toEqual(['mp_2', 'mp_3', 'mp_4']);

    // Ctrl+Click mp_3 toggles it off cleanly
    useEditorStore.getState().selectPageWithModifiers('mp_3', { ctrlOrMetaKey: true });
    expect(useEditorStore.getState().selectedPageIds).toEqual(['mp_2', 'mp_4']);
  });

  it('isolates Z-order tiers and keeps multi-placed vault signatures independent', () => {
    const { doc, pages } = makeDoc();
    useEditorStore.getState().loadInitialDocument(doc, pages);

    const imgEl = useEditorStore.getState().promoteDetectedImage({
      id: 'det_img_1',
      pageId: 'p1',
      resourceName: '/Im1',
      operatorIndex: 1,
      x: 50,
      y: 50,
      width: 400,
      height: 600,
      rotation: 0,
      pixelWidth: 400,
      pixelHeight: 600,
      previewUrl: 'blob:mock1',
      pngBytes: new Uint8Array([1, 2, 3, 4]),
      behindContent: true,
      isHeaderOrBackground: true,
    });
    const textEl = useEditorStore.getState().startEditDetectedText({
      id: 'det_txt_1',
      pageId: 'p1',
      text: 'Overlapping Heading',
      x: 100,
      y: 120,
      width: 180,
      height: 20,
      fontSize: 12,
      fontFamily: 'Helvetica',
      rawFontName: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      lineHeight: 1.2,
      baselineOffset: 10,
    });

    expect(imgEl).not.toBeNull();
    if (!imgEl) throw new Error('expected promoted image');
    expect(getElementLayerTier(imgEl)).toBe(1);
    expect(getElementLayerTier(textEl)).toBe(3);

    // Place same vault template twice across pages -> distinct IDs & non-aliased png buffers
    const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const saved: SavedSignature = {
      id: 'vault_sig_1',
      templateId: 'tmpl_1',
      variant: 'initials',
      label: 'JD Paraf',
      mode: 'draw',
      createdAt: Date.now(),
      dataUrl: tinyPng,
      width: 120,
      height: 50,
      realisticInk: true,
    };

    const sig1 = useEditorStore.getState().placeSignatureAt('p1', 200, 300, {
      signature: saved,
      widthPt: 90,
      heightPt: 40,
      realisticInk: true,
    });
    const sig2 = useEditorStore.getState().placeSignatureAt('p2', 450, 700, {
      signature: saved,
      widthPt: 90,
      heightPt: 40,
      realisticInk: true,
    });

    expect(sig1 && sig2).toBeTruthy();
    expect(sig1!.id).not.toBe(sig2!.id);
    expect(sig1!.pngBytes).not.toBe(sig2!.pngBytes);
    expect(sig1!.variant).toBe('initials');

    // Synced repeating image propagates geometric edits across all target pages
    useEditorStore.getState().applyImageToPages(imgEl.id, 'all', true);
    const repeatedP2 = useEditorStore
      .getState()
      .elements.find((e) => e.pageId === 'p2' && e.kind === 'image');
    expect(repeatedP2).toBeDefined();
    useEditorStore.getState().updateElements([{ id: imgEl.id, patch: { x: 88 } }], true);
    const updatedP2 = useEditorStore
      .getState()
      .elements.find((e) => e.id === repeatedP2!.id);
    expect(updatedP2?.x).toBe(88);
  });

  it('classifies Stage 2 background images via text-block overlap and guards background promotion', () => {
    const { doc, pages } = makeDoc();
    useEditorStore.getState().loadInitialDocument(doc, pages);

    useEditorStore.getState().setPageExtraction('p1', {
      textBlocks: [
        {
          id: 'tb_heading',
          pageId: 'p1',
          text: 'CONFIDENTIAL BRIEF',
          x: 60,
          y: 120,
          width: 240,
          height: 24,
          fontSize: 16,
          fontFamily: 'Helvetica',
          rawFontName: 'Helvetica',
          bold: true,
          italic: false,
          color: '#000000',
          lineHeight: 1.2,
          baselineOffset: 14,
        },
      ],
      images: [
        {
          id: 'bg_mid_overlap',
          pageId: 'p1',
          resourceName: '/ImBg',
          operatorIndex: 1,
          x: 40,
          y: 80,
          width: 500, // 500*200 = 100000 / 484704 = 20.6% (>= 15% and overlaps tb_heading)
          height: 200,
          rotation: 0,
          pixelWidth: 500,
          pixelHeight: 200,
          previewUrl: 'blob:bg',
          pngBytes: new Uint8Array([1, 2, 3]),
        },
        {
          id: 'fg_badge',
          pageId: 'p1',
          resourceName: '/ImFg',
          operatorIndex: 2,
          x: 50,
          y: 420,
          width: 180,
          height: 120,
          rotation: 0,
          pixelWidth: 180,
          pixelHeight: 120,
          previewUrl: 'blob:fg',
          pngBytes: new Uint8Array([4, 5, 6]),
        },
      ],
      horizontalRules: [],
      verticalRules: [],
      cellRects: [],
    });

    const ext = useEditorStore.getState().pageExtractions.p1;
    const bgImg = ext.images.find((i) => i.id === 'bg_mid_overlap')!;
    const fgImg = ext.images.find((i) => i.id === 'fg_badge')!;
    expect(bgImg.isBackgroundLayer).toBe(true);
    expect(fgImg.isBackgroundLayer).toBe(false);

    // Blocked when selectBackgroundMode=false and !forcePromote
    expect(useEditorStore.getState().promoteDetectedImage(bgImg)).toBeNull();
    // Foreground image still promotes cleanly
    expect(useEditorStore.getState().promoteDetectedImage(fgImg)).not.toBeNull();

    // Explicit selectBackgroundMode or forcePromote unlocks background promotion
    useEditorStore.getState().setSelectBackgroundMode(true);
    const promotedBg = useEditorStore.getState().promoteDetectedImage(bgImg);
    expect(promotedBg).not.toBeNull();
    expect(promotedBg!.isBackgroundLayer).toBe(true);
    expect(getElementLayerTier(promotedBg!)).toBe(1);
  });

  it('flushes active transactionBaseline before undo/redo during inline text editing', () => {
    const { doc, pages } = makeDoc();
    useEditorStore.getState().loadInitialDocument(doc, pages);

    const el = useEditorStore.getState().startEditDetectedText({
      id: 'det_tx_1',
      pageId: 'p1',
      text: 'Initial Text',
      x: 50,
      y: 100,
      width: 140,
      height: 18,
      fontSize: 12,
      fontFamily: 'Helvetica',
      rawFontName: 'Helvetica',
      bold: false,
      italic: false,
      color: '#000000',
      lineHeight: 1.2,
      baselineOffset: 10,
    });

    useEditorStore.getState().beginTransaction();
    useEditorStore.getState().updateElements(
      [{ id: el.id, patch: { text: 'Live Edited Text' } }],
      false,
    );
    expect(useEditorStore.getState().editingTextElementId).toBe(el.id);

    // Undo triggered mid-edit must restore 'Initial Text', clear editingTextElementId, and push 'Live Edited Text' to future
    useEditorStore.getState().undo();
    const afterUndo = useEditorStore.getState();
    expect(afterUndo.editingTextElementId).toBeNull();
    expect(afterUndo.transactionBaseline).toBeNull();
    expect((afterUndo.elements.find((e) => e.id === el.id) as { text: string }).text).toBe(
      'Initial Text',
    );
    expect(afterUndo.canRedo).toBe(true);

    // Redo brings back 'Live Edited Text' cleanly
    useEditorStore.getState().redo();
    const afterRedo = useEditorStore.getState();
    expect(afterRedo.editingTextElementId).toBeNull();
    expect((afterRedo.elements.find((e) => e.id === el.id) as { text: string }).text).toBe(
      'Live Edited Text',
    );
  });
});
