/**
 * Some providers emit LaTeX with \( ... \) / \[ ... \] delimiters, while
 * remark-math (and GitHub comments) use $ ... $ / $$ ... $$. Normalize the
 * former without touching fenced code blocks or inline code.
 */
function convertMathDelimiters(source: string) {
  return source
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body.trim()}$`);
}

export function normalizeMarkdown(source: string) {
  const chunks = source.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  return chunks
    .map((chunk, index) => (index % 2 === 0 ? convertMathDelimiters(chunk) : chunk))
    .join("");
}
