import type { AnnotationMap, InkKind, PageAnnotations, Stroke } from "../types";
import { apiUrl } from "./api";

const KEY_PREFIX = "pagetalk:annotations:v1:";
const SAVED_AT_SUFFIX = ":savedAt";
const EMPTY_PAGE: PageAnnotations = { strokes: [], notes: [] };
const INK_KINDS: InkKind[] = ["pen", "highlighter", "eraser"];

export function strokeKind(stroke: Stroke): InkKind {
  return INK_KINDS.includes(stroke.kind as InkKind) ? (stroke.kind as InkKind) : "pen";
}

export function isVisibleStroke(stroke: Stroke) {
  return strokeKind(stroke) !== "eraser";
}

export function visibleStrokeCount(strokes: Stroke[]) {
  return strokes.reduce((total, stroke) => total + (isVisibleStroke(stroke) ? 1 : 0), 0);
}

function normalizeAnnotations(value: unknown): AnnotationMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: AnnotationMap = {};
  for (const [key, item] of Object.entries(value)) {
    const pageNumber = Number(key);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !item || typeof item !== "object") {
      continue;
    }
    const page = item as PageAnnotations;
    result[pageNumber] = {
      strokes: Array.isArray(page.strokes)
        ? page.strokes
            .filter(
              (stroke) =>
                stroke &&
                typeof stroke.id === "string" &&
                typeof stroke.color === "string" &&
                typeof stroke.width === "number" &&
                Array.isArray(stroke.points) &&
                stroke.points.length > 0,
            )
            .map((stroke) => ({ ...stroke, kind: strokeKind(stroke) }))
        : [],
      notes: Array.isArray(page.notes)
        ? page.notes.filter(
            (note) => note && typeof note.id === "string" && typeof note.text === "string",
          )
        : [],
    };
  }
  return result;
}

function safeParse(raw: string | null): AnnotationMap {
  if (!raw) return {};
  try {
    return normalizeAnnotations(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function compactAnnotations(annotations: AnnotationMap): AnnotationMap {
  return Object.fromEntries(
    Object.entries(annotations).filter(
      ([, page]) => page.strokes.length > 0 || page.notes.length > 0,
    ),
  );
}

export function loadAnnotations(fingerprint: string): AnnotationMap {
  if (typeof localStorage === "undefined") return {};
  return safeParse(localStorage.getItem(`${KEY_PREFIX}${fingerprint}`));
}

export function loadLocalSavedAt(fingerprint: string): number {
  if (typeof localStorage === "undefined") return 0;
  const value = Number(localStorage.getItem(`${KEY_PREFIX}${fingerprint}${SAVED_AT_SUFFIX}`));
  return Number.isFinite(value) ? value : 0;
}

export function saveAnnotations(fingerprint: string, annotations: AnnotationMap) {
  const savedAt = Date.now();
  try {
    const meaningful = compactAnnotations(annotations);
    if (Object.keys(meaningful).length === 0) {
      localStorage.removeItem(`${KEY_PREFIX}${fingerprint}`);
    } else {
      localStorage.setItem(`${KEY_PREFIX}${fingerprint}`, JSON.stringify(meaningful));
    }
    // 即使页面已清空也保留时间戳，作为“删除”这一动作的本地墓碑。
    localStorage.setItem(`${KEY_PREFIX}${fingerprint}${SAVED_AT_SUFFIX}`, String(savedAt));
  } catch (error) {
    console.warn("批注保存失败", error);
  }
  return savedAt;
}

export function getPageAnnotations(annotations: AnnotationMap, page: number): PageAnnotations {
  return annotations[page] || EMPTY_PAGE;
}

export function countAnnotations(annotations: AnnotationMap) {
  let notes = 0;
  let strokes = 0;
  for (const page of Object.values(annotations)) {
    notes += page.notes.length;
    strokes += visibleStrokeCount(page.strokes);
  }
  return { notes, strokes };
}

export interface RemoteAnnotations {
  annotations: AnnotationMap;
  savedAt: number;
}

function annotationsUrl(fingerprint: string) {
  return apiUrl(`/api/annotations/${encodeURIComponent(fingerprint)}`);
}

export async function loadAnnotationsFromServer(
  fingerprint: string,
): Promise<RemoteAnnotations | null> {
  const response = await fetch(annotationsUrl(fingerprint), {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`读取磁盘批注失败（${response.status}）`);
  }
  const payload = await response.json();
  if (!payload?.annotations) return null;
  return {
    annotations: normalizeAnnotations(payload.annotations),
    savedAt: Number(payload?.savedAt) || 0,
  };
}

export async function saveAnnotationsToServer(
  fingerprint: string,
  annotations: AnnotationMap,
  options: { keepalive?: boolean } = {},
) {
  const response = await fetch(annotationsUrl(fingerprint), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ annotations: compactAnnotations(annotations) }),
    keepalive: options.keepalive,
  });
  if (!response.ok) {
    throw new Error(`写入磁盘批注失败（${response.status}）`);
  }
  const payload = await response.json();
  return Number(payload?.savedAt) || Date.now();
}
