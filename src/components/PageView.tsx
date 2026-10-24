import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { Check, LassoSelect, Loader2, StickyNote, Trash2, X } from "lucide-react";
import type { PDFDocumentProxy } from "../lib/pdf";
import { renderPageTextLayer } from "../lib/pdf";
import { strokeKind, visibleStrokeCount } from "../lib/annotations";
import type {
  CapturePayload,
  InkKind,
  Note,
  NoteColor,
  PageAnnotations,
  PageDimension,
  Point,
  SearchHighlightApi,
  Stroke,
  Tool,
} from "../types";
import { NOTE_COLORS, inkWidthPx } from "../types";

interface InkCanvasProps {
  active: boolean;
  tool: Tool;
  strokes: Stroke[];
  color: string;
  normalizedWidth: number;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onCommit: (stroke: Omit<Stroke, "id">) => void;
  onMoveStrokes: (ids: string[], dx: number, dy: number) => void;
  onDeleteStrokes: (ids: string[]) => void;
}

type NativePointer = PointerEvent & { getCoalescedEvents?: () => PointerEvent[] };
type InkMode = "ink" | "lasso" | "move" | null;

interface SelectionBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Scene {
  current: Omit<Stroke, "id"> | null;
  lasso: Point[] | null;
  selectedIds: string[];
  offset: Point;
}

function nativePoint(native: PointerEvent, rect: DOMRect, withPressure: boolean): Point {
  return {
    x: Math.min(0.999, Math.max(0.001, (native.clientX - rect.left) / rect.width)),
    y: Math.min(0.999, Math.max(0.001, (native.clientY - rect.top) / rect.height)),
    ...(withPressure
      ? { pressure: Math.min(1, Math.max(0.02, native.pressure > 0 ? native.pressure : 0.06)) }
      : {}),
  };
}

function eventSamples(native: NativePointer): PointerEvent[] {
  if (typeof native.getCoalescedEvents !== "function") return [native];
  try {
    const samples = native.getCoalescedEvents();
    return samples.length > 0 ? samples : [native];
  } catch {
    return [native];
  }
}

/**
 * 压感曲线刻意比线性更陡：轻触迅速变细，重按接近两倍笔宽。
 * 指数小于 1，会把数位笔低压力段的细小变化放大。
 */
function pressureWidth(baseWidth: number, pressure: number | undefined) {
  if (pressure === undefined) return baseWidth;
  const normalized = Math.pow(Math.min(1, Math.max(0, pressure)), 0.56);
  return Math.max(0.35, baseWidth * (0.06 + normalized * 1.94));
}

function traceSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  widthPx: number,
  heightPx: number,
  dx = 0,
  dy = 0,
) {
  ctx.beginPath();
  ctx.moveTo((points[0].x + dx) * widthPx, (points[0].y + dy) * heightPx);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = ((current.x + next.x) / 2 + dx) * widthPx;
    const midY = ((current.y + next.y) / 2 + dy) * heightPx;
    ctx.quadraticCurveTo(
      (current.x + dx) * widthPx,
      (current.y + dy) * heightPx,
      midX,
      midY,
    );
  }
  const last = points[points.length - 1];
  ctx.lineTo((last.x + dx) * widthPx, (last.y + dy) * heightPx);
}

function paintStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Pick<Stroke, "kind" | "color" | "width" | "points">,
  widthPx: number,
  heightPx: number,
  dx = 0,
  dy = 0,
) {
  const points = stroke.points;
  if (points.length === 0) return;
  const kind: InkKind = stroke.kind || "pen";
  const baseWidth = Math.max(1, inkWidthPx(kind, stroke.width, widthPx));

  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "eraser") {
    // 像素橡皮：清除画布 alpha，而不是删掉整条笔画。
    ctx.globalCompositeOperation = "destination-out";
  } else if (kind === "highlighter") {
    ctx.globalAlpha = 0.36;
  }

  const hasPressure =
    kind === "pen" && points.some((point) => typeof point.pressure === "number");

  if (hasPressure && points.length > 1) {
    // 钢笔逐段使用压感宽度；coalesced events 提供足够密的采样。
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const pressure =
        ((previous.pressure ?? current.pressure ?? 0.35) +
          (current.pressure ?? previous.pressure ?? 0.35)) /
        2;
      ctx.lineWidth = pressureWidth(baseWidth, pressure);
      ctx.beginPath();
      ctx.moveTo((previous.x + dx) * widthPx, (previous.y + dy) * heightPx);
      ctx.lineTo((current.x + dx) * widthPx, (current.y + dy) * heightPx);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (points.length === 1) {
    const radius = pressureWidth(baseWidth, points[0].pressure) / 2;
    ctx.beginPath();
    ctx.arc(
      (points[0].x + dx) * widthPx,
      (points[0].y + dy) * heightPx,
      radius,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.lineWidth = baseWidth;
  traceSmoothPath(ctx, points, widthPx, heightPx, dx, dy);
  ctx.stroke();
  ctx.restore();
}

function strokeBounds(strokes: Stroke[], ids: Set<string>, dx = 0, dy = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const stroke of strokes) {
    if (!ids.has(stroke.id)) continue;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x + dx);
      minY = Math.min(minY, point.y + dy);
      maxX = Math.max(maxX, point.x + dx);
      maxY = Math.max(maxY, point.y + dy);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function selectionBoxFor(
  strokes: Stroke[],
  ids: string[],
  widthPx: number,
  heightPx: number,
  offset: Point = { x: 0, y: 0 },
): SelectionBox | null {
  const raw = strokeBounds(strokes, new Set(ids), offset.x, offset.y);
  if (!raw) return null;
  const padX = 5 / Math.max(1, widthPx);
  const padY = 5 / Math.max(1, heightPx);
  return {
    x: raw.x - padX,
    y: raw.y - padY,
    width: raw.width + padX * 2,
    height: raw.height + padY * 2,
  };
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  ids: string[],
  widthPx: number,
  heightPx: number,
  offset: Point,
) {
  const visibleIds = ids.filter((id) => {
    const stroke = strokes.find((item) => item.id === id);
    return stroke && strokeKind(stroke) !== "eraser";
  });
  const bounds = selectionBoxFor(strokes, visibleIds, widthPx, heightPx, offset);
  if (!bounds) return;
  const left = bounds.x * widthPx;
  const top = bounds.y * heightPx;
  const width = bounds.width * widthPx;
  const height = bounds.height * heightPx;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = "rgba(194, 103, 75, 0.92)";
  ctx.fillStyle = "rgba(251, 248, 241, 0.94)";
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(left, top, width, height);
  ctx.setLineDash([]);
  for (const [x, y] of [
    [left, top],
    [left + width, top],
    [left, top + height],
    [left + width, top + height],
  ]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawLasso(ctx: CanvasRenderingContext2D, points: Point[], widthPx: number, heightPx: number) {
  if (points.length < 2) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x * widthPx, points[0].y * heightPx);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x * widthPx, points[index].y * heightPx);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(194, 103, 75, 0.07)";
  ctx.fill();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = "rgba(194, 103, 75, 0.85)";
  ctx.stroke();
  ctx.restore();
}

interface CanvasMetrics {
  width: number;
  height: number;
  pixelWidth: number;
  pixelHeight: number;
}

function measureCanvas(canvas: HTMLCanvasElement): CanvasMetrics | null {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    width: rect.width,
    height: rect.height,
    pixelWidth: Math.max(1, Math.round(rect.width * dpr)),
    pixelHeight: Math.max(1, Math.round(rect.height * dpr)),
  };
}

function ensureCanvasSize(canvas: HTMLCanvasElement, metrics: CanvasMetrics) {
  if (canvas.width === metrics.pixelWidth && canvas.height === metrics.pixelHeight) {
    return false;
  }
  canvas.width = metrics.pixelWidth;
  canvas.height = metrics.pixelHeight;
  return true;
}

function rebuildBase(
  base: HTMLCanvasElement,
  strokes: Stroke[],
  metrics: CanvasMetrics,
  skipIds: Set<string> | null,
) {
  ensureCanvasSize(base, metrics);
  const ctx = base.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(
    base.width / metrics.width,
    0,
    0,
    base.height / metrics.height,
    0,
    0,
  );
  ctx.clearRect(0, 0, metrics.width, metrics.height);
  for (const stroke of strokes) {
    if (skipIds?.has(stroke.id)) continue;
    paintStroke(ctx, stroke, metrics.width, metrics.height);
  }
}

function compositeScene(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  metrics: CanvasMetrics,
  strokes: Stroke[],
  scene: Scene,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // 已提交笔迹保存在离屏 base 中；写字时只合成一次位图，不重放全部笔画。
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  ctx.setTransform(
    canvas.width / metrics.width,
    0,
    0,
    canvas.height / metrics.height,
    0,
    0,
  );

  const selected = new Set(scene.selectedIds);
  const moving = Boolean(scene.offset.x || scene.offset.y);
  if (moving) {
    for (const stroke of strokes) {
      if (!selected.has(stroke.id)) continue;
      paintStroke(ctx, stroke, metrics.width, metrics.height, scene.offset.x, scene.offset.y);
    }
  }
  if (scene.current) paintStroke(ctx, scene.current, metrics.width, metrics.height);
  if (scene.selectedIds.length > 0) {
    drawSelection(
      ctx,
      strokes,
      scene.selectedIds,
      metrics.width,
      metrics.height,
      moving ? scene.offset : { x: 0, y: 0 },
    );
  }
  if (scene.lasso) drawLasso(ctx, scene.lasso, metrics.width, metrics.height);
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function selectWithLasso(strokes: Stroke[], polygon: Point[]) {
  return strokes
    .filter((stroke) => {
      if (stroke.points.length === 0) return false;
      const inside = stroke.points.filter((point) => pointInPolygon(point, polygon)).length;
      // 橡皮擦操作也随套索一起移动，已擦出的缺口才不会留在原地。
      const threshold = strokeKind(stroke) === "eraser" ? 0.5 : 0.35;
      return inside >= Math.max(1, Math.ceil(stroke.points.length * threshold));
    })
    .map((stroke) => stroke.id);
}

function InkCanvas({
  active,
  tool,
  strokes,
  color,
  normalizedWidth,
  canvasRef,
  onCommit,
  onMoveStrokes,
  onDeleteStrokes,
}: InkCanvasProps) {
  const currentRef = useRef<Omit<Stroke, "id"> | null>(null);
  const modeRef = useRef<InkMode>(null);
  const lassoRef = useRef<Point[] | null>(null);
  const selectedRef = useRef<string[]>([]);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const moveStartRef = useRef<Point | null>(null);
  const lastPenAtRef = useRef(0);
  const strokesRef = useRef(strokes);
  const cursorRef = useRef<HTMLSpanElement>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseDirtyRef = useRef(true);
  const baseSkipRef = useRef<Set<string> | null>(null);
  const frameRef = useRef(0);
  const rectRef = useRef<DOMRect | null>(null);
  const [resizeTick, setResizeTick] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [lassoing, setLassoing] = useState(false);
  const [moving, setMoving] = useState(false);
  strokesRef.current = strokes;

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const metrics = measureCanvas(canvas);
    if (!metrics) return;
    let base = baseCanvasRef.current;
    if (!base) {
      base = document.createElement("canvas");
      baseCanvasRef.current = base;
      baseDirtyRef.current = true;
    }
    if (ensureCanvasSize(canvas, metrics)) baseDirtyRef.current = true;
    if (baseDirtyRef.current) {
      rebuildBase(base, strokesRef.current, metrics, baseSkipRef.current);
      baseDirtyRef.current = false;
    }
    compositeScene(canvas, base, metrics, strokesRef.current, {
      current: currentRef.current,
      lasso: lassoRef.current,
      selectedIds: selectedRef.current,
      offset: offsetRef.current,
    });
  }

  /**
   * Pointer events can arrive faster than the display refreshes. Batch visual
   * updates into one paint per frame; the coalesced points are already stored.
   */
  function scheduleRedraw(dirtyBase = false) {
    if (dirtyBase) baseDirtyRef.current = true;
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      redraw();
    });
  }

  function cacheCommittedBase(nextStrokes: Stroke[]) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const metrics = measureCanvas(canvas);
    if (!metrics) return;
    ensureCanvasSize(canvas, metrics);
    let base = baseCanvasRef.current;
    if (!base) {
      base = document.createElement("canvas");
      baseCanvasRef.current = base;
    }
    rebuildBase(base, nextStrokes, metrics, null);
    baseDirtyRef.current = false;
  }

  function updateSelection(ids: string[], offset: Point = { x: 0, y: 0 }) {
    const visibleIds = ids.filter((id) => {
      const stroke = strokesRef.current.find((item) => item.id === id);
      return stroke && strokeKind(stroke) !== "eraser";
    });
    const nextIds = visibleIds.length > 0 ? ids : [];
    const unchanged =
      nextIds.length === selectedRef.current.length &&
      nextIds.every((id, index) => id === selectedRef.current[index]);
    selectedRef.current = nextIds;
    if (!unchanged) setSelectedIds(nextIds);
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    setSelectionBox(
      rect && visibleIds.length
        ? selectionBoxFor(strokesRef.current, visibleIds, rect.width, rect.height, offset)
        : null,
    );
  }

  function clearSelection() {
    updateSelection([]);
  }

  function updateCursor(event: React.PointerEvent<HTMLCanvasElement>) {
    const cursor = cursorRef.current;
    if (!cursor || !active) return;
    if (tool !== "pen" && tool !== "highlighter" && tool !== "eraser") {
      cursor.style.opacity = "0";
      return;
    }
    if (!rectRef.current) {
      rectRef.current = event.currentTarget.getBoundingClientRect();
    }
    const rect = rectRef.current;
    if (!rect.width) return;
    const kind: InkKind = tool;
    const size = Math.max(7, Math.min(110, inkWidthPx(kind, normalizedWidth, rect.width)));
    cursor.style.width = `${size}px`;
    cursor.style.height = `${size}px`;
    cursor.style.transform = `translate(${event.clientX - rect.left}px, ${event.clientY - rect.top}px) translate(-50%, -50%)`;
    cursor.style.setProperty("--cursor-color", tool === "eraser" ? "#4c5b52" : color);
    cursor.classList.toggle("is-eraser", tool === "eraser");
    cursor.style.opacity = "1";
  }

  function hideCursor() {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
  }

  function handlePointerEnter(event: React.PointerEvent<HTMLCanvasElement>) {
    rectRef.current = event.currentTarget.getBoundingClientRect();
    updateCursor(event);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      rectRef.current = canvas.getBoundingClientRect();
      baseDirtyRef.current = true;
      setResizeTick((tick) => tick + 1);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef]);

  useEffect(() => {
    return () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!active) {
      currentRef.current = null;
      lassoRef.current = null;
      offsetRef.current = { x: 0, y: 0 };
      baseSkipRef.current = null;
      modeRef.current = null;
      selectedRef.current = [];
      setSelectedIds([]);
      setSelectionBox(null);
      setLassoing(false);
      setMoving(false);
      hideCursor();
    }
    // A new committed operation invalidates the cached base layer.
    offsetRef.current = { x: 0, y: 0 };
    baseSkipRef.current = null;
    baseDirtyRef.current = true;
    scheduleRedraw();
    // scheduleRedraw is stable enough for this lifecycle; its refs are current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, active, resizeTick, selectedIds, canvasRef]);

  useEffect(() => {
    if (tool !== "lasso" && selectedRef.current.length > 0) clearSelection();
    if (tool !== "pen" && tool !== "highlighter" && tool !== "eraser") hideCursor();
    // 清理动作只依赖工具切换；清空函数每次渲染都会更新。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);

  useEffect(() => {
    const current = selectedRef.current;
    if (current.length === 0) return;
    const valid = current.filter((id) => strokes.some((stroke) => stroke.id === id));
    if (valid.length !== current.length) {
      updateSelection(valid);
      baseDirtyRef.current = true;
      scheduleRedraw();
    }
    // 撤销等外部变更后，移除已不存在的选择项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = rectRef.current || event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function insideSelection(point: Point) {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    if (!rect || !selectionBox) return false;
    return (
      point.x >= selectionBox.x &&
      point.x <= selectionBox.x + selectionBox.width &&
      point.y >= selectionBox.y &&
      point.y <= selectionBox.y + selectionBox.height
    );
  }

  function appendSamples(native: NativePointer, rect: DOMRect, kind: InkKind) {
    if (!currentRef.current) return false;
    const points = currentRef.current.points;
    let changed = false;
    const isPen = kind === "pen";
    const threshold = isPen ? 0.55 : 1;
    for (const sample of eventSamples(native)) {
      const next = nativePoint(sample, rect, isPen);
      const last = points[points.length - 1];
      if (!last) {
        points.push(next);
        changed = true;
        continue;
      }
      const distance = Math.hypot(
        (next.x - last.x) * rect.width,
        (next.y - last.y) * rect.height,
      );
      if (distance < threshold) continue;
      if (isPen) {
        const raw = next.pressure ?? 0.5;
        // 更少的滞后平滑，让压感在起笔和转折处立刻响应。
        next.pressure = (last.pressure ?? raw) * 0.22 + raw * 0.78;
      }
      points.push(next);
      changed = true;
    }
    return changed;
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active || event.button !== 0) return;
    rectRef.current = event.currentTarget.getBoundingClientRect();
    updateCursor(event);
    const native = event.nativeEvent as NativePointer;
    const now = Date.now();
    if (native.pointerType === "touch" && now - lastPenAtRef.current < 1600) return;
    if (native.pointerType === "pen") lastPenAtRef.current = now;
    event.preventDefault();
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "lasso") {
      if (selectedRef.current.length > 0 && insideSelection(point)) {
        modeRef.current = "move";
        moveStartRef.current = point;
        offsetRef.current = { x: 0, y: 0 };
        // 拖动期间 base 跳过选中笔画，使每帧只需移动这些笔画。
        baseSkipRef.current = new Set(selectedRef.current);
        baseDirtyRef.current = true;
        setMoving(true);
        scheduleRedraw();
        return;
      }
      clearSelection();
      lassoRef.current = [point];
      modeRef.current = "lasso";
      setLassoing(true);
      scheduleRedraw();
      return;
    }

    if (tool !== "pen" && tool !== "highlighter" && tool !== "eraser") return;
    const kind: InkKind = tool;
    const rect = rectRef.current || event.currentTarget.getBoundingClientRect();
    currentRef.current = {
      kind,
      color,
      width: normalizedWidth,
      points: [nativePoint(native, rect, kind === "pen")],
    };
    modeRef.current = "ink";
    scheduleRedraw();
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    updateCursor(event);
    const native = event.nativeEvent as NativePointer;
    if (native.pointerType === "pen") lastPenAtRef.current = Date.now();
    const mode = modeRef.current;
    if (!mode) return;
    event.preventDefault();

    if (mode === "lasso") {
      const point = pointFromEvent(event);
      const points = lassoRef.current;
      if (!points) return;
      const last = points[points.length - 1];
      const rect = rectRef.current || event.currentTarget.getBoundingClientRect();
      if (Math.hypot((point.x - last.x) * rect.width, (point.y - last.y) * rect.height) < 1.6) {
        return;
      }
      points.push(point);
      scheduleRedraw();
      return;
    }

    if (mode === "move") {
      const start = moveStartRef.current;
      if (!start) return;
      const point = pointFromEvent(event);
      offsetRef.current = { x: point.x - start.x, y: point.y - start.y };
      scheduleRedraw();
      return;
    }

    if (!currentRef.current) return;
    const rect = rectRef.current || event.currentTarget.getBoundingClientRect();
    const kind = currentRef.current.kind || "pen";
    if (!appendSamples(native, rect, kind)) return;
    scheduleRedraw();
  }

  function finishInteraction(event: React.PointerEvent<HTMLCanvasElement>, cancelled = false) {
    const mode = modeRef.current;
    if (!mode) return;
    modeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (mode === "ink") {
      const current = currentRef.current;
      currentRef.current = null;
      if (!cancelled && current) {
        // 先把刚落下的笔画合入离屏 base，避免等待 React 更新时闪一下。
        cacheCommittedBase([
          ...strokesRef.current,
          { ...current, id: "__pending__" },
        ]);
        onCommit({
          kind: current.kind,
          color: current.color,
          width: current.width,
          points: current.points,
        });
      } else {
        baseDirtyRef.current = true;
      }
      scheduleRedraw();
      return;
    }

    if (mode === "lasso") {
      const polygon = cancelled ? null : lassoRef.current;
      lassoRef.current = null;
      setLassoing(false);
      if (!polygon || polygon.length < 3) {
        clearSelection();
      } else {
        const ids = selectWithLasso(strokesRef.current, polygon);
        updateSelection(ids);
      }
      scheduleRedraw();
      return;
    }

    if (mode === "move") {
      const offset = offsetRef.current;
      const ids = selectedRef.current;
      moveStartRef.current = null;
      setMoving(false);
      if (!cancelled && ids.length > 0 && (offset.x || offset.y)) {
        // 保持 offset 与跳过集合，直到父级传入移动后的 strokes。
        updateSelection(ids, offset);
        onMoveStrokes(ids, offset.x, offset.y);
      } else {
        offsetRef.current = { x: 0, y: 0 };
        baseSkipRef.current = null;
        baseDirtyRef.current = true;
        if (!cancelled && ids.length > 0) updateSelection(ids);
      }
      scheduleRedraw();
    }
  }

  function deleteSelection() {
    const ids = selectedRef.current;
    if (ids.length === 0) return;
    clearSelection();
    onDeleteStrokes(ids);
    baseDirtyRef.current = true;
    scheduleRedraw();
  }

  useEffect(() => {
    if (tool !== "lasso" || selectedIds.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        deleteSelection();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        baseDirtyRef.current = true;
        scheduleRedraw();
      }
    };
    // 捕获阶段拦截，确保第一次 Esc 只取消套索选区，第二次才退出工具。
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const selectedVisibleCount = strokes.filter(
    (stroke) => selectedIds.includes(stroke.id) && strokeKind(stroke) !== "eraser",
  ).length;
  const hudStyle =
    selectionBox && selectedVisibleCount > 0
      ? {
          left: `${Math.min(80, Math.max(20, (selectionBox.x + selectionBox.width / 2) * 100))}%`,
          top: `${selectionBox.y < 0.12 ? (selectionBox.y + selectionBox.height) * 100 : selectionBox.y * 100}%`,
          ...(selectionBox.y < 0.12 ? { transform: "translate(-50%, 6px)" } : {}),
        }
      : undefined;

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`ink-canvas ${active ? "is-active" : ""} ink-tool-${tool}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={hideCursor}
        onPointerUp={(event) => finishInteraction(event)}
        onPointerCancel={(event) => finishInteraction(event, true)}
        aria-hidden="true"
      />
      <span ref={cursorRef} className="ink-cursor" aria-hidden="true" />
      {tool === "lasso" &&
        selectedVisibleCount > 0 &&
        selectionBox &&
        !lassoing &&
        !moving && (
          <div
            className="lasso-hud"
            style={hudStyle}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className="lasso-hud-count">
              <LassoSelect size={12} />
              {selectedVisibleCount} 笔
            </span>
            <span className="lasso-hud-divider" />
            <button
              type="button"
              onClick={deleteSelection}
              title="删除选中的笔迹 (Delete)"
              aria-label="删除选中的笔迹"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              onClick={() => {
                clearSelection();
                baseDirtyRef.current = true;
                scheduleRedraw();
              }}
              title="取消选择 (Esc)"
              aria-label="取消选择"
            >
              <X size={13} />
            </button>
        </div>
      )}
    </>
  );
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InteractionLayerProps {
  tool: Tool;
  pageNumber: number;
  onPlaceNote: (x: number, y: number) => void;
  onCaptureRect: (rect: Rect) => void;
}

function InteractionLayer({ tool, pageNumber, onPlaceNote, onCaptureRect }: InteractionLayerProps) {
  const [selection, setSelection] = useState<Rect | null>(null);
  const startRef = useRef<Point | null>(null);
  const movedRef = useRef(false);
  const active = tool === "note" || tool === "capture";

  useEffect(() => {
    setSelection(null);
    startRef.current = null;
  }, [tool]);

  function relativePoint(event: React.PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function handleDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || event.button !== 0) return;
    const point = relativePoint(event);
    startRef.current = point;
    movedRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "capture") setSelection({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || !startRef.current) return;
    const point = relativePoint(event);
    const start = startRef.current;
    const dx = Math.abs(point.x - start.x);
    const dy = Math.abs(point.y - start.y);
    if (dx * event.currentTarget.clientWidth > 3 || dy * event.currentTarget.clientHeight > 3) {
      movedRef.current = true;
    }
    if (tool === "capture") {
      setSelection({
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      });
    }
  }

  function handleUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!active || !startRef.current) return;
    const clamp = relativePoint(event);
    const start = startRef.current;
    startRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (tool === "note") {
      if (!movedRef.current) onPlaceNote(clamp.x, clamp.y);
      setSelection(null);
      return;
    }

    if (tool === "capture") {
      // 用起止点直接计算，避免最后一次 pointermove 尚未提交时丢失选择框。
      const finalRect: Rect = {
        x: Math.min(start.x, clamp.x),
        y: Math.min(start.y, clamp.y),
        width: Math.abs(clamp.x - start.x),
        height: Math.abs(clamp.y - start.y),
      };
      const pixelW = finalRect.width * event.currentTarget.clientWidth;
      const pixelH = finalRect.height * event.currentTarget.clientHeight;
      if (pixelW > 12 && pixelH > 12) {
        onCaptureRect(finalRect);
      }
      setSelection(null);
    }
  }

  function handleCancel() {
    startRef.current = null;
    setSelection(null);
  }

  if (!active) return null;

  const top = selection ? selection.y * 100 : 0;
  const left = selection ? selection.x * 100 : 0;
  const width = selection ? selection.width * 100 : 0;
  const height = selection ? selection.height * 100 : 0;
  const hasSelection = Boolean(selection && selection.width > 0.01 && selection.height > 0.01);

  return (
    <div
      className={`interaction-layer ${tool === "capture" ? "is-capturing" : "is-noting"}`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      aria-hidden="true"
    >
      {hasSelection && selection && (
        <>
          <div className="capture-shade capture-shade-top" style={{ height: `${top}%` }} />
          <div
            className="capture-shade capture-shade-left"
            style={{ top: `${top}%`, height: `${height}%`, width: `${left}%` }}
          />
          <div
            className="capture-shade capture-shade-right"
            style={{ top: `${top}%`, height: `${height}%`, left: `${left + width}%` }}
          />
          <div
            className="capture-shade capture-shade-bottom"
            style={{ top: `${top + height}%` }}
          />
          <div
            className="capture-selection"
            style={{
              top: `${top}%`,
              left: `${left}%`,
              width: `${width}%`,
              height: `${height}%`,
            }}
          >
            <span className="selection-corner tl" />
            <span className="selection-corner tr" />
            <span className="selection-corner bl" />
            <span className="selection-corner br" />
            <span className="selection-chip">第 {pageNumber} 页 · 将截图发送给 AI</span>
          </div>
        </>
      )}
    </div>
  );
}

interface NoteLayerProps {
  notes: Note[];
  pageNumber: number;
  activeId: string | null;
  draft: { x: number; y: number } | null;
  captureMode: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onUpdate: (id: string, text: string, color: NoteColor) => void;
  onDelete: (id: string) => void;
  onSaveDraft: (text: string, color: NoteColor) => void;
  onCancelDraft: () => void;
}

interface NoteEditorProps {
  initialText: string;
  initialColor: NoteColor;
  pageNumber: number;
  isDraft: boolean;
  onSave: (text: string, color: NoteColor) => void;
  onDelete?: () => void;
  onCancel: () => void;
}

function NoteEditor({
  initialText,
  initialColor,
  pageNumber,
  isDraft,
  onSave,
  onDelete,
  onCancel,
}: NoteEditorProps) {
  const [text, setText] = useState(initialText);
  const [color, setColor] = useState<NoteColor>(initialColor);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const palette = NOTE_COLORS[color] || NOTE_COLORS.amber;
  const canSave = text.trim().length > 0;

  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    const timer = window.setTimeout(() => {
      node.focus({ preventScroll: true });
      node.setSelectionRange(node.value.length, node.value.length);
    }, 30);
    return () => window.clearTimeout(timer);
  }, []);

  function save() {
    if (!canSave) return;
    onSave(text.trim(), color);
  }

  return (
    <div
      className={`note-float note-editor ${text ? "" : "is-empty"}`}
      style={{ ["--note-bg" as string]: palette.bg, ["--note-ink" as string]: palette.ink }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="note-editor-head">
        <span className="note-editor-label">
          <StickyNote size={13} />
          {isDraft ? "新的页边批注" : `第 ${pageNumber} 页 · 页边批注`}
        </span>
        <div className="note-editor-head-actions">
          {!isDraft && onDelete && (
            <button type="button" onClick={onDelete} aria-label="删除这条批注" title="删除批注">
              <Trash2 size={13} />
            </button>
          )}
          <button type="button" onClick={onCancel} aria-label="关闭批注" title="关闭">
            <X size={14} />
          </button>
        </div>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="写下此刻的想法、疑问，或一段还没想清楚的话…"
        rows={4}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            save();
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
      />

      <div className="note-editor-foot">
        <div className="note-colors" aria-label="批注颜色">
          {(Object.keys(NOTE_COLORS) as NoteColor[]).map((name) => (
            <button
              key={name}
              type="button"
              className={`note-color-dot ${color === name ? "is-active" : ""}`}
              style={{ backgroundColor: NOTE_COLORS[name].bg }}
              onClick={() => setColor(name)}
              aria-label={NOTE_COLORS[name].label}
              title={NOTE_COLORS[name].label}
            />
          ))}
        </div>
        <div className="note-editor-actions">
          <button type="button" className="note-cancel" onClick={onCancel}>
            取消
          </button>
          <button type="button" className="note-save" onClick={save} disabled={!canSave}>
            <Check size={13} />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function noteCardStyle(note: { x: number; y: number }) {
  return {
    left: `${note.x * 100}%`,
    top: `${note.y * 100}%`,
  };
}

function useAnchoredPlacement<T extends HTMLElement>(
  pinRef: RefObject<T | null>,
  isOpen: boolean,
  estimatedHeight: number,
) {
  const [placement, setPlacement] = useState({ up: false, left: false });

  const update = useCallback(() => {
    const rect = pinRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cardWidth = Math.min(322, viewportWidth - 40);
    const centerX = rect.left + rect.width / 2;
    const roomBelow = viewportHeight - rect.bottom - 112;
    const roomAbove = rect.top - 72;

    let left = centerX > viewportWidth * 0.56;
    if (!left && centerX + cardWidth + 22 > viewportWidth - 10) {
      if (centerX - cardWidth - 22 >= 10) left = true;
    }
    if (left && centerX - cardWidth - 22 < 10) {
      left = false;
    }

    let up = false;
    if (roomBelow < estimatedHeight) {
      up = roomAbove >= estimatedHeight || roomAbove > roomBelow;
    }

    setPlacement((current) =>
      current.up === up && current.left === left ? current : { up, left },
    );
  }, [estimatedHeight, pinRef]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    update();
  }, [isOpen, update]);

  useEffect(() => {
    if (!isOpen) return;
    const onChange = () => update();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
    };
  }, [isOpen, update]);

  return placement;
}

interface NoteMarkerProps {
  note: Note;
  index: number;
  pageNumber: number;
  isActive: boolean;
  onOpen: (id: string) => void;
  onClose: () => void;
  onUpdate: (id: string, text: string, color: NoteColor) => void;
  onDelete: (id: string) => void;
}

function NoteMarker({
  note,
  index,
  pageNumber,
  isActive,
  onOpen,
  onClose,
  onUpdate,
  onDelete,
}: NoteMarkerProps) {
  const [hovered, setHovered] = useState(false);
  const pinRef = useRef<HTMLButtonElement>(null);
  const showPreview = hovered && !isActive;
  const placement = useAnchoredPlacement(
    pinRef,
    isActive || showPreview,
    isActive ? 280 : 180,
  );
  const palette = NOTE_COLORS[note.color] || NOTE_COLORS.amber;

  return (
    <div
      className={`note-anchor ${placement.left ? "align-left" : ""} ${
        placement.up ? "align-up" : ""
      }`}
      style={noteCardStyle(note)}
    >
      <button
        ref={pinRef}
        type="button"
        className={`note-pin ${isActive ? "is-active" : ""}`}
        style={{
          ["--note-bg" as string]: palette.bg,
          ["--note-ink" as string]: palette.ink,
        }}
        onClick={() => onOpen(note.id)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-label={`打开第 ${pageNumber} 页的批注：${note.text.slice(0, 40)}`}
        aria-expanded={isActive}
      >
        <StickyNote size={12} />
        <span>{index + 1}</span>
      </button>

      {showPreview && (
        <div
          className="note-float note-preview"
          style={{
            ["--note-bg" as string]: palette.bg,
            ["--note-ink" as string]: palette.ink,
          }}
        >
          <span className="note-preview-label">页边批注</span>
          <p>{note.text}</p>
          <span className="note-preview-hint">点击展开与编辑</span>
        </div>
      )}

      {isActive && (
        <NoteEditor
          key={note.id}
          initialText={note.text}
          initialColor={note.color}
          pageNumber={pageNumber}
          isDraft={false}
          onSave={(text, color) => onUpdate(note.id, text, color)}
          onDelete={() => onDelete(note.id)}
          onCancel={onClose}
        />
      )}
    </div>
  );
}

function NoteLayer({
  notes,
  pageNumber,
  activeId,
  draft,
  captureMode,
  onOpen,
  onClose,
  onUpdate,
  onDelete,
  onSaveDraft,
  onCancelDraft,
}: NoteLayerProps) {
  const draftPinRef = useRef<HTMLSpanElement>(null);
  const draftPlacement = useAnchoredPlacement(draftPinRef, Boolean(draft), 280);

  return (
    <div className={`note-layer ${captureMode ? "is-capture-mode" : ""}`}>
      {notes.map((note, index) => (
        <NoteMarker
          key={note.id}
          note={note}
          index={index}
          pageNumber={pageNumber}
          isActive={activeId === note.id}
          onOpen={onOpen}
          onClose={onClose}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ))}

      {draft && (
        <div
          className={`note-anchor note-anchor-draft ${
            draftPlacement.left ? "align-left" : ""
          } ${draftPlacement.up ? "align-up" : ""}`}
          style={noteCardStyle(draft)}
        >
          <span
            ref={draftPinRef}
            className="note-pin is-draft"
            style={{
              ["--note-bg" as string]: NOTE_COLORS.amber.bg,
              ["--note-ink" as string]: NOTE_COLORS.amber.ink,
            }}
          >
            <StickyNote size={12} />
          </span>
          <NoteEditor
            key="draft"
            initialText=""
            initialColor="amber"
            pageNumber={pageNumber}
            isDraft
            onSave={onSaveDraft}
            onCancel={onCancelDraft}
          />
        </div>
      )}
    </div>
  );
}

interface PageViewProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  dimension: PageDimension;
  scale: number;
  pageAnnotations: PageAnnotations;
  tool: Tool;
  brushColor: string;
  brushSize: number;
  activeNoteId: string | null;
  draft: { x: number; y: number } | null;
  searchQuery: string;
  searchActivePage: number | null;
  searchActiveLocalIndex: number | null;
  searchNonce: number;
  searchHighlights: SearchHighlightApi | null;
  onAddStroke: (stroke: Omit<Stroke, "id">) => void;
  onMoveStrokes: (ids: string[], dx: number, dy: number) => void;
  onDeleteStrokes: (ids: string[]) => void;
  onPlaceNote: (x: number, y: number) => void;
  onCapture: (payload: CapturePayload) => void;
  onCaptureError: (message: string) => void;
  onOpenNote: (id: string) => void;
  onCloseNote: () => void;
  onUpdateNote: (id: string, text: string, color: NoteColor) => void;
  onDeleteNote: (id: string) => void;
  onSaveDraft: (text: string, color: NoteColor) => void;
  onCancelDraft: () => void;
}

export function PageView({
  pdf,
  pageNumber,
  dimension,
  scale,
  pageAnnotations,
  tool,
  brushColor,
  brushSize,
  activeNoteId,
  draft,
  searchQuery,
  searchActivePage,
  searchActiveLocalIndex,
  searchNonce,
  searchHighlights,
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
}: PageViewProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const lastSearchScrollKey = useRef("");
  const [near, setNear] = useState(false);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [renderState, setRenderState] = useState<"idle" | "loading" | "ready">("idle");
  const width = Math.max(1, Math.round(dimension.width * scale));
  const height = Math.max(1, Math.round(dimension.height * scale));

  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { rootMargin: "1600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!near) {
      setRenderState("idle");
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    setRenderState("loading");

    async function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const cssWidth = dimension.width * scale;
        const cssHeight = dimension.height * scale;
        const dpr = Math.min(window.devicePixelRatio || 1, 1.8);
        const budgetRatio = Math.sqrt(7_000_000 / Math.max(1, cssWidth * cssHeight));
        const outputScale = Math.max(0.45, Math.min(dpr, budgetRatio));
        const viewport = page.getViewport({ scale: scale * outputScale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        renderTask = page.render({
          canvas,
          viewport,
          background: "#ffffff",
          intent: "display",
        });
        await renderTask.promise;
        if (!cancelled) setRenderState("ready");
      } catch (error) {
        if (cancelled || (error as Error)?.name === "RenderingCancelledException") return;
        console.warn("页面渲染失败", error);
        setRenderState("idle");
      }
    }

    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [near, pdf, pageNumber, dimension.width, dimension.height, scale]);

  // 文本层：让 PDF 中的真实文字可选择、可复制，并供搜索高亮定位。
  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) return;
    const layerContainer = container;
    if (!near) {
      layerContainer.replaceChildren();
      setTextLayerVersion(0);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setTextLayerVersion(0);

    async function buildTextLayer() {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        layerContainer.replaceChildren();
        await renderPageTextLayer(page, layerContainer, scale, controller.signal);
        if (!cancelled) setTextLayerVersion((version) => version + 1);
      } catch (error) {
        if (cancelled || (error as Error)?.name === "AbortError") return;
        console.warn("文本层渲染失败", error);
      }
    }

    void buildTextLayer();
    return () => {
      cancelled = true;
      controller.abort();
      layerContainer.replaceChildren();
    };
  }, [near, pdf, pageNumber, scale]);

  // 搜索高亮：使用 CSS Custom Highlight API，不破坏文本层的 DOM 结构。
  useEffect(() => {
    const container = textLayerRef.current;
    const needle = searchQuery.trim().toLocaleLowerCase();
    if (!container || !textLayerVersion || !needle) return;

    const textNodes: { node: Text; start: number; end: number }[] = [];
    let fullText = "";
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();
    while (currentNode) {
      const value = currentNode.nodeValue || "";
      if (value) {
        textNodes.push({
          node: currentNode as Text,
          start: fullText.length,
          end: fullText.length + value.length,
        });
        fullText += value;
      }
      currentNode = walker.nextNode();
    }

    function rangeFor(start: number, end: number): Range | null {
      const startNode = textNodes.find((item) => start >= item.start && start < item.end);
      const endNode = textNodes.find((item) => end > item.start && end <= item.end);
      if (!startNode || !endNode) return null;
      try {
        const range = document.createRange();
        range.setStart(startNode.node, start - startNode.start);
        range.setEnd(endNode.node, end - endNode.start);
        return range;
      } catch {
        return null;
      }
    }

    const ranges: Range[] = [];
    const lowerText = fullText.toLocaleLowerCase();
    let position = 0;
    while (position <= lowerText.length) {
      const foundAt = lowerText.indexOf(needle, position);
      if (foundAt === -1) break;
      const range = rangeFor(foundAt, foundAt + needle.length);
      if (range) ranges.push(range);
      position = foundAt + Math.max(1, needle.length);
    }

    const all = searchHighlights?.all;
    const active = searchHighlights?.active;
    for (const range of ranges) all?.add(range);

    let activeRange: Range | null = null;
    if (searchActivePage === pageNumber && searchActiveLocalIndex !== null) {
      activeRange = ranges[searchActiveLocalIndex] ?? null;
      if (activeRange) active?.add(activeRange);
    }

    let frame = 0;
    const scrollKey = `${searchQuery}|${pageNumber}|${searchActivePage}|${searchActiveLocalIndex}|${searchNonce}`;
    if (activeRange && lastSearchScrollKey.current !== scrollKey) {
      lastSearchScrollKey.current = scrollKey;
      frame = window.requestAnimationFrame(() => {
        const viewer = container.closest(".viewer-scroll") as HTMLElement | null;
        if (!viewer) return;
        const viewerRect = viewer.getBoundingClientRect();
        const rangeRect = activeRange!.getBoundingClientRect();
        if (!rangeRect.width && !rangeRect.height) return;
        const targetTop =
          viewer.scrollTop + rangeRect.top - viewerRect.top - viewer.clientHeight * 0.3;
        viewer.scrollTo({
          top: Math.max(0, targetTop),
          behavior: "smooth",
        });
      });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      for (const range of ranges) {
        all?.delete(range);
        active?.delete(range);
      }
    };
  }, [
    textLayerVersion,
    searchQuery,
    searchActivePage,
    searchActiveLocalIndex,
    searchNonce,
    pageNumber,
    searchHighlights,
  ]);

  function handleCaptureRect(rect: Rect) {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || renderState !== "ready") {
      onCaptureError("这一页还没有渲染完成，请稍后再框选。");
      return;
    }
    const x = Math.min(1, Math.max(0, rect.x));
    const y = Math.min(1, Math.max(0, rect.y));
    const w = Math.min(1 - x, Math.max(0, rect.width));
    const h = Math.min(1 - y, Math.max(0, rect.height));
    if (w <= 0 || h <= 0) return;

    const sx = Math.floor(x * canvas.width);
    const sy = Math.floor(y * canvas.height);
    const sw = Math.max(1, Math.floor(w * canvas.width));
    const sh = Math.max(1, Math.floor(h * canvas.height));
    const maxSide = 1600;
    const ratio = Math.min(1, maxSide / sw, maxSide / sh);

    const output = document.createElement("canvas");
    output.width = Math.max(1, Math.round(sw * ratio));
    output.height = Math.max(1, Math.round(sh * ratio));
    const ctx = output.getContext("2d", { alpha: false });
    if (!ctx) {
      onCaptureError("截图生成失败，请重试。");
      return;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, output.width, output.height);

    // 将当前页的手绘批注一起合成进截图，让 AI 能看到圈画的位置。
    const ink = inkCanvasRef.current;
    if (ink && ink.width > 0 && ink.height > 0) {
      ctx.drawImage(
        ink,
        x * ink.width,
        y * ink.height,
        w * ink.width,
        h * ink.height,
        0,
        0,
        output.width,
        output.height,
      );
    }

    const image = output.toDataURL("image/jpeg", 0.92);
    onCapture({
      image,
      page: pageNumber,
      width: output.width,
      height: output.height,
      hasInk: visibleStrokeCount(pageAnnotations.strokes) > 0,
    });
  }

  return (
    <div
      className="page-frame"
      ref={frameRef}
      data-page-number={pageNumber}
      style={{ width, height }}
      aria-label={`第 ${pageNumber} 页`}
    >
      <div className="page-surface">
        <canvas
          ref={canvasRef}
          className={`pdf-canvas ${renderState === "ready" ? "is-ready" : ""}`}
        />
        <div
          ref={textLayerRef}
          className={`textLayer pdf-text-layer ${tool === "select" ? "is-selectable" : ""}`}
        />
        {renderState !== "ready" && (
          <div className="page-placeholder">
            {near ? (
              <>
                <Loader2 size={18} className="spin" />
                <span>正在铺开书页</span>
              </>
            ) : (
              <span className="page-placeholder-number">{pageNumber}</span>
            )}
          </div>
        )}
        <InkCanvas
          active={
            ["pen", "highlighter", "eraser", "lasso"].includes(tool) &&
            renderState === "ready"
          }
          tool={tool}
          strokes={pageAnnotations.strokes}
          color={brushColor}
          normalizedWidth={brushSize}
          canvasRef={inkCanvasRef}
          onCommit={onAddStroke}
          onMoveStrokes={onMoveStrokes}
          onDeleteStrokes={onDeleteStrokes}
        />
        <InteractionLayer
          tool={tool}
          pageNumber={pageNumber}
          onPlaceNote={onPlaceNote}
          onCaptureRect={handleCaptureRect}
        />
      </div>

      <NoteLayer
        notes={pageAnnotations.notes}
        pageNumber={pageNumber}
        activeId={activeNoteId}
        draft={draft}
        captureMode={tool === "capture"}
        onOpen={onOpenNote}
        onClose={onCloseNote}
        onUpdate={onUpdateNote}
        onDelete={onDeleteNote}
        onSaveDraft={onSaveDraft}
        onCancelDraft={onCancelDraft}
      />

      <div className="page-margin-note">
        <span>{String(pageNumber).padStart(2, "0")}</span>
        <i />
      </div>
    </div>
  );
}
