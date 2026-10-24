import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Layers,
  ListTree,
  Loader2,
  NotebookPen,
  X,
} from "lucide-react";
import type { PDFDocumentProxy } from "../lib/pdf";
import { formatFileSize } from "../lib/pdf";
import type {
  AnnotationMap,
  DocumentInfo,
  Note,
  NoteTarget,
  PdfOutlineNode,
} from "../types";
import { countAnnotations, visibleStrokeCount } from "../lib/annotations";
import type { AnnotationStorageState } from "../hooks/useAnnotations";
import { NOTE_COLORS } from "../types";

type SidebarTab = "pages" | "outline" | "notes";

const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 440;
const SIDEBAR_DEFAULT = 274;

interface SidebarProps {
  info: DocumentInfo;
  pdf: PDFDocumentProxy;
  currentPage: number;
  annotations: AnnotationMap;
  storageState: AnnotationStorageState;
  width: number;
  onWidthChange: (width: number) => void;
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  outline: PdfOutlineNode[];
  outlineLoading: boolean;
  onJumpToPage: (page: number) => void;
  onOpenNote: (target: NoteTarget) => void;
  onClose: () => void;
}

function PageThumb({
  pdf,
  pageNumber,
  active,
  onClick,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onClick: () => void;
}) {
  const holderRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const node = holderRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldRender) return;
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;

    async function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const targetWidth = 180 * Math.min(window.devicePixelRatio || 1, 2);
        const scale = targetWidth / base.width;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        renderTask = page.render({ canvas, viewport, background: "#ffffff" });
        await renderTask.promise;
        if (!cancelled) setReady(true);
      } catch (error) {
        if ((error as Error)?.name !== "RenderingCancelledException") {
          console.warn("缩略图渲染失败", error);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, shouldRender]);

  return (
    <button
      type="button"
      className={`page-thumb ${active ? "is-active" : ""}`}
      onClick={onClick}
      ref={holderRef}
      aria-label={`跳转到第 ${pageNumber} 页`}
      aria-current={active ? "page" : undefined}
    >
      <span className="thumb-paper">
        {!ready && <span className="thumb-skeleton" />}
        <canvas ref={canvasRef} className={ready ? "is-ready" : ""} />
      </span>
      <span className="thumb-caption">
        <span>{String(pageNumber).padStart(2, "0")}</span>
        {active && <i>正在阅读</i>}
      </span>
    </button>
  );
}

function NoteCard({
  note,
  page,
  onOpen,
}: {
  note: Note;
  page: number;
  onOpen: () => void;
}) {
  const color = NOTE_COLORS[note.color] || NOTE_COLORS.amber;
  return (
    <button
      type="button"
      className="annotation-note-row"
      onClick={onOpen}
      style={{ ["--note-bg" as string]: color.bg, ["--note-ink" as string]: color.ink }}
    >
      <span className="annotation-note-pin" />
      <span className="annotation-note-copy">
        <span className="annotation-note-text">{note.text}</span>
        <span className="annotation-note-meta">
          第 {page} 页 · 点按定位 <ArrowUpRight size={11} />
        </span>
      </span>
    </button>
  );
}

