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
  Display formulas grow to their natural height without vertical scrollbars;
  only genuinely wide formulas scroll horizontally.
- **Click any file link → default application locally, download remotely.**
  A Gateway-attested local browser opens the file with the Gateway Mac's default
  application. Remote/unknown-location browsers download it to their own device;
  a reported native-launch failure also falls back to download.
  No file-extension allowlist or preview-kind detection. Binary, empty and
  extensionless files work too; downloads preserve the original bytes.
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
  a regular file authorized by OpenClaw's current filesystem policy.
  Downloads use the same admin/profile and file-root authorization, including on
  non-Mac Gateways. Files on a remote execution node are not Gateway-local files.

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
open or download files directly. HTTP(S), mail, fragment and native session links keep
their normal owners. Alt/modified clicks retain native preview/navigation. It never
repairs literal `***` or guesses usernames in damaged historical links.

### Local versus remote

The backend uses the Gateway handshake's **server-attested local-client flag**,
not the browser's operating system, a guessed hostname, or a caller-supplied flag.
Native opening is allowed only when that flag is present; otherwise the browser
downloads the file. For native opening on the Gateway Mac, use its localhost or
loopback Dashboard address. Proxy routes that cannot attest locality deliberately
download, even if the browser happens to be on that Mac. A loopback SSH tunnel
can appear local to the Gateway; physical browser location cannot be reliably
inferred through such a tunnel. Use the normal remote Dashboard address there.

Downloads use bounded binary chunks over the existing authenticated Gateway
connection. No public file URL, copied login token, new server, preview API, or
extension/MIME allowlist is needed. The browser assembles the complete file as a
Blob, so very large files depend on the browser's available memory. A changed
file/session or revoked permission aborts the download without saving partial bytes.
The browser's normal download settings decide its destination or save dialog.

Messages are never opened/downloaded automatically; an explicit click is required.

### Files outside the session workspace

Reports saved to Downloads or another output directory need not be moved into
the session's working directory. Version 0.3.1 uses OpenClaw's public
source-aware filesystem policy resolver for the exact clicked file, honoring
the effective `tools.fs.workspaceOnly` setting and global/agent read policies.
It does not hardcode a home directory, grant all of Downloads, change your
configuration, or reinterpret the session's workspace. Restricted sessions stay
restricted. A denied folder, missing file, or changed file now has a specific
inline error instead of the same generic connection message.

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
bubbles, unclipped fractions/scripts/matrices, horizontal-only scrolling with
both ends of long formulas reachable, arbitrary and extensionless direct-file
payloads, actual browser downloads with byte-for-byte verification across chunk
boundaries, empty files, local launch failure fallback, untouched drafts, and
reload without a mode switch. It never accesses a running Gateway, accounts,
real chats, the user's browser profile, or an OS opener. Latest-host macOS/Linux
CI runs daily; it does not upgrade or deploy to anyone's machine.

`check` tests, type-checks against the installed public SDK, delegates the plugin
asset build to `openclaw plugins build`, and scans public files. The builder and
type checker use `PATH` or `OPENCLAW_CLI`, not a release selector. The lockfile
reproduces plugin dependencies; it does not pin OpenClaw.
The filesystem-policy regression uses the installed host's **real public SDK**
with isolated synthetic state/config/files: outputs outside a narrower workspace,
global/agent restrictions and overrides, and permission revocation during I/O.

Further reading: [Architecture](docs/ARCHITECTURE.md),
[Security](docs/SECURITY.md), [Upgrades](docs/UPGRADING.md), [Notices](NOTICE).

## 中文说明

公式直接渲染在原生 session conversation 中；点击文件链接时，已确认在 Gateway
本机的浏览器使用系统默认软件，远程浏览器则下载到当前设备。本机启动应用失败也
会尝试下载。**不枚举扩展名、不依赖预览支持**，也没有第二套聊天视图。
需要原生侧栏时可 Alt-click。本机默认应用模式请通过 localhost/loopback 访问；
无法确认本机身份的代理连接按远程处理。下载沿用原有管理员和会话文件权限。

插件不覆盖 Dashboard、不锁 OpenClaw 版本。公式位置有一小层仅作用于原生
transcript 的 DOM 适配，未来 UI 大改可能需要更新。每日 CI 使用当时最新版
的真实 Dashboard 检查，不会自动升级或重启你的 Gateway。
