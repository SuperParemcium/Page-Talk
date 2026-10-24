export type InkKind = "pen" | "highlighter" | "eraser";

export type Tool =
  | "select"
  | "pen"
  | "highlighter"
  | "eraser"
  | "lasso"
  | "note"
  | "capture";

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  id: string;
  kind?: InkKind;
  color: string;
  width: number;
  points: Point[];
}

export type NoteColor = "amber" | "sage" | "rose" | "sky";

export interface Note {
  id: string;
  x: number;
  y: number;
  text: string;
  color: NoteColor;
  createdAt: number;
  updatedAt: number;
}

export interface PageAnnotations {
  strokes: Stroke[];
  notes: Note[];
}

export type AnnotationMap = Record<number, PageAnnotations>;

export interface PageDimension {
  width: number;
  height: number;
  rotation: number;
}

export interface DocumentInfo {
  name: string;
  numPages: number;
  fingerprint: string;
  size: number;
}

export interface CapturePayload {
  image: string;
  page: number;
  width: number;
  height: number;
  hasInk?: boolean;
}

export interface DraftNote {
  page: number;
  x: number;
  y: number;
}

export interface AIProviderSettings {
  provider: "mock" | "openai-compatible" | "anthropic";
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  hasApiKey: boolean;
  keySource: "stored" | "env" | "none";
  handwritingBaseUrl: string;
  handwritingModel: string;
}

export type ChatStatus = "streaming" | "done" | "error" | "stopped";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  image?: string;
  page?: number;
  createdAt: number;
  status?: ChatStatus;
  meta?: string;
  error?: string;
}

export interface NoteTarget {
  page: number;
  id: string;
}

export interface PdfOutlineNode {
  id: string;
  title: string;
  pageNumber: number | null;
  url: string | null;
  bold: boolean;
  italic: boolean;
  color: string | null;
  children: PdfOutlineNode[];
}

export interface SearchMatch {
  page: number;
  localIndex: number;
}

interface HighlightLike {
  add(range: Range): void;
  delete(range: Range): void;
}

export interface SearchHighlightApi {
  all: HighlightLike;
  active: HighlightLike;
}

export const NOTE_COLORS: Record<NoteColor, { bg: string; ink: string; label: string }> = {
  amber: { bg: "#F3E3B7", ink: "#6B511E", label: "琥珀" },
  sage: { bg: "#DCE7D5", ink: "#37533B", label: "苔绿" },
  rose: { bg: "#F1D9D3", ink: "#7A3D32", label: "陶土" },
  sky: { bg: "#D9E5E8", ink: "#31545A", label: "雾蓝" },
};

export const INK_COLORS = [
  { value: "#1A211D", label: "玄黑" },
  { value: "#5B655E", label: "石灰" },
  { value: "#23352E", label: "墨绿" },
  { value: "#C0573E", label: "朱砂" },
  { value: "#D9853B", label: "赭橙" },
  { value: "#C9A227", label: "赭黄" },
  { value: "#4D7755", label: "松绿" },
  { value: "#2F7D7A", label: "青碧" },
  { value: "#37668C", label: "黛蓝" },
  { value: "#6A5A8C", label: "暮紫" },
  { value: "#A85A72", label: "胭脂" },
  { value: "#7A5B43", label: "檀褐" },
] as const;

export const HIGHLIGHTER_COLORS = [
  { value: "#F2C94C", label: "明黄" },
  { value: "#A8D96B", label: "草绿" },
  { value: "#62C9C5", label: "青碧" },
  { value: "#7FB3E8", label: "天蓝" },
  { value: "#E9A3C0", label: "桃粉" },
  { value: "#F0A45E", label: "杏橙" },
  { value: "#C5A3E8", label: "淡紫" },
] as const;

export const BRUSH_SIZE_MIN = 0.0002;
export const BRUSH_SIZE_MAX = 0.016;
export const BRUSH_SIZE_DEFAULT = 0.0046;

export const TOOL_WIDTH_FACTOR: Record<InkKind, number> = {
  pen: 1,
  highlighter: 2.6,
  eraser: 2.3,
};

export const TOOL_MIN_WIDTH: Record<InkKind, number> = {
  pen: 1,
  highlighter: 1,
  eraser: 1,
};

export function inkWidthPx(kind: InkKind, normalizedWidth: number, pageWidth: number) {
  return Math.max(
    TOOL_MIN_WIDTH[kind],
    normalizedWidth * pageWidth * TOOL_WIDTH_FACTOR[kind],
  );
}
