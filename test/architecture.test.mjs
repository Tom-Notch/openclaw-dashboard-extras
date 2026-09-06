import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(root, "src");
const publicSdk = new Set([
  "openclaw/plugin-sdk/agent-scope-runtime",
  "openclaw/plugin-sdk/control-ui",
  "openclaw/plugin-sdk/media-local-roots",
  "openclaw/plugin-sdk/plugin-entry",
  "openclaw/plugin-sdk/security-runtime",
  "openclaw/plugin-sdk/tool-plugin",
]);

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [filename] : [];
  });
}

// Deliberately small static guardrails, not a JavaScript security sandbox.
// Runtime authorization, races, and rendered output have behavioral tests.
function violations(source, filename = path.join(sourceRoot, "fixture.ts")) {
  const errors = [];
  const imports = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/g,
  );
  for (const [, specifier] of imports) {
    if (
      (specifier === "openclaw" || specifier.startsWith("openclaw/")) &&
      !publicSdk.has(specifier)
    ) {
      errors.push(`unreviewed host import: ${specifier}`);
    }
    if (path.isAbsolute(specifier) || specifier.startsWith("file:")) {
      errors.push(`machine-local import: ${specifier}`);
    }
    if (specifier.startsWith(".")) {
      const relative = path.relative(sourceRoot, path.resolve(path.dirname(filename), specifier));
      if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
        errors.push(`source import escapes plugin: ${specifier}`);
      }
    }
  }

  for (const match of source.matchAll(/\bselectReplacement\s*\(([^)]*)\)/g)) {
    if (!/^\s*["']transcript["']\s*,\s*(?:["']math-files["']|null)\s*,?\s*$/.test(match[1])) {
      errors.push("replacement selection must name the owned transcript or explicit Built-in");
    }
  }

  const forbidden = [
    ["host internals or core asset root", /(?:openclaw\/(?:src|dist)\/|gateway\.controlUi\.root|OPENCLAW_CONTROL_UI_ROOT|\bcontrolUiRoot\b|\.openclaw-upgrade|dashboard-compat\/runtime)/],
    ["release equality gate", /(?:[!=]==?\s*["']20\d{2}\.\d{1,2}\.\d{1,2}["']|["']20\d{2}\.\d{1,2}\.\d{1,2}["']\s*[!=]==?)/],
    ["exact-host allowlist", /\b(?:SUPPORTED_HOST_VERSIONS|COMPATIBLE_OPENCLAW_VERSION|PINNED_OPENCLAW_VERSION|maxHostVersion)\b/],
    ["runtime filesystem mutation", /\b(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream|truncate(?:Sync)?|ftruncate(?:Sync)?|rm(?:Sync)?|rmdir(?:Sync)?|unlink(?:Sync)?|rename(?:Sync)?|mkdir(?:Sync)?|copyFile(?:Sync)?|cp(?:Sync)?|symlink(?:Sync)?|chmod(?:Sync)?|chown(?:Sync)?)\s*\(/],
    ["shell execution", /(?<![\w.])exec\s*\(|\bexecSync\s*\(|\bimport\s*\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*from\s*["'](?:node:)?child_process["']|\bshell\s*:\s*true\b/],
    ["runtime install or shell child", /\b(?:execFile(?:Async|Sync)?|spawn(?:Sync)?)\s*\(\s*["'](?:[^"']*\/)?(?:npm|pnpm|yarn|git|sh|bash|zsh|curl|wget)["']/],
    ["built-in UI traversal", /\bdocument\s*\.\s*(?:querySelector(?:All)?|getElementById|getElementsByClassName)\s*\(/],
    ["broad browser preference mutation", /\blocalStorage\s*\.\s*clear\s*\(/],
    ["replacement of core-owned editing or session flows", /\bsurface\s*:\s*["'](?:composer|workspace|session-list|tool-result)["']/],
  ];
  for (const [description, pattern] of forbidden) {
    if (pattern.test(source)) errors.push(description);
  }
  return errors;
}

test("architecture guard rejects host coupling, pins, broad writes, and shell execution", () => {
  const examples = [
    'import { x } from "openclaw/src/gateway/internal.js";',
    'import { x } from "openclaw/plugin-sdk/session-key-runtime";',
    'import "../../host/dist/control-ui/index.js";',
    'const root = config.gateway.controlUi.root;',
    'if (hostVersion !== "2099.1.1") return;',
    'await writeFile("config.json", value);',
    'fs.rmSync(target, { recursive: true });',
    'execFile("/bin/sh", ["-c", value]);',
    'spawn("open", [value], { shell: true });',
    'document.querySelector(".core-transcript").innerHTML = html;',
    'host.ui.selectReplacement("transcript", "another-plugin:view");',
    'host.ui.selectReplacement("composer", "math-files");',
    'localStorage.clear();',
    'host.ui.registerReplacement({ surface: "composer" });',
  ];
  for (const source of examples) assert.notDeepEqual(violations(source), [], source);
});

test("architecture guard permits public APIs, own assets, and read-only native opening", () => {
  assert.deepEqual(violations(`
    import type { ControlUiHost } from "openclaw/plugin-sdk/control-ui";
    import { render } from "./markdown.js";
    const apiVersion = 1;
    const ownAsset = "dist/control-ui/plugin.js";
    const node = container.querySelector("button");
    const data = readFileSync(descriptor);
    const match = /safe/.exec(text);
    if (operatorOptedIn) host.ui.selectReplacement("transcript", "math-files");
    if (operatorChoseBuiltin) host.ui.selectReplacement("transcript", null);
    execFile("/usr/bin/open", ["--", fileReference], { shell: false });
  `), []);
});

test("browser contributions are optional and native RPC authority stays explicit", () => {
  const browser = readFileSync(path.join(sourceRoot, "control-ui.ts"), "utf8");
  const backend = readFileSync(path.join(sourceRoot, "index.ts"), "utf8");
  assert.match(browser, /\bapiVersion\s*!==\s*1\b/, "unsupported browser protocol must be rejected");
  assert.match(browser, /\bregisterReplacement\s*\(/);
  assert.match(browser, /\bsurface\s*:\s*["']transcript["']/);
  assert.doesNotMatch(browser, /\bregister(?:Panel|Action)\s*\(/);
  const adapter = readFileSync(path.join(sourceRoot, "native-transcript.ts"), "utf8");
  assert.match(adapter, /initial\.mountDefault\(native\)/);
  assert.match(adapter, /container\.closest<HTMLElement>\('openclaw-chat-pane'\)/);
  for (const method of ["dashboardExtras.capabilities", "dashboardExtras.openLocalFile"]) {
    assert.ok(backend.includes(method), `missing scoped RPC: ${method}`);
  }
  for (const scope of ["operator.read", "operator.admin"]) {
    assert.ok(backend.includes(scope), `missing RPC scope: ${scope}`);
  }
  assert.match(backend, /\bprofileAccess\s*:\s*["']required["']/);
});

test("production source stays inside the reviewed public plugin boundary", () => {
  for (const entry of ["index.ts", "control-ui.ts"]) {
    assert.ok(existsSync(path.join(sourceRoot, entry)), `missing production entry: ${entry}`);
  }
  const files = sourceFiles(sourceRoot);
  assert.ok(files.length > 0, "production source must exist");
  for (const filename of files) {
    assert.deepEqual(violations(readFileSync(filename, "utf8"), filename), [], path.relative(root, filename));
  }
});

test("package owns its entries without installing or pinning OpenClaw", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(root, "openclaw.plugin.json"), "utf8"));
  assert.equal(manifest.id, "dashboard-extras");
  assert.equal(manifest.enabledByDefault, false, "activation requires an operator choice");
  assert.deepEqual(pkg.openclaw.extensions, ["./dist/index.js"]);
  assert.equal(pkg.openclaw.controlUi, "./src/control-ui.ts");
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      assert.ok(name !== "openclaw" && !name.startsWith("@openclaw/"), `${section} must not manage host/plugin versions: ${name}`);
    }
  }
  // A minimum audited API floor is not a release lock or a future ceiling.
  for (const value of [pkg.openclaw.compat?.pluginApi, pkg.openclaw.install?.minHostVersion]) {
    if (value !== undefined) assert.match(value, /^>=\d{4}\.\d{1,2}\.\d{1,2}$/, "compatibility range must remain open-ended");
  }
  assert.equal(pkg.openclaw.install?.maxHostVersion, undefined);
  for (const name of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(pkg.scripts?.[name], undefined, `no implicit ${name} installer or host mutation`);
  }
  if (manifest.controlUi) {
    for (const asset of [manifest.controlUi.entry, ...(manifest.controlUi.styles ?? [])]) {
      assert.equal(typeof asset, "string");
      const normalized = path.posix.normalize(asset.replace(/^\.\//, ""));
      assert.ok(normalized.startsWith("dist/control-ui/"), `asset must belong to plugin build: ${asset}`);
      assert.ok(!path.posix.isAbsolute(asset) && !asset.includes("\\"), "portable relative assets only");
    }
  }
});
