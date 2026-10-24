import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = process.env.PDF_READER_DATA_DIR
  ? path.resolve(process.env.PDF_READER_DATA_DIR)
  : path.join(ROOT, "data");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");

export const DEFAULT_SYSTEM_PROMPT = `你是一位严谨、亲切的阅读助手，正在陪用户精读一份 PDF。

用户会框选书页的一小块内容并附上问题。请遵循：
1. 优先基于截图中可见的内容回答；图片模糊、被裁切或信息不足时，明确说明，不要编造。
2. 如果问题需要联系上下文，可以说明你的推测，并提醒用户补充相邻页面。
3. 用简体中文回答（除非用户要求其他语言），使用清晰的 GitHub Flavored Markdown 结构，可使用标题、列表、表格、引用和代码块。
4. 数学公式使用 LaTeX：行内公式用 $...$，独立公式用 $$...$$。不要把公式放进代码块。
5. 翻译时保留原文语气；解释概念时给出推理线索，而不只是结论。
6. 回答保持聚焦，通常不超过 500 字。`;

const PROVIDERS = new Set(["mock", "openai-compatible", "anthropic"]);

export const DEFAULT_HANDWRITING_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_HANDWRITING_MODEL = "qwen2.5vl:7b";

const DEFAULT_SETTINGS = {
  provider: "mock",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  temperature: 0.4,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  handwritingBaseUrl: DEFAULT_HANDWRITING_BASE_URL,
  handwritingModel: DEFAULT_HANDWRITING_MODEL,
};

function envDefaults() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
  if (!apiKey) return {};
  return {
    provider: "openai-compatible",
    baseUrl: process.env.AI_BASE_URL || "https://api.openai.com/v1",
    model: process.env.AI_MODEL || "gpt-4o-mini",
    apiKey,
  };
}

async function readStored() {
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") return {};
    console.warn("[settings] 无法读取配置：", error.message);
    return {};
  }
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return DEFAULT_SETTINGS.baseUrl;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("接口地址不是有效的 URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("接口地址必须使用 http 或 https");
  }
  if (url.username || url.password) {
    throw new Error("接口地址不能包含用户名或密码");
  }
  return raw.replace(/\/+$/, "");
}

export async function getResolvedSettings() {
  const stored = await readStored();
  const resolved = {
    ...DEFAULT_SETTINGS,
    ...envDefaults(),
    ...stored,
    systemPrompt: stored.systemPrompt || DEFAULT_SYSTEM_PROMPT,
  };
  return {
    provider: PROVIDERS.has(resolved.provider) ? resolved.provider : "mock",
    baseUrl: resolved.baseUrl || DEFAULT_SETTINGS.baseUrl,
    model: resolved.model || DEFAULT_SETTINGS.model,
    temperature: Number.isFinite(Number(resolved.temperature))
      ? Math.min(1, Math.max(0, Number(resolved.temperature)))
      : DEFAULT_SETTINGS.temperature,
    systemPrompt: String(resolved.systemPrompt || DEFAULT_SYSTEM_PROMPT),
    apiKey: String(resolved.apiKey || ""),
    keySource: stored.apiKey ? "stored" : envDefaults().apiKey ? "env" : "none",
    handwritingBaseUrl:
      resolved.handwritingBaseUrl ||
      process.env.OLLAMA_BASE_URL ||
      DEFAULT_HANDWRITING_BASE_URL,
    handwritingModel:
      resolved.handwritingModel ||
      process.env.OLLAMA_MODEL ||
      DEFAULT_HANDWRITING_MODEL,
  };
}

export async function getPublicSettings() {
  const settings = await getResolvedSettings();
  return {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    temperature: settings.temperature,
    systemPrompt: settings.systemPrompt,
    hasApiKey: Boolean(settings.apiKey),
    keySource: settings.keySource,
    handwritingBaseUrl: settings.handwritingBaseUrl,
    handwritingModel: settings.handwritingModel,
  };
}

export async function updateStoredSettings(input = {}) {
  if (!input || typeof input !== "object") throw new Error("配置格式不正确");
  const currentStored = await readStored();
  const next = { ...currentStored };

  if (input.provider !== undefined) {
    if (!PROVIDERS.has(input.provider)) throw new Error("不支持的模型服务类型");
    next.provider = input.provider;
  }
  if (input.baseUrl !== undefined) next.baseUrl = normalizeBaseUrl(input.baseUrl);
  if (input.model !== undefined) {
    const model = String(input.model).trim();
    if (model.length > 200) throw new Error("模型名称过长");
    next.model = model;
  }
  if (input.temperature !== undefined) {
    const temperature = Number(input.temperature);
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
      throw new Error("温度需要设置在 0 到 1 之间");
    }
    next.temperature = temperature;
  }
  if (input.systemPrompt !== undefined) {
    const systemPrompt = String(input.systemPrompt).trim();
    if (systemPrompt.length > 8000) throw new Error("系统提示词过长");
    next.systemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }
  if (input.handwritingBaseUrl !== undefined) {
    const raw = String(input.handwritingBaseUrl).trim();
    if (!raw) {
      next.handwritingBaseUrl = DEFAULT_HANDWRITING_BASE_URL;
    } else {
      let url;
      try {
        url = new URL(raw);
      } catch {
        throw new Error("Ollama 地址不是有效的 URL");
      }
      if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Ollama 地址必须使用 http 或 https");
      }
      if (url.username || url.password) {
        throw new Error("Ollama 地址不能包含用户名或密码");
      }
      next.handwritingBaseUrl = raw.replace(/\/+$/, "");
    }
  }
  if (input.handwritingModel !== undefined) {
    const model = String(input.handwritingModel).trim();
    if (model.length > 200) throw new Error("Ollama 模型名称过长");
    next.handwritingModel = model || DEFAULT_HANDWRITING_MODEL;
  }
  if (input.clearApiKey) {
    delete next.apiKey;
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    const apiKey = input.apiKey.trim();
    if (apiKey.length > 500) throw new Error("API Key 长度异常");
    next.apiKey = apiKey;
  }

  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${SETTINGS_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(tempPath, SETTINGS_PATH);
  return getPublicSettings();
}
