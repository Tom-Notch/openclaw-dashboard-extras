import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = await fs.realpath(fileURLToPath(new URL('../../', import.meta.url)));

/** Build real production sources with file-backed, alias-free maps for c8. */
export async function buildProductionArtifact(options = {}) {
  const buildsRoot = path.join(repositoryRoot, 'test-results', 'builds');
  await fs.mkdir(buildsRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(buildsRoot, 'module-'));
  if (process.env.DASHBOARD_EXTRAS_COVERAGE !== '1') {
    after(() => fs.rm(directory, { recursive: true, force: true }));
  }
  const outputPath = path.join(directory, 'production.mjs');
  // Caller controls the real source, mocks and execution format, not output/map identity.
  const { outfile: _outfile, outdir: _outdir, write: _write, sourcemap: _sourcemap, ...buildOptions } = options;
  await build({
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    ...buildOptions,
    absWorkingDir: repositoryRoot,
    outfile: outputPath,
    write: true,
    sourcemap: 'inline',
    sourcesContent: true,
  });
  return { code: await fs.readFile(outputPath, 'utf8'), path: outputPath };
}

export async function importProductionModule(options = {}) {
  const artifact = await buildProductionArtifact({ ...options, format: 'esm' });
  return import(pathToFileURL(artifact.path).href);
}
