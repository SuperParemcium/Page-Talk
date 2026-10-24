import { useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  PenTool,
  Sigma,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Modal } from "./Modal";
import { MarkdownContent } from "./MarkdownContent";
import { recognizeHandwriting } from "../lib/handwriting";

interface HandwritingLatexDialogProps {
  open: boolean;
  target: "ask" | "followup";
  model?: string;
  onClose: () => void;
  onInsert: (latex: string) => void;
}

interface PadPoint {
  x: number;
  y: number;
}

const PAD_STROKE_WIDTH = 2.4;

function drawStroke(
  ctx: CanvasRenderingContext2D,
  points: PadPoint[],
  width: number,
  height: number,
) {
  if (points.length === 0) return;
  ctx.strokeStyle = "#17251f";
  ctx.fillStyle = "#17251f";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = PAD_STROKE_WIDTH;
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(points[0].x * width, points[0].y * height, PAD_STROKE_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x * width, points[0].y * height);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x * width, points[index].y * height);
  }
  ctx.stroke();
}

export function HandwritingLatexDialog({
  open,
  target,
  model,
  onClose,
  onInsert,
}: HandwritingLatexDialogProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<PadPoint[][]>([]);
  const currentRef = useRef<PadPoint[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [latex, setLatex] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState(model);
  const [fallback, setFallback] = useState(false);

  function redrawPad() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
    const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(canvas.width / rect.width, 0, 0, canvas.height / rect.height, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) {
      drawStroke(ctx, stroke, rect.width, rect.height);
    }
    if (currentRef.current) {
      drawStroke(ctx, currentRef.current, rect.width, rect.height);
    }
  }

  function resetPad() {
    strokesRef.current = [];
    currentRef.current = null;
    setHasInk(false);
    setLatex("");
    setError(null);
    redrawPad();
  }

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): PadPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function handleDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || recognizing) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    currentRef.current = [pointFromEvent(event)];
    setHasInk(true);
    setLatex("");
    setError(null);
    redrawPad();
  }

  function handleMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!currentRef.current) return;
    event.preventDefault();
    const next = pointFromEvent(event);
    const points = currentRef.current;
    const last = points[points.length - 1];
    if (last) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (Math.hypot((next.x - last.x) * rect.width, (next.y - last.y) * rect.height) < 1.1) {
        return;
      }
    }
    points.push(next);
    redrawPad();
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) {
    if (!currentRef.current) return;
    const stroke = currentRef.current;
    currentRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && stroke.length > 0) {
      strokesRef.current.push(stroke);
    }
    setHasInk(strokesRef.current.length > 0);
    redrawPad();
  }

  function undoStroke() {
    strokesRef.current.pop();
    currentRef.current = null;
    setHasInk(strokesRef.current.length > 0);
    setLatex("");
    setError(null);
    redrawPad();
  }

  async function recognize() {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk || recognizing) return;
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const ctx = output.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(canvas, 0, 0);

    const controller = new AbortController();
    abortRef.current = controller;
    setRecognizing(true);
    setError(null);
    setLatex("");
    try {
      const result = await recognizeHandwriting(
        output.toDataURL("image/png"),
        controller.signal,
      );
      setLatex(result.latex);
      setActiveModel(result.model);
      setFallback(Boolean(result.fallback));
    } catch (recognizeError) {
      if (controller.signal.aborted) return;
      setError(
        recognizeError instanceof Error
          ? recognizeError.message
          : "识别失败，请检查 Ollama 设置后重试。",
      );
    } finally {
      if (!controller.signal.aborted) setRecognizing(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    strokesRef.current = [];
    currentRef.current = null;
    setHasInk(false);
    setLatex("");
    setError(null);
    setRecognizing(false);
    setActiveModel(model);
    setFallback(false);
    const frame = window.requestAnimationFrame(redrawPad);
    return () => {
      window.cancelAnimationFrame(frame);
      abortRef.current?.abort();
    };
    // Reset once each time the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => redrawPad());
    observer.observe(wrap);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      className="handwriting-modal"
      labelledBy="handwriting-title"
    >
      <div className="handwriting-head">
        <div className="handwriting-title-wrap">
          <span className="handwriting-icon">
            <Sigma size={18} />
          </span>
          <div>
            <span className="dialog-eyebrow">
              <PenTool size={11} />
              HANDWRITING → LATEX
            </span>
            <h2 id="handwriting-title">手写公式</h2>
          </div>
        </div>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </div>

      <div className="handwriting-body is-live">
        <div className="handwriting-pad-column">
          <div className="handwriting-pad-toolbar">
            <span>在下面写一个公式</span>
            <div>
              <button
                type="button"
                onClick={undoStroke}
                disabled={!hasInk || recognizing}
                title="撤销上一笔"
              >
                <Undo2 size={12} />
                撤销
              </button>
              <button
                type="button"
                onClick={resetPad}
                disabled={!hasInk || recognizing}
                title="清空手写板"
              >
                <Trash2 size={12} />
                清空
              </button>
            </div>
          </div>
          <div className="handwriting-canvas-wrap" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              className="handwriting-canvas"
              onPointerDown={handleDown}
              onPointerMove={handleMove}
              onPointerUp={(event) => finishStroke(event)}
              onPointerCancel={(event) => finishStroke(event, true)}
              aria-label="手写公式画布"
            />
            {!hasInk && (
              <div className="handwriting-canvas-empty" aria-hidden="true">
                <PenTool size={18} />
                <span>用鼠标或数位笔写下公式</span>
                <small>例如 \frac&#123;a&#125;&#123;b&#125; 或 ∫₀^∞ e⁻ˣ² dx</small>
              </div>
            )}
          </div>
        </div>

        <div className="handwriting-result">
          <div className="handwriting-result-head">
            <span>识别结果</span>
            <span className="handwriting-result-model">{activeModel || "Ollama"}</span>
          </div>
          {recognizing ? (
            <div className="handwriting-result-state is-loading">
              <Loader2 size={16} className="spin" />
              <p>Ollama 正在识别这张手写图…</p>
            </div>
          ) : latex ? (
            <>
              {fallback && (
                <span className="handwriting-fallback">
                  配置的模型不可用，已自动改用 {activeModel}
                </span>
              )}
              <div className="handwriting-result-preview">
                <MarkdownContent content={`$$${latex}$$`} />
              </div>
              <code className="handwriting-result-code">{latex}</code>
            </>
          ) : error ? (
            <div className="handwriting-result-state is-error">
              <X size={16} />
              <p>{error}</p>
            </div>
          ) : (
            <div className="handwriting-result-state">
              <Sparkles size={17} />
              <p>写完后点击「识别为 LaTeX」。</p>
              <small>识别结果会先显示在这里，确认后再插入问题。</small>
            </div>
          )}
        </div>
      </div>

      <div className="handwriting-note">
        <Sigma size={14} />
        <span>
          手写图片只会发送给设置里的 Ollama 模型（{activeModel || "未配置"}），不会交给聊天模型。
          识别结果会以可编辑的 LaTeX 插入{target === "ask" ? "提问框" : "追问输入框"}。
        </span>
      </div>

      <div className="handwriting-foot">
        <span>支持分数、根号、积分、矩阵等常见数学结构。</span>
        <div>
          <button type="button" className="text-button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="text-button"
            onClick={recognize}
            disabled={!hasInk || recognizing}
          >
            {recognizing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            {latex ? "重新识别" : "识别为 LaTeX"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => latex && onInsert(latex)}
            disabled={!latex || recognizing}
          >
            <Check size={14} />
            插入{target === "ask" ? "问题" : "追问"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
