import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { after, test } from 'node:test';
import { createApi, invoke, loadBackend } from './backend-fixture.mjs';

const backend = await loadBackend({ mockChildProcess: true });
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-extras-process-'));
after(async () => {
  delete globalThis.__dashboardExtrasTestProcess;
  await fs.rm(workspace, { recursive: true, force: true });
});

function setChild(behavior, { pipes = true } = {}) {
  const child = new EventEmitter();
  child.stdout = pipes ? new PassThrough() : null;
  child.stderr = pipes ? new PassThrough() : null;
  const calls = [];
  child.kill = signal => { calls.push(['kill', signal]); queueMicrotask(() => child.emit('close', 137)); };
  globalThis.__dashboardExtrasTestProcess = {
    spawn: (...args) => { calls.push(args); queueMicrotask(() => behavior?.(child)); return child; },
    execFile: () => assert.fail('helper must not launch an application'),
  };
  return calls;
}

test('Foundation uses static script, inherited descriptor and no shell', async () => {
  const calls = setChild(child => { child.stdout.write('file:///.file/id=1.2\n'); child.emit('close', 0); });
  assert.equal(await backend.createMacOSFileReference(42), 'file:///.file/id=1.2');
  assert.equal(calls[0][0], '/usr/bin/osascript');
  assert.deepEqual(calls[0][1].slice(0, 3), ['-l', 'JavaScript', '-e']);
  assert.match(calls[0][1][3], /\/dev\/fd\/3/);
  assert.equal(calls[0][2].shell, false);
  assert.deepEqual(calls[0][2].stdio, ['ignore', 'pipe', 'pipe', 42]);
});

test('Foundation errors, nonzero exit, stderr and missing pipes fail safely', async () => {
  for (const [behavior, options] of [
    [child => child.emit('error', Error('private path /private/synthetic')), {}],
    [child => child.emit('close', 1), {}],
    [child => { child.stderr.write('private stderr'); child.emit('close', 0); }, {}],
    [undefined, { pipes: false }],
  ]) {
    setChild(behavior, options);
    await assert.rejects(backend.createMacOSFileReference(42), error => {
      assert.equal(error.message, 'File-reference helper failed.');
      return true;
    });
  }
});

test('Foundation output is bounded on both streams', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const calls = setChild(child => child[stream].write(Buffer.alloc(4_097, 'x')));
    await assert.rejects(backend.createMacOSFileReference(42));
    assert.deepEqual(calls.at(-1), ['kill', 'SIGKILL']);
  }
});

test('Foundation timeout terminates its owned child', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = setChild();
  const pending = backend.createMacOSFileReference(42);
  context.mock.timers.tick(10_000);
  await assert.rejects(pending);
  assert.deepEqual(calls.at(-1), ['kill', 'SIGKILL']);
  context.mock.timers.reset();
});

test('default application launch receives only the validated file reference', async () => {
  const file = path.join(workspace, 'report.txt');
  await fs.writeFile(file, 'synthetic');
  const reference = `file:///.file/id=1.${(await fs.stat(file, { bigint: true })).ino}`;
  const { api } = createApi(workspace);
  const request = { sessionKey: 'agent:main:test', path: 'report.txt', expectedSessionId: 'session-1', expectedRoot: workspace };
  for (const shouldFail of [false, true]) {
    let call;
    globalThis.__dashboardExtrasTestProcess = {
      spawn: () => assert.fail('descriptor helper injected separately'),
      execFile: (command, args, options, callback) => {
        call = { command, args, options };
        callback(shouldFail ? Error(`private ${workspace}`) : null);
      },
    };
    const result = await backend.openLocalFileFromDashboard(api, request, { platform: 'darwin', createFileReference: async () => reference });
    assert.equal(result.opened, !shouldFail);
    assert.equal(call.command, '/usr/bin/open');
    assert.deepEqual(call.args, ['--', reference]);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout, 10_000);
    assert.equal(JSON.stringify(result).includes(workspace), false);
  }
});

test('registration and handler exceptions cannot expose private diagnostics', async () => {
  const { api, methods, logs } = createApi(workspace);
  backend.registerDashboardExtras(api, { platform: 'darwin' });
  api.runtime.config.current = () => { throw Error(`private ${workspace}`); };
  assert.deepEqual(await invoke(methods, 'dashboardExtras.capabilities', { sessionKey: 'agent:main:test' }), { nativeOpen: false, localClient: true });
  assert.equal((await invoke(methods, 'dashboardExtras.openLocalFile', {
    sessionKey: 'agent:main:test', path: 'report.txt', expectedSessionId: 'session-1', expectedRoot: workspace,
  })).opened, false);
  assert.deepEqual(logs, []);
  api.registerGatewayMethod = () => { throw Error(`private ${workspace}`); };
  assert.doesNotThrow(() => backend.registerDashboardExtras(api));
});