function OutlineNode({
  node,
  level,
  currentPage,
  onJumpToPage,
}: {
  node: PdfOutlineNode;
  level: number;
  currentPage: number;
  onJumpToPage: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(level === 0);
  const hasChildren = node.children.length > 0;
  const isActive = node.pageNumber === currentPage;

  function activate() {
    if (node.pageNumber) {
      onJumpToPage(node.pageNumber);
      return;
    }
    if (node.url) {
      window.open(node.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (hasChildren) setExpanded((value) => !value);
  }

  return (
    <li className="outline-node">
      <div className={`outline-row ${isActive ? "is-active" : ""}`}>
        {hasChildren ? (
          <button
            type="button"
            className="outline-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? "收起此大纲层级" : "展开此大纲层级"}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="outline-toggle-placeholder" />
        )}
        <button
          type="button"
          className="outline-link"
          onClick={activate}
          title={node.pageNumber ? `${node.title} · 第 ${node.pageNumber} 页` : node.title}
        >
          <span
            className="outline-title"
            style={{
              ["--outline-ink" as string]: node.color || "inherit",
              fontWeight: node.bold ? 600 : undefined,
              fontStyle: node.italic ? "italic" : undefined,
            }}
          >
            {node.title}
          </span>
          {node.url && <ExternalLink size={11} className="outline-external" />}
          {node.pageNumber && <span className="outline-page">{node.pageNumber}</span>}
        </button>
      </div>
      {hasChildren && expanded && (
        <ul className="outline-children">
          {node.children.map((child) => (
            <OutlineNode
              key={child.id}
              node={child}
              level={level + 1}
              currentPage={currentPage}
              onJumpToPage={onJumpToPage}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function Sidebar({
  info,
  pdf,
  currentPage,
  annotations,
  storageState,
  width,
  onWidthChange,
  tab,
  onTabChange,
  outline,
  outlineLoading,
  onJumpToPage,
  onOpenNote,
  onClose,
}: SidebarProps) {
  const counts = countAnnotations(annotations);
  const annotationPages = Object.keys(annotations)
    .map(Number)
    .filter((page) => {
      const item = annotations[page];
      return item && (item.notes.length > 0 || visibleStrokeCount(item.strokes) > 0);
    })
    .sort((a, b) => a - b);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function clampWidth(value: number) {
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, value));
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizeRef.current = { startX: event.clientX, startWidth: width };
    setResizing(true);
    document.body.classList.add("is-resizing-sidebar");
  }

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const drag = resizeRef.current;
      if (!drag) return;
      onWidthChange(clampWidth(drag.startWidth + event.clientX - drag.startX));
    };
    const onEnd = () => {
      resizeRef.current = null;
      setResizing(false);
      document.body.classList.remove("is-resizing-sidebar");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    // Width changes should not re-subscribe while a drag is in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizing, onWidthChange]);

  function resizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onWidthChange(clampWidth(width - 16));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onWidthChange(clampWidth(width + 16));
    } else if (event.key === "Home") {
      event.preventDefault();
      onWidthChange(SIDEBAR_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      onWidthChange(SIDEBAR_MAX);
    }
  }

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-resizing-sidebar");
    };
  }, []);

  return (
    <aside
      className={`sidebar ${resizing ? "is-resizing" : ""}`}
      aria-label="阅读导航"
      style={{ width }}
    >
      <div className="sidebar-head">
        <div>
          <span className="sidebar-eyebrow">READING DESK</span>
          <h2>阅读桌面</h2>
        </div>
        <button type="button" className="icon-button small" onClick={onClose} aria-label="收起侧栏">
          <X size={16} />
        </button>
      </div>

      <div className="doc-summary">
        <div className="doc-summary-cover" aria-hidden="true">
          <FileText size={18} />
          <span>PDF</span>
        </div>
        <div className="doc-summary-copy">
          <strong title={info.name}>{info.name.replace(/\.pdf$/i, "")}</strong>
          <span>
            {info.numPages} 页 · {formatFileSize(info.size)}
          </span>
        </div>
      </div>

      <div className="sidebar-tabs" role="tablist" aria-label="侧栏视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "pages"}
          className={tab === "pages" ? "is-active" : ""}
          onClick={() => onTabChange("pages")}
        >
          <Layers size={14} />
          页面
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "outline"}
          className={tab === "outline" ? "is-active" : ""}
          onClick={() => onTabChange("outline")}
        >
          <ListTree size={14} />
          大纲
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notes"}
          className={tab === "notes" ? "is-active" : ""}
          onClick={() => onTabChange("notes")}
        >
          <NotebookPen size={14} />
          批注
          {counts.notes + counts.strokes > 0 && (
            <span className="tab-count">{counts.notes + counts.strokes}</span>
          )}
        </button>
      </div>

      <div className="sidebar-scroll">
        {tab === "pages" ? (
          <div className="thumb-list">
            {Array.from({ length: info.numPages }, (_, index) => index + 1).map((page) => (
              <PageThumb
                key={page}
                pdf={pdf}
                pageNumber={page}
                active={currentPage === page}
                onClick={() => onJumpToPage(page)}
              />
            ))}
          </div>
        ) : tab === "outline" ? (
          outlineLoading ? (
            <div className="sidebar-empty outline-loading">
              <Loader2 size={20} className="spin" />
              <p>正在读取文档大纲…</p>
            </div>
          ) : outline.length === 0 ? (
            <div className="sidebar-empty">
              <span className="empty-illustration">
                <ListTree size={22} />
              </span>
              <h3>这份 PDF 没有内嵌大纲</h3>
              <p>仍可以按页浏览，或在页面上用批注建立自己的阅读线索。</p>
            </div>
          ) : (
            <ul className="outline-list">
              {outline.map((node) => (
                <OutlineNode
                  key={node.id}
                  node={node}
                  level={0}
                  currentPage={currentPage}
                  onJumpToPage={onJumpToPage}
                />
              ))}
            </ul>
          )
        ) : annotationPages.length === 0 ? (
          <div className="sidebar-empty">
            <span className="empty-illustration">
              <NotebookPen size={22} />
            </span>
            <h3>页边还是空白的</h3>
            <p>用画笔圈出重点，或选择批注工具，在页面上钉一张便签。</p>
          </div>
        ) : (
          <div className="annotation-list">
            <div className="annotation-summary">
              <span>{counts.notes} 条文字批注</span>
              <span>{counts.strokes} 处手绘</span>
            </div>
            {annotationPages.map((page) => {
              const item = annotations[page];
              const inkCount = visibleStrokeCount(item.strokes);
              return (
                <section className="annotation-group" key={page}>
                  <button
                    type="button"
                    className="annotation-page-label"
                    onClick={() => onJumpToPage(page)}
                  >
                    <span>第 {String(page).padStart(2, "0")} 页</span>
                    <ArrowUpRight size={13} />
                  </button>
                  {item.notes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      page={page}
                      onOpen={() => onOpenNote({ page, id: note.id })}
                    />
                  ))}
                  {inkCount > 0 && (
                    <button
                      type="button"
                      className="stroke-row"
                      onClick={() => onJumpToPage(page)}
                    >
                      <span className="stroke-preview" aria-hidden="true">
                        <svg viewBox="0 0 60 18">
                          <path
                            d="M3 13c8-8 12 3 20-4s12 4 18-2 12-3 16 0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                          />
                        </svg>
                      </span>
                      <span>{inkCount} 笔手绘</span>
                      <ArrowUpRight size={12} />
                    </button>
                  )}
                </section>
              );
            })}
            <p className={`annotation-save-note is-${storageState}`}>
              {storageState === "loading" && "正在读取本机批注…"}
              {storageState === "saving" && "正在写入本机磁盘…"}
              {storageState === "saved" && "墨迹与批注已保存到本机磁盘"}
              {storageState === "error" && "磁盘写入失败，已保留浏览器缓存"}
              {storageState === "idle" && "墨迹与批注会自动保存"}
            </p>
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        <span className="sidebar-foot-dot" />
        <span>进度 {Math.round((currentPage / info.numPages) * 100)}%</span>
        <span className="sidebar-foot-progress">
          <i style={{ width: `${(currentPage / info.numPages) * 100}%` }} />
        </span>
      </div>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title="拖动调整侧栏宽度，双击恢复默认"
        onPointerDown={startResize}
        onDoubleClick={() => onWidthChange(SIDEBAR_DEFAULT)}
        onKeyDown={resizeKeyDown}
      >
        <span />
      </div>
    </aside>
  );
}
