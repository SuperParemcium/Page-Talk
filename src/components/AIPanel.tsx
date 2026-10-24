import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  BookOpen,
  PenTool,
  ScanLine,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { AIProviderSettings, ChatMessage } from "../types";
import { providerLabel } from "../lib/ai";
import { MarkdownContent } from "./MarkdownContent";
import { MarkdownEditor } from "./MarkdownEditor";

interface AIPanelProps {
  open: boolean;
  settings: AIProviderSettings | null;
  messages: ChatMessage[];
  streaming: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  currentPage: number;
  onClose: () => void;
  onStop: () => void;
  onSendFollowUp: (question: string) => void;
  onStartCapture: () => void;
  onOpenHandwriting: () => void;
  onOpenSettings: () => void;
  onClear: () => void;
}

function MessageImage({ src, page }: { src: string; page?: number }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <button
        type="button"
        className="chat-shot"
        onClick={() => setZoomed(true)}
        title="放大截图"
        aria-label="放大查看截图"
      >
        <img src={src} alt={`第 ${page ?? ""} 页截图`} />
        <span>第 {page ?? "—"} 页 · 点击放大</span>
      </button>
      {zoomed &&
        createPortal(
          <div className="chat-lightbox" onClick={() => setZoomed(false)}>
            <button type="button" onClick={() => setZoomed(false)} aria-label="关闭大图">
              <X size={20} />
            </button>
            <img src={src} alt={`第 ${page ?? ""} 页截图大图`} />
            <span>第 {page ?? "—"} 页 · 框选截图</span>
          </div>,
          document.body,
        )}
    </>
  );
}

function MessageBody({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="user-message">
        <div className="user-bubble">
          {message.image && <MessageImage src={message.image} page={message.page} />}
          <MarkdownContent content={message.content} className="user-markdown" />
          {message.page && !message.image && (
            <span className="followup-context">关于第 {message.page} 页</span>
          )}
        </div>
      </div>
    );
  }

  const isStreaming = message.status === "streaming";
  return (
    <article className="assistant-message">
      <div className="assistant-avatar" aria-hidden="true">
        间
      </div>
      <div className="assistant-content">
        <div className="assistant-label">
          <span>页间 AI</span>
          {message.meta && <i>{message.meta}</i>}
          {isStreaming && <span className="reading-indicator">正在读</span>}
        </div>
        {message.content ? (
          <MarkdownContent content={message.content} streaming={isStreaming} />
        ) : isStreaming ? (
          <div className="assistant-thinking">
            <span className="thinking-dots">
              <i />
              <i />
              <i />
            </span>
            正在读你框选的这一块…
          </div>
        ) : null}

        {message.status === "error" && (
          <div className="chat-error">{message.error || "回答生成失败，请稍后重试。"}</div>
        )}
        {message.status === "stopped" && <div className="chat-stopped">已停止生成</div>}
      </div>
    </article>
  );
}

