/** Classify destinations, not file types. The Gateway owns all authorization. */
export function localFileFromAnchor(anchor: HTMLAnchorElement): string | null {
  // Let native session navigation and ordinary web/email links keep their owners.
  if (anchor.hasAttribute('data-session-key') || anchor.hasAttribute('data-session-link')) return null;
  const nativePath = anchor.getAttribute('data-file-path');
  if (nativePath) return valid(nativePath) ? nativePath : null;
  const href = anchor.getAttribute('href');
  if (!href || href.startsWith('#') || href.startsWith('//') || !valid(href)) return null;
  if (/^file:\/\//iu.test(href)) {
    try {
      const url = new URL(href);
      if ((url.hostname && url.hostname !== 'localhost') || url.username || url.password || url.port || url.search || url.hash) return null;
      const file = decodeURIComponent(url.pathname);
      return valid(file) ? file : null;
    } catch { return null; }
  }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href)) return null;
  // Scheme-less Markdown destinations are session-local paths. No extension
  // list, preview-kind checks, home-name guessing, or wildcard expansion.
  try { const decoded = decodeURIComponent(href); return valid(decoded) ? decoded : null; }
  catch { return null; }
}
function valid(value: string): boolean {
  return value.length <= 8_192 && !/[\x00-\x1f\x7f\\]/u.test(value) && !value.startsWith('//');
}
