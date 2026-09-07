import type { ControlUiHost } from 'openclaw/plugin-sdk/control-ui';

const CHUNK_BYTES = 512 * 1_024;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export class FileDownloadError extends Error {
  constructor(readonly code: unknown) { super('File download was refused.'); }
}

/** Only known safe codes become UI messages; never expose raw RPC exceptions. */
export function fileActionFailureMessage(error: unknown): string {
  if (error instanceof FileDownloadError) switch (error.code) {
    case 'outside-allowed-roots': return 'This session’s file policy does not allow access to this folder.';
    case 'file-unavailable': return 'This file is missing or the Gateway cannot read it.';
    case 'not-a-file': return 'This link points to a folder or another non-file item.';
    case 'file-changed': return 'This file changed during download. Click the link again.';
    case 'stale-preview': return 'The session or its file permissions changed. Click the link again.';
  }
  return 'Could not open or download this file. Check its path, session file permissions and Gateway connection.';
}

/** Download arbitrary bytes using the operator's existing authenticated RPC connection. */
export async function downloadSessionFile(host: ControlUiHost, params: Record<string, unknown>, document: Document, current: () => boolean): Promise<void> {
  const view = document.defaultView!;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0, size: number | undefined, revision: string | undefined, name: string | undefined;
  do {
    if (!current()) return;
    const result = await host.request('dashboardExtras.readLocalFile', { ...params, offset, ...(revision ? { expectedRevision: revision } : {}) });
    if (!current()) return;
    if (record(result) && result.read === false) throw new FileDownloadError(result.code);
    if (!record(result) || result.read !== true || !integer(result.size) || result.offset !== offset || !integer(result.nextOffset) ||
        result.nextOffset > result.size || result.nextOffset - offset > CHUNK_BYTES ||
        (result.nextOffset <= offset && result.size !== 0) || typeof result.revision !== 'string' || !/^[a-f0-9]{64}$/.test(result.revision) ||
        typeof result.name !== 'string' || !result.name || /[\/\\\x00-\x1f\x7f]/u.test(result.name) ||
        typeof result.data !== 'string' || result.data.length > Math.ceil(CHUNK_BYTES / 3) * 4 ||
        (size !== undefined && (result.size !== size || result.revision !== revision || result.name !== name))) throw new Error('File download was refused or changed.');
    const decoded = view.atob(result.data);
    if (decoded.length !== result.nextOffset - offset) throw new Error('Incomplete file download.');
    chunks.push(Uint8Array.from(decoded, char => char.charCodeAt(0)));
    offset = result.nextOffset; size = result.size; revision = result.revision; name = result.name;
  } while (offset < size);
  if (!current()) return;
  // Force a download even for HTML/PDF. Never navigate to or execute the contents.
  const url = view.URL.createObjectURL(new view.Blob(chunks, { type: 'application/octet-stream' }));
  const link = document.createElement('a'); link.href = url; link.download = name!; link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); view.setTimeout(() => view.URL.revokeObjectURL(url), 30_000); }
}
