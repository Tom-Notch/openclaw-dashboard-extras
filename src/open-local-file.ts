import { execFile, spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { OpenClawConfig, OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';

type SecuritySdk = typeof import('openclaw/plugin-sdk/security-runtime');
export type NativeOpenSdk = Pick<SecuritySdk, 'FsSafeError' | 'openLocalFileSafely' | 'resolveLocalPathFromRootsSync'> & {
  resolveSessionAgentIdStrict: typeof import('openclaw/plugin-sdk/agent-scope-runtime').resolveSessionAgentIdStrict;
  getAgentScopedMediaLocalRoots: typeof import('openclaw/plugin-sdk/media-local-roots').getAgentScopedMediaLocalRoots;
};
export type NativeOpenDeps = {
  platform?: NodeJS.Platform;
  loadSdk?: () => Promise<NativeOpenSdk | undefined>;
  createFileReference?: (fd: number) => Promise<string>;
  launch?: (reference: string) => Promise<void>;
};
type FailureCode = 'invalid-request' | 'unsupported-platform' | 'unsupported-runtime' | 'session-unavailable' |
  'stale-preview' | 'remote-session' | 'outside-allowed-roots' | 'file-unavailable' | 'not-a-file' | 'unsafe-path' | 'open-failed';
export type DashboardOpenLocalFileResult = { opened: true } | { opened: false; code: FailureCode; reason: string };
export type DashboardCapabilities = { nativeOpen: boolean; sessionId?: string; root?: string };
type SessionRequest = { sessionKey: string; agentId?: string };
type OpenRequest = SessionRequest & { requestedPath: string; expectedSessionId: string; expectedRoot: string };
const MAX_PATH_LENGTH = 8_192;
const FILE_REFERENCE_PATTERN = /^file:\/\/\/\.file\/id=([0-9]+)\.([0-9]+)$/;
const FILE_REFERENCE_SCRIPT = 'ObjC.import("Foundation"); ObjC.unwrap($.NSURL.fileURLWithPath("/dev/fd/3").fileReferenceURL.absoluteString);';
const failure = (code: FailureCode, reason = 'The file could not be opened safely.'): DashboardOpenLocalFileResult => ({ opened: false, code, reason });

/** A security API floor, not an exact host pin or an upper version ceiling. */
export function isSupportedHost(api: OpenClawPluginApi): boolean {
  try {
    const raw = api?.runtime?.version;
    if (typeof raw !== 'string') return false;
    // Numeric correction releases and build metadata are accepted; unknown prereleases fail closed.
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-\d+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
    if (!match) return false;
    const parts = match.slice(1, 4).map(Number);
    if (!parts.every(Number.isSafeInteger)) return false;
    const floor = [2026, 9, 2];
    for (let index = 0; index < floor.length; index++) {
      if (parts[index] !== floor[index]) return parts[index] > floor[index];
    }
    return true;
  } catch { return false; }
}

export function supportsNativeOpenRuntime(api: OpenClawPluginApi): boolean {
  try {
    return isSupportedHost(api) && typeof api.runtime.config?.current === 'function' &&
      typeof api.runtime.agent?.resolveAgentWorkspaceDir === 'function' &&
      typeof api.runtime.agent?.session?.getSessionEntry === 'function';
  } catch { return false; }
}

let sdkPromise: Promise<NativeOpenSdk | undefined> | undefined;
async function loadNativeOpenSdk(): Promise<NativeOpenSdk | undefined> {
  sdkPromise ??= Promise.all([
    import('openclaw/plugin-sdk/agent-scope-runtime'),
    import('openclaw/plugin-sdk/media-local-roots'),
    import('openclaw/plugin-sdk/security-runtime'),
  ]).then(([scope, media, security]) => ({
    resolveSessionAgentIdStrict: scope.resolveSessionAgentIdStrict,
    getAgentScopedMediaLocalRoots: media.getAgentScopedMediaLocalRoots,
    FsSafeError: security.FsSafeError,
    openLocalFileSafely: security.openLocalFileSafely,
    resolveLocalPathFromRootsSync: security.resolveLocalPathFromRootsSync,
  })).catch(() => undefined);
  return sdkPromise;
}

async function resolveSdk(deps: NativeOpenDeps): Promise<NativeOpenSdk | undefined> {
  try {
    const sdk = await (deps.loadSdk ?? loadNativeOpenSdk)();
    if (!sdk || !['resolveSessionAgentIdStrict', 'getAgentScopedMediaLocalRoots', 'FsSafeError',
      'openLocalFileSafely', 'resolveLocalPathFromRootsSync'].every(key => typeof sdk[key as keyof NativeOpenSdk] === 'function')) return undefined;
    return sdk;
  } catch { return undefined; }
}

function validText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= limit && !value.includes('\0');
}
function parseSessionRequest(params: unknown): SessionRequest | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const raw = params as Record<string, unknown>;
  if (!validText(raw.sessionKey, 4_096) || (raw.agentId !== undefined && !validText(raw.agentId, 128))) return undefined;
  return { sessionKey: raw.sessionKey.trim(), ...(typeof raw.agentId === 'string' ? { agentId: raw.agentId.trim() } : {}) };
}
function parseOpenRequest(params: unknown): OpenRequest | undefined {
  const session = parseSessionRequest(params);
  if (!session) return undefined;
  const raw = params as Record<string, unknown>;
  if (!validText(raw.path, MAX_PATH_LENGTH) || !validText(raw.expectedSessionId, 512) ||
    !validText(raw.expectedRoot, MAX_PATH_LENGTH) || !path.isAbsolute(raw.expectedRoot)) return undefined;
  // Do not trim paths: leading/trailing spaces can be part of a legitimate filename.
  return { ...session, requestedPath: raw.path, expectedSessionId: raw.expectedSessionId.trim(), expectedRoot: raw.expectedRoot };
}

