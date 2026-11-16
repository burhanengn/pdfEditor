import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { PageMeta } from '@/types/pdf';

interface VirtualThumbnailGridProps {
  pages: PageMeta[];
  columns?: number;
  minColumnWidthPx?: number;
  maxColumns?: number;
  estimateRowHeightPx?: number;
  gapPx?: number;
  className?: string;
  renderItem: (page: PageMeta, pageIndex: number) => ReactNode;
}

export function VirtualThumbnailGrid({
  pages,
  columns,
  minColumnWidthPx = 175,
  maxColumns = 5,
  estimateRowHeightPx = 248,
  gapPx = 12,
  className = '',
  renderItem,
}: VirtualThumbnailGridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [measuredCols, setMeasuredCols] = useState<number>(columns ?? 2);

  useEffect(() => {
    if (columns !== undefined) {
      setMeasuredCols(columns);
      return;
    }
    const el = scrollRef.current;
    if (!el) return;

    const recompute = () => {
      const width = el.clientWidth || 360;
      const computed = Math.max(
        2,
        Math.min(maxColumns, Math.floor((width + gapPx) / (minColumnWidthPx + gapPx))),
      );
      setMeasuredCols(computed);
    };
    recompute();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns, minColumnWidthPx, maxColumns, gapPx]);

  const effectiveCols = Math.max(1, columns ?? measuredCols);
  const rowCount = Math.ceil(pages.length / effectiveCols);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeightPx,
    overscan: 2,
  });

  return (
    <div ref={scrollRef} className={`flex-1 overflow-y-auto ${className}`}>
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((vRow) => {
          const startIdx = vRow.index * effectiveCols;
          const rowPages = pages.slice(startIdx, startIdx + effectiveCols);
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vRow.start}px)`,
                paddingBottom: `${gapPx}px`,
                display: 'grid',
                gridTemplateColumns: `repeat(${effectiveCols}, minmax(0, 1fr))`,
                gap: `${gapPx}px`,
              }}
            >
              {rowPages.map((page, colOffset) => renderItem(page, startIdx + colOffset))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
