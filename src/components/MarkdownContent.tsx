import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { normalizeMarkdown } from "../lib/markdown";

interface MarkdownContentProps {
  content: string;
  streaming?: boolean;
  className?: string;
}

export function MarkdownContent({
  content,
  streaming = false,
  className = "",
}: MarkdownContentProps) {
  return (
    <div
      className={`markdown-body ${streaming ? "is-streaming" : ""} ${className}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [
            rehypeKatex,
            {
              throwOnError: false,
              strict: false,
              trust: false,
            },
          ],
        ]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
        }}
      >
        {normalizeMarkdown(content)}
      </ReactMarkdown>
      {streaming && <span className="stream-caret" />}
    </div>
  );
}
