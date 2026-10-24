import { useEffect, useMemo, useRef, useState } from "react";
import type { PDFDocumentProxy } from "../lib/pdf";
import type {
  AnnotationMap,
  CapturePayload,
  DocumentInfo,
  DraftNote,
  NoteColor,
  PageDimension,
  SearchHighlightApi,
  Stroke,
  Tool,
} from "../types";
import { getPageAnnotations } from "../lib/annotations";
import { PageView } from "./PageView";

export interface JumpRequest {
  page: number;
  nonce: number;
  behavior?: ScrollBehavior;
}

interface DocumentStageProps {
  pdf: PDFDocumentProxy;
  info: DocumentInfo;
  dimensions: PageDimension[];
  scale: number;
  stagePadding: number;
  currentPage: number;
  annotations: AnnotationMap;
  tool: Tool;
  brushColor: string;
  brushSize: number;
  activeNoteId: string | null;
  activeNotePage: number | null;
  draftNote: DraftNote | null;
  searchQuery: string;
  searchActivePage: number | null;
  searchActiveLocalIndex: number | null;
  searchNonce: number;
  searchHighlights: SearchHighlightApi | null;
  jumpRequest: JumpRequest | null;
  onCurrentPageChange: (page: number) => void;
  onViewportWidthChange: (width: number) => void;
  onAddStroke: (page: number, stroke: Omit<Stroke, "id">) => void;
  onMoveStrokes: (page: number, ids: string[], dx: number, dy: number) => void;
  onDeleteStrokes: (page: number, ids: string[]) => void;
  onPlaceNote: (page: number, x: number, y: number) => void;
  onCapture: (payload: CapturePayload) => void;
  onCaptureError: (message: string) => void;
  onOpenNote: (page: number, id: string) => void;
  onCloseNote: () => void;
  onUpdateNote: (page: number, id: string, text: string, color: NoteColor) => void;
  onDeleteNote: (page: number, id: string) => void;
  onSaveDraft: (text: string, color: NoteColor) => void;
  onCancelDraft: () => void;
}

const PAGE_GAP = 39;
const STACK_TOP_PADDING = 34;
const OVERSCAN = 1500;

interface Layout {
  starts: number[];
  heights: number[];
  contentEnd: number;
}

