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
  const result = await build({
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    ...buildOptions,
    absWorkingDir: repositoryRoot,
    outfile: outputPath,
    write: false,
    sourcemap: 'inline',
    sourcesContent: true,
  });
  let code = result.outputFiles.find(file => file.path === outputPath)?.text;
  if (typeof code !== 'string') throw new Error('The coverage build did not produce its module.');
  const pattern = /sourceMappingURL=data:application\/json;base64,([^\s]+)/;
  const encoded = pattern.exec(code)?.[1];
  if (!encoded) throw new Error('The coverage build did not produce an inline source map.');
  const map = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  // v8-to-istanbul calls its exclusion predicate before resolving bundled sources.
  // Absolute native paths make both that early check and the final remap truthful.
  map.sources = map.sources.map(source => {
    if (source.startsWith('file://')) return fileURLToPath(source);
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(source)) return source; // synthetic esbuild namespaces
    return path.resolve(directory, map.sourceRoot ?? '', source);
  });
  delete map.sourceRoot;
  code = code.replace(pattern, `sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`);
  await fs.writeFile(outputPath, code);
  return { code, path: outputPath };
}

export async function importProductionModule(options = {}) {
  const artifact = await buildProductionArtifact({ ...options, format: 'esm' });
  return import(pathToFileURL(artifact.path).href);
}
