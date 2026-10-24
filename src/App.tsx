import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import type {
  AIProviderSettings,
  CapturePayload,
  ChatMessage,
  DocumentInfo,
  DraftNote,
  InkKind,
  NoteColor,
  NoteTarget,
  PageDimension,
  PdfOutlineNode,
  Tool,
} from "./types";
import {
  BRUSH_SIZE_DEFAULT,
  HIGHLIGHTER_COLORS,
  INK_COLORS,
  inkWidthPx,
} from "./types";
import {
  loadPdfFromFile,
  loadPdfFromUrl,
  loadPdfOutline,
  type LoadedPdf,
  type PDFDocumentProxy,
} from "./lib/pdf";
import { AIRequestError, fetchSettings, providerLabel, streamChat } from "./lib/ai";
import { getPageAnnotations } from "./lib/annotations";
import { useAnnotations } from "./hooks/useAnnotations";
import { usePdfSearch } from "./hooks/usePdfSearch";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { DocumentStage, type JumpRequest } from "./components/DocumentStage";
import { ToolDock } from "./components/ToolDock";
import { SearchBar } from "./components/SearchBar";
import { AIPanel } from "./components/AIPanel";
import { AskDialog } from "./components/AskDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { HandwritingLatexDialog } from "./components/HandwritingLatexDialog";
import { Brand } from "./components/Brand";
import { Toast, type ToastState } from "./components/Toast";

type SidebarTab = "pages" | "outline" | "notes";

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inkKindForTool(tool: Tool): InkKind | null {
  return tool === "pen" || tool === "highlighter" || tool === "eraser" ? tool : null;
}

type Theme = "light" | "dark";

const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 440;
const SIDEBAR_WIDTH_DEFAULT = 274;

function initialTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function initialSidebarWidth() {
  if (typeof window === "undefined") return SIDEBAR_WIDTH_DEFAULT;
  const raw = window.localStorage.getItem("pagetalk:sidebar-width");
  if (!raw) return SIDEBAR_WIDTH_DEFAULT;
  const saved = Number(raw);
  return Number.isFinite(saved)
    ? clamp(saved, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)
    : SIDEBAR_WIDTH_DEFAULT;
}

function friendlyLoadError(error: unknown) {
  const name = (error as { name?: string })?.name;
  const message = error instanceof Error ? error.message : String(error);
  if (name === "PasswordException") return "这份 PDF 需要密码，已取消打开。";
  if (name === "InvalidPDFException") return "这个文件不是有效的 PDF，或已经损坏。";
  if (/password/i.test(message)) return "这份 PDF 需要密码，无法打开。";
  if (/worker/i.test(message)) return "PDF 解析组件加载失败，请刷新页面后重试。";
  return `打开 PDF 失败：${message || "未知错误"}`;
}

function friendlyChatError(error: unknown) {
  if (error instanceof AIRequestError) return error.message;
  if (error instanceof DOMException && error.name === "AbortError") return "生成已停止。";
  if (error instanceof Error) {
    if (/fetch|network|load failed/i.test(error.message)) {
      return "无法连接本地 AI 代理，请确认应用服务正在运行。";
    }
    return error.message;
  }
  return "回答生成失败，请稍后重试。";
}

