import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Maximize2,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Sun,
} from "lucide-react";
import { Brand } from "./Brand";

interface TopBarProps {
  fileName: string;
  numPages: number;
  currentPage: number;
  onJumpToPage: (page: number) => void;
  onOpenFile: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  isFitWidth: boolean;
  zoomPercent: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
  onOpenAI: () => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  aiOpen: boolean;
  streaming: boolean;
  isMock: boolean;
}

function PageNavigator({
  currentPage,
  numPages,
  onJumpToPage,
}: {
  currentPage: number;
  numPages: number;
  onJumpToPage: (page: number) => void;
}) {
  const [value, setValue] = useState(String(currentPage));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(String(currentPage));
  }, [currentPage]);

  function commit() {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setValue(String(currentPage));
      return;
    }
    const next = Math.min(numPages, Math.max(1, Math.round(parsed)));
    setValue(String(next));
    if (next !== currentPage) onJumpToPage(next);
  }

  return (
    <div className="page-navigator">
      <button
        type="button"
        className="nav-arrow"
        onClick={() => onJumpToPage(Math.max(1, currentPage - 1))}
        disabled={currentPage <= 1}
        aria-label="上一页"
      >
        <ChevronLeft size={17} />
      </button>
      <form
        className="page-form"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ""))}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={commit}
          inputMode="numeric"
          aria-label="跳转到页码"
          title="输入页码，回车跳转"
        />
        <span className="page-total">/ {numPages}</span>
      </form>
      <button
        type="button"
        className="nav-arrow"
        onClick={() => onJumpToPage(Math.min(numPages, currentPage + 1))}
        disabled={currentPage >= numPages}
        aria-label="下一页"
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}

export function TopBar({
  fileName,
  numPages,
  currentPage,
  onJumpToPage,
  onOpenFile,
  theme,
  onToggleTheme,
  sidebarOpen,
  onToggleSidebar,
  isFitWidth,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onFitWidth,
  onOpenAI,
  onOpenSearch,
  onOpenSettings,
  aiOpen,
  streaming,
  isMock,
}: TopBarProps) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="icon-button"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
        >
          {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        <Brand />
        <span className="topbar-separator" />
        <button
          type="button"
          className="doc-pill"
          onClick={onOpenFile}
          title="打开另一份 PDF"
          aria-label={`当前文档 ${fileName}，打开另一份 PDF`}
        >
          <span className="doc-pill-icon">
            <FolderOpen size={15} />
          </span>
          <span className="doc-pill-copy">
            <strong>{fileName}</strong>
            <span>{numPages} 页</span>
          </span>
        </button>
      </div>

      <div className="topbar-center">
        <PageNavigator
          currentPage={currentPage}
          numPages={numPages}
          onJumpToPage={onJumpToPage}
        />
      </div>

      <div className="topbar-right">
        <div className="zoom-controls" role="group" aria-label="缩放">
          <button type="button" className="nav-arrow" onClick={onZoomOut} aria-label="缩小">
            <Minus size={15} />
          </button>
          <span className="zoom-value" title={isFitWidth ? "适合宽度" : "当前缩放"}>
            {isFitWidth ? `适宽 ${zoomPercent}%` : `${zoomPercent}%`}
          </span>
          <button type="button" className="nav-arrow" onClick={onZoomIn} aria-label="放大">
            <Plus size={15} />
          </button>
          <button
            type="button"
            className={`fit-button ${isFitWidth ? "is-active" : ""}`}
            onClick={onFitWidth}
            aria-label="适合宽度"
            title="适合宽度"
          >
            <Maximize2 size={14} />
          </button>
        </div>

        <span className="topbar-separator hide-mobile" />

        <button
          type="button"
          className="icon-button"
          onClick={onOpenSearch}
          aria-label="搜索文档"
          title="搜索文档 (Ctrl+F)"
        >
          <Search size={17} />
        </button>

        <button
          type="button"
          className={`ai-trigger ${aiOpen ? "is-open" : ""} ${streaming ? "is-streaming" : ""}`}
          onClick={onOpenAI}
          aria-label="打开共读助手"
          title="共读助手"
        >
          <Sparkles size={16} />
          <span>{streaming ? "回答中" : "共读助手"}</span>
          {isMock && <i className="demo-dot" title="演示模式" />}
        </button>

        <button
          type="button"
          className="icon-button theme-toggle"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>

        <button
          type="button"
          className="icon-button"
          onClick={onOpenSettings}
          aria-label="AI 设置"
          title="AI 设置"
        >
          <Settings2 size={17} />
        </button>
      </div>
    </header>
  );
}
