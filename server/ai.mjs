const MAX_MESSAGES = 16;
const MAX_TEXT = 20_000;
const MAX_IMAGE_CHARS = 12 * 1024 * 1024;

export class AIError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "AIError";
    this.status = status;
  }
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new AIError("没有可发送的消息", 400);
  }
  const cleaned = messages
    .slice(-MAX_MESSAGES)
    .map((message) => {
      const role = message?.role === "assistant" ? "assistant" : "user";
      const text = String(message?.text ?? "").slice(0, MAX_TEXT).trim();
      let image = null;
      if (role === "user" && typeof message?.image === "string" && message.image.startsWith("data:image/")) {
        if (message.image.length > MAX_IMAGE_CHARS) {
          throw new AIError("截图体积过大，请重新框选较小的区域", 413);
        }
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(message.image)) {
          throw new AIError("截图格式不支持", 400);
        }
        image = message.image;
      }
      return { role, text, image };
    })
    .filter((message) => message.text || message.image);

  if (!cleaned.some((message) => message.role === "user")) {
    throw new AIError("请先写下你的问题", 400);
  }
  return cleaned;
}

function mergeConsecutive(messages) {
  const merged = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) {
      previous.text = [previous.text, message.text].filter(Boolean).join("\n\n");
      previous.image = message.image || previous.image;
    } else {
      merged.push({ ...message });
    }
  }
  return merged;
}

function completionUrl(baseUrl) {
  const url = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(url)) return url;
  return `${url}/chat/completions`;
}

function anthropicUrl(baseUrl) {
  const url = baseUrl.replace(/\/+$/, "");
  if (/\/messages$/.test(url)) return url;
  if (/\/v1$/.test(url)) return `${url}/messages`;
  return `${url}/v1/messages`;
}

function friendlyHttpError(status, detail) {
  if (status === 401 || status === 403) {
    return "鉴权失败。请检查 API Key 是否正确、是否有该模型的访问权限。";
  }
  if (status === 404) {
    return "接口或模型不存在。请检查 Base URL 与模型名称。";
  }
  if (status === 429) {
    return "请求被限流或额度不足，请稍后再试，或检查账户余额。";
  }
  if (status >= 500) {
    return `模型服务暂时不可用（${status}）。可以稍后重试。`;
  }
  const snippet = detail ? `：${detail.slice(0, 240)}` : "";
  return `模型请求失败（${status}）${snippet}`;
}

function extractOpenAIText(parsed) {
  const delta = parsed?.choices?.[0]?.delta;
  if (!delta) return "";
  if (typeof delta.content === "string") return delta.content;
  if (Array.isArray(delta.content)) {
    return delta.content.map((part) => part?.text || "").join("");
  }
  return "";
}

function extractAnthropicText(parsed) {
  if (parsed?.type === "content_block_delta" && parsed?.delta?.type === "text_delta") {
    return parsed.delta.text || "";
  }
  return "";
}

async function readSSE(response, onEvent) {
  if (!response.body) throw new AIError("模型服务没有返回内容流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let received = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed?.error) {
          throw new AIError(
            parsed.error.message || "模型服务返回了错误",
            Number(parsed.error.code) || 502,
          );
        }
        const text = onEvent(parsed);
        if (text) received = true;
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (!received) {
    throw new AIError("模型没有返回可见文本。请确认所选模型支持图片输入，且接口兼容所选协议。");
  }
}

async function postJson(url, headers, body, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new AIError(`无法连接模型服务：${error.message}`, 502);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const raw = await response.text();
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || parsed?.message || raw;
      } catch {
        detail = raw;
      }
    } catch {
      // ignore body read failures
    }
    throw new AIError(friendlyHttpError(response.status, detail), response.status);
  }
  return response;
}

export async function streamAssistant({ settings, messages, context, signal, onDelta, maxOutputTokens }) {
  const cleaned = mergeConsecutive(cleanMessages(messages));

  if (settings.provider === "mock") {
    await streamMock({ messages: cleaned, context, signal, onDelta });
    return;
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error("timeout")), 120_000);
  const abort = () => timeoutController.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }

  try {
    if (settings.provider === "anthropic") {
      await streamAnthropic({
        settings,
        messages: cleaned,
        context,
        signal: timeoutController.signal,
        onDelta,
        maxOutputTokens,
      });
    } else {
      await streamOpenAICompatible({
        settings,
        messages: cleaned,
        context,
        signal: timeoutController.signal,
        onDelta,
        maxOutputTokens,
      });
    }
  } catch (error) {
    if (timeoutController.signal.aborted) {
      if (signal?.aborted) {
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }
      throw new AIError("模型响应超时，请稍后重试。", 504);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", abort);
  }
}

