import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { Window } from "happy-dom";
import { importProductionModule } from "./helpers/load-production.mjs";

const window = new Window();
window.document.write("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window, document: window.document });
const { enhanceNativeMath } = await importProductionModule({
  entryPoints: [new URL("../src/native-math.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
function rendered(source) {
  const node = document.createElement("div");
  node.setAttribute("data-message-text", source);
  const content = document.createElement("div");
  content.className = "chat-text";
  content.innerHTML = new MarkdownIt({ html:false,breaks:true }).render(source);
  node.append(content);
  enhanceNativeMath(node);
  return node;
}

for (const source of ["$\\frac{1}{2}$", "$$\\frac{1}{2}$$", "\\(\\frac{1}{2}\\)", "\\[\\frac{1}{2}\\]"]) {
  test(`renders bounded native MathML before Markdown parsing: ${source}`, () => {
    assert.equal(rendered(source).querySelectorAll("math mfrac").length, 1);
  });
}

test("math asterisks and multiline display math survive Markdown parsing", () => {
  const result = rendered("$a*b*c$\n\n$$\\frac{1}{2}\n\n+ x$$");
  assert.equal(result.querySelectorAll("math").length, 2);
  assert.ok([...result.querySelectorAll("em")].every(node => !node.textContent));
});

test("code, escaped delimiters, currency, and unfinished streaming remain literal", () => {
  for (const source of ["`$x$`", "```tex\n$x$\n```", "    $x$", "\\$x\\$", "$5 to $10", "$unfinished", "\\(unfinished"]) {
    assert.equal(rendered(source).querySelectorAll("math").length, 0, source);
  }
  assert.equal(rendered("\\(x+1\\)").querySelectorAll("math").length, 1);
});

test("untrusted HTML, event attributes, links, and TeX cannot execute", () => {
  const result = rendered('<img src=x onerror=alert(1)> [bad](javascript:alert) $\\href{javascript:alert(1)}{x}$ $\\htmlStyle{color:red}{x}$');
  assert.equal(result.querySelectorAll("script,iframe,img,[onerror],[onclick],math a").length, 0);
  assert.equal(result.querySelectorAll('a[href^="javascript:"]').length, 0);
});

test("math cannot be injected into link attributes or code", () => {
  const node = rendered('[x](https://example.org/"$x$")\n\n    $y$');
  assert.equal(node.querySelectorAll("math").length, 0);
  assert.equal(node.querySelectorAll("code math").length, 0);
});

test("formula count and source work are bounded without truncating native messages", () => {
  assert.ok(rendered(Array(300).fill("$x$").join(" ")).querySelectorAll("math").length <= 256);
  const node = rendered("x".repeat(200_000));
  assert.ok(node.textContent.length >= 200_000);
  assert.equal(node.querySelector("math"), null);
});

test("math macros cannot leak between formulas", () => {
  const node = rendered("$\\gdef\\mycommand{x}\\mycommand$ $\\mycommand$");
  assert.match(node.textContent, /\\mycommand/);
});

test("adversarial placeholder prefixes do not cause quadratic rendering work", () => {
  const source = "OPENCLAWKATEXPLACEHOLDER" + "X".repeat(90_000) + " $x$";
  const started = performance.now();
  const node = rendered(source);
  assert.equal(node.querySelectorAll("math").length, 1);
  assert.ok(performance.now() - started < 400, "bounded input must not monopolize a browser frame for a second");
});

test("oversized generated MathML remains readable source instead of huge DOM", () => {
  const source = "$1" + "+1".repeat(8_000) + "$";
  const node = rendered(source);
  assert.equal(node.querySelectorAll("math").length, 0);
  assert.match(node.textContent, /\$1\+1/);
});
