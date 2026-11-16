import type { PageMeta } from '@/types/pdf';
import { axisAlignedRectBaseToDisplay } from '@/engine/coordinates';
import { useViewerStore } from '@/store/useViewerStore';

interface SearchHighlightLayerProps {
  page: PageMeta;
  pageIndex: number;
  zoom: number;
}

export function SearchHighlightLayer({ page, pageIndex, zoom }: SearchHighlightLayerProps) {
  const searchHits = useViewerStore((s) => s.searchHits);
  const activeSearchHitIndex = useViewerStore((s) => s.activeSearchHitIndex);

  const activeHit = activeSearchHitIndex >= 0 ? searchHits[activeSearchHitIndex] : null;
  const pageHits = searchHits.filter((h) => h.pageIndex === page.sourcePageIndex || h.pageIndex === pageIndex);
  if (pageHits.length === 0) return null;

  return (
    <div
      data-testid={`search-highlights-${page.id}`}
      className="pointer-events-none absolute inset-0 z-15"
    >
      {pageHits.map((hit) => {
        const isActive =
          activeHit &&
          activeHit.pageIndex === hit.pageIndex &&
          activeHit.matchIndexInPage === hit.matchIndexInPage;
        return hit.rects.map((r, rIdx) => {
          const disp = axisAlignedRectBaseToDisplay(
            r,
            page.baseWidth,
            page.baseHeight,
            page.userRotation,
            zoom,
          );
          return (
            <div
              key={`${hit.pageIndex}_${hit.matchIndexInPage}_${rIdx}`}
              data-active-match={isActive ? 'true' : 'false'}
              style={{
                position: 'absolute',
                left: `${disp.x}px`,
                top: `${disp.y}px`,
                width: `${Math.max(2, disp.width)}px`,
                height: `${Math.max(4, disp.height)}px`,
              }}
              className={
                isActive
                  ? 'rounded-[2px] bg-orange-500/45 ring-2 ring-orange-500'
                  : 'rounded-[2px] bg-yellow-300/45'
              }
            />
          );
        });
      })}
    </div>
  );
}
