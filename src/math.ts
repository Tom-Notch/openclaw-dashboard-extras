// Control UI module adds bounded, sanitized MathML rendering to Markdown.
import DOMPurify from "dompurify";
import katex from "katex";

const PLACEHOLDER_PREFIX = "OPENCLAWKATEXPLACEHOLDER";
const PLACEHOLDER_SUFFIX = "ZXQ";
const MAX_FORMULA_CHARS = 20_000;
const MAX_RENDERED_FORMULA_CHARS = 128_000;
const MAX_CACHE_ENTRIES = 256;
export const MAX_MATH_FRAGMENTS = 256;

type SourceRange = [start: number, end: number];

export type MarkdownMathFragment = {
  display: boolean;
  end: number;
  raw: string;
  start: number;
  tex: string;
  token: string;
};

export type ExtractedMarkdownMath = {
  fragments: MarkdownMathFragment[];
  source: string;
};

const renderedFormulaCache = new Map<string, string>();

// This is a dedicated KaTeX MathML surface, deliberately separate from the
// ordinary Markdown sanitizer. Adding math must not make user-authored HTML
// valid anywhere else in a message.
const KATEX_MATHML_TAGS = [
  "annotation",
  "math",
  "menclose",
  "mfrac",
  "mglyph",
  "mi",
  "mlabeledtr",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mroot",
  "mrow",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "semantics",
  "span",
] as const;

const KATEX_MATHML_ATTRIBUTES = [
  "accent",
  "accentunder",
  "class",
  "columnalign",
  "columnlines",
  "columnspacing",
  "depth",
  "display",
  "displaystyle",
  "encoding",
  "fence",
  "height",
  "largeop",
  "linebreak",
  "linethickness",
  "lspace",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "maxsize",
  "minsize",
  "movablelimits",
  "notation",
  "rowalign",
  "rowlines",
  "rowspacing",
  "rspace",
  "scriptlevel",
  "separator",
  "stretchy",
  "symmetric",
  "title",
  "voffset",
  "width",
  "xmlns",
] as const;

function isEscaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    slashes += 1;
  }
  return slashes % 2 === 1;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/u.test(character);
}

function isAsciiWord(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_]/u.test(character);
}

// Single-dollar math needs conservative word boundaries so ordinary prices
// such as "$5 to $10" remain prose. Explicit \(...\) is available when a
// formula genuinely needs word-adjacent delimiters.
function canOpenDollar(source: string, index: number): boolean {
  const previous = source[index - 1];
  const next = source[index + 1];
  return (
    previous !== "$" &&
    (index === 0 || isWhitespace(previous) || !isAsciiWord(previous)) &&
    !isWhitespace(next)
  );
}

function canCloseDollar(source: string, index: number): boolean {
  const previous = source[index - 1];
  const next = source[index + 1];
  return (
    next !== "$" &&
    (next === undefined || isWhitespace(next) || !isAsciiWord(next)) &&
    !isWhitespace(previous)
  );
}

function scanFenceRanges(source: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let openFence: { character: string; length: number; start: number } | null = null;
  let lineStart = 0;

  while (lineStart < source.length) {
    const newline = source.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? source.length : newline + 1;
    const line = source.slice(lineStart, newline === -1 ? source.length : newline);

    if (!openFence) {
      const opening = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
      const marker = opening?.[1];
      if (marker) {
        openFence = {
          character: marker[0] ?? "`",
          length: marker.length,
          start: lineStart,
        };
      }
    } else {
      const trimmed = line.replace(/^[ \t]{0,3}/, "");
      let runLength = 0;
      while (trimmed[runLength] === openFence.character) {
        runLength += 1;
      }
      if (runLength >= openFence.length && /^[ \t]*$/.test(trimmed.slice(runLength))) {
        ranges.push([openFence.start, lineEnd]);
        openFence = null;
      }
    }

    lineStart = lineEnd;
  }

  if (openFence) {
    ranges.push([openFence.start, source.length]);
  }
  return ranges;
}

function rangeContaining(ranges: readonly SourceRange[], position: number): SourceRange | null {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) {
      return null;
    }
    if (position < range[0]) {
      high = middle - 1;
    } else if (position >= range[1]) {
      low = middle + 1;
    } else {
      return range;
    }
  }
  return null;
}

