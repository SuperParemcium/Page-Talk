import { useEffect, useRef, useState } from "react";
import type { AnnotationMap, Note, NoteColor, PageAnnotations, Stroke } from "../types";
import {
  loadAnnotations,
  loadAnnotationsFromServer,
  loadLocalSavedAt,
  saveAnnotations,
  saveAnnotationsToServer,
} from "../lib/annotations";

const emptyPage = (): PageAnnotations => ({ strokes: [], notes: [] });

interface Session {
  fingerprint: string | null;
  annotations: AnnotationMap;
  ready: boolean;
}

export type AnnotationStorageState = "idle" | "loading" | "saving" | "saved" | "error";

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function initialSession(fingerprint: string | null): Session {
  if (!fingerprint) return { fingerprint: null, annotations: {}, ready: true };
  return { fingerprint, annotations: loadAnnotations(fingerprint), ready: true };
}

export function useAnnotations(fingerprint: string | null) {
  const [session, setSession] = useState<Session>(() => initialSession(fingerprint));
  const saveTimer = useRef<number | null>(null);
  const latestSession = useRef(session);
  const historyRef = useRef<Record<number, Stroke[][]>>({});
  const [historyDepths, setHistoryDepths] = useState<Record<number, number>>({});
  const [hydrated, setHydrated] = useState(false);
  const [storageState, setStorageState] = useState<AnnotationStorageState>(() =>
    fingerprint ? "loading" : "idle",
  );
  const hydratedRef = useRef(false);
  const hydratedFingerprintRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const saveSequence = useRef(0);
  const serverSaveChain = useRef<Promise<unknown>>(Promise.resolve());
  latestSession.current = session;

  function queueServerSave(documentFingerprint: string, snapshot: AnnotationMap) {
    const sequence = ++saveSequence.current;
    serverSaveChain.current = serverSaveChain.current
      .catch(() => undefined)
      .then(() => saveAnnotationsToServer(documentFingerprint, snapshot))
      .then(() => {
        if (
          sequence === saveSequence.current &&
          latestSession.current.fingerprint === documentFingerprint
        ) {
          setStorageState("saved");
        }
      })
      .catch(() => {
        if (
          sequence === saveSequence.current &&
          latestSession.current.fingerprint === documentFingerprint
        ) {
          setStorageState("error");
        }
      });
  }

  useEffect(() => {
    if (hydratedFingerprintRef.current === fingerprint) return;
    const previous = latestSession.current;
    if (previous.ready && previous.fingerprint && previous.fingerprint !== fingerprint) {
      // 切换文档前，把还没等到防抖写入的最后一笔落盘。
      saveAnnotations(previous.fingerprint, previous.annotations);
    }
    historyRef.current = {};
    setHistoryDepths({});
    hydratedRef.current = false;
    setHydrated(false);
    dirtyRef.current = false;
    saveSequence.current += 1;

    if (!fingerprint) {
      hydratedFingerprintRef.current = null;
      setSession({ fingerprint: null, annotations: {}, ready: true });
      setStorageState("idle");
      return;
    }

    hydratedFingerprintRef.current = fingerprint;
    const localSavedAt = loadLocalSavedAt(fingerprint);
    setSession({
      fingerprint,
      annotations: loadAnnotations(fingerprint),
      ready: true,
    });
    setStorageState("loading");

    let cancelled = false;
    async function hydrate() {
      try {
        const remote = await loadAnnotationsFromServer(fingerprint!);
        if (cancelled) return;
        const useRemote = Boolean(
          remote && !dirtyRef.current && remote.savedAt >= localSavedAt,
        );
        if (useRemote && remote) {
          dirtyRef.current = false;
          setSession({
            fingerprint: fingerprint!,
            annotations: remote.annotations,
            ready: true,
          });
        }
        hydratedRef.current = true;
        setHydrated(true);
        setStorageState("saved");
      } catch (error) {
        if (cancelled) return;
        console.warn("[annotations] 无法读取磁盘批注，使用浏览器缓存。", error);
        hydratedRef.current = true;
        setHydrated(true);
        setStorageState("error");
      }
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
    // 只在文档指纹变化时加载；session 的更新由当前指纹驱动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  useEffect(() => {
    if (!session.ready || !session.fingerprint || !hydrated) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const documentFingerprint = session.fingerprint;
    const snapshot = session.annotations;
    setStorageState("saving");
    saveTimer.current = window.setTimeout(() => {
      if (latestSession.current.fingerprint !== documentFingerprint) return;
      saveAnnotations(documentFingerprint, snapshot);
      if (hydratedRef.current) {
        queueServerSave(documentFingerprint, snapshot);
      }
    }, 220);
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
    // queueServerSave uses refs and is stable for this effect's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, hydrated]);

  useEffect(() => {
    const flush = () => {
      const current = latestSession.current;
      if (current.ready && current.fingerprint) {
        saveAnnotations(current.fingerprint, current.annotations);
        if (hydratedRef.current) {
          void saveAnnotationsToServer(current.fingerprint, current.annotations, {
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, []);

  const annotations = session.fingerprint === fingerprint ? session.annotations : {};
  const ready = session.fingerprint === fingerprint && session.ready;

  function updatePage(
    pageNumber: number,
    updater: (page: PageAnnotations) => PageAnnotations,
  ) {
    dirtyRef.current = true;
    setSession((current) => {
      if (current.fingerprint !== fingerprint) return current;
      const page = current.annotations[pageNumber] || emptyPage();
      return {
        ...current,
        annotations: {
          ...current.annotations,
          [pageNumber]: updater(page),
        },
      };
    });
  }

  function rememberPage(pageNumber: number) {
    const page = latestSession.current.annotations[pageNumber];
    if (!page || page.strokes.length === 0) return;
    const stack = historyRef.current[pageNumber] || [];
    stack.push(page.strokes);
    if (stack.length > 60) stack.shift();
    historyRef.current[pageNumber] = stack;
    setHistoryDepths((current) => ({
      ...current,
      [pageNumber]: stack.length,
    }));
  }

  const addStroke = (pageNumber: number, stroke: Omit<Stroke, "id">) => {
    const nextStroke: Stroke = { ...stroke, id: uid() };
    rememberPage(pageNumber);
    updatePage(pageNumber, (page) => ({
      ...page,
      strokes: [...page.strokes, nextStroke],
    }));
  };

  const undoStroke = (pageNumber: number) => {
    const stack = historyRef.current[pageNumber];
    const snapshot = stack?.pop();
    if (snapshot) {
      if (stack && stack.length === 0) delete historyRef.current[pageNumber];
      setHistoryDepths((current) => ({
        ...current,
        [pageNumber]: stack?.length || 0,
      }));
      updatePage(pageNumber, (page) => ({ ...page, strokes: snapshot }));
      return;
    }
    // 文档刚打开时没有内存历史，这时撤销仍然退回上一笔已加载的笔迹。
    updatePage(pageNumber, (page) => ({
      ...page,
      strokes: page.strokes.slice(0, -1),
    }));
  };

  const clearPageStrokes = (pageNumber: number) => {
    rememberPage(pageNumber);
    updatePage(pageNumber, (page) => ({ ...page, strokes: [] }));
  };

  const moveStrokes = (pageNumber: number, ids: string[], dx: number, dy: number) => {
    if (ids.length === 0 || (!dx && !dy)) return;
    const selected = new Set(ids);
    rememberPage(pageNumber);
    updatePage(pageNumber, (page) => ({
      ...page,
      strokes: page.strokes.map((stroke) =>
        selected.has(stroke.id)
          ? {
              ...stroke,
              points: stroke.points.map((point) => ({
                ...point,
                x: point.x + dx,
                y: point.y + dy,
              })),
            }
          : stroke,
      ),
    }));
  };

  const deleteStrokes = (pageNumber: number, ids: string[]) => {
    if (ids.length === 0) return;
    const selected = new Set(ids);
    rememberPage(pageNumber);
    updatePage(pageNumber, (page) => ({
      ...page,
      strokes: page.strokes.filter((stroke) => !selected.has(stroke.id)),
    }));
  };

  const addNote = (
    pageNumber: number,
    note: { x: number; y: number; text: string; color: NoteColor },
  ): Note => {
    const now = Date.now();
    const nextNote: Note = { ...note, id: uid(), createdAt: now, updatedAt: now };
    updatePage(pageNumber, (page) => ({ ...page, notes: [...page.notes, nextNote] }));
    return nextNote;
  };

  const updateNote = (
    pageNumber: number,
    noteId: string,
    patch: Partial<Pick<Note, "text" | "color" | "x" | "y">>,
  ) => {
    updatePage(pageNumber, (page) => ({
      ...page,
      notes: page.notes.map((note) =>
        note.id === noteId ? { ...note, ...patch, updatedAt: Date.now() } : note,
      ),
    }));
  };

  const deleteNote = (pageNumber: number, noteId: string) => {
    updatePage(pageNumber, (page) => ({
      ...page,
      notes: page.notes.filter((note) => note.id !== noteId),
    }));
  };

  return {
    annotations,
    ready,
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
  };
}
