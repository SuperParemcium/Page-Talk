import {
  ArrowUp,
  Image as ImageIcon,
  PenTool,
  Settings2,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import type { AIProviderSettings, CapturePayload } from "../types";
import { providerLabel } from "../lib/ai";
import { Modal } from "./Modal";
import { MarkdownEditor } from "./MarkdownEditor";

interface AskDialogProps {
  open: boolean;
  capture: CapturePayload | null;
  settings: AIProviderSettings | null;
  question: string;
  onQuestionChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (question: string) => void;
  onOpenHandwriting: () => void;
  onConfigure: () => void;
}

const QUICK_PROMPTS = [
  { label: "解释这段", prompt: "请解释框选内容的意思，并点出理解它的关键。" },
  { label: "翻译成中文", prompt: "请把框选内容翻译成中文，保留原文语气。" },
  { label: "概括要点", prompt: "请用三句话概括框选内容的核心观点。" },
  { label: "联系上下文", prompt: "结合这一页的上下文，这段内容为什么重要？" },
];

export function AskDialog({
  open,
  capture,
  settings,
  question,
  onQuestionChange,
  onClose,
  onSubmit,
  onOpenHandwriting,
  onConfigure,
}: AskDialogProps) {
  const isMock = !settings || settings.provider === "mock";
  const canSubmit = Boolean(capture) && question.trim().length > 0;

  function submit() {
    if (!canSubmit) return;
    onSubmit(question.trim());
  }

  return (
    <Modal open={open} onClose={onClose} className="ask-modal" labelledBy="ask-title">
      <div className="ask-head">
        <div>
          <span className="dialog-eyebrow">
            <Sparkles size={12} />
            ASK THE PAGE
          </span>
          <h2 id="ask-title">这一处，想问什么？</h2>
        </div>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </div>

      <div className="ask-body">
        <figure className="ask-preview">
          <div className="ask-image-frame">
            <span className="image-corner tl" />
            <span className="image-corner tr" />
            <span className="image-corner bl" />
            <span className="image-corner br" />
            {capture ? (
              <img src={capture.image} alt={`第 ${capture.page} 页的框选截图`} />
            ) : (
              <div className="ask-image-empty">
                <ImageIcon size={24} />
                暂无截图
              </div>
            )}
          </div>
          <figcaption>
            <span>
              第 {capture?.page ?? "—"} 页 · 框选截图
              {capture ? ` · ${capture.width}×${capture.height}` : ""}
              {capture?.hasInk ? " · 含手绘" : ""}
            </span>
            <span className="ask-image-privacy">仅发送这块画面</span>
          </figcaption>
        </figure>

        <div className="ask-form">
          <label htmlFor="ask-question">你的问题</label>
          <MarkdownEditor
            id="ask-question"
            value={question}
            onChange={onQuestionChange}
            placeholder="哪里没读懂？想翻译、拆解，还是找一个反例？可以写 Markdown 和 $公式$。"
            rows={5}
            minHeight={137}
            autoFocus
            ariaLabel="你的问题"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="quick-prompts" aria-label="快捷问题">
            {QUICK_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onQuestionChange(item.prompt)}
                className={question === item.prompt ? "is-active" : ""}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="ask-form-tools">
            <button
              type="button"
              className="handwriting-entry"
              onClick={onOpenHandwriting}
              title="手写公式转 LaTeX（入口已预留）"
            >
              <PenTool size={13} />
              手写公式转 LaTeX
              <span>预留</span>
            </button>
            <span>识别后以可编辑 LaTeX 插入问题</span>
          </div>

          <div className={`ask-model ${isMock ? "is-demo" : ""}`}>
            <span className="ask-model-icon">
              <WandSparkles size={15} />
            </span>
            <div>
              <strong>
                {isMock ? "演示模式" : settings?.model || "尚未配置模型"}
              </strong>
              <span>
                {isMock
                  ? "当前回答由本地示例生成，不会调用真实 AI。"
                  : `${providerLabel(settings?.provider || "")} · 将连同第 ${
                      capture?.page ?? "—"
                    } 页的截图一起发送`}
              </span>
            </div>
            <button type="button" onClick={onConfigure}>
              <Settings2 size={13} />
              配置
            </button>
          </div>
        </div>
      </div>

      <div className="ask-foot">
        <span className="ask-shortcut">
          按 <kbd>⌘</kbd> / <kbd>Ctrl</kbd> + <kbd>Enter</kbd> 发送
        </span>
        <div className="ask-actions">
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary-button" onClick={submit} disabled={!canSubmit}>
            <Sparkles size={15} />
            发送给 AI
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
