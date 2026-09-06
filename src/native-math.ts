import MarkdownIt from 'markdown-it';
import { extractMarkdownMath, restoreMarkdownMath } from './math.ts';

const markdown = new MarkdownIt({ html: false, breaks: true });
const excluded = 'pre,code,a,button,textarea,script,style,math,[data-dashboard-extras-math],.mermaid';
const compact = (text: string) => text.replace(/\s/gu, '');
const MAX_SOURCE = 96_000;
const inlineFormatting = /^(em|strong|s|del|span|sub|sup)$/u;
type SpacingState = { source: string | null; hidden: Map<HTMLElement, { display: string; priority: string }> };
const spacingStates = new WeakMap<HTMLElement, SpacingState>();

function emptyRemnant(node: Node, state: SpacingState): boolean {
  if (node.nodeType === 3) return !node.textContent?.trim();
  if (node.nodeType === 8) return true; // Retain native/Lit ownership markers.
  if (node.nodeType !== 1) return false;
  const element = node as HTMLElement;
  if (element.localName === 'br') return state.hidden.has(element) && element.style.display === 'none';
  if (element.localName !== 'p' && !inlineFormatting.test(element.localName)) return false;
  return [...node.childNodes].every(child => emptyRemnant(child, state));
}

function restoreSpacing(element: HTMLElement, previous: { display: string; priority: string }): void {
  // Do not overwrite a newer style assigned by the host.
  if (element.style.display !== 'none' || element.style.getPropertyPriority('display')) return;
  if (previous.display) element.style.setProperty('display', previous.display, previous.priority);
  else element.style.removeProperty('display');
}

function suppressSpacing(element: HTMLElement, state: SpacingState): void {
  if (!state.hidden.has(element)) state.hidden.set(element, {
    display: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display'),
  });
  element.style.setProperty('display', 'none');
}

/** A display formula already supplies the line boundary next to its delimiters. */
function adjacentBreak(node: Node, side: 'previousSibling' | 'nextSibling', content: HTMLElement): HTMLElement | null {
  let cursor = node;
  while (cursor.parentNode) {
    let neighbor = cursor[side];
    while (neighbor && (neighbor.nodeType === 8 || (neighbor.nodeType === 3 && !neighbor.textContent?.trim()))) neighbor = neighbor[side];
    if (neighbor) return neighbor.nodeType === 1 && (neighbor as Element).localName === 'br' ? neighbor as HTMLElement : null;
    const parent = cursor.parentElement;
    if (!parent || parent === content || !inlineFormatting.test(parent.localName)) break;
    cursor = parent;
  }
  return null;
}

/** A bounded adapter over displayed message text, never a replacement Markdown renderer. */
export function enhanceNativeMath(bubble: HTMLElement): void {
  const source = bubble.getAttribute('data-message-text');
  let spacing = spacingStates.get(bubble);
  if (spacing) {
    for (const [element, previous] of spacing.hidden) {
      if (spacing.source !== source || !bubble.contains(element) || (element.localName === 'p' && !emptyRemnant(element, spacing))) {
        restoreSpacing(element, previous); spacing.hidden.delete(element);
      }
    }
    spacing.source = source;
  }
  if (!source || source.length > MAX_SOURCE || (source.match(/\$|\\[([]|`/gu)?.length ?? 0) > 2_048) return;
  const document = bubble.ownerDocument;
  const fragments = extractMarkdownMath(source).fragments;
  if (!fragments.length) return;
  if (!spacing) { spacing = { source, hidden: new Map() }; spacingStates.set(bubble, spacing); }
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
      // Inspect the original range before changing text. Only its own layout
      // remnants are suppressed; unrelated prose and line breaks stay native.
      const range = document.createRange();
      range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset + 1);
      const remnants = [...content.querySelectorAll<HTMLElement>('br,p')].filter(node => range.intersectsNode(node));
      const boundaries = fragment.display ? [
        !(first.node.textContent ?? '').slice(0, first.offset).trim() ? adjacentBreak(first.node, 'previousSibling', content) : null,
        !(last.node.textContent ?? '').slice(last.offset + 1).trim() ? adjacentBreak(last.node, 'nextSibling', content) : null,
      ] : [];
      const span = document.createElement('span');
      span.dataset.dashboardExtrasMath = '';
      // One formula baseline follows the user's live chat-size setting, not
      // incidental heading/table sizes. MathML still owns scripts and TeX sizes.
      span.style.fontSize = 'var(--chat-text-size, 1em)';
      span.append(rendered.content);
      if (fragment.display) {
        // Collapsible margins share native paragraph spacing instead of adding
        // padding to it. Same-paragraph display math still gets a small gap.
        // overflow-x:auto otherwise makes overflow-y:auto too. Native MathML
        // reports spare vertical scroll extent beyond its actual formula bounds;
        // suppress that scrollbar without capping the intrinsic equation height.
        span.style.display = 'block'; span.style.overflowX = 'auto'; span.style.overflowY = 'hidden';
        span.style.marginBlock = '0.5em'; span.style.textAlign = 'center';
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
      for (const node of [...remnants.filter(node => node.localName === 'br'), ...boundaries]) {
        if (node) suppressSpacing(node, spacing);
      }
      for (const node of remnants) {
        if (node.localName === 'p' && emptyRemnant(node, spacing)) suppressSpacing(node, spacing);
      }
    }
  }
}
