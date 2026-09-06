import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";
import { createContext, Script } from "node:vm";

// Markdown has its own security/math suite. This fixture isolates UI ownership,
// raw-source delivery, file actions, and asynchronous lifetime behavior.
const markdownFixture = `
export function renderMarkdown(source) {
  globalThis.markdownSources.push(source);
  const esc = value => value.replace(/[&<>\"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[char]));
  return '<p>' + esc(source).replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (_, label, target) => '<a href="#" data-file-path="'+target+'" role="button">'+label+'</a>') + '</p>';
}
export function parseLocalFileTarget(value) {
  return typeof value === 'string' && value && !/^(?:https?|javascript|data|mailto):/i.test(value) ? value : null;
}`;
let bundlePromise;
function uiBundle() {
  bundlePromise ??= build({
    entryPoints: [new URL("../src/transcript.ts", import.meta.url).pathname],
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "ExtrasUI",
    logLevel: "silent",
    plugins: [{ name: "markdown-boundary-fixture", setup(builder) {
      builder.onResolve({ filter: /^\.\/markdown\.ts$/ }, () => ({ path: "fixture", namespace: "markdown-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "markdown-fixture" }, () => ({ contents: markdownFixture }));
    } }],
  }).then(result => result.outputFiles[0].text);
  return bundlePromise;
}
const caps = { nativeOpen: true, sessionId: "incarnation-a", root: "/workspace" };
const file = { sessionKey: "agent:main:test", root: "/workspace", file: { path: "canary.txt", name: "canary.txt", kind: "read", missing: false, content: "benign preview", contentEncoding: "utf8", previewKind: "text" } };
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function fixture(t, options = {}) {
  const window = new Window();
  window.markdownSources = [];
  // Execute only the locally built trusted module, not page scripts or message HTML.
  const sandbox = createContext({ markdownSources: window.markdownSources }, { codeGeneration: { strings: false, wasm: false } });
  new Script(await uiBundle()).runInContext(sandbox);
  window.ExtrasUI = sandbox.ExtrasUI;
  window.document.body.innerHTML = '<div id="builtin">Built-in composer stays untouched</div><div id="plugin"></div>';
  const container = window.document.querySelector("#plugin");
  const abort = new AbortController();
  const calls = [];
  const listeners = new Set();
  const host = {
    apiVersion: 1, signal: abort.signal,
    connection: { connected: true, canRead: true, canWrite: true, canAdmin: options.canAdmin ?? true },
    request: async (method, params) => {
      // The real RPC boundary serializes data; clone across the VM realm as it does.
      calls.push({ method, params: structuredClone(params) });
      if (options.request) return options.request(method, params);
      if (method === "dashboardExtras.capabilities") return { ...caps, nativeOpen: options.nativeOpen ?? true };
      if (method === "sessions.files.get") return structuredClone(file);
      if (method === "dashboardExtras.openLocalFile") return { opened: true };
      throw new Error("Unexpected request");
    },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const context = { host, signal: abort.signal, presented: true, props: {
    sessionKey: "agent:main:test", agentId: "main", messages: options.messages ?? [{ role: "assistant", content: "[Read canary](canary.txt)" }], stream: options.stream ?? null, loading: false,
  } };
  const handle = window.ExtrasUI.mountTranscript(container, context);
  const shadow = container.querySelector("*")?.shadowRoot;
  assert.ok(shadow, "plugin must own a shadow root");
  t.after(() => { handle.dispose(); abort.abort(); window.happyDOM.abort(); });
  return { window, container, shadow, calls, handle, context, abort, host, listeners };
}
function button(shadow, label) { return [...shadow.querySelectorAll("button")].find(node => node.textContent === label); }
async function preview(view) {
  const anchor = view.shadow.querySelector("a[data-file-path]");
  assert.ok(anchor, "file reference is available");
  anchor.dispatchEvent(new view.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await flush();
}

test("renders original mathematical source and streaming text without touching the built-in DOM", async t => {
  const source = String.raw`Inline \(a*b*c\) and $x^2$.`;
  const view = await fixture(t, { messages: [{ role: "assistant", content: [{ type: "text", text: source }] }], stream: String.raw`$$\frac{1}{2}$$` });
  assert.ok(view.window.markdownSources.includes(source));
  assert.ok(view.window.markdownSources.includes(String.raw`$$\frac{1}{2}$$`));
  assert.equal(view.window.document.querySelector("#builtin").textContent, "Built-in composer stays untouched");
  assert.equal(view.calls.some(call => /chat\.(?:send|history|startup)/.test(call.method)), false);
});

test("renders tools, nontext blocks and unknown messages as readable inert content", async t => {
  const view = await fixture(t, { messages: [
    { role: "assistant", content: [{ type: "toolCall", name: "calculator", arguments: { expression: "2+2" } }, { type: "image", mimeType: "image/png", data: "not-an-image" }] },
    { custom: { text: "<img src=x onerror=alert(1)>" } },
  ] });
  assert.match(view.shadow.textContent, /calculator/);
  assert.match(view.shadow.textContent, /2\+2/);
  assert.match(view.shadow.textContent, /image\/png/);
  assert.match(view.shadow.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(view.shadow.querySelector("img"), null);
});

test("file preview never launches and carries the view's explicit session identity", async t => {
  const view = await fixture(t);
  await preview(view);
  assert.match(view.shadow.textContent, /benign preview/);
  assert.equal(view.calls.filter(call => call.method === "dashboardExtras.openLocalFile").length, 0);
  assert.deepEqual(view.calls.find(call => call.method === "sessions.files.get").params, { sessionKey: "agent:main:test", agentId: "main", path: "canary.txt" });
  assert.equal(button(view.shadow, "Open in Default Application").disabled, false);
});

test("only explicit application button opens the canonical file with verified incarnation and root", async t => {
  const view = await fixture(t);
  await preview(view);
  button(view.shadow, "Open in Default Application").click();
  await flush();
  const opens = view.calls.filter(call => call.method === "dashboardExtras.openLocalFile");
  assert.equal(opens.length, 1);
  assert.deepEqual(opens[0].params, { sessionKey: "agent:main:test", agentId: "main", path: "canary.txt", expectedSessionId: "incarnation-a", expectedRoot: "/workspace" });
  assert.match(view.shadow.textContent, /Opened in the default application/);
});

test("native capability absence or lack of administrator scope preserves mathematical transcript and preview", async t => {
  for (const options of [{ nativeOpen: false }, { canAdmin: false }]) {
    const view = await fixture(t, options);
    await preview(view);
    assert.match(view.shadow.textContent, /benign preview/);
    assert.equal(button(view.shadow, "Open in Default Application")?.disabled ?? true, true);
    assert.match(view.shadow.textContent, /unavailable|administrator/i);
  }
});

test("late preview response cannot attach to a different session or agent", async t => {
  for (const changed of [{ sessionKey: "agent:main:other" }, { agentId: "other" }]) {
    const pending = deferred();
    const view = await fixture(t, { request: async method => method === "dashboardExtras.capabilities" ? caps : pending.promise });
    await preview(view);
    view.handle.update({ ...view.context, props: { ...view.context.props, ...changed } });
    pending.resolve(file);
    await flush();
    assert.doesNotMatch(view.shadow.textContent, /benign preview/);
    assert.equal(button(view.shadow, "Open in Default Application")?.disabled ?? true, true);
  }
});

test("disposal or hidden presentation retires an outstanding preview", async t => {
  for (const retire of [view => view.abort.abort(), view => view.handle.update({ ...view.context, presented: false })]) {
    const pending = deferred();
    const view = await fixture(t, { request: async method => method === "dashboardExtras.capabilities" ? caps : pending.promise });
    await preview(view);
    retire(view);
    pending.resolve(file);
    await flush();
    assert.doesNotMatch(view.shadow.textContent, /benign preview/);
    assert.equal(view.calls.some(call => call.method === "dashboardExtras.openLocalFile"), false);
  }
});

test("mismatched preview identity or root never enables native opening", async t => {
  for (const bad of [{ ...file, sessionKey: "agent:main:other" }, { ...file, root: "/another-root" }]) {
    const view = await fixture(t, { request: async method => method === "dashboardExtras.capabilities" ? caps : bad });
    await preview(view);
    assert.equal(button(view.shadow, "Open in Default Application")?.disabled ?? true, true);
    assert.equal(view.calls.some(call => call.method === "dashboardExtras.openLocalFile"), false);
    assert.match(view.shadow.textContent, /unavailable|changed|verify/i);
  }
});

test("session incarnation change between preview and explicit launch is rejected", async t => {
  let reads = 0;
  const view = await fixture(t, { request: async method => {
    if (method === "dashboardExtras.capabilities") return { ...caps, sessionId: ++reads === 1 ? "incarnation-a" : "incarnation-b" };
    return file;
  } });
  await preview(view);
  button(view.shadow, "Open in Default Application").click();
  await flush();
  assert.equal(view.calls.some(call => call.method === "dashboardExtras.openLocalFile"), false);
  assert.match(view.shadow.textContent, /changed|preview again/i);
});

test("errors stay visible without leaking backend paths or credential-like details", async t => {
  const view = await fixture(t, { request: async method => {
    if (method === "dashboardExtras.capabilities") return caps;
    throw new Error("Private path /Users/private/secret and auth-token-do-not-render");
  } });
  await preview(view);
  assert.match(view.shadow.textContent, /Could not|Unable to|unavailable/i);
  assert.doesNotMatch(view.shadow.textContent, /Users\/private|auth-token/);
});

test("literal masked paths are never guessed or repaired by the browser", async t => {
  const view = await fixture(t, { messages: [{ role: "assistant", content: "[Old file](/Users/***/Downloads/file.pdf)" }] });
  await preview(view);
  assert.equal(view.calls.find(call => call.method === "sessions.files.get").params.path, "/Users/***/Downloads/file.pdf");
});

test("missing and binary previews explain their state and never attempt an implicit launch", async t => {
  for (const previewFile of [{ ...file.file, missing: true, content: undefined }, { ...file.file, content: "Zm9v", contentEncoding: "base64", previewKind: "unsupported" }]) {
    const view = await fixture(t, { request: async method => method === "dashboardExtras.capabilities" ? caps : { ...file, file: previewFile } });
    await preview(view);
    assert.match(view.shadow.textContent, /missing|not available|cannot be previewed|binary/i);
    assert.equal(view.calls.some(call => call.method === "dashboardExtras.openLocalFile"), false);
  }
});

test("loading, empty state and subsequent streamed updates remain readable", async t => {
  const view = await fixture(t, { messages: [] });
  assert.match(view.shadow.textContent, /No messages|empty/i);
  view.handle.update({ ...view.context, props: { ...view.context.props, messages: [], loading: true, stream: "Latest streaming content" } });
  assert.match(view.shadow.textContent, /Latest streaming content/);
  assert.match(view.shadow.textContent, /loading/i);
});
