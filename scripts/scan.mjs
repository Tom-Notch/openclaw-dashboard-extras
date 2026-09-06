import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const patterns = [
  ["personal home path", /\/(?:Users|home)\/[^/\s"'`]+\//gu],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu],
  ["provider secret", /\bsk-[A-Za-z0-9_-]{20,}\b/gu],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{30,}\b/gu],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/gu],
  ["private dashboard session", /\bagent:[^\s"'`]+:dashboard:[0-9a-f-]{20,}\b/gu],
];

export function inspectText(text, file) {
  const findings = [];
  for (const [kind, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      findings.push({ file, line: text.slice(0, match.index).split("\n").length, kind });
    }
  }
  return findings;
}

export function inspectRepository(root) {
  const findings = [];
  let files = 0;
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if ([".git", "node_modules", "coverage", "test-results", "playwright-report"].includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const file = path.relative(root, absolute);
      if (entry.isSymbolicLink()) { findings.push({ file, kind: "symlink" }); continue; }
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile()) continue;
      files++;
      const bytes = fs.readFileSync(absolute);
      if (!bytes.includes(0)) findings.push(...inspectText(bytes.toString("utf8"), file));
    }
  }
  walk(root);
  return { files, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectRepository(fileURLToPath(new URL("..", import.meta.url)));
  if (result.findings.length) {
    process.stderr.write(JSON.stringify({ status: "FAIL", findings: result.findings }, null, 2) + "\n");
    process.exitCode = 1;
  } else {
    process.stdout.write(`Publication hygiene check passed across ${result.files} files.\n`);
  }
}
