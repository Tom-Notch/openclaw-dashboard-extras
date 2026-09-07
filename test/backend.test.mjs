import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fstatSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createApi, invoke, loadBackend } from './backend-fixture.mjs';

const backend = await loadBackend();
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-backend-'));
after(() => fs.rm(workspace, { recursive: true, force: true }));
const request = (root, overrides = {}) => ({
  sessionKey: 'agent:main:test', agentId: 'main', path: 'report.txt',
  expectedSessionId: 'session-1', expectedRoot: root, ...overrides,
});
const referenceFor = async file => `file:///.file/id=1.${(await fs.stat(file, { bigint: true })).ino}`;

test('future host versions retain explicit read/admin profile authorization', async () => {
  for (const version of ['2026.9.2', '2026.9.3', '2027.1.0']) {
    const { api, methods } = createApi(workspace, { version });
    backend.registerDashboardExtras(api, { platform: 'darwin' });
    assert.deepEqual(methods.get('dashboardExtras.capabilities').policy, { scope: 'operator.read', profileAccess: 'required' });
    assert.deepEqual(methods.get('dashboardExtras.openLocalFile').policy, { scope: 'operator.admin', profileAccess: 'required' });
    assert.deepEqual(await invoke(methods, 'dashboardExtras.capabilities'), { nativeOpen: true, download: true, localClient: true });
  }
});

test('invalid/old hosts and missing registration APIs fail closed without throwing', () => {
  for (const version of ['2026.9.1', '2026.8.9', 'unknown', '2026.9.2-beta.1']) {
    const { api, methods } = createApi(workspace, { version });
    assert.doesNotThrow(() => backend.registerDashboardExtras(api));
    assert.equal(methods.has('dashboardExtras.openLocalFile'), false);
  }
  assert.doesNotThrow(() => backend.registerDashboardExtras({}));
});

test('unsupported platform, missing runtime and missing SDK report unavailable', async () => {
  for (const mode of ['platform', 'runtime', 'sdk']) {
    const { api, methods } = createApi(workspace);
    if (mode === 'runtime') delete api.runtime.agent.session.getSessionEntry;
    backend.registerDashboardExtras(api, {
      platform: mode === 'platform' ? 'linux' : 'darwin',
      ...(mode === 'sdk' ? { loadSdk: async () => undefined } : {}),
    });
    assert.deepEqual(await invoke(methods, 'dashboardExtras.capabilities'), { nativeOpen: false, localClient: true, ...(mode === 'platform' ? { download: true } : {}) });
    if (methods.has('dashboardExtras.openLocalFile')) {
      assert.equal((await invoke(methods, 'dashboardExtras.openLocalFile', request(workspace))).opened, false);
    }
  }
});

test('scoped capabilities expose only current local session id and root', async () => {
  const { api, state, methods } = createApi(workspace);
  backend.registerDashboardExtras(api, { platform: 'darwin' });
  assert.deepEqual(await invoke(methods, 'dashboardExtras.capabilities', { sessionKey: 'agent:main:test', agentId: 'main' }), {
    nativeOpen: true, download: true, localClient: true, sessionId: 'session-1', root: workspace,
  });
  for (const params of [{ sessionKey: 'agent:main:test', agentId: 'other' }, { sessionKey: '' }, null, { agentId: 'main' }]) {
    assert.deepEqual(await invoke(methods, 'dashboardExtras.capabilities', params), { nativeOpen: false, localClient: true });
  }
  state.entry.execHost = 'node';
  assert.deepEqual(await invoke(methods, 'dashboardExtras.capabilities', { sessionKey: 'agent:main:test' }), { nativeOpen: false, localClient: true });
});

test('retargeting an allowed root during helper work revokes the old descriptor grant', async () => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-root-identity-'));
  try {
    const original = path.join(fixture, 'original');
    const replacement = path.join(fixture, 'replacement');
    const alias = path.join(fixture, 'allowed');
    await fs.mkdir(original);
    await fs.mkdir(replacement);
    await fs.writeFile(path.join(original, 'report.txt'), 'original');
    await fs.symlink(original, alias);
    const { api } = createApi(alias);
    const result = await backend.openLocalFileFromDashboard(api, request(alias), {
      platform: 'darwin',
      createFileReference: async () => {
        await fs.unlink(alias);
        await fs.symlink(replacement, alias);
        return referenceFor(path.join(original, 'report.txt'));
      },
      launch: async () => {},
    });
    assert.deepEqual(result, { opened: false, code: 'stale-preview', reason: 'The file could not be opened safely.' });
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
});

test('regular filenames preserve spaces and open through an inode-bound reference', async () => {
  const { api } = createApi(workspace);
  const file = path.join(workspace, ' -report ü.txt ');
  await fs.writeFile(file, 'synthetic content');
  let descriptor;
  let launched;
  const result = await backend.openLocalFileFromDashboard(api, request(workspace, { path: path.basename(file) }), {
    platform: 'darwin',
    createFileReference: async fd => { descriptor = fd; return referenceFor(file); },
    launch: async reference => { launched = reference; },
  });
  assert.deepEqual(result, { opened: true });
  assert.equal(launched, await referenceFor(file));
  assert.throws(() => fstatSync(descriptor), { code: 'EBADF' });
});

