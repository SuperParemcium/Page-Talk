import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { DocumentInfo, PageDimension, PdfOutlineNode } from "../types";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy };

export interface LoadedPdf {
  pdf: PDFDocumentProxy;
  info: DocumentInfo;
  dimensions: PageDimension[];
  destroy: () => Promise<void>;
}

const ASSET_OPTIONS = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
};

export async function loadPdfFromFile(file: File): Promise<LoadedPdf> {
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    throw new Error("请选择一个 PDF 文件");
  }
  const buffer = await file.arrayBuffer();
  return loadPdfData(buffer, file.name, file.size);
}

export async function loadPdfFromUrl(url: string, name: string): Promise<LoadedPdf> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("示例文档加载失败");
  const buffer = await response.arrayBuffer();
  return loadPdfData(buffer, name, buffer.byteLength);
}

async function loadPdfData(
  buffer: ArrayBuffer,
  name: string,
  size: number,
): Promise<LoadedPdf> {
  const task = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    ...ASSET_OPTIONS,
  });

  task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
    const message =
      reason === pdfjsLib.PasswordResponses.NEED_PASSWORD
        ? "这份 PDF 需要密码才能打开，请输入密码："
        : "密码不正确，请重新输入：";
    const password = window.prompt(message);
    if (password === null) {
      void task.destroy();
      return;
    }
    updatePassword(password);
  };

  const pdf = await task.promise;
  const dimensions = new Array<PageDimension>(pdf.numPages);
  let nextPageNumber = 1;
  const concurrency = Math.min(16, pdf.numPages);

  async function measurePages() {
    while (true) {
      const pageNumber = nextPageNumber;
      nextPageNumber += 1;
      if (pageNumber > pdf.numPages) return;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      dimensions[pageNumber - 1] = {
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
      };
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => measurePages()));

  return {
    pdf,
    dimensions,
    destroy: () => task.destroy(),
    info: {
      name,
      numPages: pdf.numPages,
      fingerprint: pdf.fingerprints?.[0] || `${name}-${size}`,
      size,
    },
  };
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 在页面上叠一层与 canvas 对齐的文本层，用于原生选择、复制与搜索高亮。
 */
export async function renderPageTextLayer(
  page: PDFPageProxy,
  container: HTMLElement,
  scale: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  const viewport = page.getViewport({ scale });
  container.style.setProperty("--total-scale-factor", String(scale));
  container.style.setProperty("--scale-round-x", "1px");
  container.style.setProperty("--scale-round-y", "1px");
  const stream = page.streamTextContent({
    includeMarkedContent: true,
    disableNormalization: true,
  });
  const layer = new pdfjsLib.TextLayer({
    textContentSource: stream,
    container,
    viewport,
  });
  const abort = () => layer.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await layer.render();
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export async function extractPageText(pdf: PDFDocumentProxy, pageNumber: number) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if ("str" in item) {
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
  }
  return text;
}

function safeOutlineUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, window.location.href);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return url.href;
  } catch {
    // 忽略格式错误的链接。
  }
  return null;
}

function outlineColor(color: Uint8ClampedArray | undefined): string | null {
  if (!color || color.length < 3) return null;
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

export async function loadPdfOutline(pdf: PDFDocumentProxy): Promise<PdfOutlineNode[]> {
  let raw: Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>;
  try {
    raw = await pdf.getOutline();
  } catch {
    return [];
  }
  if (!raw || raw.length === 0) return [];

  const destinationCache = new Map<string, number | null>();

  async function resolvePage(dest: unknown): Promise<number | null> {
    if (!dest) return null;
    let resolved: unknown = dest;
    if (typeof dest === "string") {
      if (destinationCache.has(dest)) return destinationCache.get(dest) ?? null;
      try {
        resolved = await pdf.getDestination(dest);
      } catch {
        resolved = null;
      }
    }
    if (!Array.isArray(resolved) || resolved.length === 0) {
      if (typeof dest === "string") destinationCache.set(dest, null);
      return null;
    }
    const ref = resolved[0];
    let page: number | null = null;
    if (typeof ref === "number") {
      page = Math.min(pdf.numPages, Math.max(1, ref + 1));
    } else if (ref && typeof ref === "object") {
      try {
        const index = await pdf.getPageIndex(ref);
        page = Math.min(pdf.numPages, Math.max(1, index + 1));
      } catch {
        page = null;
      }
    }
    if (typeof dest === "string") destinationCache.set(dest, page);
    return page;
  }

  async function mapItems(
    items: typeof raw,
    parentPath: string,
    depth: number,
  ): Promise<PdfOutlineNode[]> {
    const nodes: PdfOutlineNode[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const id = `${parentPath}-${index}`;
      const pageNumber = await resolvePage(item.dest);
      const children = Array.isArray(item.items)
        ? await mapItems(item.items as typeof raw, id, depth + 1)
        : [];
      nodes.push({
        id,
        title: item.title?.trim() || `未命名条目 ${index + 1}`,
        pageNumber,
        url: safeOutlineUrl(item.url),
        bold: Boolean(item.bold),
        italic: Boolean(item.italic),
        color: outlineColor(item.color),
        children,
      });
    }
    return nodes;
  }

  return mapItems(raw, "outline", 0);
}
