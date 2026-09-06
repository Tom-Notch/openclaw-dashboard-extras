import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildPlugin } from "../scripts/build.mjs";

test("builds only plugin artifacts and delegates native metadata to installed host", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-extras-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src/index.ts"), 'export default {id: "dashboard-extras", register() {}};');
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({name:"fixture",openclaw:{extensions:["./dist/index.js"],controlUi:"./src/control-ui.ts"}}));
  const calls = [];
  await buildPlugin({ root, cli: "fixture-openclaw", run(command, args, options) { calls.push({command, args, options}); } });
  assert.match(fs.readFileSync(path.join(root, "dist/index.js"), "utf8"), /dashboard-extras/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "fixture-openclaw");
  assert.deepEqual(calls[0].args, ["plugins", "build", "--root", root]);
  assert.equal(calls[0].options.shell, false);
});

test("build refuses a symlink output directory and propagates official build failures", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-extras-build-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, "other"));
  fs.symlinkSync(path.join(root, "other"), path.join(root, "dist"));
  fs.writeFileSync(path.join(root, "src/index.ts"), "export default {};");
  await assert.rejects(buildPlugin({ root, run() { assert.fail("must not run host command"); } }), /symlink/);
  fs.unlinkSync(path.join(root, "dist"));
  await assert.rejects(buildPlugin({root, run() { throw new Error("official build failed"); }}), /official build failed/);
});
