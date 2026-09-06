# Installation, upgrades, and recovery

Dashboard Extras is an independent plugin. Neither build nor runtime updates
OpenClaw, patches core assets, installs wrappers, or changes service startup.

## From 0.1 (the separate Math & Files transcript)

0.2 deliberately removes the alternate transcript and both header actions.
Review and remove only the old setting, if present:

```sh
openclaw config unset plugins.entries.dashboard-extras.config.defaultView
```

Then update/build the checkout, validate the package and reload the native UI.
The stale browser `openclaw-dashboard-extras.transcript.v1` preference is ignored.
It cannot re-enable the old interface. There is no replacement config knob.

## Routine core updates

Use the managed stable-channel updater in the operator's maintenance window:

```sh
openclaw update --channel stable
```

Do not add exact tags, stop the service first, copy old Dashboard assets, pin
OpenClaw, or reinstall an old gateway wrapper. After the core update, run the
plugin checks against the now-installed host and inspect the live service.
A successful core update alone does not prove a plugin's UI compatibility.

## Updating this plugin

For an authorized linked checkout with no unrelated local changes:

```sh
git pull --ff-only
npm ci
npm run check
npm run test:coverage
npx playwright install chromium
npm run test:e2e
openclaw plugins validate --root . --json
```

Use **Reload plugin UI** in Dashboard plugin management for browser-only changes.
Backend changes require a normal managed Gateway restart. Preserve an existing
working artifact until the new build and UI checks pass. Do not interrupt active
work or stop a functioning Gateway merely to update browser assets.

For copied/archive installs, package the reviewed build with `npm pack`, inspect
`npm pack --dry-run`, and reinstall that exact local archive through the official
CLI. An archive/link is not an automatic registry update feed. For a registry
source, use its floating stable/latest selector and inspect the recorded install
spec; do not use `--pin` or an exact release selector. This repository's package
name does not imply an npm release already exists.

## Acceptance checks

1. `openclaw --version`, `openclaw gateway status`, health endpoint and plugin
   runtime inspection: working service, RPCs and expected plugin assets.
2. In a normal session, without choosing a mode, render inline/block/matrix
   formulas and stream a partial formula to completion.
   Compare the same display formula written on one line, several lines, and
   with an internal blank line: source layout must not leave extra empty rows.
3. Check native message groups, tool disclosures, copy/reply buttons, history,
   web links, code blocks and unsent composer text. No plugin title or second
   scrollable transcript should appear.
4. Click harmless local files, including a name with no extension and an
   arbitrary unknown suffix. The OS chooses the application; no Dashboard
   preview or file-content read is required. Merely displaying a link must not
   launch anything. Alt-click keeps native navigation available.
5. Change sessions, lose/reconnect the connection, or revoke admin access:
   pending file actions must not authorize an old request.
6. Reload the Dashboard. Enhancement remains automatic. Check fresh browser and
   Gateway errors; don't confuse a successful asset request with a working UI.

The daily macOS/Linux workflow runs these browser interactions with the latest
installed official Dashboard and synthetic RPCs. It never connects to operator
accounts, real chats, a personal browser, or a live OS file opener. It is a
compatibility signal, not an automatic deployment to anyone's Gateway.

## Fallback and recovery

If the DOM adapter no longer recognizes a host shape, native messages stay
readable and unmatched actions are omitted. A plugin initialization exception
uses OpenClaw's built-in view fallback. No compatibility failure intentionally
terminates the backend process.

Disable `dashboard-extras` in plugin management and reload the UI to remove
browser enhancements. To disable the backend as well, coordinate:

```sh
openclaw plugins disable dashboard-extras
openclaw gateway restart
```

Don't turn off the global Custom plugin UI lab if other plugins need it. No
core-file restoration is required. Reinstalling a known-good **plugin** artifact
for rollback does not require downgrading or pinning OpenClaw.

If uninstalling, inspect `openclaw plugins uninstall dashboard-extras --dry-run`
first. Only remove this plugin's managed records/artifacts; never reset user
config, chats, credentials, or workspace files.
