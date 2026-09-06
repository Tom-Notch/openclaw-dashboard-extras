import MarkdownIt from 'markdown-it';
import { extractMarkdownMath, restoreMarkdownMath } from './math.ts';

const markdown = new MarkdownIt({ html: false, breaks: true });
const excluded = 'pre,code,a,button,textarea,script,style,math,[data-dashboard-extras-math],.mermaid';
const compact = (text: string) => text.replace(/\s/gu, '');
const MAX_SOURCE = 96_000;

/** A bounded adapter over displayed message text, never a replacement Markdown renderer. */
export function enhanceNativeMath(bubble: HTMLElement): void {
  const source = bubble.getAttribute('data-message-text');
  if (!source || source.length > MAX_SOURCE || (source.match(/\$|\\[([]|`/gu)?.length ?? 0) > 2_048) return;
  const document = bubble.ownerDocument;
  const fragments = extractMarkdownMath(source).fragments;
  if (!fragments.length) return;
  for (const content of bubble.querySelectorAll<HTMLElement>('.chat-text')) {
    if (content.closest('[data-message-text]') !== bubble) continue;
    for (const fragment of fragments) {
      // Use the original source, including TeX escapes consumed by Markdown.
      // The ordinary Markdown projection is used solely to locate its rendered
      // text; only the independently sanitized MathML is inserted into the page.
      const projection = document.createElement('template');
      projection.innerHTML = markdown.render(fragment.raw);
      const needle = compact(projection.content.textContent ?? '');
      if (!needle) continue;
      const walker = document.createTreeWalker(content, 4);
      const positions: { node: Text; offset: number }[] = [];
      let haystack = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest(excluded)) { haystack += '\0'; positions.push({ node: node as Text, offset:0 }); continue; }
        const text = node.textContent ?? '';
        for (let offset = 0; offset < text.length; offset++) {
          if (/\s/u.test(text[offset])) continue;
          haystack += text[offset]; positions.push({ node: node as Text, offset });
        }
      }
      const start = haystack.indexOf(needle);
      if (start < 0) continue; // Changed host markup leaves readable native text.
      const end = start + needle.length - 1;
      const first = positions[start], last = positions[end];
      if (!first || !last) continue;
      const rendered = document.createElement('template');
      rendered.innerHTML = restoreMarkdownMath(fragment.token, [fragment]);
      if (!rendered.content.querySelector('math')) continue;
      const span = document.createElement('span');
      span.dataset.dashboardExtrasMath = '';
      span.append(rendered.content);
      if (fragment.display) {
        span.style.display = 'block'; span.style.overflowX = 'auto'; span.style.padding = '0.65em 0'; span.style.textAlign = 'center';
      }
      // Never delete native elements or Lit part-boundary comments. Native
      // streaming, syntax highlighting, copy buttons and keyed rows keep owners.
      const nodes = [...new Set(positions.slice(start, end + 1).map(position => position.node))];
      if (first.node === last.node) {
        const suffix = first.node.splitText(last.offset + 1);
        first.node.textContent = (first.node.textContent ?? '').slice(0, first.offset);
        suffix.parentNode?.insertBefore(span, suffix);
      } else {
        first.node.textContent = (first.node.textContent ?? '').slice(0, first.offset);
        last.node.textContent = (last.node.textContent ?? '').slice(last.offset + 1);
        for (const node of nodes.slice(1, -1)) node.textContent = '';
        first.node.parentNode?.insertBefore(span, first.node.nextSibling);
      }
    }
  }
}
