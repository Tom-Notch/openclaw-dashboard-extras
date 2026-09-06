import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCoverageSourceMaps } from '../test/helpers/coverage-source-map.mjs';

const repositoryRoot = await fs.realpath(fileURLToPath(new URL('../', import.meta.url)));
const coverageRoot = path.join(repositoryRoot, 'coverage');
await fs.mkdir(path.join(coverageRoot, 'runs'), { recursive: true });
const runDirectory = await fs.mkdtemp(path.join(coverageRoot, 'runs', 'run-'));
const rawDirectory = path.join(runDirectory, 'raw');
const normalizedDirectory = path.join(runDirectory, 'normalized');
await fs.mkdir(rawDirectory);
await fs.mkdir(normalizedDirectory);

function runNode(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repositoryRoot, env, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
}

const testFiles = (await fs.readdir(path.join(repositoryRoot, 'test')))
  .filter(name => name.endsWith('.test.mjs')).sort().map(name => `test/${name}`);
const testExit = await runNode(['--test', ...testFiles], {
  ...process.env,
  NODE_V8_COVERAGE: rawDirectory,
  DASHBOARD_EXTRAS_COVERAGE: '1',
});

// c8/v8-to-istanbul filters multi-source bundles before resolving source URLs.
// Preserve raw reports, and normalize ONLY equivalent file:// source identities
// in a second directory. Function names, offsets, counts and mappings stay exact.
for (const name of await fs.readdir(rawDirectory)) {
  if (!name.endsWith('.json')) continue;
  const raw = JSON.parse(await fs.readFile(path.join(rawDirectory, name), 'utf8'));
  const normalized = normalizeCoverageSourceMaps(raw);
  assert.deepEqual(normalized.result, raw.result, 'Coverage execution evidence must not change.');
  await fs.writeFile(path.join(normalizedDirectory, name), JSON.stringify(normalized));
}

const reportExit = await runNode([
  'node_modules/c8/bin/c8.js', 'report',
  '--all', '--src', 'src', '--include', 'src/**/*.ts', '--exclude-after-remap',
  '--temp-directory', normalizedDirectory, '--reports-dir', coverageRoot,
  '--reporter', 'text', '--reporter', 'json', '--reporter', 'json-summary',
  '--check-coverage', '--lines', '80', '--branches', '80', '--functions', '80',
]);

async function collectSourceFiles(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectSourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.ts')) result.push(target);
  }
  return result;
}

try {
  const report = JSON.parse(await fs.readFile(path.join(coverageRoot, 'coverage-final.json'), 'utf8'));
  const expectedSources = (await collectSourceFiles(path.join(repositoryRoot, 'src'))).sort();
  assert.deepEqual(Object.keys(report).sort(), expectedSources, 'Coverage must contain all and only production TypeScript files.');
  // Detect the misleading 100%-with-zero-functions result produced by broken maps.
  for (const name of ['index.ts', 'open-local-file.ts', 'math.ts', 'markdown.ts', 'transcript.ts']) {
    const measured = report[path.join(repositoryRoot, 'src', name)];
    assert.ok(Object.keys(measured.fnMap).length > 0, `${name} must have measured production functions.`);
    assert.ok(Object.keys(measured.branchMap).length > 0, `${name} must have measured production branches.`);
  }
  console.log(`Verified production-only coverage for ${expectedSources.length} source files; test helpers, fixtures and dependencies excluded.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Coverage identity verification failed.');
  process.exitCode = 1;
}
if (testExit !== 0 || reportExit !== 0) process.exitCode = 1;
