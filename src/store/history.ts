import type { CanvasElement } from '@/types/elements';
import type { PageMeta, PageNumberingConfig } from '@/types/pdf';

export interface DocumentSnapshot {
  pages: PageMeta[];
  elements: CanvasElement[];
  pageNumbering?: PageNumberingConfig | null;
}

export const MAX_HISTORY_DEPTH = 60;

export function clonePageMeta(page: PageMeta): PageMeta {
  return {
    ...page,
    mediaBox: [...page.mediaBox] as [number, number, number, number],
    cropBox: [...page.cropBox] as [number, number, number, number],
  };
}

export function cloneElement(el: CanvasElement): CanvasElement {
  switch (el.kind) {
    case 'text-edit':
      return {
        ...el,
        originalRect: { ...el.originalRect },
        runs: el.runs ? el.runs.map((r) => ({ ...r })) : undefined,
      };
    case 'text-add':
      return {
        ...el,
        runs: el.runs ? el.runs.map((r) => ({ ...r })) : undefined,
      };
    case 'image-replacement':
      return {
        ...el,
        originalRect: { ...el.originalRect },
      };
    case 'shape-replacement':
      return {
        ...el,
        originalRect: { ...el.originalRect },
      };
    case 'stroke':
    case 'path':
      return {
        ...el,
        points: el.points.map((p) => ({ ...p })),
      };
    case 'signature':
      return {
        ...el,
        svgPaths: el.svgPaths ? el.svgPaths.map((p) => ({ ...p })) : undefined,
      };
    default:
      return { ...el };
  }
}

export function cloneSnapshot(
  pages: PageMeta[],
  elements: CanvasElement[],
  pageNumbering?: PageNumberingConfig | null,
): DocumentSnapshot {
  return {
    pages: pages.map(clonePageMeta),
    elements: elements.map(cloneElement),
    pageNumbering: pageNumbering ? { ...pageNumbering } : (pageNumbering ?? null),
  };
}

export function collectSnapshotUrls(snapshots: DocumentSnapshot[]): Set<string> {
  const urls = new Set<string>();
  for (const snap of snapshots) {
    for (const el of snap.elements) {
      if ('previewUrl' in el && el.previewUrl) {
        urls.add(el.previewUrl);
      }
    }
  }
  return urls;
}
