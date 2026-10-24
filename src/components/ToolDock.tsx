import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  Eraser,
  Highlighter,
  LassoSelect,
  MousePointer2,
  PenLine,
  ScanLine,
  Spline,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Tool } from "../types";
import {
  BRUSH_SIZE_MAX,
  BRUSH_SIZE_MIN,
  HIGHLIGHTER_COLORS,
  INK_COLORS,
} from "../types";

interface ToolDockProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  brushColor: string;
  brushSize: number;
  brushPixels: number;
  onBrushColor: (color: string) => void;
  onBrushSize: (size: number) => void;
  canUndo: boolean;
  onUndo: () => void;
  onClearStrokes: () => void;
}

const toolItems: {
  id: Tool;
  label: string;
  shortcut: string;
  icon: typeof MousePointer2;
}[] = [
  { id: "select", label: "浏览", shortcut: "V", icon: MousePointer2 },
  { id: "pen", label: "钢笔", shortcut: "P", icon: PenLine },
  { id: "highlighter", label: "荧光笔", shortcut: "H", icon: Highlighter },
  { id: "eraser", label: "橡皮", shortcut: "E", icon: Eraser },
  { id: "lasso", label: "套索", shortcut: "L", icon: LassoSelect },
  { id: "note", label: "批注", shortcut: "N", icon: StickyNote },
];

const BRUSH_TOOLS: Tool[] = ["pen", "highlighter", "eraser"];

const BRUSH_LABEL: Record<string, string> = {
  pen: "钢笔",
  highlighter: "荧光笔",
  eraser: "橡皮擦",
};

const BRUSH_NOTE: Record<string, string> = {
  pen: "数位笔压感",
  highlighter: "半透明叠色",
  eraser: "擦除像素，不删笔画",
};

const BRUSH_ICON = {
  pen: PenLine,
  highlighter: Highlighter,
  eraser: Eraser,
};

