import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdf";
import { extractPageText } from "../lib/pdf";
import type { SearchHighlightApi, SearchMatch } from "../types";

interface UsePdfSearchOptions {
  pdf: PDFDocumentProxy | null;
  documentKey: string | null;
  onNavigate: (page: number) => void;
}

const HIGHLIGHT_NAME = "pagetalk-search";
const HIGHLIGHT_ACTIVE_NAME = "pagetalk-search-active";

type HighlightConstructor = new () => {
  add(range: Range): void;
  delete(range: Range): void;
};

export function usePdfSearch({ pdf, documentKey, onNavigate }: UsePdfSearchOptions) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [navigationNonce, setNavigationNonce] = useState(0);
  const [focusNonce, setFocusNonce] = useState(0);

  const cacheRef = useRef(new Map<number, string>());
  const matchesRef = useRef(matches);
  matchesRef.current = matches;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const registryRef = useRef<{ delete(name: string): void } | null>(null);

  const highlightApi = useMemo<SearchHighlightApi | null>(() => {
    if (typeof window === "undefined" || typeof CSS === "undefined") return null;
    const HighlightCtor = (window as unknown as { Highlight?: HighlightConstructor }).Highlight;
    const registry = (
      CSS as unknown as {
        highlights?: { set(name: string, highlight: unknown): void; delete(name: string): void };
      }
    ).highlights;
    if (!HighlightCtor || !registry) return null;
    const all = new HighlightCtor();
    const active = new HighlightCtor();
    registry.set(HIGHLIGHT_NAME, all);
    registry.set(HIGHLIGHT_ACTIVE_NAME, active);
    registryRef.current = registry;
    return { all, active };
  }, []);

  useEffect(() => {
    return () => {
      registryRef.current?.delete(HIGHLIGHT_NAME);
      registryRef.current?.delete(HIGHLIGHT_ACTIVE_NAME);
    };
  }, []);

  // 文档变化时清空搜索状态和文本缓存。
  useEffect(() => {
    setOpen(false);
    setQuery("");
    setMatches([]);
    setActiveIndex(-1);
    setSearching(false);
    setScanned(0);
    setTotalPages(pdf?.numPages || 0);
    cacheRef.current = new Map();
  }, [documentKey, pdf]);

  useEffect(() => {
    if (!open || !pdf) return;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) {
      setSearching(false);
      setMatches([]);
      setActiveIndex(-1);
      setScanned(0);
      setTotalPages(pdf.numPages);
      return;
    }

    let cancelled = false;
    setTotalPages(pdf.numPages);
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearching(true);
        setScanned(0);
        setMatches([]);
        setActiveIndex(-1);
        const found: SearchMatch[] = [];
        const batchSize = 6;

        try {
          for (
            let batchStart = 1;
            batchStart <= pdf.numPages;
            batchStart += batchSize
          ) {
            if (cancelled) return;
            const pageNumbers: number[] = [];
            for (
              let pageNumber = batchStart;
              pageNumber < Math.min(batchStart + batchSize, pdf.numPages + 1);
              pageNumber += 1
            ) {
              pageNumbers.push(pageNumber);
            }

            const texts = await Promise.all(
              pageNumbers.map(async (pageNumber) => {
                let text = cacheRef.current.get(pageNumber);
                if (text === undefined) {
                  text = await extractPageText(pdf, pageNumber);
                  cacheRef.current.set(pageNumber, text);
                }
                return text;
              }),
            );
            if (cancelled) return;

            for (let index = 0; index < pageNumbers.length; index += 1) {
              const haystack = texts[index].toLocaleLowerCase();
              let position = 0;
              let localIndex = 0;
              while (position <= haystack.length) {
                const foundAt = haystack.indexOf(needle, position);
                if (foundAt === -1) break;
                found.push({ page: pageNumbers[index], localIndex });
                localIndex += 1;
                position = foundAt + Math.max(1, needle.length);
              }
            }
            setScanned(Math.min(pdf.numPages, batchStart + batchSize - 1));
          }

          if (cancelled) return;
          setMatches(found);
          setSearching(false);
          setScanned(pdf.numPages);
          if (found.length > 0) {
            setActiveIndex(0);
            setNavigationNonce((value) => value + 1);
            onNavigateRef.current(found[0].page);
          }
        } catch {
          if (!cancelled) {
            setSearching(false);
            setMatches([]);
            setActiveIndex(-1);
          }
        }
      })();
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, pdf]);

  function updateQuery(value: string) {
    setQuery(value);
    setActiveIndex(-1);
    setMatches([]);
    setSearching(Boolean(value.trim()));
    setScanned(0);
  }

  function openSearch() {
    setOpen(true);
    setFocusNonce((value) => value + 1);
  }

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setMatches([]);
    setActiveIndex(-1);
    setSearching(false);
    setScanned(0);
  }

  function navigateTo(index: number) {
    const list = matchesRef.current;
    if (list.length === 0) return;
    const wrapped = ((index % list.length) + list.length) % list.length;
    const match = list[wrapped];
    setActiveIndex(wrapped);
    setNavigationNonce((value) => value + 1);
    onNavigateRef.current(match.page);
  }

  return {
    open,
    query,
    matches,
    activeIndex,
    activeMatch: activeIndex >= 0 ? matches[activeIndex] ?? null : null,
    searching,
    scanned,
    totalPages: totalPages || pdf?.numPages || 0,
    navigationNonce,
    focusNonce,
    highlightApi,
    updateQuery,
    openSearch,
    closeSearch,
    next: () => navigateTo(activeIndex + 1),
    previous: () => navigateTo(activeIndex - 1),
    focus: () => setFocusNonce((value) => value + 1),
  };
}
