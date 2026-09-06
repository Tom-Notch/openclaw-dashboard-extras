import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Find the installed host through its executable, never an npm version selector. */
export function resolveHostPackage({ cli, env = process.env, cwd = process.cwd() } = {}) {
  const command = cli ?? env.OPENCLAW_CLI ?? 'openclaw';
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) throw new Error('OpenClaw CLI is not configured.');
  const explicitPath = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const extensions = process.platform === 'win32' && !path.extname(command)
    ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')]
    : [''];
  const candidates = explicitPath ? [path.resolve(cwd, command)] : (env.PATH ?? '').split(path.delimiter)
    .filter(Boolean).flatMap(directory => extensions.map(extension => path.resolve(cwd, directory, command + extension)));
  let executable;
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
      executable = fs.realpathSync(candidate);
      break;
    } catch { /* Try the next PATH entry. No executable is launched. */ }
  }
  if (!executable) throw new Error('OpenClaw CLI was not found; install the host or set OPENCLAW_CLI.');
  for (let directory = path.dirname(executable);;) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      if (packageJson.name === 'openclaw') return { root: directory, packageJson, executable };
    } catch { /* Only a matching package ancestor is authority. */ }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error('The resolved executable is not inside an OpenClaw package; set OPENCLAW_CLI to its real package entry.');
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Only explicitly published, package-confined SDK .types exports are accepted. */
export function resolvePublicSdkTypePaths(host, imports) {
  const result = {};
  for (const specifier of new Set(imports)) {
    if (!/^openclaw\/plugin-sdk\/[a-z0-9][a-z0-9-]*$/.test(specifier)) throw new Error(`Not a public SDK import: ${specifier}`);
    const declaration = host.packageJson.exports?.[`./${specifier.slice('openclaw/'.length)}`]?.types;
    let resolved;
    try {
      if (typeof declaration !== 'string' || !declaration.startsWith('./')) throw new Error('missing types');
      const candidate = path.resolve(host.root, declaration);
      if (!within(host.root, candidate)) throw new Error('outside package');
      resolved = fs.realpathSync(candidate);
      if (!within(host.root, resolved) || !fs.statSync(resolved).isFile()) throw new Error('outside package');
    } catch { throw new Error(`No usable public type export for ${specifier}.`); }
    result[specifier] = [resolved];
  }
  return result;
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
  }).sort();
}

export async function typecheck({ root = fileURLToPath(new URL('../', import.meta.url)), host = resolveHostPackage(), run = spawnSync } = {}) {
  const require = createRequire(import.meta.url);
  const compilerPackagePath = require.resolve('typescript/package.json');
  const compilerPackage = JSON.parse(fs.readFileSync(compilerPackagePath, 'utf8'));
  const compilerBin = typeof compilerPackage.bin === 'string' ? compilerPackage.bin : compilerPackage.bin?.tsc;
  if (typeof compilerBin !== 'string') throw new Error('Installed TypeScript does not publish a tsc executable.');
  const compilerRoot = path.dirname(compilerPackagePath);
  const compilerEntry = fs.realpathSync(path.resolve(compilerRoot, compilerBin));
  if (!within(compilerRoot, compilerEntry)) throw new Error('TypeScript compiler entry escapes its package.');
  const files = sourceFiles(path.join(root, 'src'));
  // Map every explicitly typed public SDK export. The compiler itself parses
  // imports, including type-only imports; no regex lexer or unstable AST API.
  const sdkImports = Object.entries(host.packageJson.exports ?? {})
    .filter(([name, value]) => name.startsWith('./plugin-sdk/') && typeof value?.types === 'string')
    .map(([name]) => `openclaw/${name.slice(2)}`);
  const paths = resolvePublicSdkTypePaths(host, sdkImports);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-extras-typecheck-config-'));
  try {
    const configFile = path.join(directory, 'tsconfig.json');
    fs.writeFileSync(configFile, JSON.stringify({
      files,
      compilerOptions: {
        noEmit: true, strict: true, skipLibCheck: true, target: 'ES2023',
        lib: ['ES2023', 'DOM', 'DOM.Iterable'],
        module: 'NodeNext', moduleResolution: 'NodeNext',
        allowImportingTsExtensions: true, paths,
        types: ['node'], typeRoots: [path.join(root, 'node_modules', '@types')],
      },
    }));
    const result = run(process.execPath, [compilerEntry, '--project', configFile, '--pretty', 'false'], {
      cwd: root, stdio: 'inherit', shell: false, timeout: 120_000,
    });
    const passed = !result.error && !result.signal && result.status === 0;
    console.log(`Strict typecheck ${passed ? 'PASS' : 'FAIL'}: ${files.length} source files; ${sdkImports.length} public SDK type mappings; installed OpenClaw ${host.packageJson.version}; TypeScript ${compilerPackage.version}.`);
    return passed;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!await typecheck()) process.exitCode = 1; }
  catch (error) { console.error(error instanceof Error ? error.message : 'Typecheck could not run.'); process.exitCode = 1; }
}
