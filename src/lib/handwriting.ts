import { apiUrl } from "./api";

async function readError(response: Response) {
  try {
    const data = await response.json();
    return data.error || data.message || `请求失败（${response.status}）`;
  } catch {
    return `请求失败（${response.status}）`;
  }
}

export interface HandwritingResult {
  latex: string;
  model: string;
  requestedModel?: string;
  fallback?: boolean;
}

export interface OllamaCheckResult {
  connected: boolean;
  installed: boolean;
  models: string[];
  visionModels?: string[];
}

export async function recognizeHandwriting(
  image: string,
  signal?: AbortSignal,
): Promise<HandwritingResult> {
  const response = await fetch(apiUrl("/api/handwriting/latex"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
    signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function checkOllama(
  baseUrl: string,
  model: string,
): Promise<OllamaCheckResult> {
  const response = await fetch(apiUrl("/api/handwriting/check"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl, model }),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}
