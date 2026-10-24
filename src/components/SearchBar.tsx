import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";

interface SearchBarProps {
  open: boolean;
  query: string;
  searching: boolean;
  scanned: number;
  totalPages: number;
  resultCount: number;
  activeIndex: number;
  focusNonce: number;
  onQueryChange: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}

export function SearchBar({
  open,
  query,
  searching,
  scanned,
  totalPages,
  resultCount,
  activeIndex,
  focusNonce,
  onQueryChange,
  onNext,
  onPrevious,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, focusNonce]);

  if (!open) return null;

  const hasQuery = query.trim().length > 0;
  const position = activeIndex >= 0 && resultCount > 0 ? activeIndex + 1 : 0;

  return (
    <div className="find-bar" role="search" aria-label="在文档中搜索">
      <Search size={15} className="find-bar-icon" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="搜索文档中的文字…"
        aria-label="搜索文档中的文字"
        spellCheck={false}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (event.shiftKey) onPrevious();
            else onNext();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <div className="find-bar-status" aria-live="polite">
        {searching ? (
          <>
            <Loader2 size={12} className="spin" />
            <span>
              {scanned > 0 ? `${scanned} / ${totalPages}` : "搜索中"}
            </span>
          </>
        ) : !hasQuery ? (
          <span className="find-bar-hint">Ctrl / ⌘ + F</span>
        ) : resultCount === 0 ? (
          <span>无结果</span>
        ) : (
          <span>
            {position} / {resultCount}
          </span>
        )}
      </div>
      <span className="find-bar-divider" />
      <button
        type="button"
        className="find-bar-button"
        onClick={onPrevious}
        disabled={resultCount === 0}
        aria-label="上一个搜索结果"
        title="上一个 (Shift+Enter)"
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className="find-bar-button"
        onClick={onNext}
        disabled={resultCount === 0}
        aria-label="下一个搜索结果"
        title="下一个 (Enter)"
      >
        <ChevronDown size={16} />
      </button>
      <button
        type="button"
        className="find-bar-button close"
        onClick={onClose}
        aria-label="关闭搜索"
        title="关闭 (Esc)"
      >
        <X size={16} />
      </button>
    </div>
  );
}
