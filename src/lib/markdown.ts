import { marked } from "marked";
import hljs from "highlight.js";

marked.setOptions({
  breaks: true,
  gfm: true
});

const renderer = new marked.Renderer();
renderer.code = (code, infostring) => {
  const lang = (infostring || "").trim();
  const highlighted =
    lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;

  const className = lang ? `language-${lang}` : "";
  return `<pre><code class=\"hljs ${className}\">${highlighted}</code></pre>`;
};

marked.use({ renderer });

export function renderMarkdownToHtml(content: string): string {
  return marked.parse(content ?? "");
}
