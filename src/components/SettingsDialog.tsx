import { useEffect, useState } from "react";
import {
  Brain,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PenTool,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import type { AIProviderSettings } from "../types";
import {
  persistSettings,
  providerLabel,
  runConnectionTest,
  type SettingsUpdate,
} from "../lib/ai";
import { checkOllama } from "../lib/handwriting";
import { Modal } from "./Modal";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen2.5vl:7b";

interface SettingsDialogProps {
  open: boolean;
  settings: AIProviderSettings | null;
  onClose: () => void;
  onSaved: (settings: AIProviderSettings) => void;
}

interface Preset {
  id: string;
  label: string;
  sublabel: string;
  provider: AIProviderSettings["provider"];
  baseUrl: string;
  model: string;
  models?: string[];
}

const PRESETS: Preset[] = [
  {
    id: "mock",
    label: "演示模式",
    sublabel: "无需 Key，体验流程",
    provider: "mock",
    baseUrl: "",
    model: "",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    sublabel: "Flash · 视觉",
    provider: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    models: ["deepseek-flash"],
  },
  {
    id: "openai",
    label: "OpenAI",
    sublabel: "GPT · Vision",
    provider: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    sublabel: "Claude · Vision",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    models: ["claude-sonnet-4-20250514", "claude-3-7-sonnet-latest"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    sublabel: "OpenAI 兼容入口",
    provider: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    id: "qwen",
    label: "通义千问",
    sublabel: "DashScope · VL",
    provider: "openai-compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-max",
    models: ["qwen-vl-max", "qwen-vl-plus"],
  },
  {
    id: "custom",
    label: "自定义",
    sublabel: "任意兼容接口",
    provider: "openai-compatible",
    baseUrl: "",
    model: "",
  },
];

interface FormState {
  provider: AIProviderSettings["provider"];
  baseUrl: string;
  model: string;
  temperature: number;
  systemPrompt: string;
  apiKey: string;
  clearApiKey: boolean;
  handwritingBaseUrl: string;
  handwritingModel: string;
}

function initialForm(settings: AIProviderSettings | null): FormState {
  return {
    provider: settings?.provider || "mock",
    baseUrl: settings?.baseUrl || "",
    model: settings?.model || "",
    temperature: settings?.temperature ?? 0.4,
    systemPrompt: settings?.systemPrompt || "",
    apiKey: "",
    clearApiKey: false,
    handwritingBaseUrl: settings?.handwritingBaseUrl || DEFAULT_OLLAMA_URL,
    handwritingModel: settings?.handwritingModel || DEFAULT_OLLAMA_MODEL,
  };
}

function matchPreset(settings: AIProviderSettings | null): string {
  if (!settings || settings.provider === "mock") return "mock";
  const preset = PRESETS.find(
    (item) =>
      item.id !== "mock" &&
      item.id !== "custom" &&
      item.provider === settings.provider &&
      item.baseUrl.replace(/\/+$/, "") === settings.baseUrl.replace(/\/+$/, ""),
  );
  return preset?.id || "custom";
}

export function SettingsDialog({ open, settings, onClose, onSaved }: SettingsDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialForm(settings));
  const [selectedPreset, setSelectedPreset] = useState(() => matchPreset(settings));
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [handwritingBusy, setHandwritingBusy] = useState(false);
  const [handwritingTest, setHandwritingTest] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm(settings));
    setSelectedPreset(matchPreset(settings));
    setShowKey(false);
    setAdvancedOpen(false);
    setBusy(null);
    setError(null);
    setTestResult(null);
    setHandwritingBusy(false);
    setHandwritingTest(null);
    // 仅在打开时重置，保存后的 settings 更新不应覆盖正在编辑的表单。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const activePreset = PRESETS.find((item) => item.id === selectedPreset) || PRESETS[0];
  const isMock = form.provider === "mock";
  const keyIsSaved = Boolean(settings?.hasApiKey) && !form.clearApiKey;

  function choosePreset(preset: Preset) {
    setSelectedPreset(preset.id);
    setTestResult(null);
    setError(null);
    if (preset.id === "mock") {
      setForm((current) => ({ ...current, provider: "mock" }));
      return;
    }
    setForm((current) => ({
      ...current,
      provider: preset.provider,
      baseUrl: preset.baseUrl,
      model: preset.model,
    }));
  }

  function patch(patchValue: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patchValue }));
    setTestResult(null);
    setHandwritingTest(null);
  }

  function buildPayload(): SettingsUpdate {
    return {
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      temperature: form.temperature,
      systemPrompt: form.systemPrompt,
      handwritingBaseUrl: form.handwritingBaseUrl.trim(),
      handwritingModel: form.handwritingModel.trim(),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(form.clearApiKey ? { clearApiKey: true } : {}),
    };
  }

  function validate() {
    if (form.provider !== "mock") {
      if (!form.baseUrl.trim()) return "请填写接口地址";
    try {
      const url = new URL(form.baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) return "接口地址需要使用 http 或 https";
    } catch {
      return "接口地址格式不正确";
    }
    if (!form.model.trim()) return "请填写模型名称";
    if (!keyIsSaved && !form.apiKey.trim()) {
      const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(form.baseUrl);
      if (!local) return "请填写 API Key（本地模型可留空）";
      }
    }
    if (!form.handwritingBaseUrl.trim()) return "请填写 Ollama 地址";
    try {
      const url = new URL(form.handwritingBaseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) {
        return "Ollama 地址需要使用 http 或 https";
      }
    } catch {
      return "Ollama 地址格式不正确";
    }
    if (!form.handwritingModel.trim()) return "请填写 Ollama 视觉模型";
    return null;
  }

  async function save(closeAfter = true) {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const next = await persistSettings(buildPayload());
      onSaved(next);
      if (closeAfter) onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function testHandwriting() {
    setHandwritingBusy(true);
    setHandwritingTest(null);
    try {
      const result = await checkOllama(
        form.handwritingBaseUrl.trim(),
        form.handwritingModel.trim(),
      );
      const visionModels = result.visionModels || [];
      setOllamaModels(visionModels.length > 0 ? visionModels : result.models || []);
      if (result.installed) {
        setHandwritingTest({
          ok: true,
          text: `已连接 Ollama，模型 ${form.handwritingModel.trim()} 可用。`,
        });
      } else if (visionModels.length > 0) {
        setHandwritingTest({
          ok: true,
          text: `已连接。${form.handwritingModel.trim()} 未安装，识别时会自动改用 ${visionModels[0]}。`,
        });
      } else {
        const installed = result.models?.length
          ? `已安装：${result.models.slice(0, 6).join("、")}`
          : "还没有安装任何模型";
        setHandwritingTest({
          ok: false,
          text: `Ollama 已连接，但没有可用的视觉模型。${installed}。可运行 ollama pull ${form.handwritingModel.trim()}。`,
        });
      }
    } catch (error) {
      setHandwritingTest({
        ok: false,
        text: error instanceof Error ? error.message : "Ollama 检测失败",
      });
    } finally {
      setHandwritingBusy(false);
    }
  }

  async function testAndSave() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy("test");
    setError(null);
    setTestResult(null);
    try {
      const next = await persistSettings(buildPayload());
      onSaved(next);
      if (!isMock) {
        const result = await runConnectionTest();
        setTestResult({ ok: true, text: result.reply || "连接成功" });
      } else {
        setTestResult({ ok: true, text: "演示模式可用，无需连接。接入真实模型后再来测试。" });
      }
    } catch (testError) {
      const message = testError instanceof Error ? testError.message : "连接测试失败";
      setTestResult({ ok: false, text: message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} className="settings-modal" labelledBy="settings-title">
      <header className="settings-head">
        <div>
          <span className="dialog-eyebrow">
            <Sparkles size={12} />
            MODEL CONNECTION
          </span>
          <h2 id="settings-title">AI 设置</h2>
          <p>选择你信任的模型，来一起读这些书页。</p>
        </div>
        <button type="button" className="dialog-close" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </header>

      <div className="settings-body">
        <section className="settings-section">
          <div className="settings-label-row">
            <span className="settings-label">模型服务</span>
            <span className="settings-caption">需要支持图片输入的视觉模型</span>
          </div>
          <div className="provider-grid" role="radiogroup" aria-label="模型服务">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="radio"
                aria-checked={selectedPreset === preset.id}
                className={`provider-card ${
                  selectedPreset === preset.id ? "is-active" : ""
                } ${preset.id === "custom" ? "is-custom" : ""}`}
                onClick={() => choosePreset(preset)}
              >
                <span className="provider-icon">
                  {preset.id === "mock" ? (
                    <WandSparkles size={15} />
                  ) : preset.id === "deepseek" ? (
                    <Brain size={15} />
                  ) : (
                    <Server size={15} />
                  )}
                </span>
                <span className="provider-copy">
                  <strong>{preset.label}</strong>
                  <small>{preset.sublabel}</small>
                </span>
                {selectedPreset === preset.id && <Check size={14} className="provider-check" />}
              </button>
            ))}
          </div>
        </section>

        {isMock ? (
          <div className="mock-panel">
            <span className="mock-panel-icon">
              <WandSparkles size={20} />
            </span>
            <div>
              <h3>先体验完整流程，不必马上准备 API Key</h3>
              <p>
                演示模式会在本地生成一条示例回答，用来展示“框选 → 提问 → 流式回答 →
                继续追问”的交互。它不会真的理解书页内容。
              </p>
            </div>
          </div>
        ) : (
          <section className="settings-section connection-section">
            <div className="settings-label-row">
              <span className="settings-label">连接信息</span>
              <span className="settings-caption">
                {providerLabel(form.provider)} · 经由本地代理发送
              </span>
            </div>

            <div className="field-row">
              <label className="field">
                <span>接口地址 Base URL</span>
                <input
                  value={form.baseUrl}
                  onChange={(event) => patch({ baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>模型名称</span>
                <input
                  value={form.model}
                  onChange={(event) => patch({ model: event.target.value })}
                  placeholder="支持图片输入的模型"
                  list="model-suggestions"
                  spellCheck={false}
                  autoComplete="off"
                />
                <datalist id="model-suggestions">
                  {(activePreset.models || []).map((model) => (
                    <option value={model} key={model} />
                  ))}
                </datalist>
              </label>
            </div>

            {selectedPreset === "custom" && (
              <div className="protocol-row">
                <span>接口协议</span>
                <div className="protocol-switch">
                  <button
                    type="button"
                    className={form.provider === "openai-compatible" ? "is-active" : ""}
                    onClick={() => patch({ provider: "openai-compatible" })}
                  >
                    OpenAI 兼容
                  </button>
                  <button
                    type="button"
                    className={form.provider === "anthropic" ? "is-active" : ""}
                    onClick={() => patch({ provider: "anthropic" })}
                  >
                    Anthropic
                  </button>
                </div>
              </div>
            )}

            {selectedPreset === "deepseek" && (
              <p className="provider-note">
                <Sparkles size={12} />
                DeepSeek 的 <code>deepseek-flash</code> 支持图片输入；请勿换成纯文本模型，否则无法读取截图。
              </p>
            )}

            <label className="field key-field">
              <span>
                API Key
                <small>
                  <KeyRound size={11} />
                  仅保存在本机，不写入 PDF 或浏览器存储
                </small>
              </span>
              <div className="key-input">
                <input
                  type={showKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(event) =>
                    patch({ apiKey: event.target.value, clearApiKey: false })
                  }
                  placeholder={
                    form.clearApiKey
                      ? "将清除已保存的 Key"
                      : keyIsSaved
                        ? "已保存，留空则不修改"
                        : "填入你的 API Key"
                  }
                  spellCheck={false}
                  autoComplete="off"
                  disabled={form.clearApiKey}
                />
                <button
                  type="button"
                  className="key-visibility"
                  onClick={() => setShowKey((value) => !value)}
                  aria-label={showKey ? "隐藏 Key" : "显示 Key"}
                  title={showKey ? "隐藏" : "显示"}
                >
                  {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {keyIsSaved && !form.apiKey && (
                  <button
                    type="button"
                    className="key-clear"
                    onClick={() => patch({ apiKey: "", clearApiKey: true })}
                    aria-label="清除已保存的 Key"
                    title="清除已保存的 Key"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                {form.clearApiKey && (
                  <button
                    type="button"
                    className="key-clear undo"
                    onClick={() => patch({ clearApiKey: false })}
                  >
                    撤销清除
                  </button>
                )}
              </div>
              {settings?.keySource === "env" && !form.clearApiKey && (
                <small className="field-note">检测到环境变量中的 Key；此处输入会覆盖它。</small>
              )}
            </label>

            <p className="settings-security">
              <KeyRound size={12} />
              配置写入本机的 <code>data/settings.json</code>，请求由本地 Node
              代理转发。请只使用你有权访问的模型服务。
            </p>
          </section>
        )}

        <section className="settings-section handwriting-ocr-section">
          <div className="settings-label-row">
            <span className="settings-label">手写公式识别</span>
            <span className="settings-caption">Ollama · 本地视觉模型</span>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Ollama 地址</span>
              <input
                value={form.handwritingBaseUrl}
                onChange={(event) => patch({ handwritingBaseUrl: event.target.value })}
                placeholder={DEFAULT_OLLAMA_URL}
                spellCheck={false}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>视觉模型</span>
              <input
                value={form.handwritingModel}
                onChange={(event) => patch({ handwritingModel: event.target.value })}
                placeholder={DEFAULT_OLLAMA_MODEL}
                list="ollama-model-suggestions"
                spellCheck={false}
                autoComplete="off"
              />
              <datalist id="ollama-model-suggestions">
                {ollamaModels.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>
            </label>
          </div>
          <div className="ollama-check-row">
            <button
              type="button"
              className="text-button ollama-check"
              onClick={testHandwriting}
              disabled={handwritingBusy || Boolean(busy)}
            >
              {handwritingBusy ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              检测 Ollama
            </button>
            {handwritingTest ? (
              <span className={`ollama-test-result ${handwritingTest.ok ? "is-ok" : "is-error"}`}>
                {handwritingTest.ok ? <Check size={13} /> : <X size={13} />}
                {handwritingTest.text}
              </span>
            ) : (
              <span className="ollama-hint">
                先运行 <code>ollama serve</code>，再 <code>ollama pull {form.handwritingModel || "模型"}</code>。
              </span>
            )}
          </div>
          <p className="provider-note handwriting-provider-note">
            <PenTool size={12} />
            手写公式只在点击「识别并插入」时发送给这个本地模型，不会交给上面的聊天模型。
          </p>
        </section>

        <details
          className="advanced-settings"
          open={advancedOpen}
          onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
        >
          <summary>
            <span>高级设置</span>
            <small>温度与系统提示词</small>
          </summary>
          <div className="advanced-body">
            <label className="field range-field">
              <span>
                回答温度
                <b>{form.temperature.toFixed(1)}</b>
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={form.temperature}
                onChange={(event) => patch({ temperature: Number(event.target.value) })}
              />
              <small>越低越克制稳定，越高越发散。</small>
            </label>
            <label className="field">
              <span>系统提示词</span>
              <textarea
                rows={5}
                value={form.systemPrompt}
                onChange={(event) => patch({ systemPrompt: event.target.value })}
                placeholder="告诉 AI 应该如何陪你阅读…"
              />
            </label>
          </div>
        </details>

        {error && <div className="settings-error">{error}</div>}
        {testResult && (
          <div className={`test-result ${testResult.ok ? "is-ok" : "is-error"}`}>
            {testResult.ok ? <Check size={15} /> : <X size={15} />}
            <span>{testResult.text}</span>
          </div>
        )}
      </div>

      <footer className="settings-foot">
        <span className="settings-foot-note">
          <KeyRound size={12} />
          保存后 Key 不会回传到页面
        </span>
        <div className="settings-actions">
          <button
            type="button"
            className="text-button test-button"
            onClick={testAndSave}
            disabled={Boolean(busy)}
          >
            {busy === "test" ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
            保存并测试
          </button>
          <button type="button" className="text-button" onClick={onClose} disabled={Boolean(busy)}>
            取消
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => save(true)}
            disabled={Boolean(busy)}
          >
            {busy === "save" ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            保存设置
          </button>
        </div>
      </footer>
    </Modal>
  );
}