export function AIPanel({
  open,
  settings,
  messages,
  streaming,
  draft,
  onDraftChange,
  currentPage,
  onClose,
  onStop,
  onSendFollowUp,
  onStartCapture,
  onOpenHandwriting,
  onOpenSettings,
  onClear,
}: AIPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMock = !settings || settings.provider === "mock";
  const hasConversation = messages.length > 0;

  useEffect(() => {
    if (!open) return;
    const node = scrollRef.current;
    if (!node) return;
    const frame = window.requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, streaming, open]);

  if (!open) return null;

  function send() {
    const value = draft.trim();
    if (!value || streaming) return;
    onSendFollowUp(value);
  }

  return (
    <aside className="ai-panel" aria-label="AI 共读助手">
      <header className="ai-head">
        <div className="ai-head-title">
          <span className="ai-orb">
            <Sparkles size={17} />
          </span>
          <div>
            <div className="ai-title-row">
              <h2>共读助手</h2>
              {isMock && <span className="ai-demo-badge">演示模式</span>}
            </div>
            <p>
              {isMock
                ? "接入模型后，我会读你框选的书页"
                : `${providerLabel(settings?.provider || "")} · ${
                    settings?.model || "未选择模型"
                  }`}
            </p>
          </div>
        </div>
        <div className="ai-head-actions">
          {hasConversation && (
            <button
              type="button"
              className="icon-button small"
              onClick={onClear}
              title="清空对话"
              aria-label="清空对话"
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            className="icon-button small"
            onClick={onOpenSettings}
            title="AI 设置"
            aria-label="AI 设置"
          >
            <Settings2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button small"
            onClick={onClose}
            title="关闭助手"
            aria-label="关闭助手"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="ai-scroll" ref={scrollRef}>
        {!hasConversation ? (
          <div className="ai-empty">
            <div className="ai-empty-art" aria-hidden="true">
              <div className="ai-empty-page">
                <span />
                <span />
                <span />
                <i />
              </div>
              <div className="ai-empty-scan">
                <ScanLine size={22} />
              </div>
              <Sparkles size={16} className="ai-empty-spark" />
            </div>
            <span className="ai-empty-eyebrow">A SECOND PAIR OF EYES</span>
            <h3>框选一块，<br />我们一起读。</h3>
            <p>
              遇到读不懂的句子、陌生的概念，或一张看不明白的图表，
              框住它，问出你的问题。截图会连同问题一起交给 AI。
            </p>
            <button type="button" className="primary-button wide" onClick={onStartCapture}>
              <ScanLine size={16} />
              去框中当前页
            </button>
            <div className="ai-empty-steps">
              <span>
                <b>1</b>框选
              </span>
              <i />
              <span>
                <b>2</b>提问
              </span>
              <i />
              <span>
                <b>3</b>追问
              </span>
            </div>
            {isMock && (
              <button type="button" className="demo-config-link" onClick={onOpenSettings}>
                当前是演示模式，点此接入真实模型
              </button>
            )}
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <MessageBody key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      <div className="ai-composer-area">
        {streaming && (
          <div className="stream-status">
            <span>
              <i />
              正在阅读截图中…
            </span>
            <button type="button" onClick={onStop}>
              <Square size={11} fill="currentColor" />
              停止
            </button>
          </div>
        )}
        {hasConversation ? (
          <>
            <div className="ai-composer">
              <MarkdownEditor
                value={draft}
                onChange={onDraftChange}
                placeholder={
                  streaming
                    ? "等待回答，或先停止生成…"
                    : "继续追问这一页…支持 Markdown 和 $公式$"
                }
                rows={2}
                minHeight={48}
                compact
                disabled={streaming}
                ariaLabel="继续追问"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <div className="ai-composer-foot">
                <div className="composer-tools">
                  <button
                    type="button"
                    className="capture-again"
                    onClick={onStartCapture}
                    title="重新框选一块书页"
                  >
                    <ScanLine size={13} />
                    框选新片段
                  </button>
                  <button
                    type="button"
                    className="handwriting-entry"
                    onClick={onOpenHandwriting}
                    disabled={streaming}
                    title="手写公式转 LaTeX（入口已预留）"
                  >
                    <PenTool size={13} />
                    手写公式
                    <span>预留</span>
                  </button>
                </div>
                <div className="composer-right">
                  <span>Enter 发送</span>
                  <button
                    type="button"
                    className="send-button"
                    onClick={send}
                    disabled={!draft.trim() || streaming}
                    aria-label="发送追问"
                  >
                    <ArrowUp size={16} />
                  </button>
                </div>
              </div>
            </div>
            <p className="ai-privacy">
              <BookOpen size={11} />
              第 {currentPage} 页 · 截图只会发送给你配置的模型服务
            </p>
          </>
        ) : (
          <p className="ai-privacy">
            <BookOpen size={11} />
            你的 PDF 与批注只保存在本机
          </p>
        )}
      </div>
    </aside>
  );
}
