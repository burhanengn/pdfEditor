import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, List, Search, X } from 'lucide-react';
import { pdfiumScheduler } from '@/engine/pdfium/renderScheduler';
import { useLayoutClass } from '@/hooks/useLayoutClass';
import { useI18n } from '@/i18n/useI18n';
import { useEditorStore } from '@/store/useEditorStore';
import { useViewerStore } from '@/store/useViewerStore';
import { Sheet } from '../common/Sheet';

interface SearchBarProps {
  onJumpToPage: (pageIndex: number) => void;
}

export function SearchBar({ onJumpToPage }: SearchBarProps) {
  const { t } = useI18n();
  const { layoutClass } = useLayoutClass();
  const pages = useEditorStore((s) => s.pages);
  const activePageId = useEditorStore((s) => s.activePageId);

  const searchOpen = useViewerStore((s) => s.searchOpen);
  const searchQuery = useViewerStore((s) => s.searchQuery);
  const searchMatchCase = useViewerStore((s) => s.searchMatchCase);
  const searchWholeWord = useViewerStore((s) => s.searchWholeWord);
  const searchScanning = useViewerStore((s) => s.searchScanning);
  const searchHits = useViewerStore((s) => s.searchHits);
  const activeSearchHitIndex = useViewerStore((s) => s.activeSearchHitIndex);

  const setSearchOpen = useViewerStore((s) => s.setSearchOpen);
  const setSearchQuery = useViewerStore((s) => s.setSearchQuery);
  const setSearchOptions = useViewerStore((s) => s.setSearchOptions);
  const resetSearchResults = useViewerStore((s) => s.resetSearchResults);
  const appendSearchChunk = useViewerStore((s) => s.appendSearchChunk);
  const setActiveSearchHitIndex = useViewerStore((s) => s.setActiveSearchHitIndex);
  const stepSearchHit = useViewerStore((s) => s.stepSearchHit);

  const [resultsListOpen, setResultsListOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeSearchCancelRef = useRef<(() => void) | null>(null);

  // Focus input on open
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      activeSearchCancelRef.current?.();
      activeSearchCancelRef.current = null;
      setResultsListOpen(false);
    }
  }, [searchOpen]);

  // 250ms debounced streaming search outward from current page (02 §3.5)
  useEffect(() => {
    activeSearchCancelRef.current?.();
    activeSearchCancelRef.current = null;

    if (!searchOpen || !searchQuery.trim() || pages.length === 0) {
      resetSearchResults(0);
      return;
    }

    const timer = window.setTimeout(() => {
      const startPageIdx = Math.max(
        0,
        pages.findIndex((p) => p.id === activePageId),
      );
      const docId = pages[startPageIdx]?.sourceDocId ?? pages[0].sourceDocId;
      const docPages = pages
        .map((p, idx) => ({ p, idx }))
        .filter((x) => x.p.sourceDocId === docId)
        .map((x) => x.p.sourcePageIndex);

      resetSearchResults(docPages.length);
      const handle = pdfiumScheduler.startSearch(
        {
          sourceDocId: docId,
          query: searchQuery,
          matchCase: searchMatchCase,
          wholeWord: searchWholeWord,
          startPageIndex: startPageIdx,
          pageIndices: docPages,
        },
        (chunk) => {
          appendSearchChunk(chunk);
        },
      );
      activeSearchCancelRef.current = handle.cancel;
    }, 250);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    searchOpen,
    searchQuery,
    searchMatchCase,
    searchWholeWord,
    pages,
    activePageId,
    resetSearchResults,
    appendSearchChunk,
  ]);

  if (!searchOpen) return null;

  const navigateMatch = (delta: 1 | -1) => {
    const hit = stepSearchHit(delta);
    if (hit) {
      const targetIdx = pages.findIndex((p) => p.sourcePageIndex === hit.pageIndex);
      if (targetIdx >= 0) onJumpToPage(targetIdx);
    }
  };

  const countLabel =
    searchHits.length === 0
      ? searchScanning
        ? '…'
        : t('search.noResults')
      : `${activeSearchHitIndex + 1} / ${searchHits.length}${searchScanning ? '+' : ''}`;

  const isCompact = layoutClass === 'compact';

  return (
    <>
      <div
        data-testid="viewer-search-bar"
        className={
          isCompact
            ? 'fixed left-2 right-2 top-[calc(env(safe-area-inset-top,0px)+54px)] z-35 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95'
            : 'fixed right-4 top-14 z-35 flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white/95 p-2.5 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95'
        }
      >
        <div className="flex w-full items-center gap-1.5">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                navigateMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setSearchOpen(false);
              }
            }}
            placeholder={t('search.placeholder')}
            data-testid="viewer-search-input"
            className="min-h-[36px] min-w-0 flex-1 rounded-lg bg-slate-100 px-2.5 py-1 text-base text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-slate-100 sm:text-sm"
          />
          <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500 dark:text-slate-400">
            {countLabel}
          </span>
          <button
            type="button"
            disabled={searchHits.length === 0}
            onClick={() => navigateMatch(-1)}
            aria-label="Previous match"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={searchHits.length === 0}
            onClick={() => navigateMatch(1)}
            aria-label="Next match"
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(false)}
            aria-label={t('action.close')}
            className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex w-full items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setSearchOptions({ matchCase: !searchMatchCase })}
              className={`min-h-[32px] rounded-md border px-2 py-1 font-medium ${
                searchMatchCase
                  ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {t('search.matchCase')}
            </button>
            <button
              type="button"
              onClick={() => setSearchOptions({ wholeWord: !searchWholeWord })}
              className={`min-h-[32px] rounded-md border px-2 py-1 font-medium ${
                searchWholeWord
                  ? 'border-blue-500 bg-blue-500/15 text-blue-600 dark:text-blue-400'
                  : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
              }`}
            >
              {t('search.wholeWord')}
            </button>
          </div>
          {searchHits.length > 0 && (
            <button
              type="button"
              onClick={() => setResultsListOpen((v) => !v)}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <List className="h-3.5 w-3.5" />
              <span>Results</span>
            </button>
          )}
        </div>
      </div>

      {/* Results list sheet/panel */}
      <Sheet
        open={resultsListOpen}
        onClose={() => setResultsListOpen(false)}
        title={`Search Results (${searchHits.length}${searchScanning ? '+' : ''})`}
        detent="half"
        allowedDetents={['half', 'full']}
      >
        <div className="divide-y divide-slate-200 p-2 dark:divide-slate-800">
          {searchHits.map((hit, idx) => (
            <button
              key={`${hit.pageIndex}_${hit.matchIndexInPage}_${idx}`}
              type="button"
              onClick={() => {
                setActiveSearchHitIndex(idx);
                const pageIdx = pages.findIndex((p) => p.sourcePageIndex === hit.pageIndex);
                if (pageIdx >= 0) onJumpToPage(pageIdx);
                if (isCompact) setResultsListOpen(false);
              }}
              className={`flex min-h-[44px] w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left text-xs transition ${
                idx === activeSearchHitIndex
                  ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
                  : 'hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
            >
              <span className="font-semibold tabular-nums">Page {hit.pageIndex + 1}</span>
              <span className="line-clamp-2 text-slate-600 dark:text-slate-400">{hit.snippet}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}
