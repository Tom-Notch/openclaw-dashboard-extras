# OpenClaw Dashboard Extras

Independent OpenClaw plugin for mathematical Markdown and explicit, authorized
opening of local files in the Gateway host's default application.

This is an **independent plugin**, not a patched OpenClaw distribution. It does
not replace Dashboard assets, inspect the built-in DOM, install a second
OpenClaw, or pin the host to a particular release.

## Features

- **Math & Files transcript:** renders `$…$`, `$$…$$`, `\(…\)` and `\[…\]`
  from the original Markdown, including streaming responses. KaTeX runs locally
  and emits sanitized native MathML. Code and ordinary prices stay literal.
- **Local file preview:** a file link opens a plugin-owned preview. An explicit
  **Open in Default Application** button performs the authorized native launch.
  Merely displaying, selecting, or previewing a link never launches anything.
- **Built-in remains available:** OpenClaw still owns the composer, sessions,
  connection, tools, and agent execution. Switch back with **Use built-in
  transcript** whenever you want the official rich cards or history controls.

Math and text previews work in modern browsers on supported OpenClaw hosts.
Native application opening is currently **macOS only**, and happens on the
**Gateway host**, not the machine running a remote browser. Binary files have
a metadata-only preview; they are not embedded or downloaded automatically.

## Requirements and compatibility

- An existing OpenClaw installation with the audited plugin API floor
  `>=2026.9.2`. There is no maximum host version and no exact-release check.
- A Node.js version supported by your OpenClaw installation; Node 24's latest
  patch or newer supported release is suitable for building this project.
- Native Custom plugin UI enabled. Open the Gateway's own Dashboard over
  HTTPS or a browser-trusted loopback address.
- Native file opening requires an authenticated administrator/profile and a
  file allowed by the session's server-side workspace/media-root policy.

OpenClaw currently labels its plugin APIs **experimental**. Independence
reduces coupling; it is not a promise that every future breaking API change
will be compatible. See [upgrade policy](docs/UPGRADING.md). Scheduled CI tests
`openclaw@latest`; it does not upgrade anyone's running Gateway.

## Install from this repository

Review the source and [security model](docs/SECURITY.md) first. Native plugins
run trusted browser code with the signed-in operator's authority.

```sh
git clone https://github.com/Tom-Notch/openclaw-dashboard-extras.git
cd openclaw-dashboard-extras
npm ci
npm run check
openclaw plugins validate --root . --json
openclaw plugins install --link . --force
openclaw plugins enable dashboard-extras
openclaw config set gateway.controlUi.experimental.customPlugins true
openclaw gateway restart
```

`--force` confirms the local, non-store source; it is not a safety-scanner
bypass. If the installer requests capability or policy approval, inspect that
specific report. Do not disable security checks to make installation pass.

Keep the linked checkout at its chosen location. The plugin does not depend
on a directory containing an OpenClaw version number. Refresh the Dashboard
after installation, then choose **Math & Files transcript** in its header
actions (the action is labelled **Use Math & Files**). Your choice is remembered
in a plugin-namespaced browser preference.
**Use built-in transcript** stores the opposite preference.

For an explicitly opted-in deployment, make the plugin view the initial
default in browsers that have no saved preference:

```sh
openclaw config set plugins.entries.dashboard-extras.config.defaultView math
openclaw gateway restart
```

The shipped default is `builtin`. A browser's explicit choice wins over this
setting. The public SDK cannot inspect another plugin's selected replacement;
if multiple plugins auto-select transcripts, activation order can matter.

If `openclaw` is not on the build process's PATH, use
`OPENCLAW_CLI=/absolute/path/to/openclaw npm run build`. This is a local
executable path, not a host-version selector.

## Using local file links

Have your bot emit ordinary Markdown with a real local path, for example:

```markdown
[Report](/workspace/reports/final report.pdf)
[Notes](./notes.md)
[File URL](file:///workspace/reports/final%20report.pdf)
```

Clicking the link only previews it. The native button becomes available after
the Gateway confirms the session incarnation and workspace. Opening rechecks
those facts and the underlying file. A path is not an authorization grant.
The plugin never guesses missing usernames or replaces literal `***` in old
links; regenerate an already-redacted link from its actual target.

## Upgrade, disable, and recover

Upgrade OpenClaw normally. There is no UI overlay to rebuild for each core
release, no updater wrapper to reinstall, and no patched minified bundle to
copy forward. Keep this plugin independently up to date:

```sh
git pull --ff-only
npm ci
npm run check
openclaw plugins validate --root . --json
openclaw gateway restart
```

Back up local plugin changes before pulling. For a copied/package install,
reinstall the tested package instead of assuming it follows this checkout.
To stop using the plugin, select **Use built-in transcript**. To disable it:

```sh
openclaw plugins disable dashboard-extras
openclaw gateway restart
```

Do not turn off the global Custom plugin UI lab if other plugins need it.
For migration from a previous whole-Dashboard overlay, read the dedicated
[upgrade and recovery guide](docs/UPGRADING.md); this plugin's installer does
not silently rewrite unrelated configuration or launch services.

## Development and verification

```sh
npm test
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
```

Tests use synthetic sessions and local temporary files. Native launch calls
are mocked; macOS tests also verify real descriptor-to-Foundation references
without opening an application. Browser tests load the actual built plugin
in an isolated browser, not a personal browser profile.

`npm run check` runs tests, uses the installed OpenClaw's public native asset
builder, and scans the publication tree for credentials and personal paths.
`npm audit` and an independent secret scan are additional release gates.
The lockfile records reproducible plugin dependencies; it does not contain or
freeze an OpenClaw installation.

Further reading: [architecture](docs/ARCHITECTURE.md),
[security](docs/SECURITY.md), [upgrades](docs/UPGRADING.md), and
[third-party notices](NOTICE).

## 中文说明

这是独立插件，不再按 OpenClaw 版本替换整套 Dashboard，也不锁定主程序版本。
选择 **Math & Files transcript** 使用数学视图；本地文件链接先进入插件预览，
再由你明确点击默认应用按钮。需要官方完整卡片或历史操作时，随时切回内置视图。
默认应用打开的是 **Gateway 所在 Mac** 上的文件。插件 API 若在未来发生破坏性
变化，仍可能需要更新插件；不能把“不 pin”理解成“所有未来版本永久兼容”。
