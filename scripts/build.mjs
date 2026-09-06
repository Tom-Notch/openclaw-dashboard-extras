import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

export async function buildPlugin({
  root = fileURLToPath(new URL("..", import.meta.url)),
  cli = process.env.OPENCLAW_CLI || "openclaw",
  run = execFileSync,
} = {}) {
  const output = path.join(root, "dist");
  if (fs.lstatSync(output, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error("Refusing a symlink plugin output directory.");
  }
  fs.mkdirSync(output, { recursive: true });
  await build({
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["openclaw", "openclaw/*", "@openclaw/*"],
    sourcemap: false,
    legalComments: "eof",
  });
  // The installed host owns native plugin metadata and immutable asset layout.
  // This command never installs, upgrades, configures, or restarts that host.
  run(cli, ["plugins", "build", "--root", root], { cwd: root, stdio: "inherit", shell: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPlugin();
}