function resolveBinding(api: OpenClawPluginApi, sdk: NativeOpenSdk, request: SessionRequest) {
  const cfg = api.runtime.config.current() as OpenClawConfig;
  const agentId = sdk.resolveSessionAgentIdStrict({ config: cfg, sessionKey: request.sessionKey, agentId: request.agentId });
  const entry = api.runtime.agent.session.getSessionEntry({ agentId, sessionKey: request.sessionKey, readConsistency: 'latest' });
  if (!entry || !validText(entry.sessionId, 512)) return undefined;
  const configuredWorkspace = api.runtime.agent.resolveAgentWorkspaceDir(cfg, agentId);
  const root = entry.spawnedWorkspaceDir ?? entry.spawnedCwd ?? configuredWorkspace;
  if (!validText(root, MAX_PATH_LENGTH) || !path.isAbsolute(root)) return undefined;
  const roots = [...sdk.getAgentScopedMediaLocalRoots(cfg, agentId), configuredWorkspace, entry.spawnedWorkspaceDir, entry.spawnedCwd];
  return { agentId, entry, root, roots: [...new Set(roots.filter((root): root is string => validText(root, MAX_PATH_LENGTH) && path.isAbsolute(root)).map(root => path.resolve(root)))] };
}
type Binding = NonNullable<ReturnType<typeof resolveBinding>>;
function isRemote(binding: Binding): boolean { return Boolean(binding.entry.execNode) || binding.entry.execHost === 'node'; }
function matches(binding: Binding, request: OpenRequest): boolean {
  return binding.entry.sessionId === request.expectedSessionId && path.resolve(binding.root) === path.resolve(request.expectedRoot) && !isRemote(binding);
}

/** Capture filesystem identities, not just root spellings that could be retargeted. */
function captureRootIdentities(roots: readonly string[]): string {
  return JSON.stringify([...roots].sort().map(root => {
    try {
      const canonical = realpathSync(root);
      const stat = statSync(canonical, { bigint: true });
      return [root, canonical, stat.dev.toString(), stat.ino.toString(), stat.isDirectory()];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return [root, null];
      throw error;
    }
  }));
}

export async function getDashboardCapabilities(api: OpenClawPluginApi, params: unknown, deps: NativeOpenDeps = {}): Promise<DashboardCapabilities> {
  const unavailable = { nativeOpen: false };
  if ((deps.platform ?? process.platform) !== 'darwin' || !supportsNativeOpenRuntime(api)) return unavailable;
  const sdk = await resolveSdk(deps);
  if (!sdk) return unavailable;
  if (params === undefined || (params && typeof params === 'object' && !Array.isArray(params) && Object.keys(params).length === 0)) return { nativeOpen: true };
  const request = parseSessionRequest(params);
  if (!request) return unavailable;
  try {
    const binding = resolveBinding(api, sdk, request);
    return !binding || isRemote(binding) ? unavailable : { nativeOpen: true, sessionId: binding.entry.sessionId, root: binding.root };
  } catch { return unavailable; }
}

