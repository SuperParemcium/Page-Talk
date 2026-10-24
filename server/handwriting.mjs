const MAX_IMAGE_CHARS = 8 * 1024 * 1024;
const MAX_LATEX = 4000;

const SYSTEM_PROMPT = `You are a precise LaTeX OCR engine for handwritten mathematics.
Return ONLY the LaTeX body of the formula in the image.
Rules:
- No Markdown fences, no dollar signs, no \\( \\) or \\[ \\] delimiters.
- No explanation, no preamble, no "Here is".
- Preserve the author's structure: fractions, roots, integrals, limits, matrices, cases.
- Use standard LaTeX commands. If something is unreadable, use \\text{?}.
- If the image contains no readable mathematical expression, return \\text{无法识别}.`;

function baseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) throw Object.assign(new Error("尚未配置 Ollama 地址"), { status: 400 });
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw Object.assign(new Error("Ollama 地址格式不正确"), { status: 400 });
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw Object.assign(new Error("Ollama 地址必须使用 http 或 https"), { status: 400 });
  }
  return raw.replace(/\/api$/, "");
}

function imagePayload(image) {
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    throw Object.assign(new Error("手写图片格式不正确"), { status: 400 });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    throw Object.assign(new Error("手写图片过大，请重新书写"), { status: 413 });
  }
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([a-z0-9+/=\s]+)$/i.exec(image);
  if (!match) throw Object.assign(new Error("手写图片需要是 PNG 或 JPEG"), { status: 400 });
  return match[2].replace(/\s+/g, "");
}

function cleanLatex(raw) {
  let text = String(raw || "").trim();
  text = text.replace(/^```(?:latex|tex|math)?\s*/i, "").replace(/```$/i, "").trim();
  text = text.replace(/^latex\s*[:：]\s*/i, "").trim();
  if (text.startsWith("\\[") && text.endsWith("\\]")) {
    text = text.slice(2, -2).trim();
  } else if (text.startsWith("\\(") && text.endsWith("\\)")) {
    text = text.slice(2, -2).trim();
  } else if (text.startsWith("$$") && text.endsWith("$$")) {
    text = text.slice(2, -2).trim();
  } else if (text.startsWith("$") && text.endsWith("$")) {
    text = text.slice(1, -1).trim();
  }
  return text.slice(0, MAX_LATEX).trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readOllamaError(response) {
  try {
    const data = await response.json();
    return data?.error || data?.message || `Ollama 返回 ${response.status}`;
  } catch {
    return `Ollama 返回 ${response.status}`;
  }
}

function normalizedModel(name) {
  return String(name || "").replace(/:latest$/i, "");
}

async function listModels(root) {
  const response = await fetchWithTimeout(
    `${root}/api/tags`,
    { headers: { Accept: "application/json" } },
    5_000,
  );
  if (!response.ok) throw new Error(await readOllamaError(response));
  const payload = await response.json();
  return Array.isArray(payload?.models) ? payload.models : [];
}

async function resolveModel(root, requestedModel) {
  const wanted = String(requestedModel || "").trim();
  try {
    const models = await listModels(root);
    const names = models.map((item) => item?.name).filter(Boolean);
    const exact = names.find((name) => normalizedModel(name) === normalizedModel(wanted));
    if (exact) return { model: exact, fallback: false };
    const vision = models.find((item) =>
      Array.isArray(item?.capabilities) && item.capabilities.includes("vision"),
    );
    if (vision?.name) {
      return { model: vision.name, fallback: true, requested: wanted };
    }
    if (names.length > 0) {
      throw Object.assign(
        new Error(
          `未找到视觉模型 ${wanted}。已安装：${names.slice(0, 6).join("、")}。请运行 ollama pull ${wanted}，或在设置中选择一个视觉模型。`,
        ),
        { status: 400 },
      );
    }
  } catch (error) {
    if (error.status) throw error;
    // /api/tags 不可用时仍然尝试请求指定模型，让 Ollama 返回更具体的错误。
  }
  return { model: wanted, fallback: false };
}

export async function checkOllama({ inputBaseUrl, model }) {
  const root = baseUrl(inputBaseUrl);
  let response;
  try {
    response = await fetchWithTimeout(`${root}/api/tags`, { headers: { Accept: "application/json" } }, 8_000);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("连接 Ollama 超时，请确认服务已启动"), { status: 504 });
    }
    throw Object.assign(
      new Error(`无法连接 Ollama（${error.message}）。请确认 ollama serve 正在运行。`),
      { status: 502 },
    );
  }
  if (!response.ok) {
    throw Object.assign(
      new Error(await readOllamaError(response)),
      { status: 502 },
    );
  }
  const payload = await response.json();
  const entries = Array.isArray(payload?.models) ? payload.models : [];
  const models = entries.map((item) => item?.name).filter(Boolean);
  const visionModels = [
    ...new Set(
      entries
        .filter(
          (item) =>
            Array.isArray(item?.capabilities) && item.capabilities.includes("vision"),
        )
        .map((item) => item?.name)
        .filter(Boolean),
    ),
  ];
  const wanted = String(model || "").trim();
  const installed = Boolean(
    wanted && models.some((name) => normalizedModel(name) === normalizedModel(wanted)),
  );
  return { connected: true, installed, models, visionModels };
}

export async function recognizeHandwriting({
  image,
  inputBaseUrl,
  model,
  signal,
}) {
  const root = baseUrl(inputBaseUrl);
  const imageBase64 = imagePayload(image);
  const selectedModel = String(model || "").trim();
  if (!selectedModel) {
    throw Object.assign(new Error("尚未配置 Ollama 视觉模型"), { status: 400 });
  }
  const resolved = await resolveModel(root, selectedModel);

  let response;
  try {
    response = await fetchWithTimeout(
      `${root}/api/chat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: resolved.model,
          stream: false,
          options: { temperature: 0, num_predict: 768 },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content:
                "Transcribe the handwritten formula in this image to LaTeX. Output the LaTeX body only.",
              images: [imageBase64],
            },
          ],
        }),
        signal,
      },
      90_000,
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw Object.assign(new Error("Ollama 识别超时，请稍后重试"), { status: 504 });
    }
    throw Object.assign(
      new Error(`无法连接 Ollama（${error.message}）。请确认服务已启动。`),
      { status: 502 },
    );
  }

  if (!response.ok) {
    const detail = await readOllamaError(response);
    const hint = /not found|pull/i.test(detail)
      ? `，请先运行 ollama pull ${resolved.model}`
      : "";
    throw Object.assign(new Error(`${detail}${hint}`), { status: 502 });
  }

  const payload = await response.json();
  const raw = payload?.message?.content ?? payload?.response ?? "";
  const latex = cleanLatex(raw);
  if (!latex) {
    throw Object.assign(new Error("模型没有返回 LaTeX，请重写公式后重试"), { status: 502 });
  }
  return {
    latex,
    model: resolved.model,
    requestedModel: selectedModel,
    fallback: resolved.fallback,
  };
}
