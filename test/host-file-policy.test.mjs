import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { resolveHostPackage } from '../scripts/typecheck.mjs';
import { createApi, invoke, loadBackend } from './backend-fixture.mjs';

// Real public host policy and filesystem helpers, synthetic config/session/files.
// Isolate the host's derived state roots from the operator's actual installation.
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-host-policy-'));
process.env.OPENCLAW_STATE_DIR = path.join(fixture, 'state');
process.env.OPENCLAW_CONFIG_PATH = path.join(fixture, 'config.json');
after(() => fs.rm(fixture, { recursive: true, force: true }));
const requireHost = createRequire(path.join(resolveHostPackage().root, 'package.json'));
const sdk = Object.assign({}, ...await Promise.all([
  'agent-scope-runtime', 'media-local-roots', 'security-runtime',
].map(name => import(pathToFileURL(requireHost.resolve(`openclaw/plugin-sdk/${name}`)).href))));
const backend = await loadBackend();
const workspace = path.join(fixture, 'workspace');
const outputs = path.join(fixture, 'outputs # with spaces');
await fs.mkdir(workspace); await fs.mkdir(outputs);
const file = path.join(outputs, 'report # ü.unknown ');
const bytes = Buffer.from('synthetic report\0arbitrary bytes\xff', 'latin1');
await fs.writeFile(file, bytes);
const request = {
  sessionKey: 'agent:main:test', agentId: 'main', path: file,
  expectedSessionId: 'session-1', expectedRoot: workspace, offset: 0,
};
function fixtureApi(globalTools, agentTools) {
  const result = createApi(workspace);
  result.state.config = {
    testRoots: [workspace],
    agents: { defaults: { workspace }, list: [{ id: 'main', ...(agentTools ? { tools: agentTools } : {}) }] },
    tools: globalTools,
  };
  return result;
}
const deps = { loadSdk: async () => sdk };

test('real host policy permits a concrete file outside the session workspace without changing the workspace', async () => {
  const { api, methods } = fixtureApi({ fs: { workspaceOnly: false } });
  backend.registerDashboardExtras(api, deps);
  const caps = await invoke(methods, 'dashboardExtras.capabilities', { sessionKey: request.sessionKey, agentId: request.agentId });
  assert.equal(caps.root, workspace);
  const read = await backend.readLocalFileFromDashboard(api, request, deps);
  assert.equal(read.read, true, JSON.stringify(read));
  assert.deepEqual(Buffer.from(read.data, 'base64'), bytes);
  assert.equal(read.name, path.basename(file));
  let launched = false;
  const opened = await backend.openLocalFileFromDashboard(api, request, {
    ...deps, platform: 'darwin',
    createFileReference: async () => `file:///.file/id=1.${(await fs.stat(file, { bigint: true })).ino}`,
    launch: async () => { launched = true; },
  });
  assert.deepEqual(opened, { opened: true }); assert.equal(launched, true);
});

test('real host workspace restrictions and global/agent read policies still refuse outside files', async () => {
  for (const [globalTools, agentTools] of [
    [{ fs: { workspaceOnly: true } }],
    [{ fs: { workspaceOnly: false } }, { fs: { workspaceOnly: true } }],
    [{ fs: { workspaceOnly: false }, deny: ['read'] }],
    [{ fs: { workspaceOnly: false } }, { deny: ['read'] }],
    [{ fs: { workspaceOnly: false }, profile: 'minimal' }],
  ]) {
    const { api } = fixtureApi(globalTools, agentTools);
    const result = await backend.readLocalFileFromDashboard(api, request, deps);
    assert.equal(result.read, false); assert.equal(result.code, 'outside-allowed-roots');
    assert.equal(result.data, undefined);
  }
  const { api } = fixtureApi({ fs: { workspaceOnly: true } }, { fs: { workspaceOnly: false } });
  assert.equal((await backend.readLocalFileFromDashboard(api, request, deps)).read, true);
});

test('a host policy restriction introduced during file IO revokes the source-derived permission', async () => {
  const { api, state } = fixtureApi({ fs: { workspaceOnly: false } });
  const get = api.runtime.agent.session.getSessionEntry;
  let calls = 0;
  api.runtime.agent.session.getSessionEntry = params => {
    if (++calls > 1) state.config.tools.fs.workspaceOnly = true;
    return get(params);
  };
  const result = await backend.readLocalFileFromDashboard(api, request, deps);
  assert.equal(result.read, false); assert.equal(result.code, 'stale-preview');
  assert.equal(result.data, undefined);
});
