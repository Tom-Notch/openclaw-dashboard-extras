import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { extractMarkdownMath, restoreMarkdownMath } from "./math.js";

const MAX_SOURCE = 96_000;
const MAX_PATH = 8_192;
const markdown = new MarkdownIt({ html: false, linkify: false, breaks: true });

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** Classification only. The Gateway, not a browser path, determines authority. */
export function parseLocalFileTarget(raw: string): string | null {
  if (typeof raw !== "string" || !raw || raw.length > MAX_PATH || /[\x00-\x1f\x7f]/u.test(raw)) return null;
  let target = raw.trim();
  if (/^file:\/\//iu.test(target)) {
    if (/[?#]/u.test(target)) return null;
    let candidate = target;
    for (let depth = 0; depth <= target.length; depth++) {
      if (/%(?:2f|5c)/iu.test(candidate)) return null;
      try {
        const decoded = decodeURIComponent(candidate);
        if (decoded === candidate) break;
        candidate = decoded;
      } catch { break; }
    }
    try {
      const url = new URL(target);
      if (url.hostname && url.hostname.toLowerCase() !== "localhost") return null;
      if (url.username || url.password || url.port) return null;
      target = decodeURIComponent(url.pathname);
    } catch { return null; }
  } else if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) {
    return null;
  }
  if (target.startsWith("//") || target.includes("\\") || /[\x00-\x1f\x7f]/u.test(target)) return null;
  if (!/^(?:\/|~\/|\.\.?\/)/u.test(target) && !/^[^\s<>]+\.[a-z0-9]{1,12}(?::\d+(?::\d+)?)?$/iu.test(target)) return null;
  return target.replace(/:\d{1,6}(?::\d{1,6})?$/u, "");
}

// A local-only inline rule runs outside code/fences and accepts spaces and
// balanced parentheses in authored paths. It never changes ordinary web links.
markdown.inline.ruler.before("link", "dashboard-extras-file", (state, silent) => {
  if (state.src[state.pos] !== "[") return false;
  const closeLabel = state.src.indexOf("](", state.pos + 1);
  if (closeLabel < 0 || closeLabel - state.pos > 512) return false;
  const start = closeLabel + 2;
  let depth = 1;
  let end = start;
  for (; end < state.posMax && end - start <= MAX_PATH; end++) {
    const character = state.src[end];
    if (character === "\n" || character === "\r") return false;
    if (character === "(") depth++;
    if (character === ")" && --depth === 0) break;
    if (character !== ")") continue;
  }
  if (depth !== 0) return false;
  let raw = state.src.slice(start, end);
  if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1);
  const target = parseLocalFileTarget(raw);
  if (!target) return false;
  if (!silent) {
    const open = state.push("link_open", "a", 1);
    open.attrs = [["href", "#"], ["data-file-path", target], ["role", "button"]];
    state.push("text", "", 0).content = state.src.slice(state.pos + 1, closeLabel);
    state.push("link_close", "a", -1);
  }
  state.pos = end + 1;
  return true;
});

/** Self-contained pre-Markdown math rendering. No global host renderer hooks. */
export function renderMarkdown(raw: string): string {
  const truncated = raw.length > MAX_SOURCE;
  const source = raw.slice(0, MAX_SOURCE);
  const notice = truncated ? "<p>Display truncated for safety. Use the built-in transcript to read the complete message.</p>" : "";
  // Avoid pathological delimiter scans; safe readable source remains available.
  if ((source.match(/\$|\\[([]|`/gu)?.length ?? 0) > 2_048) {
    return `<pre>${escapeHtml(source)}</pre>${notice}`;
  }
  const math = extractMarkdownMath(source);
  let output: string;
  try { output = markdown.render(math.source); }
  catch { return `<pre>${escapeHtml(source)}</pre>${notice}`; }
  const clean = DOMPurify.sanitize(output, {
    ALLOWED_TAGS: ["p", "br", "hr", "strong", "em", "s", "del", "blockquote", "pre", "code", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "a"],
    ALLOWED_ATTR: ["href", "title", "class", "start", "data-file-path", "role"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_TRUSTED_TYPE: false,
  });
  const template = document.createElement("template");
  template.innerHTML = restoreMarkdownMath(clean, math.fragments);
  for (const anchor of template.content.querySelectorAll("a")) {
    const local = anchor.getAttribute("data-file-path");
    if (local && parseLocalFileTarget(local)) {
      anchor.setAttribute("href", "#");
      continue;
    }
    anchor.removeAttribute("data-file-path");
    const href = anchor.getAttribute("href") ?? "";
    if (!/^(?:https?:\/\/|mailto:)/iu.test(href)) {
      anchor.removeAttribute("href");
      continue;
    }
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
  return template.innerHTML + notice;
}
