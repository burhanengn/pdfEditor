import { useEffect, useState } from 'react';

export type LayoutClass = 'compact' | 'medium' | 'expanded';

export interface LayoutMetrics {
  layoutClass: LayoutClass;
  width: number;
  height: number;
  isCoarsePointer: boolean;
  isLandscapePhone: boolean;
}

function computeLayoutMetrics(): LayoutMetrics {
  if (typeof window === 'undefined') {
    return {
      layoutClass: 'expanded',
      width: 1440,
      height: 900,
      isCoarsePointer: false,
      isLandscapePhone: false,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const isCoarsePointer = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  const isLandscapePhone = isCoarsePointer && height < 480 && width >= 480;

  let layoutClass: LayoutClass;
  if (width >= 1024 && !isLandscapePhone) {
    layoutClass = 'expanded';
  } else if (width >= 600 || isLandscapePhone) {
    layoutClass = 'medium';
  } else {
    layoutClass = 'compact';
  }

  return {
    layoutClass,
    width,
    height,
    isCoarsePointer,
    isLandscapePhone,
  };
}

/**
 * Responsive 3-class layout hook matching 03 §2.2:
 * compact (<600px) · medium (600–1023px or landscape phone height<480) · expanded (>=1024px)
 */
export function useLayoutClass(): LayoutMetrics {
  const [metrics, setMetrics] = useState<LayoutMetrics>(() => computeLayoutMetrics());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => {
      setMetrics((prev) => {
        const next = computeLayoutMetrics();
        if (
          prev.layoutClass === next.layoutClass &&
          prev.width === next.width &&
          prev.height === next.height &&
          prev.isCoarsePointer === next.isCoarsePointer
        ) {
          return prev;
        }
        return next;
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return metrics;
}
