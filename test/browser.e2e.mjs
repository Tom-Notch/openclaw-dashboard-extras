import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// This host is entirely synthetic. It cannot access any Gateway, credential,
// real session, user browser profile, or operating-system file-open command.
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "openclaw.plugin.json"), "utf8"));
const entry = path.resolve(projectRoot, manifest.controlUi?.entry ?? "");
assert.ok(entry.startsWith(`${projectRoot}${path.sep}dist${path.sep}control-ui${path.sep}`));
const bundledJavaScript = fs.readFileSync(entry);
const fixtureSource = String.raw`Inline $x^2+y^2=z^2$.

Explicit inline \(e^{i\pi}+1=0\).

$$\frac{1}{2}+\frac{1}{3}=\frac{5}{6}$$

\[\frac{2}{3}\]

Code stays literal: INLINE_CODE_FIXTURE. Prices: $5 to $10.

[Preview the canary](./reports/demo file.txt)`.replace("INLINE_CODE_FIXTURE", () => "`$code$`");
const harness = `
import plugin from '/plugin.js';
const fixtureSource = ${JSON.stringify(fixtureSource)};
const activation = new AbortController();
let viewAbort = new AbortController();
let view;
const replacements = new Map();
const actions = new Map();
const listeners = new Set();
const calls = [];
const props = { sessionKey:'agent:fixture:canary',agentId:'fixture',messages:[
  {role:'assistant',content:[{type:'text',text:fixtureSource}]},
  {role:'assistant',content:[{type:'toolCall',name:'fixture_calculator',arguments:{expression:'2+2'}}]},
],stream:null,loading:false};
const host = {
  apiVersion:1,pluginId:'dashboard-extras',signal:activation.signal,basePath:'',locale:'en',
  connection:{connected:true,canRead:true,canWrite:true,canAdmin:true},
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  async request(method,params){
    calls.push({method,params:structuredClone(params)});
    if(method==='dashboardExtras.capabilities')return{nativeOpen:true,sessionId:'fixture-incarnation',root:'/fixture-workspace',defaultView:'math'};
    if(method==='sessions.files.get')return{sessionKey:props.sessionKey,root:'/fixture-workspace',file:{path:'reports/demo file.txt',name:'demo file.txt',kind:'read',missing:false,content:'BENIGN_FILE_PREVIEW',contentEncoding:'utf8',previewKind:'text'}};
    if(method==='dashboardExtras.openLocalFile')return{opened:true};
    throw new Error('Unexpected synthetic host request');
  },
  ui:{
    registerReplacement(item){replacements.set(item.id,item);return()=>replacements.delete(item.id);},
    registerPanel(){return()=>{};},
    registerAction(item){
      actions.set(item.id,item);
      const button=document.createElement('button');button.textContent=item.label;
      button.dataset.action=item.id;
      button.onclick=()=>item.run({host,signal:activation.signal,sessionKey:props.sessionKey,agentId:props.agentId});
      document.querySelector('#actions').append(button);
      return()=>button.remove();
    },
    selectReplacement(surface,id){
      if(surface!=='transcript')throw new Error('Unexpected replacement surface');
      viewAbort.abort();view?.dispose();viewAbort=new AbortController();
      const container=document.querySelector('#transcript');container.replaceChildren();
      if(id===null){container.textContent='BUILTIN_TRANSCRIPT';return;}
      const registration=replacements.get(id);if(!registration)throw new Error('Missing own replacement');
      const context={host:{...host,signal:viewAbort.signal},props,signal:viewAbort.signal,presented:true,mountDefault(){throw new Error('The independent view must not mount built-in DOM');}};
      view=registration.mount(container,context);
    },
  },
};
document.querySelector('#transcript').textContent='BUILTIN_TRANSCRIPT';
await plugin.activate(host);
window.syntheticProof={calls,host,props};
window.fixtureReady=true;
`;
const html = '<!doctype html><html><head><meta charset="utf-8"><title>Dashboard Extras synthetic browser verification</title><style>body{margin:24px;font-family:system-ui}#actions{display:flex;gap:12px;margin-bottom:16px}textarea{width:100%;margin-top:16px;min-height:70px}</style></head><body><nav id="actions"></nav><main id="transcript"></main><textarea aria-label="Synthetic host-owned composer" placeholder="Host-owned composer remains outside the plugin"></textarea><script type="module" src="/harness.js"></script></body></html>';
const server = http.createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/") { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
  else if (request.url === "/harness.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(harness); }
  else if (request.url === "/plugin.js") { response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(bundledJavaScript); }
  else if (request.url === "/favicon.ico") { response.writeHead(204); response.end(); }
  else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
let browser;
let context;
let page;
let stage = "launch-isolated-browser";
const errors = [];
try {
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1320, height: 1100 }, serviceWorkers: "block" });
  page = await context.newPage();
  page.on("pageerror", error => errors.push({ kind: "pageerror", name: error.name }));
  page.on("console", message => { if (message.type() === "error") errors.push({ kind: "console-error" }); });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForFunction(() => window.fixtureReady === true);
  stage = "real-bundle-math-and-literal-content";
  const math = page.locator("math");
  assert.equal(await math.count(), 4, "all four delimiter styles render from original source");
  stage = "math-fractions";
  assert.equal(await page.locator("math mfrac").count(), 4);
  stage = "literal-code";
  assert.equal(await page.locator("code").filter({ hasText: "$code$" }).count(), 1);
  stage = "literal-prices";
  assert.equal(await page.getByText("Prices: $5 to $10.", { exact: false }).count(), 1);
  stage = "readable-tool-message";
  assert.equal(await page.getByText("toolCall: fixture_calculator", { exact: true }).count(), 1);
  await page.getByRole("textbox", { name: "Synthetic host-owned composer" }).fill("UNSENT_SYNTHETIC_DRAFT");
  stage = "preview-space-containing-file-without-native-launch";
  await page.locator('a[data-file-path="./reports/demo file.txt"]').click();
  await page.getByText("BENIGN_FILE_PREVIEW", { exact: true }).waitFor();
  const countOpen = () => page.evaluate(() => window.syntheticProof.calls.filter(call => call.method === "dashboardExtras.openLocalFile").length);
  assert.equal(await countOpen(), 0);
  const previewRead = await page.evaluate(() => window.syntheticProof.calls.find(call => call.method === "sessions.files.get"));
  assert.deepEqual(previewRead.params, { sessionKey: "agent:fixture:canary", agentId: "fixture", path: "./reports/demo file.txt" });
  stage = "explicit-default-app-action-stub";
  await page.getByRole("button", { name: "Open in Default Application", exact: true }).click();
  await page.getByText("Opened in the default application.", { exact: true }).waitFor();
  assert.equal(await countOpen(), 1);
  const open = await page.evaluate(() => window.syntheticProof.calls.find(call => call.method === "dashboardExtras.openLocalFile"));
  assert.deepEqual(open.params, { sessionKey: "agent:fixture:canary", agentId: "fixture", path: "reports/demo file.txt", expectedSessionId: "fixture-incarnation", expectedRoot: "/fixture-workspace" });
  assert.equal(await page.getByRole("textbox", { name: "Synthetic host-owned composer" }).inputValue(), "UNSENT_SYNTHETIC_DRAFT");
  const artifacts = path.join(projectRoot, "test-results");
  fs.mkdirSync(artifacts, { recursive: true });
  await page.screenshot({ path: path.join(artifacts, "browser-e2e.png"), fullPage: true });
  stage = "built-in-restore-and-remembered-choice";
  await page.getByRole("button", { name: "Use built-in transcript", exact: true }).last().click();
  await page.getByText("BUILTIN_TRANSCRIPT", { exact: true }).waitFor();
  await page.reload();
  await page.waitForFunction(() => window.fixtureReady === true);
  await page.getByText("BUILTIN_TRANSCRIPT", { exact: true }).waitFor();
  assert.equal(await page.locator("math").count(), 0);
  await page.getByRole("button", { name: "Use Math & Files", exact: true }).click();
  await page.locator("math").first().waitFor();
  await page.reload();
  await page.waitForFunction(() => window.fixtureReady === true);
  assert.equal(await page.locator("math").count(), 4);
  assert.equal(await page.evaluate(() => window.syntheticProof.calls.some(call => /^chat\./.test(call.method))), false);
  assert.deepEqual(errors, []);
  const result = { status: "passed", data: "synthetic public host only", bundle: manifest.controlUi.entry, formulas: 4, fractions: 4, codeAndPricesPreserved: true, spaceContainingFilePreview: true, noNativeOpenOnPreview: true, explicitOpenPayloadVerified: true, realApplicationOpened: false, builtinRestoreAndPreferenceReload: true, syntheticComposerUntouched: true, pageErrors: [], consoleErrors: [], screenshot: "test-results/browser-e2e.png" };
  fs.writeFileSync(path.join(artifacts, "browser-e2e.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ status: "failed", stage, errorName: error?.name ?? "Error", ...(error?.name === "AssertionError" ? { actual: error.actual, expected: error.expected } : {}), errors }));
  process.exitCode = 1;
} finally {
  await page?.goto("about:blank").catch(() => {});
  await context?.close();
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