async function streamOpenAICompatible({
  settings,
  messages,
  context,
  signal,
  onDelta,
  maxOutputTokens,
}) {
  const system = buildSystemPrompt(settings, context);
  const bodyMessages = [
    { role: "system", content: system },
    ...messages.map((message) => {
      if (message.role === "assistant") {
        return { role: "assistant", content: message.text };
      }
      const parts = [];
      if (message.image) {
        parts.push({ type: "image_url", image_url: { url: message.image, detail: "high" } });
      }
      parts.push({ type: "text", text: message.text || "请阅读这张书页截图。" });
      return { role: "user", content: parts };
    }),
  ];

  const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

  const response = await postJson(
    completionUrl(settings.baseUrl),
    headers,
    {
      model: settings.model,
      messages: bodyMessages,
      temperature: settings.temperature,
      stream: true,
      ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {}),
    },
    signal,
  );

  await readSSE(response, (parsed) => {
    const text = extractOpenAIText(parsed);
    if (text) onDelta(text);
    return text;
  });
}

async function streamAnthropic({
  settings,
  messages,
  context,
  signal,
  onDelta,
  maxOutputTokens,
}) {
  const system = buildSystemPrompt(settings, context);
  const anthropicMessages = messages.map((message) => {
    if (message.role === "assistant") {
      return { role: "assistant", content: message.text || "..." };
    }
    const content = [];
    if (message.image) {
      const match = /^data:(image\/[a-z]+);base64,(.*)$/is.exec(message.image);
      if (!match) throw new AIError("截图格式无法解析", 400);
      content.push({
        type: "image",
        source: { type: "base64", media_type: match[1], data: match[2] },
      });
    }
    content.push({ type: "text", text: message.text || "请阅读这张书页截图。" });
    return { role: "user", content };
  });

  const headers = {
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "anthropic-version": "2023-06-01",
  };
  if (settings.apiKey) headers["x-api-key"] = settings.apiKey;

  const response = await postJson(
    anthropicUrl(settings.baseUrl),
    headers,
    {
      model: settings.model,
      system,
      messages: anthropicMessages,
      temperature: settings.temperature,
      max_tokens: maxOutputTokens || 2048,
      stream: true,
    },
    signal,
  );

  await readSSE(response, (parsed) => {
    const text = extractAnthropicText(parsed);
    if (text) onDelta(text);
    return text;
  });
}

function buildSystemPrompt(settings, context) {
  let prompt = settings.systemPrompt;
  if (context?.documentName) {
    prompt += `\n\n当前文档：《${String(context.documentName).slice(0, 200)}》`;
  }
  if (context?.page) {
    prompt += `，用户正在阅读第 ${Number(context.page)} 页。`;
  }
  prompt +=
    "\n\n输出格式：使用 GitHub Flavored Markdown（标题、列表、表格、引用、代码块均可）。" +
    "数学公式必须使用 LaTeX 定界符：行内 $...$，独立公式 $$...$$；不要用代码块包裹公式。";
  return prompt;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function streamMock({ messages, context, signal, onDelta }) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const question = (lastUser?.text || "").replace(/\s+/g, " ").trim();
  const page = context?.page ? `第 ${context.page} 页` : "当前书页";
  const hasImage = messages.some((message) => message.image);
  const doc = context?.documentName ? `《${context.documentName}》` : "这本书";

  const answer = `> **演示模式** · 这条回答由本地示例生成，没有调用真实 AI。在右上角「设置」里接入模型后，我会真正“看”懂你的截图。

我收到的信息：${hasImage ? `一张来自${page}的框选截图` : "一段文字"}${question ? `，以及你的问题“${question.slice(0, 80)}${question.length > 80 ? "…" : ""}”` : ""}。

等接入真实模型后，我会沿着这样的路径陪你读 ${doc}：

1. **定位画面** —— 先辨认截图中的标题、段落、图表或公式，确认你框选的是哪一处。
2. **回答问题** —— 如果是概念，我会解释它在上下文中的含义；如果是外文，我会保留语气翻译；如果是图表，我会描述坐标、趋势与异常点。
3. **回到全书** —— 结合${page}附近的内容，指出它和前后文的关系，并提醒你注意容易误读的地方。

顺手演示一下公式渲染。若一页有 $p$ 个段落、停留 $t$ 分钟，可以把它写成阅读密度：

$$d = \\frac{p}{t}$$

这个式子当然不是阅读的答案，只是说明：**Markdown 表格、列表与 LaTeX 公式都会按 GitHub 评论的样式显示。**

现在，整个交互链路已经打通：

- 框选任意区域，把截图随问题一起发送；
- 回答会像现在这样逐字流式出现；
- 还可以在下方继续追问，我会保留这次截图作为上下文。

**下一步**：打开「设置 → 模型服务」，选择服务商并填入支持视觉输入的模型与 API Key。`;

  const chunks = answer.match(/[\s\S]{1,3}/g) || [];
  for (const chunk of chunks) {
    if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    onDelta(chunk);
    await delay(10, signal);
  }
}

export async function testConnection(settings) {
  if (settings.provider === "mock") {
    return "演示模式已就绪。接入真实模型后，这里会显示模型的连通结果。";
  }
  let reply = "";
  await streamAssistant({
    settings,
    messages: [{ role: "user", text: "这是连通性测试。请只回复：连接成功", image: null }],
    maxOutputTokens: 64,
    onDelta: (text) => {
      reply += text;
    },
  });
  return reply.trim().slice(0, 300) || "连接成功";
}