export default function App() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [info, setInfo] = useState<DocumentInfo | null>(null);
  const [dimensions, setDimensions] = useState<PageDimension[]>([]);
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [welcomeError, setWelcomeError] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [viewerWidth, setViewerWidth] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitMode, setFitMode] = useState(true);
  const [jumpRequest, setJumpRequest] = useState<JumpRequest | null>(null);

  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 1180);
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("pages");
  const [outline, setOutline] = useState<PdfOutlineNode[]>([]);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [tool, setTool] = useState<Tool>("select");
  const [penColor, setPenColor] = useState<string>(INK_COLORS[2].value);
  const [highlighterColor, setHighlighterColor] = useState<string>(
    HIGHLIGHTER_COLORS[0].value,
  );
  const [brushSizes, setBrushSizes] = useState<Record<InkKind, number>>({
    pen: BRUSH_SIZE_DEFAULT,
    highlighter: 0.007,
    eraser: 0.008,
  });
  const [activeNote, setActiveNote] = useState<NoteTarget | null>(null);
  const [draftNote, setDraftNote] = useState<DraftNote | null>(null);

  const [settings, setSettings] = useState<AIProviderSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [handwritingTarget, setHandwritingTarget] = useState<"ask" | "followup" | null>(
    null,
  );
  const [returnToAsk, setReturnToAsk] = useState(false);
  const [capture, setCapture] = useState<CapturePayload | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [askDraft, setAskDraft] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const pdfDestroyRef = useRef<(() => Promise<void>) | null>(null);
  const loadSequence = useRef(0);
  const jumpSequence = useRef(0);
  const pendingAnchorPage = useRef<number | null>(null);
  const anchorTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);

  const annotationStore = useAnnotations(info?.fingerprint || null);
  const {
    annotations,
    storageState,
    historyDepths,
    addStroke,
    undoStroke,
    clearPageStrokes,
    moveStrokes,
    deleteStrokes,
    addNote,
    updateNote,
    deleteNote,
  } = annotationStore;

  const maxPageWidth = useMemo(
    () => dimensions.reduce((max, page) => Math.max(max, page.width), 0) || 595,
    [dimensions],
  );
  const stagePadding = viewerWidth > 0 && viewerWidth < 760 ? 20 : 48;
  const fitScale =
    viewerWidth > 0
      ? clamp((viewerWidth - stagePadding * 2) / maxPageWidth, 0.3, 2.6)
      : 1;
  const scale = fitMode ? fitScale : zoom;
  const zoomPercent = Math.round(scale * 100);
  const pageStrokes = getPageAnnotations(annotations, currentPage).strokes;
  const canUndo = pageStrokes.length > 0 || (historyDepths[currentPage] ?? 0) > 0;
  const inkKind = inkKindForTool(tool);
  const brushColor = tool === "highlighter" ? highlighterColor : penColor;
  const brushSize = inkKind ? brushSizes[inkKind] : BRUSH_SIZE_DEFAULT;
  const brushPixels =
    inkKind && dimensions[currentPage - 1]
      ? inkWidthPx(inkKind, brushSize, dimensions[currentPage - 1].width * scale)
      : 0;

  function updateBrushColor(color: string) {
    if (tool === "highlighter") setHighlighterColor(color);
    else setPenColor(color);
  }

  function updateBrushSize(size: number) {
    if (!inkKind) return;
    setBrushSizes((current) => ({ ...current, [inkKind]: size }));
  }

  const showToast = useCallback((message: string, type: ToastState["type"] = "info") => {
    setToast({ id: Date.now(), message, type });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.title = info ? `${info.name.replace(/\.pdf$/i, "")} · 页间` : "页间 · AI PDF 阅读器";
  }, [info]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem("pagetalk:theme", theme);
    } catch {
      // ignore storage failures
    }
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    themeMeta?.setAttribute("content", theme === "dark" ? "#101512" : "#f4f0e7");
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("pagetalk:sidebar-width", String(sidebarWidth));
    } catch {
      // ignore storage failures
    }
  }, [sidebarWidth]);

  useEffect(() => {
    if (!pdf) {
      setOutline([]);
      setOutlineLoading(false);
      return;
    }
    let cancelled = false;
    setOutline([]);
    setOutlineLoading(true);
    loadPdfOutline(pdf)
      .then((items) => {
        if (!cancelled) setOutline(items);
      })
      .catch(() => {
        if (!cancelled) setOutline([]);
      })
      .finally(() => {
        if (!cancelled) setOutlineLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdf]);

  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((next) => {
        if (!cancelled) setSettings(next);
      })
      .catch(() => {
        if (!cancelled) {
          showToast("无法读取 AI 配置，请确认本地服务正在运行。", "error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  const commitMessages = useCallback((next: ChatMessage[]) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    commitMessages(
      messagesRef.current.map((message) =>
        message.id === id ? { ...message, ...patch } : message,
      ),
    );
  }, [commitMessages]);

  const abortActiveRequest = useCallback(() => {
    requestSequence.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
  }, []);

  const applyLoadedDocument = useCallback(
    (loaded: LoadedPdf) => {
      const previousDestroy = pdfDestroyRef.current;
      pdfDestroyRef.current = loaded.destroy;
      pendingAnchorPage.current = null;
      if (anchorTimer.current !== null) {
        window.clearTimeout(anchorTimer.current);
        anchorTimer.current = null;
      }
      setPdf(loaded.pdf);
      setInfo(loaded.info);
      setDimensions(loaded.dimensions);
      setCurrentPage(1);
      setJumpRequest(null);
      setFitMode(true);
      setTool("select");
      setActiveNote(null);
      setDraftNote(null);
      setCapture(null);
      setAskOpen(false);
      setAiOpen(false);
      setHandwritingTarget(null);
      setAskDraft("");
      setFollowUpDraft("");
      setWelcomeError(null);
      abortActiveRequest();
      commitMessages([]);
      if (previousDestroy) {
        window.setTimeout(() => {
          void previousDestroy();
        }, 80);
      }
    },
    [abortActiveRequest, commitMessages],
  );

  const performLoad = useCallback(
    async (loader: () => Promise<LoadedPdf>, label: string) => {
      const requestId = ++loadSequence.current;
      setLoadingLabel(label);
      setWelcomeError(null);
      try {
        const loaded = await loader();
        if (requestId !== loadSequence.current) {
          void loaded.destroy();
          return;
        }
        applyLoadedDocument(loaded);
      } catch (error) {
        if (requestId !== loadSequence.current) return;
        const message = friendlyLoadError(error);
        setWelcomeError(message);
        showToast(message, "error");
      } finally {
        if (requestId === loadSequence.current) setLoadingLabel(null);
      }
    },
    [applyLoadedDocument, showToast],
  );

  const openFile = useCallback(
    (file: File) => {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        showToast("请选择一个 PDF 文件。", "error");
        return;
      }
      void performLoad(() => loadPdfFromFile(file), `正在打开 · ${file.name}`);
    },
    [performLoad, showToast],
  );

  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  const openSample = useCallback(() => {
    void performLoad(
      () => loadPdfFromUrl("/sample.pdf", "在书页之间 · 深度阅读手册.pdf"),
      "正在展开示例文档",
    );
  }, [performLoad]);

  useEffect(() => {
    let depth = 0;
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types || []).includes("Files");
    }
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setIsDraggingFile(true);
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDraggingFile(false);
    }
    function onDrop(event: DragEvent) {
      event.preventDefault();
      depth = 0;
      setIsDraggingFile(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) openFileRef.current(file);
    }
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (anchorTimer.current !== null) window.clearTimeout(anchorTimer.current);
      void pdfDestroyRef.current?.();
    };
  }, []);

  const schedulePageAnchor = useCallback((page: number) => {
    pendingAnchorPage.current = page;
    if (anchorTimer.current !== null) window.clearTimeout(anchorTimer.current);
    anchorTimer.current = window.setTimeout(() => {
      pendingAnchorPage.current = null;
      anchorTimer.current = null;
    }, 900);
  }, []);

  // 侧栏或 AI 面板改变阅读区宽度时，让当前页留在视野中，而不是跳到别处。
  useEffect(() => {
    const page = pendingAnchorPage.current;
    if (page === null || viewerWidth <= 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (pendingAnchorPage.current !== page) return;
      pendingAnchorPage.current = null;
      if (anchorTimer.current !== null) {
        window.clearTimeout(anchorTimer.current);
        anchorTimer.current = null;
      }
      setCurrentPage(page);
      jumpSequence.current += 1;
      setJumpRequest({ page, nonce: jumpSequence.current, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [viewerWidth, scale]);

  const goToPage = (page: number, behavior?: ScrollBehavior) => {
    const total = info?.numPages || 1;
    const next = clamp(Math.round(page), 1, total);
    const resolvedBehavior =
      behavior ?? (Math.abs(next - currentPage) > 1 ? "auto" : "smooth");
    pendingAnchorPage.current = null;
    setCurrentPage(next);
    jumpSequence.current += 1;
    setJumpRequest({ page: next, nonce: jumpSequence.current, behavior: resolvedBehavior });
  };

  const toggleSidebar = () => {
    schedulePageAnchor(currentPage);
    setSidebarOpen((open) => !open);
  };

  const closeSidebar = () => {
    schedulePageAnchor(currentPage);
    setSidebarOpen(false);
  };

  const toggleAIPanel = () => {
    schedulePageAnchor(currentPage);
    setAiOpen((open) => !open);
  };

  const closeAIPanel = () => {
    schedulePageAnchor(currentPage);
    setAiOpen(false);
  };

  const handleCurrentPageChange = useCallback((page: number) => {
    setCurrentPage((previous) => (previous === page ? previous : page));
  }, []);

  const search = usePdfSearch({
    pdf,
    documentKey: info?.fingerprint || null,
    onNavigate: (page) => goToPage(page, "auto"),
  });

  const openDocumentSearch = () => {
    if (!activeNote && !draftNote) setTool("select");
    if (aiOpen) closeAIPanel();
    search.openSearch();
  };

  const changeTool = (next: Tool) => {
    setTool(next);
    setActiveNote(null);
    setDraftNote(null);
  };

  const zoomIn = () => {
    setFitMode(false);
    setZoom(clamp(scale * 1.12, 0.25, 3));
  };
  const zoomOut = () => {
    setFitMode(false);
    setZoom(clamp(scale / 1.12, 0.25, 3));
  };

  const handlePlaceNote = (page: number, x: number, y: number) => {
    setDraftNote({ page, x, y });
    setActiveNote(null);
    setTool("select");
  };

  const handleSaveDraft = (text: string, color: NoteColor) => {
    if (!draftNote) return;
    addNote(draftNote.page, {
      x: draftNote.x,
      y: draftNote.y,
      text,
      color,
    });
    setDraftNote(null);
  };

  const handleUpdateNote = (page: number, id: string, text: string, color: NoteColor) => {
    updateNote(page, id, { text, color });
    setActiveNote(null);
  };

  const handleDeleteNote = (page: number, id: string) => {
    deleteNote(page, id);
    setActiveNote(null);
  };

  const openNote = (page: number, id: string) => {
    setDraftNote(null);
    setActiveNote({ page, id });
    goToPage(page);
  };

  const handleSidebarNote = (target: NoteTarget) => {
    openNote(target.page, target.id);
  };

  const handleCapture = (payload: CapturePayload) => {
    setCapture(payload);
    setTool("select");
    setActiveNote(null);
    setDraftNote(null);
    setAskDraft("");
    setAskOpen(true);
  };

  const handleAsk = (question: string) => {
    if (!capture) return;
    const shot = capture;
    if (!aiOpen) schedulePageAnchor(shot.page);
    setAskOpen(false);
    setCapture(null);
    setAiOpen(true);
    setAskDraft("");
    void askQuestion(question, shot.image, shot.page);
  };

  async function askQuestion(question: string, image?: string, page?: number) {
    requestSequence.current += 1;
    const sequence = requestSequence.current;
    abortRef.current?.abort();
    abortRef.current = null;

    const now = Date.now();
    const previous = messagesRef.current.map((message) =>
      message.status === "streaming" ? { ...message, status: "stopped" as const } : message,
    );
    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content: question,
      ...(image ? { image } : {}),
      ...(page ? { page } : {}),
      createdAt: now,
      status: "done",
    };
    const assistantId = uid();
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: now + 1,
      status: "streaming",
      meta:
        settings?.provider === "mock"
          ? "本地示例"
          : settings?.model || providerLabel(settings?.provider || ""),
    };
    const historyForRequest = [...previous, userMessage]
      .filter((message) => message.role === "user" || message.content.trim())
      .slice(-8);

    commitMessages([...previous, userMessage, assistantMessage]);
    setAiOpen(true);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let pendingText = "";
    let flushTimer: number | null = null;

    const flush = () => {
      if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (!pendingText) return;
      const text = pendingText;
      pendingText = "";
      commitMessages(
        messagesRef.current.map((message) =>
          message.id === assistantId
            ? { ...message, content: message.content + text }
            : message,
        ),
      );
    };

    try {
      await streamChat({
        messages: historyForRequest,
        documentName: info?.name,
        page: page || currentPage,
        signal: controller.signal,
        onDelta: (text) => {
          pendingText += text;
          if (flushTimer === null) flushTimer = window.setTimeout(flush, 38);
        },
        onMeta: (meta) => {
          patchMessage(assistantId, {
            meta:
              meta.provider === "mock"
                ? "本地示例"
                : meta.model || providerLabel(meta.provider),
          });
        },
      });
      if (sequence !== requestSequence.current) return;
      flush();
      patchMessage(assistantId, { status: "done" });
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      flush();
      if (controller.signal.aborted) {
        patchMessage(assistantId, { status: "stopped" });
      } else {
        patchMessage(assistantId, {
          status: "error",
          error: friendlyChatError(error),
        });
      }
    } finally {
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (sequence === requestSequence.current) {
        abortRef.current = null;
        setStreaming(false);
      }
    }
  }

  const handleFollowUp = (question: string) => {
    setFollowUpDraft("");
    void askQuestion(question, undefined, currentPage);
  };

  function stopStreaming() {
    const activeAssistant = messagesRef.current.find(
      (message) => message.role === "assistant" && message.status === "streaming",
    );
    abortRef.current?.abort();
    if (activeAssistant) patchMessage(activeAssistant.id, { status: "stopped" });
    setStreaming(false);
  }

  const clearConversation = () => {
    abortActiveRequest();
    commitMessages([]);
    setFollowUpDraft("");
  };

  const openAskCapture = () => {
    if (aiOpen) schedulePageAnchor(currentPage);
    setAiOpen(false);
    setTool("capture");
    showToast("在书页上拖拽，框出想提问的部分。");
  };

  const openSettingsNormally = () => {
    setReturnToAsk(false);
    setSettingsOpen(true);
  };

  const configureFromAsk = () => {
    setAskOpen(false);
    setReturnToAsk(true);
    setSettingsOpen(true);
  };

  const closeSettings = () => {
    setSettingsOpen(false);
    if (returnToAsk) {
      setReturnToAsk(false);
      if (capture) setAskOpen(true);
    }
  };

  const handleSettingsSaved = (next: AIProviderSettings) => {
    setSettings(next);
    showToast("AI 设置已保存。", "success");
  };

  const insertHandwritingLatex = (latex: string) => {
    if (!handwritingTarget) return;
    const formula = `$$\n${latex.trim()}\n$$`;
    if (handwritingTarget === "ask") {
      setAskDraft((current) => (current.trim() ? `${current.trimEnd()}\n\n${formula}` : formula));
    } else {
      setFollowUpDraft((current) => (current.trim() ? `${current.trimEnd()}\n\n${formula}` : formula));
    }
    setHandwritingTarget(null);
    showToast("已插入手写公式，可继续编辑后发送。", "success");
  };

  const closeAskWithoutCapture = () => {
    setAskOpen(false);
    setCapture(null);
    setTool("select");
  };

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return (
        ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ||
        element.isContentEditable
      );
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      const typing = isTypingTarget(event.target);
      const modalOpen = askOpen || settingsOpen || handwritingTarget !== null;

      if (event.key === "Escape" && !modalOpen) {
        if (search.open) {
          search.closeSearch();
          return;
        }
        if (draftNote || activeNote) {
          setDraftNote(null);
          setActiveNote(null);
          return;
        }
        if (tool !== "select") {
          setTool("select");
          return;
        }
        if (aiOpen) {
          schedulePageAnchor(currentPage);
          setAiOpen(false);
          return;
        }
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f" &&
        !modalOpen &&
        info
      ) {
        event.preventDefault();
        openDocumentSearch();
        return;
      }

      if (typing || !info || modalOpen || search.open) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        if (canUndo) {
          event.preventDefault();
          undoStroke(currentPage);
        }
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "v") setTool("select");
      else if (key === "p") changeTool("pen");
      else if (key === "h") changeTool("highlighter");
      else if (key === "e") changeTool("eraser");
      else if (key === "l") changeTool("lasso");
      else if (key === "n") changeTool("note");
      else if (key === "q") {
        if (aiOpen) schedulePageAnchor(currentPage);
        setAiOpen(false);
        changeTool("capture");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeNote,
    aiOpen,
    askOpen,
    canUndo,
    currentPage,
    draftNote,
    info,
    settingsOpen,
    handwritingTarget,
    tool,
    undoStroke,
    schedulePageAnchor,
    search.open,
    search.closeSearch,
    openDocumentSearch,
  ]);

  const isMock = !settings || settings.provider === "mock";

  return (
    <div className={`app ${isDraggingFile ? "is-file-dragging" : ""}`}>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) openFile(file);
        }}
      />

      {!info || !pdf ? (
        <WelcomeScreen
          onOpenFile={() => fileInputRef.current?.click()}
          onOpenSample={openSample}
          onOpenSettings={openSettingsNormally}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
          error={welcomeError}
        />
      ) : (
        <div className="reader">
          <TopBar
            fileName={info.name}
            numPages={info.numPages}
            currentPage={currentPage}
            onJumpToPage={goToPage}
            onOpenFile={() => fileInputRef.current?.click()}
            theme={theme}
            onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            sidebarOpen={sidebarOpen}
            onToggleSidebar={toggleSidebar}
            isFitWidth={fitMode}
            zoomPercent={zoomPercent}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFitWidth={() => setFitMode(true)}
            onOpenAI={toggleAIPanel}
            onOpenSearch={openDocumentSearch}
            onOpenSettings={openSettingsNormally}
            aiOpen={aiOpen}
            streaming={streaming}
            isMock={isMock}
          />

          <div className="reader-body">
            {sidebarOpen && (
              <Sidebar
                info={info}
                pdf={pdf}
                currentPage={currentPage}
                annotations={annotations}
                storageState={storageState}
                width={sidebarWidth}
                onWidthChange={setSidebarWidth}
                tab={sidebarTab}
                onTabChange={setSidebarTab}
                outline={outline}
                outlineLoading={outlineLoading}
                onJumpToPage={goToPage}
                onOpenNote={handleSidebarNote}
                onClose={closeSidebar}
              />
            )}

            <main className="reader-stage">
              <DocumentStage
                pdf={pdf}
                info={info}
                dimensions={dimensions}
                scale={scale}
                stagePadding={stagePadding}
                currentPage={currentPage}
                annotations={annotations}
                tool={tool}
                brushColor={brushColor}
                brushSize={brushSize}
                activeNoteId={activeNote?.id || null}
                activeNotePage={activeNote?.page || null}
                draftNote={draftNote}
                searchQuery={search.query}
                searchActivePage={search.activeMatch?.page ?? null}
                searchActiveLocalIndex={search.activeMatch?.localIndex ?? null}
                searchNonce={search.navigationNonce}
                searchHighlights={search.highlightApi}
                jumpRequest={jumpRequest}
                onCurrentPageChange={handleCurrentPageChange}
                onViewportWidthChange={setViewerWidth}
                onAddStroke={addStroke}
                onMoveStrokes={moveStrokes}
                onDeleteStrokes={deleteStrokes}
                onPlaceNote={handlePlaceNote}
                onCapture={handleCapture}
                onCaptureError={(message) => showToast(message, "error")}
                onOpenNote={(page, id) => {
                  setDraftNote(null);
                  setActiveNote({ page, id });
                }}
                onCloseNote={() => setActiveNote(null)}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onSaveDraft={handleSaveDraft}
                onCancelDraft={() => setDraftNote(null)}
              />

              <SearchBar
                open={search.open}
                query={search.query}
                searching={search.searching}
                scanned={search.scanned}
                totalPages={search.totalPages}
                resultCount={search.matches.length}
                activeIndex={search.activeIndex}
                focusNonce={search.focusNonce}
                onQueryChange={search.updateQuery}
                onNext={search.next}
                onPrevious={search.previous}
                onClose={search.closeSearch}
              />

              {!activeNote && !draftNote && (
                <ToolDock
                  tool={tool}
                  onToolChange={changeTool}
                  brushColor={brushColor}
                  brushSize={brushSize}
                  brushPixels={brushPixels}
                  onBrushColor={updateBrushColor}
                  onBrushSize={updateBrushSize}
                  canUndo={canUndo}
                  onUndo={() => undoStroke(currentPage)}
                  onClearStrokes={() => {
                    clearPageStrokes(currentPage);
                    showToast("已清除本页手绘。", "success");
                  }}
                />
              )}
            </main>

            <AIPanel
              open={aiOpen}
              settings={settings}
              messages={messages}
              streaming={streaming}
              draft={followUpDraft}
              onDraftChange={setFollowUpDraft}
              currentPage={currentPage}
              onClose={closeAIPanel}
              onStop={stopStreaming}
              onSendFollowUp={handleFollowUp}
              onStartCapture={openAskCapture}
              onOpenHandwriting={() => setHandwritingTarget("followup")}
              onOpenSettings={openSettingsNormally}
              onClear={clearConversation}
            />
          </div>
        </div>
      )}

      <AskDialog
        open={askOpen && handwritingTarget === null}
        capture={capture}
        settings={settings}
        question={askDraft}
        onQuestionChange={setAskDraft}
        onClose={closeAskWithoutCapture}
        onSubmit={handleAsk}
        onOpenHandwriting={() => setHandwritingTarget("ask")}
        onConfigure={configureFromAsk}
      />

      <HandwritingLatexDialog
        open={handwritingTarget !== null}
        target={handwritingTarget ?? "ask"}
        model={settings?.handwritingModel}
        onClose={() => setHandwritingTarget(null)}
        onInsert={insertHandwritingLatex}
      />

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={closeSettings}
        onSaved={handleSettingsSaved}
      />

      {loadingLabel && (
        <div className="loading-overlay" role="status" aria-live="polite">
          <div className="loading-card">
            <Brand />
            <div className="loading-spinner">
              <Loader2 size={18} className="spin" />
            </div>
            <strong>{loadingLabel}</strong>
            <span>PDF 只在你的设备上解析</span>
          </div>
        </div>
      )}

      {isDraggingFile && (
        <div className="drop-overlay">
          <div className="drop-card">
            <span className="drop-icon">
              <FileUp size={26} />
            </span>
            <strong>松开，打开这份 PDF</strong>
            <span>页面与批注都会留在这台设备上</span>
            <i className="drop-corner tl" />
            <i className="drop-corner tr" />
            <i className="drop-corner bl" />
            <i className="drop-corner br" />
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
