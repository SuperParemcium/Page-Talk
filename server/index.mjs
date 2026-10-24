import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPublicSettings, getResolvedSettings, updateStoredSettings } from "./config.mjs";
import { readAnnotations, writeAnnotations } from "./annotations.mjs";
import { checkOllama, recognizeHandwriting } from "./handwriting.mjs";
import { AIError, streamAssistant, testConnection } from "./ai.mjs";

const ROOT = process.env.PAGE_TALK_APP_ROOT
  ? path.resolve(process.env.PAGE_TALK_APP_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = process.env.PAGE_TALK_DIST
  ? path.resolve(process.env.PAGE_TALK_DIST)
  : path.join(ROOT, "dist");
const PDFJS_ROOT = process.env.PAGE_TALK_PDFJS_ROOT
  ? path.resolve(process.env.PAGE_TALK_PDFJS_ROOT)
  : path.join(ROOT, "node_modules", "pdfjs-dist");
const PORT = Number(process.env.PORT || process.env.PDF_READER_PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

const app = express();
app.disable("x-powered-by");

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length > 0) {
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (allowedOrigins.includes("*")) {
        res.setHeader("Access-Control-Allow-Origin", "*");
      } else if (allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
}

app.use(express.json({ limit: "16mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "page-talk", version: "0.1.0" });
});

app.get("/api/settings", async (_req, res) => {
  try {
    res.json(await getPublicSettings());
  } catch (error) {
    res.status(500).json({ error: error.message || "读取配置失败" });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const settings = await updateStoredSettings(req.body);
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error.message || "保存配置失败" });
  }
});

app.get("/api/annotations/:fingerprint", async (req, res) => {
  try {
    const stored = await readAnnotations(req.params.fingerprint);
    if (!stored) {
      // “尚未保存”是正常状态，不用 404 污染浏览器控制台。
      res.json({ annotations: null, savedAt: 0 });
      return;
    }
    res.json(stored);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "读取批注失败" });
  }
});

app.put("/api/annotations/:fingerprint", async (req, res) => {
  try {
    const result = await writeAnnotations(req.params.fingerprint, req.body?.annotations);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "保存批注失败" });
  }
});

app.post("/api/handwriting/latex", async (req, res) => {
  try {
    const settings = await getResolvedSettings();
    const result = await recognizeHandwriting({
      image: req.body?.image,
      inputBaseUrl: settings.handwritingBaseUrl,
      model: settings.handwritingModel,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "手写识别失败" });
  }
});

app.post("/api/handwriting/check", async (req, res) => {
  try {
    const settings = await getResolvedSettings();
    const result = await checkOllama({
      inputBaseUrl: req.body?.baseUrl || settings.handwritingBaseUrl,
      model: req.body?.model || settings.handwritingModel,
    });
    res.json(result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Ollama 检测失败" });
  }
});

app.post("/api/ai/test", async (req, res) => {
  try {
    const settings = await getResolvedSettings();
    const reply = await testConnection(settings);
    res.json({ ok: true, reply, model: settings.model, provider: settings.provider });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "连接测试失败" });
  }
});

app.post("/api/ai/chat", async (req, res) => {
  const { messages, context } = req.body || {};
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  const abortController = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  const send = (payload) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const settings = await getResolvedSettings();
    if (!settings.apiKey && settings.provider !== "mock") {
      const customNoKey = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(settings.baseUrl);
      if (!customNoKey) {
        throw new AIError("尚未配置 API Key。请在右上角「设置」中填写。", 401);
      }
    }
    send({ type: "meta", provider: settings.provider, model: settings.model });
    await streamAssistant({
      settings,
      messages,
      context: {
        documentName: context?.documentName,
        page: context?.page,
      },
      signal: abortController.signal,
      onDelta: (text) => send({ type: "delta", text }),
    });
    send({ type: "done" });
  } catch (error) {
    if (error?.name === "AbortError" || abortController.signal.aborted) {
      // 客户端已离开，不需要再写错误。
    } else if (error instanceof AIError) {
      send({ type: "error", message: error.message });
    } else {
      console.error("[ai/chat]", error);
      send({ type: "error", message: error.message || "生成回答时发生未知错误" });
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

for (const [mount, target] of [
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
  ["iccs", "iccs"],
]) {
  app.use(
    `/pdfjs/${mount}`,
    express.static(path.join(PDFJS_ROOT, target), {
      maxAge: "7d",
      immutable: false,
    }),
  );
}

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST, { maxAge: "1h", index: false }));
  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/pdfjs/")
    ) {
      return next();
    }
    res.sendFile("index.html", { root: DIST });
  });
} else {
  app.get("/", (_req, res) => {
    res
      .status(503)
      .type("text/plain")
      .send("前端尚未构建。开发时请访问 Vite 提供的地址，或先运行 npm run build。");
  });
}

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, _req, res, _next) => {
  console.error("[server]", error);
  if (res.headersSent) return;
  res.status(error.status || 500).json({ error: error.message || "服务器内部错误" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`页间 PDF Reader 运行于 http://${HOST}:${PORT}`);
  if (!fs.existsSync(DIST)) {
    console.log("前端尚未构建。开发模式请配合 npm run dev 使用 Vite (5173)。");
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请设置 PDF_READER_PORT 使用其他端口。`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
