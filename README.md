# OpenClaw Dashboard Extras

**Math and local file actions inside the normal OpenClaw conversation.**
No second transcript. No “Use Math & Files” button. No replacement Dashboard.

Version 0.2 fixes the 0.1 design mistake: a separate, simplified transcript
is not a seamless enhancement. The plugin now mounts OpenClaw's **actual native
transcript** and decorates it. Message groups, tool disclosures, copy/reply
buttons, the composer, history, and file previews remain owned by OpenClaw.

## What you get

- `$…$`, `$$…$$`, `\(…\)`, and `\[…\]` formulas in existing message bubbles,
  including completed formulas in streamed responses. KaTeX runs locally and
  emits sanitized MathML. Code, prices, links, and native rich blocks remain.
  Formula base size follows the live chat-text setting consistently across
  paragraphs, headings and tables. MathML still preserves normal script/fraction
  hierarchy and explicit TeX size commands; it does not flatten all glyphs.
  Multiline TeX does not leave source line breaks or empty paragraphs behind
  the rendered formula. Surrounding prose retains its normal spacing.
- **Click any local file link → the Gateway host's system default application.**
  No file-extension allowlist, preview-kind detection, or Dashboard file-read
  request. Files without extensions work too. The OS decides which app to use.
  Alt-click retains OpenClaw's original side-panel behavior when needed.
- No OpenClaw version pin, core asset patch, upgrade wrapper, or startup build.

**Compatibility boundary:** loading and native-view composition use the public
plugin API. Formula placement uses a small, transcript-scoped DOM adapter because the SDK
has no Markdown-decoration API. Local-link clicks use delegated DOM events. This is
not a guarantee against future UI changes. CI tests the *real installed latest
Dashboard*, not just a lookalike fixture. See [Architecture](docs/ARCHITECTURE.md).

## Requirements

- An existing OpenClaw installation, audited API floor `>=2026.9.2` (no upper
  bound or exact-version restriction), and its supported Node.js runtime.
- **Settings → Labs → Custom plugin UI**, with Dashboard served over HTTPS or
  trusted loopback. Native plugins are trusted code, not a sandbox.
- Native opening: macOS **Gateway host**, an authenticated admin/profile, and
  a regular file authorized by that session's workspace/media-root policy.
  Remote execution-node sessions and unsupported platforms cannot launch files.

## Install

Review [Security](docs/SECURITY.md), then use the existing OpenClaw CLI:

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

Keep the linked checkout in place. If the installer requests capability
consent, review its report; after approving this specific plugin, repeat with
`--accept-capabilities`. `--force` is not a scanner bypass.

**Refresh the Dashboard. Nothing to select:** enabling the plugin automatically
enhances the native conversation. There is no plugin view preference or config.
If upgrading from 0.1, remove its obsolete setting before building 0.2:

```sh
openclaw config unset plugins.entries.dashboard-extras.config.defaultView
```

Only run that command if the old setting exists. Old browser view preferences
are ignored; they no longer select an alternate transcript. Another plugin that
also selects a transcript may conflict: the SDK has no replacement-composition
priority API. Do not enable competing transcript replacements.

## Writing links

Use real local paths and standard Markdown. Angle brackets preserve spaces:

```markdown
[Report](</workspace/reports/final report.pdf>)
[Notes](./notes.md)
[Source](/workspace/src/main.ts:12)
```

Plain clicks on native file links and scheme-less local Markdown destinations
open local files directly. HTTP(S), mail, fragment and native session links keep
their normal owners. Alt/modified clicks retain native preview/navigation. It never
repairs literal `***` or guesses usernames in damaged historical links.

Opening happens **on the Gateway host**, not on a remote browser's computer.
Messages are never opened automatically; an explicit file-link click is required.

## Upgrades and recovery

Upgrade OpenClaw normally using its stable channel. There is no per-release
UI overlay to rebuild or minified core chunk to patch. Upgrade this linked
plugin separately:

```sh
git pull --ff-only
npm ci
npm run check
npm run test:e2e
```

Browser-only updates use the Dashboard's **Reload plugin UI** operation.
Backend changes need a normal managed Gateway restart. See the
[upgrade guide](docs/UPGRADING.md) for copied installs and migration.

If an upstream UI change breaks enhancement, the built-in transcript remains
mounted and readable; a missing file seam does not authorize a native open.
To remove all enhancements, disable `dashboard-extras` in plugin management
and reload its UI; coordinate a Gateway restart when disabling the backend.
This plugin does not downgrade or stop OpenClaw to force compatibility.

## Verification

```sh
npm test
npm run typecheck
npm run test:coverage
npm run build
npx playwright install chromium
npm run test:e2e
```

`test:e2e` serves the **installed OpenClaw's unmodified production Dashboard
assets** in isolated Chromium with synthetic RPCs. It checks math in native
bubbles, arbitrary and extensionless direct-file payloads, untouched drafts,
and reload without a mode switch. It never accesses a running Gateway, accounts,
real chats, the user's browser profile, or an OS opener. Latest-host macOS/Linux
CI runs daily; it does not upgrade or deploy to anyone's machine.

`check` tests, type-checks against the installed public SDK, delegates the plugin
asset build to `openclaw plugins build`, and scans public files. The builder and
type checker use `PATH` or `OPENCLAW_CLI`, not a release selector. The lockfile
reproduces plugin dependencies; it does not pin OpenClaw.

Further reading: [Architecture](docs/ARCHITECTURE.md),
[Security](docs/SECURITY.md), [Upgrades](docs/UPGRADING.md), [Notices](NOTICE).

## 中文说明

公式直接渲染在原生 session conversation 中；点击任何本地文件链接直接交给
Gateway 所在 Mac 的系统默认软件。**不枚举扩展名、不依赖预览支持**，也没有
第二套聊天视图。需要原生侧栏时可 Alt-click。

插件不覆盖 Dashboard、不锁 OpenClaw 版本。公式位置有一小层仅作用于原生
transcript 的 DOM 适配，未来 UI 大改可能需要更新。每日 CI 使用当时最新版
的真实 Dashboard 检查，不会自动升级或重启你的 Gateway。
