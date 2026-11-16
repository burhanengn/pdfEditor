import { useEffect, useState } from 'react';
import type { PageMeta } from '@/types/pdf';
import { axisAlignedRectBaseToDisplay } from '@/engine/coordinates';
import { pdfiumScheduler } from '@/engine/pdfium/renderScheduler';
import type { PdfLinkAnnotation } from '@/engine/pdfium/pdfiumTypes';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';

const linksCache = new Map<string, PdfLinkAnnotation[]>();

interface LinkLayerProps {
  page: PageMeta;
  zoom: number;
  onJumpToPage?: (pageIndex: number) => void;
}

export function LinkLayer({ page, zoom, onJumpToPage }: LinkLayerProps) {
  const appMode = useEditorStore((s) => s.appMode);
  const docRevision = useViewerStore((s) => s.docRevision);
  const [links, setLinks] = useState<PdfLinkAnnotation[]>([]);

  const key = `${docRevision}:${page.sourceDocId}:${page.sourcePageIndex}`;

  useEffect(() => {
    const cached = linksCache.get(key);
    if (cached) {
      setLinks(cached);
      return;
    }
    let cancelled = false;
    pdfiumScheduler
      .getLinks(page.sourceDocId, page.sourcePageIndex)
      .then((res) => {
        if (cancelled) return;
        linksCache.set(key, res);
        setLinks(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, page.sourceDocId, page.sourcePageIndex]);

  // Links active only in Viewer mode so Editor taps don't navigate away (02 §2.2)
  if (appMode !== 'view' || links.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-25">
      {links.map((link) => {
        const disp = axisAlignedRectBaseToDisplay(
          { x: link.x, y: link.y, width: link.width, height: link.height },
          page.baseWidth,
          page.baseHeight,
          page.userRotation,
          zoom,
        );
        if (link.kind === 'uri' && link.uri && /^https?:|^mailto:/i.test(link.uri)) {
          return (
            <a
              key={link.id}
              href={link.uri}
              target="_blank"
              rel="noopener noreferrer"
              title={link.uri}
              aria-label={`External link: ${link.uri}`}
              style={{
                position: 'absolute',
                left: `${disp.x}px`,
                top: `${disp.y}px`,
                width: `${Math.max(16, disp.width)}px`,
                height: `${Math.max(16, disp.height)}px`,
              }}
              className="pointer-events-auto rounded-sm transition hover:bg-blue-500/15 hover:ring-1 hover:ring-blue-500/50"
            />
          );
        }
        if (link.kind === 'goto' && link.destPageIndex !== undefined) {
          return (
            <button
              key={link.id}
              type="button"
              onClick={() => onJumpToPage?.(link.destPageIndex!)}
              title={`Jump to page ${link.destPageIndex + 1}`}
              aria-label={`Jump to page ${link.destPageIndex + 1}`}
              style={{
                position: 'absolute',
                left: `${disp.x}px`,
                top: `${disp.y}px`,
                width: `${Math.max(16, disp.width)}px`,
                height: `${Math.max(16, disp.height)}px`,
              }}
              className="pointer-events-auto rounded-sm transition hover:bg-blue-500/15 hover:ring-1 hover:ring-blue-500/50"
            />
          );
        }
        return null;
      })}
    </div>
  );
}
