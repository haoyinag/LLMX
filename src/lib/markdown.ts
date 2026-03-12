import { marked } from "marked";
import hljs from "highlight.js";

marked.setOptions({
  breaks: true,
  gfm: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  }
});

export function renderMarkdownToHtml(content: string): string {
  return marked.parse(content ?? "");
}
