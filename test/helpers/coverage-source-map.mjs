import { fileURLToPath } from 'node:url';

/** Normalize Node's cached source identities only; never rewrite execution evidence. */
export function normalizeCoverageSourceMaps(raw) {
  const normalized = structuredClone(raw);
  for (const cached of Object.values(normalized['source-map-cache'] ?? {})) {
    if (!Array.isArray(cached?.data?.sources)) continue;
    cached.data.sources = cached.data.sources.map(source =>
      typeof source === 'string' && source.startsWith('file://') ? fileURLToPath(source) : source);
  }
  return normalized;
}
