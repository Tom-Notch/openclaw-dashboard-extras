import assert from "node:assert/strict";
import { test } from "node:test";
import { createContext, Script } from "node:vm";
import { build } from "esbuild";

const preferenceKey = "openclaw-dashboard-extras.transcript.v1";
let bundle;
async function plugin() {
  bundle ??= build({
    entryPoints: [new URL("../src/control-ui.ts", import.meta.url).pathname],
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "Entry",
    plugins: [{ name: "view-boundary", setup(builder) {
      builder.onResolve({ filter: /^\.\/transcript\.ts$/ }, () => ({ path: "views", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export function mountTranscript() {} export function mountFilePanel() {}" }));
    } }],
  }).then(result => result.outputFiles[0].text);
  return bundle;
}
async function activate({ preference, defaultView = "builtin", delayed, apiVersion = 1 } = {}) {
  const values = new Map(preference ? [[preferenceKey, preference]] : []);
  const sandbox = createContext({ localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } }, { codeGeneration: { strings: false, wasm: false } });
  new Script(await plugin()).runInContext(sandbox);
  const selections = [];
  const actions = [];
  const registrations = [];
  const abort = new AbortController();
  const host = { apiVersion, signal: abort.signal, ui: {
    registerReplacement: item => { registrations.push(item); return () => {}; },
    registerPanel: item => { registrations.push(item); return () => {}; },
    registerAction: item => { actions.push(item); return () => {}; },
    selectReplacement: (surface, id) => selections.push({ surface, id }),
  }, request: async method => { assert.equal(method, "dashboardExtras.capabilities"); return delayed ? delayed : { nativeOpen: false, defaultView }; } };
  const activation = sandbox.Entry.default.activate(host);
  if (!delayed) await activation;
  return { selections, actions, registrations, values, host, abort, activation };
}

test("public package leaves the built-in transcript selected by default", async () => {
  const view = await activate();
  assert.deepEqual(view.selections, []);
  assert.ok(view.registrations.some(item => item.id === "math-files" && item.surface === "transcript"));
});

test("stored operator choice overrides the configured default without host-private preferences", async () => {
  const math = await activate({ preference: "math" });
  assert.deepEqual(math.selections, [{ surface: "transcript", id: "math-files" }]);
  const builtin = await activate({ preference: "builtin", defaultView: "math" });
  assert.deepEqual(builtin.selections, []);
  const configured = await activate({ defaultView: "math" });
  assert.deepEqual(configured.selections, [{ surface: "transcript", id: "math-files" }]);
});

test("explicit actions store only this plugin's choice and use public replacement selection", async () => {
  const view = await activate();
  const math = view.actions.find(item => item.id === "use-math-files");
  const builtin = view.actions.find(item => item.id === "use-builtin-transcript");
  assert.ok(math && builtin);
  await math.run({ host: view.host, signal: view.host.signal });
  assert.equal(view.values.get(preferenceKey), "math");
  await builtin.run({ host: view.host, signal: view.host.signal });
  assert.equal(view.values.get(preferenceKey), "builtin");
  assert.deepEqual(view.selections, [{ surface: "transcript", id: "math-files" }, { surface: "transcript", id: null }]);
  assert.deepEqual([...view.values.keys()], [preferenceKey]);
});

test("late default resolution cannot override an explicit selection or retired activation", async () => {
  for (const choice of ["builtin", "abort"]) {
    let resolve;
    const delayed = new Promise(done => { resolve = done; });
    const view = await activate({ delayed });
    if (choice === "abort") view.abort.abort();
    else await view.actions.find(item => item.id === "use-builtin-transcript").run({ host: view.host, signal: view.host.signal });
    resolve({ nativeOpen: false, defaultView: "math" });
    await view.activation;
    assert.equal(view.selections.some(item => item.id === "math-files"), false);
  }
});