function scanInlineCodeRanges(source: string, fenceRanges: readonly SourceRange[]): SourceRange[] {
  const ranges: SourceRange[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const fenced = rangeContaining(fenceRanges, cursor);
    if (fenced) {
      cursor = fenced[1];
      continue;
    }
    if (source[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    let runLength = 1;
    while (source[cursor + runLength] === "`") {
      runLength += 1;
    }
    let search = cursor + runLength;
    let closingEnd = -1;

    while (search < source.length) {
      const nextFence = rangeContaining(fenceRanges, search);
      if (nextFence) {
        search = nextFence[1];
        continue;
      }
      const candidate = source.indexOf("`", search);
      if (candidate === -1) {
        break;
      }
      const candidateFence = rangeContaining(fenceRanges, candidate);
      if (candidateFence) {
        search = candidateFence[1];
        continue;
      }
      let candidateLength = 1;
      while (source[candidate + candidateLength] === "`") {
        candidateLength += 1;
      }
      if (candidateLength === runLength) {
        closingEnd = candidate + candidateLength;
        break;
      }
      search = candidate + candidateLength;
    }

    if (closingEnd === -1) {
      cursor += runLength;
    } else {
      ranges.push([cursor, closingEnd]);
      cursor = closingEnd;
    }
  }

  return ranges;
}

function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
  const sorted = ranges.toSorted((left, right) => left[0] - right[0]);
  const merged: SourceRange[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range[0] > previous[1]) {
      merged.push([...range]);
    } else {
      previous[1] = Math.max(previous[1], range[1]);
    }
  }
  return merged;
}

function codeRanges(source: string): SourceRange[] {
  const fences = scanFenceRanges(source);
  return mergeRanges([...fences, ...scanInlineCodeRanges(source, fences)]);
}

function findClosing(
  source: string,
  start: number,
  delimiter: string,
  protectedRanges: readonly SourceRange[],
  predicate?: (position: number) => boolean,
): number {
  let cursor = start;
  while (cursor < source.length) {
    const candidate = source.indexOf(delimiter, cursor);
    if (candidate === -1) {
      return -1;
    }
    const protectedRange = rangeContaining(protectedRanges, candidate);
    if (protectedRange) {
      cursor = protectedRange[1];
      continue;
    }
    if (!isEscaped(source, candidate) && (!predicate || predicate(candidate))) {
      return candidate;
    }
    cursor = candidate + delimiter.length;
  }
  return -1;
}

function placeholder(prefix: string, index: number): string {
  return `${prefix}${index}${PLACEHOLDER_SUFFIX}`;
}

/** Extracts complete TeX fragments while protecting Markdown code syntax. */
export function extractMarkdownMath(source: string): ExtractedMarkdownMath {
  if (!source.includes("$") && !source.includes("\\(") && !source.includes("\\[")) {
    return { source, fragments: [] };
  }

  const protectedRanges = codeRanges(source);
  const fragments: MarkdownMathFragment[] = [];
  const output: string[] = [];
  // Choose an absent short prefix in linear time. Growing the prefix one X at
  // a time causes quadratic rescanning on an adversarial long X suffix.
  const occupied = new Set(
    [...source.matchAll(/OPENCLAWKATEXPLACEHOLDER(\d+)X/gu)].map((match) => match[1]),
  );
  let nonce = 0;
  while (occupied.has(String(nonce))) nonce += 1;
  const tokenPrefix = `${PLACEHOLDER_PREFIX}${nonce}X`;
  let cursor = 0;
  let plainStart = 0;

  const capture = (start: number, end: number, tex: string, display: boolean) => {
    output.push(source.slice(plainStart, start));
    const token = placeholder(tokenPrefix, fragments.length);
    fragments.push({ token, raw: source.slice(start, end), tex, display, start, end });
    output.push(token);
    cursor = end;
    plainStart = end;
  };

  while (cursor < source.length) {
    // Message content is untrusted. Bound both KaTeX work and the later
    // placeholder restoration pass; any remaining delimiters stay readable
    // as their original source text.
    if (fragments.length >= MAX_MATH_FRAGMENTS) {
      break;
    }
    const protectedRange = rangeContaining(protectedRanges, cursor);
    if (protectedRange) {
      cursor = protectedRange[1];
      continue;
    }

    if (source.startsWith("\\[", cursor) && !isEscaped(source, cursor)) {
      const closing = findClosing(source, cursor + 2, "\\]", protectedRanges);
      if (closing !== -1) {
        const tex = source.slice(cursor + 2, closing);
        if (tex.trim() && tex.length <= MAX_FORMULA_CHARS) {
          capture(cursor, closing + 2, tex, true);
          continue;
        }
      }
    }

    if (source.startsWith("\\(", cursor) && !isEscaped(source, cursor)) {
      const closing = findClosing(source, cursor + 2, "\\)", protectedRanges);
      if (closing !== -1) {
        const tex = source.slice(cursor + 2, closing);
        if (tex.trim() && !tex.includes("\n") && tex.length <= MAX_FORMULA_CHARS) {
          capture(cursor, closing + 2, tex, false);
          continue;
        }
      }
    }

    if (
      source.startsWith("$$", cursor) &&
      source[cursor - 1] !== "$" &&
      source[cursor + 2] !== "$" &&
      !isEscaped(source, cursor)
    ) {
      const closing = findClosing(
        source,
        cursor + 2,
        "$$",
        protectedRanges,
        (position) => source[position - 1] !== "$" && source[position + 2] !== "$",
      );
      if (closing !== -1) {
        const tex = source.slice(cursor + 2, closing);
        if (tex.trim() && tex.length <= MAX_FORMULA_CHARS) {
          capture(cursor, closing + 2, tex, true);
          continue;
        }
      }
    }

    if (
      source[cursor] === "$" &&
      source[cursor + 1] !== "$" &&
      !isEscaped(source, cursor) &&
      canOpenDollar(source, cursor)
    ) {
      const closing = findClosing(source, cursor + 1, "$", protectedRanges, (position) =>
        canCloseDollar(source, position),
      );
      if (closing !== -1) {
        const tex = source.slice(cursor + 1, closing);
        if (tex.trim() && !tex.includes("\n") && tex.length <= MAX_FORMULA_CHARS) {
          capture(cursor, closing + 1, tex, false);
          continue;
        }
      }
    }

    cursor += 1;
  }

  output.push(source.slice(plainStart));
  return { source: output.join(""), fragments };
}

