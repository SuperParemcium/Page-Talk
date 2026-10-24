import { ArrowUpRight, BookOpen, FolderOpen, Moon, ScanLine, Settings2, Sparkles, Sun } from "lucide-react";
import { Brand } from "./Brand";

interface WelcomeScreenProps {
  onOpenFile: () => void;
  onOpenSample: () => void;
  onOpenSettings: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  error?: string | null;
}

export function WelcomeScreen({
  onOpenFile,
  onOpenSample,
  onOpenSettings,
  theme,
  onToggleTheme,
  error,
}: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <header className="welcome-top">
        <Brand />
        <div className="welcome-top-actions">
          <span className="prototype-pill">PROTOTYPE · 0.1</span>
          <button
            type="button"
            className="ghost-button welcome-theme"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
            title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button type="button" className="ghost-button" onClick={onOpenSettings}>
            <Settings2 size={15} />
            AI 设置
          </button>
        </div>
      </header>

      <main className="welcome-main">
        <section className="welcome-copy">
          <div className="welcome-eyebrow">
            <span />
            READ SLOWLY · ASK FREELY
          </div>
          <h1>
            把书页，
            <br />
            变成<span className="accent-word">可以对话</span>的纸。
          </h1>
          <p className="welcome-lede">
            一个安静、克制的 PDF 阅读器。在页边写字，随手圈画；
            遇到读不懂的地方，框选一块，连同你的问题一起交给 AI。
          </p>

          <div className="welcome-cta">
            <button type="button" className="primary-button large" onClick={onOpenFile}>
              <FolderOpen size={18} />
              打开一本 PDF
              <ArrowUpRight size={16} className="button-arrow" />
            </button>
            <button type="button" className="text-button large" onClick={onOpenSample}>
              <BookOpen size={17} />
              先读示例
            </button>
          </div>

          <div className="welcome-features" aria-label="核心功能">
            <span>
              <i className="feature-dot dot-ink" />
              自由圈画
            </span>
            <span>
              <i className="feature-dot dot-amber" />
              悬浮批注
            </span>
            <span>
              <i className="feature-dot dot-terra" />
              框选问 AI
            </span>
          </div>

          {error && <div className="welcome-error">{error}</div>}

          <p className="welcome-privacy">
            你的 PDF 与批注只保存在本机 · 仅你框选的截图会发送给所配置的模型
          </p>
        </section>

        <section className="welcome-art" aria-label="页间阅读界面示意">
          <div className="art-halo" />
          <div className="art-sheet art-sheet-back" />
          <div className="art-sheet art-sheet-mid" />
          <div className="art-sheet art-sheet-front">
            <div className="art-sheet-head">
              <span>PAGE 07 · 注意力的归处</span>
              <span>01</span>
            </div>
            <div className="art-kicker">A NOTE ON READING</div>
            <h2>
              先让注意力，
              <br />
              回到这一页。
            </h2>
            <div className="art-rule" />
            <p>
              真正的阅读，不是把书页翻完，而是让某一页在心里多停留一会儿。你不需要读懂每一个字，只需要允许自己被一段话绊住。
            </p>
            <p className="art-faded">
              停顿不是空白。在停顿里，文字才开始与你发生关系。
            </p>

            <svg className="art-ink" viewBox="0 0 330 54" fill="none" aria-hidden="true">
              <path
                d="M4 31C39 18 62 42 96 26C123 13 137 35 165 25C198 13 225 33 251 23C276 14 298 21 326 17"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>

            <div className="art-capture">
              <span className="capture-corner tl" />
              <span className="capture-corner tr" />
              <span className="capture-corner bl" />
              <span className="capture-corner br" />
              <div className="art-capture-chip">
                <ScanLine size={13} />
                框选提问
              </div>
            </div>

            <div className="art-note">
              <span className="art-note-pin" />
              这里的“停顿”，和后面说的
              <br />
              “留白”是同一件事吗？
              <small>页边批注 · 刚刚</small>
            </div>
          </div>

          <div className="art-ai-card">
            <div className="art-ai-head">
              <span className="art-ai-mark">
                <Sparkles size={13} />
              </span>
              <strong>共读助手</strong>
              <span className="art-ai-live">正在回答</span>
            </div>
            <p>
              这里的停顿更像是一种<em>主动的注意</em>。作者在后面用“留白”来描述
              同一件事：为尚未想清楚的部分，留出继续思考的位置。
            </p>
            <div className="art-ai-line" />
            <div className="art-ai-foot">
              <span>来自第 7 页 · 截图</span>
              <span className="typing-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>

          <div className="art-stamp">
            <span>慢读</span>
            <span>PAUSE</span>
          </div>
        </section>
      </main>

      <footer className="welcome-footer">
        <span>页间 · 给阅读留一点余地</span>
        <span className="welcome-footer-note">
          支持本地 PDF · 批注自动保存 · 接入 DeepSeek / OpenAI / Anthropic / Gemini / Qwen
        </span>
      </footer>
    </div>
  );
}
