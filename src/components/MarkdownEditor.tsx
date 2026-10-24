import { useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  Bold,
  Code2,
  Eye,
  FunctionSquare,
  Heading2,
  Italic,
  Link2,
  List,
  PenLine,
  Quote,
  Sigma,
} from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
  rows?: number;
  minHeight?: number;
  compact?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

interface ToolAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "写点什么…",
  id,
  rows = 4,
  minHeight = 120,
  compact = false,
  disabled = false,
  autoFocus = false,
  ariaLabel,
  onKeyDown,
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function focusSelection(start: number, end: number) {
    window.requestAnimationFrame(() => {
      const node = textareaRef.current;
      if (!node) return;
      node.focus({ preventScroll: true });
      node.setSelectionRange(start, end);
    });
  }

  function replaceSelection(prefix: string, suffix = "", fallback = "") {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const selected = value.slice(start, end) || fallback;
    const next = `${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`;
    onChange(next);
    focusSelection(start + prefix.length, start + prefix.length + selected.length);
  }

  function prefixLine(prefix: string) {
    const node = textareaRef.current;
    const cursor = node?.selectionStart ?? value.length;
    const lineStart = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1;
    const next = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`;
    onChange(next);
    focusSelection(cursor + prefix.length, cursor + prefix.length);
  }

  function insertBlock(block: string) {
    const node = textareaRef.current;
    const start = node?.selectionStart ?? value.length;
    const end = node?.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const body = block.includes("{{}}") ? block.replace("{{}}", selected || "公式") : block;
    const next = `${value.slice(0, start)}${body}${value.slice(end)}`;
    onChange(next);
    const contentStart = next.indexOf(selected || "公式", start);
    const target = contentStart >= 0 ? contentStart : start + body.length;
    focusSelection(target, target + (selected || "公式").length);
  }

  const actions: ToolAction[] = [
    {
      id: "bold",
      label: "加粗",
      icon: <Bold size={13} />,
      run: () => replaceSelection("**", "**", "加粗文字"),
    },
    {
      id: "italic",
      label: "斜体",
      icon: <Italic size={13} />,
      run: () => replaceSelection("*", "*", "斜体文字"),
    },
    {
      id: "heading",
      label: "小标题",
      icon: <Heading2 size={13} />,
      run: () => prefixLine("## "),
    },
    {
      id: "quote",
      label: "引用",
      icon: <Quote size={13} />,
      run: () => prefixLine("> "),
    },
    {
      id: "list",
      label: "列表",
      icon: <List size={13} />,
      run: () => prefixLine("- "),
    },
    {
      id: "code",
      label: "行内代码",
      icon: <Code2 size={13} />,
      run: () => replaceSelection("`", "`", "code"),
    },
    {
      id: "link",
      label: "链接",
      icon: <Link2 size={13} />,
      run: () => replaceSelection("[", "](https://)", "链接文字"),
    },
    {
      id: "inline-math",
      label: "行内公式",
      icon: <Sigma size={13} />,
      run: () => replaceSelection("$", "$", "a^2+b^2=c^2"),
    },
    {
      id: "display-math",
      label: "独立公式",
      icon: <FunctionSquare size={13} />,
      run: () => insertBlock("\n\n$$\n{{}}\n$$\n\n"),
    },
  ];

  return (
    <div
      className={`md-editor ${compact ? "is-compact" : ""} ${disabled ? "is-disabled" : ""}`}
      style={{ ["--md-min-height" as string]: `${minHeight}px` }}
    >
      <div className="md-editor-top">
        <div className="md-tabs" role="tablist" aria-label="Markdown 编辑模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "write"}
            className={mode === "write" ? "is-active" : ""}
            onClick={() => {
              setMode("write");
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            }}
          >
            <PenLine size={11} />
            编写
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            className={mode === "preview" ? "is-active" : ""}
            onClick={() => setMode("preview")}
          >
            <Eye size={11} />
            预览
          </button>
        </div>
        <div className="md-toolbar" role="toolbar" aria-label="Markdown 格式">
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              title={action.label}
              aria-label={action.label}
              onMouseDown={(event) => event.preventDefault()}
              onClick={action.run}
              disabled={disabled || mode === "preview"}
            >
              {action.icon}
            </button>
          ))}
        </div>
      </div>

      {mode === "preview" ? (
        <div className="md-preview" role="tabpanel">
          {value.trim() ? (
            <MarkdownContent content={value} />
          ) : (
            <span className="md-preview-empty">还没有内容。切回「编写」开始写。</span>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          id={id}
          data-autofocus={autoFocus || undefined}
          className="md-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          aria-label={ariaLabel}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      )}
    </div>
  );
}
