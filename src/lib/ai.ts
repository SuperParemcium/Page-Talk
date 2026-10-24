import type { AIProviderSettings, ChatMessage } from "../types";
import { apiUrl } from "./api";

export class AIRequestError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "AIRequestError";
    this.status = status;
  }
}

async function readError(response: Response) {
  try {
    const data = await response.json();
    return data.error || data.message || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export async function fetchSettings(): Promise<AIProviderSettings> {
  const response = await fetch(apiUrl("/api/settings"));
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export interface SettingsUpdate {
  provider: AIProviderSettings["provider"];
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  handwritingBaseUrl: string;
  handwritingModel: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export async function persistSettings(update: SettingsUpdate): Promise<AIProviderSettings> {
  const response = await fetch(apiUrl("/api/settings"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function runConnectionTest(): Promise<{ ok: boolean; reply: string }> {
  const response = await fetch(apiUrl("/api/ai/test"), { method: "POST" });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

interface StreamChatInput {
  messages: ChatMessage[];
  documentName?: string;
  page?: number;
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  onMeta?: (meta: { provider: string; model: string }) => void;
}

export async function streamChat({
  messages,
  documentName,
  page,
  signal,
  onDelta,
  onMeta,
}: StreamChatInput): Promise<void> {
  const response = await fetch(apiUrl("/api/ai/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map((message) => ({
        role: message.role,
        text: message.content,
        image: message.image,
      })),
      context: { documentName, page },
    }),
    signal,
  });

  if (!response.ok) {
    throw new AIRequestError(await readError(response), response.status);
  }
  if (!response.body) throw new AIRequestError("浏览器不支持流式响应", 500);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamError: string | null = null;
  let done = false;

  const handleLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    if (event.type === "delta" && typeof event.text === "string") {
      onDelta(event.text);
    } else if (event.type === "meta") {
      onMeta?.({
        provider: String(event.provider || ""),
        model: String(event.model || ""),
      });
    } else if (event.type === "error") {
      streamError = String(event.message || "模型返回了未知错误");
    } else if (event.type === "done") {
      done = true;
    }
  };

  while (true) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  buffer += decoder.decode();
  if (buffer) handleLine(buffer);

  if (streamError) throw new AIRequestError(streamError, 502);
  if (!done) {
    // 流自然结束但没有收到 done：仍保留已有内容，不视为失败。
  }
}

export function providerLabel(provider: string) {
  switch (provider) {
    case "mock":
      return "演示模式";
    case "anthropic":
      return "Anthropic";
    case "openai-compatible":
      return "OpenAI 兼容";
    default:
      return provider || "未配置";
  }
}