export function ToolDock({
  tool,
  onToolChange,
  brushColor,
  brushSize,
  brushPixels,
  onBrushColor,
  onBrushSize,
  canUndo,
  onUndo,
  onClearStrokes,
}: ToolDockProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const brushOpen = BRUSH_TOOLS.includes(tool);
  const palette = tool === "highlighter" ? HIGHLIGHTER_COLORS : INK_COLORS;
  const BrushIcon = BRUSH_ICON[tool as keyof typeof BRUSH_ICON] || PenLine;
  const sizePercent =
    ((brushSize - BRUSH_SIZE_MIN) / (BRUSH_SIZE_MAX - BRUSH_SIZE_MIN)) * 100;
  const previewWidth = Math.max(1.5, Math.min(19, brushPixels || 3));
  const sizeLabel =
    brushPixels >= 10 ? `${Math.round(brushPixels)} px` : `${brushPixels.toFixed(1)} px`;

  useEffect(() => {
    setConfirmClear(false);
  }, [tool]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = window.setTimeout(() => setConfirmClear(false), 3200);
    return () => window.clearTimeout(timer);
  }, [confirmClear]);

  return (
    <div className="tool-dock-wrap">
      {brushOpen && (
        <div className="brush-palette" role="group" aria-label={`${BRUSH_LABEL[tool]}设置`}>
          <div className="brush-palette-head">
            <span className="brush-palette-title">
              <BrushIcon size={13} strokeWidth={1.9} />
              {BRUSH_LABEL[tool]}
            </span>
            <span className={`brush-palette-note ${tool === "pen" ? "has-pressure" : ""}`}>
              {tool === "pen" && <Spline size={11} />}
              {BRUSH_NOTE[tool]}
            </span>
          </div>

          {tool !== "eraser" && (
            <div className="brush-color-row">
              <span className="palette-label">颜色</span>
              <div className="color-swatches">
                {palette.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={`color-swatch ${brushColor === color.value ? "is-active" : ""}`}
                    style={{ backgroundColor: color.value }}
                    onClick={() => onBrushColor(color.value)}
                    aria-label={`${color.label}${BRUSH_LABEL[tool]}`}
                    title={color.label}
                  />
                ))}
                <label
                  className={`custom-color ${palette.some((color) => color.value === brushColor) ? "" : "is-active"}`}
                  title="自定义颜色"
                  style={{ "--picked-color": brushColor } as CSSProperties}
                >
                  <span className="custom-color-wheel" aria-hidden="true" />
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(event) => onBrushColor(event.target.value)}
                    aria-label="自定义画笔颜色"
                  />
                </label>
              </div>
            </div>
          )}

          <div className="brush-size-row">
            <span className="palette-label">粗细</span>
            <span className="brush-preview" aria-hidden="true">
              <i
                style={{
                  width: previewWidth,
                  height: previewWidth,
                  backgroundColor: tool === "eraser" ? "#9b9d94" : brushColor,
                  opacity: tool === "highlighter" ? 0.5 : 1,
                }}
              />
            </span>
            <input
              className="brush-size-slider"
              type="range"
              min={BRUSH_SIZE_MIN}
              max={BRUSH_SIZE_MAX}
              step={0.0001}
              value={brushSize}
              onChange={(event) => onBrushSize(Number(event.target.value))}
              aria-label={`${BRUSH_LABEL[tool]}粗细`}
              style={{ "--size-pct": `${sizePercent}%` } as CSSProperties}
            />
            <span className="brush-size-value">{sizeLabel}</span>
          </div>

          <div className="brush-palette-actions">
            <span className="brush-action-hint">
              {tool === "pen" && "轻压细、重压粗 · 支持数位板"}
              {tool === "highlighter" && "拖动即可覆盖，不遮挡原文"}
              {tool === "eraser" && "只擦除经过的像素，可撤销"}
            </span>
            <button
              type="button"
              className="mini-action"
              onClick={onUndo}
              disabled={!canUndo}
              title="撤销上一步 (Ctrl+Z)"
            >
              <Undo2 size={14} />
              撤销
            </button>
            <button
              type="button"
              className={`mini-action danger ${confirmClear ? "is-confirming" : ""}`}
              onClick={() => {
                if (confirmClear) {
                  onClearStrokes();
                  setConfirmClear(false);
                } else {
                  setConfirmClear(true);
                }
              }}
              disabled={!canUndo && !confirmClear}
              title="清除本页全部手绘"
            >
              <Trash2 size={14} />
              {confirmClear ? "确认清除" : "清空本页"}
            </button>
          </div>
        </div>
      )}

      <div className="tool-dock" role="toolbar" aria-label="阅读工具">
        {toolItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`tool-button ${tool === item.id ? "is-active" : ""}`}
              onClick={() => onToolChange(item.id)}
              aria-pressed={tool === item.id}
              aria-label={item.label}
              title={`${item.label} (${item.shortcut})`}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>{item.label}</span>
            </button>
          );
        })}

        <span className="tool-divider" />

        <button
          type="button"
          className={`tool-button tool-capture ${tool === "capture" ? "is-active" : ""}`}
          onClick={() => onToolChange("capture")}
          aria-pressed={tool === "capture"}
          aria-label="框选问 AI"
          title="框选一块书页，向 AI 提问 (Q)"
        >
          <ScanLine size={18} strokeWidth={1.9} />
          <span>框选问 AI</span>
        </button>

        <span className="tool-divider" />

        <button
          type="button"
          className="tool-icon-button"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销上一步 (Ctrl+Z)"
          aria-label="撤销上一步"
        >
          <Undo2 size={17} strokeWidth={1.9} />
        </button>
      </div>

      <div className="tool-hint" aria-live="polite">
        {tool === "select" && "滚轮连续阅读 · 选择工具，在页边留下痕迹"}
        {tool === "pen" && "钢笔已开启 · 轻压细、重压粗，Esc 退出"}
        {tool === "highlighter" && "荧光笔已开启 · 半透明覆盖，不遮挡文字，Esc 退出"}
        {tool === "eraser" && "橡皮擦已开启 · 擦除像素，不会删除整条笔画，Esc 退出"}
        {tool === "lasso" && "套索 · 圈住笔迹后拖动；Delete 删除，Esc 取消"}
        {tool === "note" && "在页面上点击，放置一条悬浮批注 · Esc 取消"}
        {tool === "capture" && (
          <>
            <ScanLine size={13} />
            拖拽框选要交给 AI 的书页内容 · Esc 取消
          </>
        )}
      </div>
    </div>
  );
}
