import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Window } from "happy-dom";

const window = new Window();
window.document.write("<!doctype html><html><body></body></html>");
Object.assign(globalThis, { window, document: window.document });
const bundle = await build({
  entryPoints: [new URL("../src/markdown.ts", import.meta.url).pathname],
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const { renderMarkdown, parseLocalFileTarget } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
function rendered(source) {
  const node = document.createElement("div");
  node.innerHTML = renderMarkdown(source);
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
  assert.equal(result.querySelectorAll("em").length, 0);
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

test("external links retain normal browser navigation with safe opener policy", () => {
  const anchor = rendered("[docs](https://example.org/docs)").querySelector("a");
  assert.equal(anchor.getAttribute("href"), "https://example.org/docs");
  assert.equal(anchor.getAttribute("target"), "_blank");
  assert.match(anchor.getAttribute("rel"), /noopener/);
});

test("local paths with spaces and parentheses produce explicit preview actions", () => {
  const node = rendered("[local](/fixture/work/report (final).txt) [url](file:///fixture/work/report%20final.pdf)");
  assert.deepEqual([...node.querySelectorAll("a")].map(a => a.dataset.filePath), ["/fixture/work/report (final).txt", "/fixture/work/report final.pdf"]);
  assert.ok([...node.querySelectorAll("a")].every(a => a.getAttribute("href") === "#"));
});

test("local link syntax inside code is never converted into an action", () => {
  const node = rendered("`[local](/fixture/work/report (final).txt)`");
  assert.equal(node.querySelectorAll("a").length, 0);
  assert.match(node.textContent, /report \(final\)/);
});

test("rejects remote file URLs, double-encoded separators and control bytes", () => {
  for (const href of ["file://remote/share/file.txt", "file:///fixture/a%2fb.txt", "file:///fixture/a%252fb.txt", "file:///fixture/a%00.txt", "javascript:alert(1)", "//remote/file", "https://example.org/file.txt", "file:///fixture/x?secret=y"]) {
    assert.equal(parseLocalFileTarget(href), null, href);
  }
});

test("never guesses redacted paths or rewrites filenames' literal spaces", () => {
  assert.equal(parseLocalFileTarget("/fixture/***/report.txt"), "/fixture/***/report.txt");
  assert.equal(parseLocalFileTarget("./report.txt:12"), "./report.txt");
  assert.equal(parseLocalFileTarget("file:///fixture/space%20.txt"), "/fixture/space .txt");
});

test("math cannot be injected into link attributes or code", () => {
  const node = rendered('[x](https://example.org/"$x$")\n\n    $y$');
  assert.equal(node.querySelectorAll("math").length, 0);
  assert.equal(node.querySelectorAll("code math").length, 0);
});

test("formula count and source size are bounded with a visible notice", () => {
  assert.ok(rendered(Array(300).fill("$x$").join(" ")).querySelectorAll("math").length <= 256);
  const node = rendered("x".repeat(200_000));
  assert.ok(node.textContent.length < 150_000);
  assert.match(node.textContent, /truncated/i);
});

test("math macros cannot leak between formulas", () => {
  const node = rendered("$\\gdef\\mycommand{x}\\mycommand$ $\\mycommand$");
  assert.match(node.textContent, /\\mycommand/);
});
