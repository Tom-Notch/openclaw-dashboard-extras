import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { resolveHostPackage, resolvePublicSdkTypePaths } from '../scripts/typecheck.mjs';

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-typecheck-'));
after(() => fs.rm(fixture, { recursive: true, force: true }));

async function makeHost(name) {
  const root = path.join(fixture, name);
  await fs.mkdir(path.join(root, 'bin'), { recursive: true });
  await fs.mkdir(path.join(root, 'public-types'));
  const cli = path.join(root, 'bin', 'openclaw');
  await fs.writeFile(cli, '#!/usr/bin/env node\n', { mode: 0o755 });
  const pkg = { name: 'openclaw', version: '2099.1.0', exports: {
    './plugin-sdk/control-ui': { types: './public-types/control-ui.d.ts', default: './runtime.js' },
    './plugin-sdk/runtime-only': { default: './runtime.js' },
    './plugin-sdk/unsafe': { types: '../escape.d.ts' },
  } };
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(path.join(root, 'public-types', 'control-ui.d.ts'), 'export type Host = { apiVersion: 1 };');
  return { root, cli, pkg };
}

test('finds the real host package through PATH and an executable symlink', async () => {
  const host = await makeHost('path-host');
  const bin = path.join(fixture, 'path-bin');
  await fs.mkdir(bin);
  await fs.symlink(host.cli, path.join(bin, 'openclaw'));
  const resolved = resolveHostPackage({ env: { PATH: bin } });
  assert.equal(resolved.root, await fs.realpath(host.root));
  assert.equal(resolved.packageJson.name, 'openclaw');
  assert.equal(resolved.packageJson.version, '2099.1.0');
});

test('explicit CLI takes precedence and unrelated executables are rejected', async () => {
  const host = await makeHost('explicit-host');
  assert.equal(resolveHostPackage({ env: { OPENCLAW_CLI: host.cli, PATH: '' } }).root, await fs.realpath(host.root));
  const unrelated = path.join(fixture, 'unrelated');
  await fs.writeFile(unrelated, '#!/usr/bin/env node\n', { mode: 0o755 });
  assert.throws(() => resolveHostPackage({ cli: unrelated, env: {} }), /OpenClaw package/);
  assert.throws(() => resolveHostPackage({ env: { PATH: '' } }), /OpenClaw CLI/);
});

test('type paths come only from existing confined public export declarations', async () => {
  const host = await makeHost('typed-host');
  const resolved = resolveHostPackage({ cli: host.cli });
  const paths = resolvePublicSdkTypePaths(resolved, ['openclaw/plugin-sdk/control-ui']);
  assert.deepEqual(paths, { 'openclaw/plugin-sdk/control-ui': [await fs.realpath(path.join(host.root, 'public-types/control-ui.d.ts'))] });
  for (const name of ['runtime-only', 'unsafe', 'missing']) {
    assert.throws(() => resolvePublicSdkTypePaths(resolved, [`openclaw/plugin-sdk/${name}`]), /public type export/);
  }
  const outside = path.join(fixture, 'outside.d.ts');
  await fs.writeFile(outside, 'export type Outside = never;');
  await fs.symlink(outside, path.join(host.root, 'public-types', 'escape.d.ts'));
  resolved.packageJson.exports['./plugin-sdk/symlink'] = { types: './public-types/escape.d.ts' };
  assert.throws(() => resolvePublicSdkTypePaths(resolved, ['openclaw/plugin-sdk/symlink']), /public type export/);
  assert.throws(() => resolvePublicSdkTypePaths(resolved, ['openclaw/dist/private.js']), /public SDK import/);
});
