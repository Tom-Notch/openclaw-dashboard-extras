import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { buildProductionArtifact, importProductionModule } from './helpers/load-production.mjs';

test('production source maps resolve to actual source files, not temporary-directory aliases', async () => {
  const artifact = await buildProductionArtifact({ entryPoints: ['src/index.ts'], external: ['openclaw/*'], format: 'esm' });
  assert.equal(artifact.path, await fs.realpath(artifact.path));
  const encoded = /sourceMappingURL=data:application\/json;base64,([^\s]+)/.exec(artifact.code)?.[1];
  assert.ok(encoded, 'coverage requires an inline source map');
  const map = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  assert.ok(map.sources.every(source => path.isAbsolute(source)), 'c8 must filter resolved filesystem paths before remapping ranges');
  const sources = map.sources.map(source => path.resolve(path.dirname(artifact.path), source));
  for (const source of sources) assert.equal(source, await fs.realpath(source));
  assert.ok(sources.some(source => source.endsWith('/src/index.ts')));
  assert.ok(sources.some(source => source.endsWith('/src/open-local-file.ts')));
});

test('ESM helper executes a file-backed synthetic test module', async () => {
  const module = await importProductionModule({ stdin: {
    contents: 'export const answer = 42;',
    sourcefile: 'test/helpers/arithmetic-fixture.mjs',
    loader: 'js',
  } });
  assert.equal(module.answer, 42);
});