/** Foundation receives only the previously validated descriptor, inherited as FD 3. */
export async function createMacOSFileReference(openedFd: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', FILE_REFERENCE_SCRIPT], {
      shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', openedFd],
    });
    if (!child.stdout || !child.stderr) { child.kill('SIGKILL'); reject(new Error('File-reference helper failed.')); return; }
    const output: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = false;
    const kill = () => { failed = true; child.kill('SIGKILL'); };
    const timeout = setTimeout(kill, 10_000);
    timeout.unref?.();
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 4_096) kill(); else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.byteLength; if (stderrBytes > 4_096) kill(); });
    child.once('error', () => { clearTimeout(timeout); reject(new Error('File-reference helper failed.')); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (failed || code !== 0 || stderrBytes > 0) reject(new Error('File-reference helper failed.'));
      else resolve(Buffer.concat(output).toString('utf8').trim());
    });
  });
}

export async function launchMacOSDefaultApplication(reference: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/open', ['--', reference], { shell: false, timeout: 10_000, maxBuffer: 64 * 1_024, windowsHide: true },
      error => error ? reject(new Error('Native application launch failed.')) : resolve());
  });
}

function validateFileReference(reference: string, inode: bigint): boolean {
  if (typeof reference !== 'string' || reference.length > 512) return false;
  const match = FILE_REFERENCE_PATTERN.exec(reference);
  try { return Boolean(match?.[2]) && BigInt(match![2]) === inode; } catch { return false; }
}

/** Authenticated admin RPC owner validates server policy before any native side effect. */
export async function openLocalFileFromDashboard(api: OpenClawPluginApi, params: unknown, deps: NativeOpenDeps = {}): Promise<DashboardOpenLocalFileResult> {
  if ((deps.platform ?? process.platform) !== 'darwin') return failure('unsupported-platform');
  if (!supportsNativeOpenRuntime(api)) return failure('unsupported-runtime');
  const request = parseOpenRequest(params);
  if (!request) return failure('invalid-request');
  const sdk = await resolveSdk(deps);
  if (!sdk) return failure('unsupported-runtime');
  let binding;
  try { binding = resolveBinding(api, sdk, request); } catch { return failure('invalid-request'); }
  if (!binding) return failure('session-unavailable');
  if (isRemote(binding)) return failure('remote-session');
  if (!matches(binding, request)) return failure('stale-preview');
  let rootIdentities: string;
  try { rootIdentities = captureRootIdentities(binding.roots); } catch { return failure('unsafe-path'); }
  const candidate = path.isAbsolute(request.requestedPath) ? path.normalize(request.requestedPath) : path.resolve(binding.root, request.requestedPath);
  let contained;
  try {
    contained = sdk.resolveLocalPathFromRootsSync({ filePath: candidate, roots: binding.roots, label: 'dashboard file roots', allowMissing: true });
  } catch { return failure('unsafe-path'); }
  if (!contained) return failure('outside-allowed-roots');
  let opened;
  try { opened = await sdk.openLocalFileSafely({ filePath: contained.path }); }
  catch (error) {
    if (error instanceof sdk.FsSafeError) {
      if (error.code === 'not-file') return failure('not-a-file');
      if (['symlink', 'path-alias', 'path-mismatch', 'outside-workspace', 'device-path'].includes(error.code)) return failure('unsafe-path');
    }
    return failure('file-unavailable');
  }
  try {
    if (!opened.stat.isFile()) return failure('not-a-file');
    const finalContainment = sdk.resolveLocalPathFromRootsSync({ filePath: opened.realPath, roots: binding.roots, label: 'dashboard file roots', requireFile: true });
    if (!finalContainment || finalContainment.path !== opened.realPath) return failure('outside-allowed-roots');
    const stat = await opened.handle.stat({ bigint: true });
    const reference = await (deps.createFileReference ?? createMacOSFileReference)(opened.handle.fd);
    if (!validateFileReference(reference, stat.ino)) return failure('unsafe-path');
    // Re-read BOTH session incarnation and current config/root policy after awaited work.
    if (!supportsNativeOpenRuntime(api)) return failure('unsupported-runtime');
    const latest = resolveBinding(api, sdk, request);
    if (!latest || latest.agentId !== binding.agentId || !matches(latest, request)) return failure('stale-preview');
    // Validate the immutable root grant again. A changed pathname must never replace the pinned inode.
    if (latest.roots.length !== binding.roots.length || latest.roots.some(root => !binding.roots.includes(root))) return failure('stale-preview');
    if (captureRootIdentities(latest.roots) !== rootIdentities) return failure('stale-preview');
    await (deps.launch ?? launchMacOSDefaultApplication)(reference);
    return { opened: true };
  } catch { return failure('open-failed'); }
  finally { await opened.handle.close().catch(() => {}); }
}
