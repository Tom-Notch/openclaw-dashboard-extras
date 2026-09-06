import fs from 'node:fs';
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

export async function typecheck({ root = fileURLToPath(new URL('../', import.meta.url)), host = resolveHostPackage() } = {}) {
  const ts = (await import('typescript')).default;
  const files = sourceFiles(path.join(root, 'src'));
  const sdkImports = new Set();
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = node => {
      let specifier;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text;
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) specifier = node.arguments[0].text;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) specifier = node.argument.literal.text;
      if (specifier === 'openclaw' || specifier?.startsWith('openclaw/')) sdkImports.add(specifier);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const paths = resolvePublicSdkTypePaths(host, sdkImports);
  const program = ts.createProgram(files, {
    noEmit: true, strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2023,
    lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true, paths,
    types: ['node'], typeRoots: [path.join(root, 'node_modules', '@types')],
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const diagnostic of diagnostics) {
    const location = diagnostic.file && diagnostic.start !== undefined
      ? `${path.relative(root, diagnostic.file.fileName)}:${diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`
      : 'compiler';
    console.error(`${location} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }
  console.log(`Strict typecheck: ${diagnostics.length} diagnostics; ${files.length} source files; ${sdkImports.size} public SDK imports; installed OpenClaw ${host.packageJson.version}.`);
  return diagnostics.length === 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (!await typecheck()) process.exitCode = 1; }
  catch (error) { console.error(error instanceof Error ? error.message : 'Typecheck could not run.'); process.exitCode = 1; }
}