/** Keeps the stable/tail streaming split outside complete display or inline math. */
export function protectStreamingMarkdownSplit<
  T extends { boundary: number; tailRepairStart: number | null },
>(source: string, split: T): T {
  if (split.boundary <= 0 || split.boundary >= source.length) {
    return split;
  }
  const containing = extractMarkdownMath(source).fragments.find(
    (fragment) => split.boundary > fragment.start && split.boundary < fragment.end,
  );
  if (!containing) {
    return split;
  }
  return {
    ...split,
    boundary: containing.start,
    tailRepairStart:
      split.tailRepairStart === null ? null : Math.min(split.tailRepairStart, containing.start),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeKatex(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...KATEX_MATHML_TAGS],
    ALLOWED_ATTR: [...KATEX_MATHML_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_TRUSTED_TYPE: false,
  });
}

function cacheFormula(key: string, html: string): void {
  renderedFormulaCache.set(key, html);
  if (renderedFormulaCache.size > MAX_CACHE_ENTRIES) {
    const oldest = renderedFormulaCache.keys().next().value;
    if (oldest !== undefined) {
      renderedFormulaCache.delete(oldest);
    }
  }
}

function renderFormula(fragment: MarkdownMathFragment): string {
  const key = `${fragment.display ? "display" : "inline"}\0${fragment.tex}`;
  const cached = renderedFormulaCache.get(key);
  if (cached !== undefined) {
    renderedFormulaCache.delete(key);
    renderedFormulaCache.set(key, cached);
    return cached;
  }

  try {
    const rawRendered = katex.renderToString(fragment.tex, {
      displayMode: fragment.display,
      output: "mathml",
      throwOnError: true,
      trust: false,
      strict: "ignore",
      maxExpand: 1_000,
      maxSize: 20,
      macros: {},
    });
    if (rawRendered.length > MAX_RENDERED_FORMULA_CHARS) return escapeHtml(fragment.raw);
    const rendered = fragment.display
      ? rawRendered.replace('class="katex"', 'class="katex katex-block"')
      : rawRendered;
    const sanitized = sanitizeKatex(rendered);
    cacheFormula(key, sanitized);
    return sanitized;
  } catch {
    // Never include untrusted formula text or exception messages in logs.
    return escapeHtml(fragment.raw);
  }
}

/** Restores MathML only into text nodes; attribute placeholders become raw text. */
export function restoreMarkdownMath(
  html: string,
  fragments: readonly MarkdownMathFragment[],
): string {
  if (fragments.length === 0) {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;

  // A formula-looking link destination remains a destination, never markup.
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of element.attributes) {
      let value = attribute.value;
      for (const fragment of fragments) {
        value = value.replaceAll(fragment.token, fragment.raw);
      }
      if (value !== attribute.value) {
        element.setAttribute(attribute.name, value);
      }
    }
  }

  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(template.content, 4);
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const textNode of textNodes) {
    const value = textNode.data;
    const isCodeText = Boolean(textNode.parentElement?.closest("code, pre"));
    let cursor = 0;
    let replaced = false;
    const replacement = document.createDocumentFragment();

    while (cursor < value.length) {
      let next: { fragment: MarkdownMathFragment; index: number } | null = null;
      for (const fragment of fragments) {
        const index = value.indexOf(fragment.token, cursor);
        if (index !== -1 && (!next || index < next.index)) {
          next = { fragment, index };
        }
      }
      if (!next) {
        break;
      }

      replacement.append(value.slice(cursor, next.index));
      if (isCodeText) {
        // Markdown can create code blocks that the source-level fence scanner
        // cannot recognize on its own (for example indented code or an
        // incomplete nested blockquote fence). Keep placeholders literal at
        // the DOM restoration boundary so code never flickers into MathML.
        replacement.append(next.fragment.raw);
      } else {
        const rendered = document.createElement("template");
        rendered.innerHTML = renderFormula(next.fragment);
        replacement.append(rendered.content.cloneNode(true));
      }
      cursor = next.index + next.fragment.token.length;
      replaced = true;
    }

    if (replaced) {
      replacement.append(value.slice(cursor));
      textNode.replaceWith(replacement);
    }
  }

  return template.innerHTML;
}