function pageAtOffset(starts: number[], offset: number) {
  if (starts.length === 0) return 0;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (starts[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return low;
}

function rangeForPixels(layout: Layout, from: number, to: number) {
  const count = layout.starts.length;
  if (count === 0) return { start: 0, end: 0 };
  let start = 0;
  while (
    start < count - 1 &&
    layout.starts[start] + layout.heights[start] < from
  ) {
    start += 1;
  }
  let end = start;
  while (end < count && layout.starts[end] <= to) end += 1;
  end = Math.min(count, Math.max(start + 1, end));
  return { start, end };
}

export function DocumentStage({
  pdf,
  info,
  dimensions,
  scale,
  stagePadding,
  currentPage,
  annotations,
  tool,
  brushColor,
  brushSize,
  activeNoteId,
  activeNotePage,
  draftNote,
  searchQuery,
  searchActivePage,
  searchActiveLocalIndex,
  searchNonce,
  searchHighlights,
  jumpRequest,
  onCurrentPageChange,
  onViewportWidthChange,
  onAddStroke,
  onMoveStrokes,
  onDeleteStrokes,
  onPlaceNote,
  onCapture,
  onCaptureError,
  onOpenNote,
  onCloseNote,
  onUpdateNote,
  onDeleteNote,
  onSaveDraft,
  onCancelDraft,
}: DocumentStageProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const initialisedRef = useRef<DocumentInfo | null>(null);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const handledJumpRef = useRef(0);
  const lastScaleRef = useRef(scale);
  const [progress, setProgress] = useState(0);
  const [visibleRange, setVisibleRange] = useState(() => ({
    start: 0,
    end: Math.min(Math.max(dimensions.length, 1), 3),
  }));

  const layout = useMemo<Layout>(() => {
    const starts = new Array<number>(dimensions.length);
    const heights = new Array<number>(dimensions.length);
    let offset = 0;
    for (let index = 0; index < dimensions.length; index += 1) {
      const height = dimensions[index].height * scale;
      heights[index] = height;
      starts[index] = offset;
      offset += height + PAGE_GAP;
    }
    return { starts, heights, contentEnd: offset };
  }, [dimensions, scale]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const report = () => onViewportWidthChange(root.clientWidth);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(root);
    return () => observer.disconnect();
  }, [onViewportWidthChange]);

  useEffect(() => {
    const root = scrollRef.current;
    const stack = stackRef.current;
    if (!root || !stack || layout.starts.length === 0) return;
    let raf = 0;

    function update() {
      if (!root || !stack) return;
      const stackTop = stack.offsetTop;
      const contentTop = stackTop + STACK_TOP_PADDING;
      const localTop = root.scrollTop - contentTop;
      const from = localTop - OVERSCAN;
      const to = localTop + root.clientHeight + OVERSCAN;
      const nextRange = rangeForPixels(layout, from, to);
      setVisibleRange((previous) =>
        previous.start === nextRange.start && previous.end === nextRange.end
          ? previous
          : nextRange,
      );

      const anchorOffset = Math.max(
        0,
        localTop + Math.min(140, root.clientHeight * 0.26),
      );
      const pageIndex = pageAtOffset(layout.starts, anchorOffset);
      onCurrentPageChange(pageIndex + 1);
      const maxScroll = Math.max(1, root.scrollHeight - root.clientHeight);
      setProgress(Math.min(100, Math.max(0, (root.scrollTop / maxScroll) * 100)));
    }

    function onScroll() {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    }

    update();
    root.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver = new ResizeObserver(onScroll);
    resizeObserver.observe(root);
    const settleFrame = window.requestAnimationFrame(update);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.cancelAnimationFrame(settleFrame);
      root.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [layout, onCurrentPageChange]);

  useEffect(() => {
    if (!jumpRequest || handledJumpRef.current === jumpRequest.nonce) return;
    handledJumpRef.current = jumpRequest.nonce;
    const root = scrollRef.current;
    const stack = stackRef.current;
    if (!root || !stack || layout.starts.length === 0) return;
    const pageIndex = Math.min(
      layout.starts.length - 1,
      Math.max(0, jumpRequest.page - 1),
    );
    const stackTop = stack.offsetTop;
    const pageTop = stackTop + STACK_TOP_PADDING + layout.starts[pageIndex];
    const localTop = layout.starts[pageIndex] - 28;
    const nextRange = rangeForPixels(
      layout,
      localTop - OVERSCAN,
      localTop + root.clientHeight + OVERSCAN,
    );
    setVisibleRange(nextRange);
    root.scrollTo({
      top: Math.max(0, pageTop - 28),
      behavior: jumpRequest.behavior ?? "smooth",
    });
  }, [jumpRequest, layout]);

  // 重新打开文档（即使指纹相同）时回到第一页，避免沿用上一次的滚动位置。
  useEffect(() => {
    if (initialisedRef.current === info) return;
    initialisedRef.current = info;
    const root = scrollRef.current;
    if (root) root.scrollTo({ top: 0, behavior: "auto" });
    setProgress(0);
    setVisibleRange({
      start: 0,
      end: Math.min(Math.max(dimensions.length, 1), 3),
    });
    handledJumpRef.current = 0;
    onCurrentPageChange(1);
  }, [info, dimensions.length, onCurrentPageChange]);

  // 缩放后页面高度会改变：以当前页页首为锚点，避免漂移到别的页。
  useEffect(() => {
    if (lastScaleRef.current === scale) return;
    lastScaleRef.current = scale;
    const root = scrollRef.current;
    const stack = stackRef.current;
    if (!root || !stack || layout.starts.length === 0) return;
    const pageIndex = Math.min(
      layout.starts.length - 1,
      Math.max(0, currentPageRef.current - 1),
    );
    const target =
      stack.offsetTop + STACK_TOP_PADDING + layout.starts[pageIndex] - 28;
    root.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  }, [scale, layout]);

  const count = layout.starts.length;
  const renderStart = count === 0 ? 0 : Math.min(visibleRange.start, count - 1);
  const renderEnd =
    count === 0
      ? 0
      : Math.min(Math.max(visibleRange.end, renderStart + 1), count);
  const topSpacer = count === 0 ? 0 : layout.starts[renderStart];
  const renderedEndOffset =
    renderEnd > 0
      ? layout.starts[renderEnd - 1] +
        layout.heights[renderEnd - 1] +
        PAGE_GAP
      : 0;
  const bottomSpacer = Math.max(0, layout.contentEnd - renderedEndOffset);

  return (
    <div className="viewer-shell">
      <div className="viewer-scroll" ref={scrollRef}>
        <div className="viewer-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </div>
        <div
          className="pages-stack"
          ref={stackRef}
          style={{ ["--stage-pad" as string]: `${stagePadding}px` }}
        >
          <div className="virtual-spacer" style={{ height: topSpacer }} />
          {Array.from({ length: Math.max(0, renderEnd - renderStart) }, (_, offset) => {
            const index = renderStart + offset;
            const pageNumber = index + 1;
            return (
              <div
                className="virtual-page"
                key={`${info.fingerprint}-${pageNumber}`}
                style={{ height: layout.heights[index] + PAGE_GAP }}
              >
                <PageView
                  pdf={pdf}
                  pageNumber={pageNumber}
                  dimension={dimensions[index]}
                  scale={scale}
                  pageAnnotations={getPageAnnotations(annotations, pageNumber)}
                  tool={tool}
                  brushColor={brushColor}
                  brushSize={brushSize}
                  activeNoteId={activeNotePage === pageNumber ? activeNoteId : null}
                  draft={draftNote?.page === pageNumber ? draftNote : null}
                  searchQuery={searchQuery}
                  searchActivePage={searchActivePage}
                  searchActiveLocalIndex={searchActiveLocalIndex}
                  searchNonce={searchNonce}
                  searchHighlights={searchHighlights}
                  onAddStroke={(stroke) => onAddStroke(pageNumber, stroke)}
                  onMoveStrokes={(ids, dx, dy) => onMoveStrokes(pageNumber, ids, dx, dy)}
                  onDeleteStrokes={(ids) => onDeleteStrokes(pageNumber, ids)}
                  onPlaceNote={(x, y) => onPlaceNote(pageNumber, x, y)}
                  onCapture={onCapture}
                  onCaptureError={onCaptureError}
                  onOpenNote={(id) => onOpenNote(pageNumber, id)}
                  onCloseNote={onCloseNote}
                  onUpdateNote={(id, text, color) =>
                    onUpdateNote(pageNumber, id, text, color)
                  }
                  onDeleteNote={(id) => onDeleteNote(pageNumber, id)}
                  onSaveDraft={onSaveDraft}
                  onCancelDraft={onCancelDraft}
                />
              </div>
            );
          })}
          <div className="virtual-spacer" style={{ height: bottomSpacer }} />
          <div className="end-of-document">
            <span className="end-mark">间</span>
            <p>读到这里。要不要在页边，留下你的问题？</p>
            <span className="end-page-count">共 {info.numPages} 页</span>
          </div>
        </div>
      </div>
      {currentPage > 0 && (
        <div className="stage-page-indicator" aria-hidden="true">
          <span>{String(currentPage).padStart(2, "0")}</span>
          <i />
          <span>{String(info.numPages).padStart(2, "0")}</span>
        </div>
      )}
    </div>
  );
}
