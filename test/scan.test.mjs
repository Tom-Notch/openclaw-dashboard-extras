import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectText } from "../scripts/scan.mjs";

test("publication scan reports secret categories without echoing matched data", () => {
  const secret = ["ghp", "A".repeat(36)].join("_");
  const findings = inspectText(`const value = "${secret}";`, "fixture.ts");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].kind, "GitHub token");
  assert.equal(JSON.stringify(findings).includes(secret), false);
});

test("publication scan excludes real machine homes and transcript identifiers", () => {
  const home = ["", "Users", "fixture-owner", "secret.txt"].join("/");
  assert.equal(inspectText(home, "fixture.ts")[0].kind, "personal home path");
  assert.equal(inspectText("const sample = '/fixture/work/report.txt';", "fixture.ts").length, 0);
});
