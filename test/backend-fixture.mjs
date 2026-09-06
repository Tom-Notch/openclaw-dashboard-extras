import { build } from 'esbuild';

// Synthetic SDK contracts: never import the operator's installed host or state.
const sdkFixture = `
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
export function resolveSessionAgentIdStrict({ config, sessionKey, agentId }) {
  const scoped = /^agent:([^:]+):/.exec(sessionKey)?.[1];
  if (scoped && agentId && scoped !== agentId.toLowerCase()) throw Error('owner mismatch');
  return scoped ?? agentId ?? config.testAgent ?? 'main';
}
export function getAgentScopedMediaLocalRoots(cfg) { return cfg.testRoots ?? []; }
export class FsSafeError extends Error { constructor(code) { super(code); this.code = code; } }
export function resolveLocalPathFromRootsSync({ filePath, roots, allowMissing, requireFile }) {
  let target;
  try { target = fs.realpathSync(filePath); }
  catch (error) { if (allowMissing && error.code === 'ENOENT') target = path.resolve(filePath); else throw error; }
  if (!roots.some(root => { const rel = path.relative(fs.realpathSync(root), target); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); })) return undefined;
  if (requireFile && !fs.statSync(target).isFile()) throw new FsSafeError('not-file');
  return { path: target };
}
export async function openLocalFileSafely({ filePath }) {
  let handle;
  try {
    const stat = await fsp.lstat(filePath);
    if (stat.isSymbolicLink()) throw new FsSafeError('symlink');
    if (!stat.isFile()) throw new FsSafeError('not-file');
    handle = await fsp.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    return { handle, stat: await handle.stat(), realPath: await fsp.realpath(filePath) };
  } catch (error) { await handle?.close(); if (error.code === 'ENOENT') throw new FsSafeError('not-found'); throw error; }
}
`;

export async function loadBackend() {
  const result = await build({
    entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'synthetic-sdk', setup(builder) {
      builder.onResolve({ filter: /^openclaw\/plugin-sdk\// }, args => ({ path: args.path, namespace: 'sdk' }));
      builder.onLoad({ filter: /.*/, namespace: 'sdk' }, () => ({ contents: sdkFixture, loader: 'js' }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

export function createApi(root, options = {}) {
  const methods = new Map();
  const logs = [];
  const config = { testRoots: [root], testAgent: 'main' };
  const state = { config, entry: { sessionId: 'session-1', spawnedWorkspaceDir: root } };
  const api = {
    registrationMode: 'full',
    logger: { warn: text => logs.push(text), error: text => logs.push(text) },
    registerGatewayMethod: (name, handler, policy) => methods.set(name, { handler, policy }),
    runtime: {
      version: options.version ?? '2026.9.2',
      config: { current: () => state.config },
      agent: {
        resolveAgentWorkspaceDir: cfg => cfg.testRoots[0],
        session: { getSessionEntry: request => {
          if (request.readConsistency !== 'latest') throw Error('fresh read required');
          return state.entry;
        } },
      },
    },
  };
  return { api, state, methods, logs };
}

export async function invoke(methods, name, params) {
  let response;
  await methods.get(name).handler({ params, respond: (ok, payload) => { response = { ok, payload }; } });
  if (!response?.ok) throw Error('RPC did not respond successfully');
  return response.payload;
}