test('stale, remote, invalid, outside and non-file requests never launch', async () => {
  const file = path.join(workspace, 'report.txt');
  await fs.writeFile(file, 'synthetic');
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-outside-'));
  try {
    await fs.writeFile(path.join(outside, 'report.txt'), 'outside');
    await fs.symlink(outside, path.join(workspace, 'escape'));
    for (const [params, expected] of [
      [request(workspace, { expectedSessionId: 'stale' }), 'stale-preview'],
      [request(workspace, { expectedRoot: outside }), 'stale-preview'],
      [request(workspace, { agentId: 'other' }), 'invalid-request'],
      [request(workspace, { path: '\0bad' }), 'invalid-request'],
      [request(workspace, { path: path.join(outside, 'report.txt') }), 'outside-allowed-roots'],
      [request(workspace, { path: 'escape/report.txt' }), 'outside-allowed-roots'],
      [request(workspace, { path: '.' }), 'not-a-file'],
      [request(workspace, { path: 'missing.txt' }), 'file-unavailable'],
    ]) {
      const { api } = createApi(workspace);
      const result = await backend.openLocalFileFromDashboard(api, params, { platform: 'darwin', launch: async () => assert.fail('must not launch') });
      assert.equal(result.code, expected);
    }
    const { api, state } = createApi(workspace);
    state.entry.execNode = 'remote';
    assert.equal((await backend.openLocalFileFromDashboard(api, request(workspace), { platform: 'darwin' })).code, 'remote-session');
  } finally { await fs.rm(outside, { recursive: true, force: true }); }
});

test('session and configuration revocation during helper await are rechecked', async () => {
  const file = path.join(workspace, 'report.txt');
  await fs.writeFile(file, 'synthetic');
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-revoked-'));
  try {
    for (const change of ['session', 'root']) {
      const { api, state } = createApi(workspace);
      const result = await backend.openLocalFileFromDashboard(api, request(workspace), {
        platform: 'darwin',
        createFileReference: async () => {
          if (change === 'session') state.entry = { ...state.entry, sessionId: 'replacement' };
          else { state.config = { testRoots: [other] }; state.entry = { sessionId: 'session-1' }; }
          return referenceFor(file);
        },
        launch: async () => assert.fail('revoked operation must not launch'),
      });
      assert.equal(result.opened, false);
    }
  } finally { await fs.rm(other, { recursive: true, force: true }); }
});

test('untrusted helper results and launch failures are sanitized', async () => {
  const file = path.join(workspace, 'report.txt');
  await fs.writeFile(file, 'synthetic');
  const { api } = createApi(workspace);
  for (const reference of ['file:///tmp/file.txt', 'file:///.file/id=1.99999999999999', 'https://example.invalid/']) {
    assert.equal((await backend.openLocalFileFromDashboard(api, request(workspace), {
      platform: 'darwin', createFileReference: async () => reference,
      launch: async () => assert.fail('invalid references must not launch'),
    })).code, 'unsafe-path');
  }
  const result = await backend.openLocalFileFromDashboard(api, request(workspace), {
    platform: 'darwin', createFileReference: () => referenceFor(file),
    launch: async () => { throw Error(`private path ${workspace}`); },
  });
  assert.equal(result.code, 'open-failed');
  assert.equal(JSON.stringify(result).includes(workspace), false);
});

test('macOS Foundation follows the validated descriptor after path replacement', { skip: process.platform !== 'darwin' }, async () => {
  const file = path.join(workspace, 'native-reference.txt');
  const moved = path.join(workspace, 'native-reference-moved.txt');
  await fs.writeFile(file, 'original');
  const { api } = createApi(workspace);
  let originalReference;
  const result = await backend.openLocalFileFromDashboard(api, request(workspace, { path: path.basename(file) }), {
    platform: 'darwin',
    createFileReference: async fd => {
      await fs.rename(file, moved);
      await fs.writeFile(file, 'replacement');
      originalReference = await backend.createMacOSFileReference(fd);
      return originalReference;
    },
    launch: async reference => { assert.equal(reference, originalReference); },
  });
  assert.deepEqual(result, { opened: true });
  assert.equal(originalReference.split('.').at(-1), String((await fs.stat(moved, { bigint: true })).ino));
});

test('backend source does not import private session-key or host internals', async () => {
  const source = await fs.readFile(new URL('../src/open-local-file.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /session-key-runtime|openclaw\/dist|\/src\/agents/);
  assert.match(source, /resolveSessionAgentIdStrict/);
});

test('official authoring metadata declares RPC-only activation and the actual config schema', async () => {
  const symbols = Object.getOwnPropertySymbols(backend.default);
  const metadata = symbols.map(symbol => backend.default[symbol]).find(value => value?.id === 'dashboard-extras');
  assert.ok(metadata, 'the official plugin builder needs public authoring metadata');
  assert.deepEqual(metadata.tools, []);
  assert.deepEqual(metadata.activation, { onStartup: true });
  const manifest = JSON.parse(await fs.readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));
  assert.deepEqual(metadata.configSchema, manifest.configSchema);
  assert.deepEqual(backend.default.configSchema.jsonSchema, manifest.configSchema);
  assert.equal(Object.getOwnPropertyDescriptor(backend.default, symbols[0]).enumerable, false);
  const source = await fs.readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(source, /from ['"]openclaw\/plugin-sdk\/tool-plugin['"]/);
  assert.doesNotMatch(source, /Symbol\.for/);
});
