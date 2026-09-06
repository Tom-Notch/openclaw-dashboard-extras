# Installing and upgrading

Keep OpenClaw on its normal release channel. Dashboard Extras is a separately
managed plugin, not a replacement gateway or Control UI distribution. Neither
its runtime nor its build installs or changes OpenClaw.

## Review before installation

Native plugin UI runs with the authenticated operator's browser authority, and
the backend can launch a default application on the gateway Mac. Review
[Security](SECURITY.md), the source, dependencies, build scripts, and the packed
file list before enabling it. Do not pipe a remote installer into a shell.

From a reviewed checkout, with a compatible `openclaw` CLI already on `PATH`:

```sh
npm ci
npm run check
npm pack --dry-run
npm pack
```

`check` runs tests, checks source types against the installed public SDK, builds
the backend and native UI, and scans the project.
`npm ci` reproduces the plugin's dependency lock; it does not pin the installed
OpenClaw. `OPENCLAW_CLI` may select an existing CLI for the build without
installing one. Inspect the generated archive, then pass its exact filename to
the official installer:

```sh
openclaw plugins install ./reviewed-plugin-archive.tgz
openclaw plugins inspect dashboard-extras
openclaw plugins enable dashboard-extras
```

Replace the example archive name with the file just reviewed. Let the CLI show
provenance, install policy, and capability-consent prompts. Do not bypass a
security block or treat `--force` as permission approval. Installation and
enabling change managed plugin state/configuration, so an automation bot must
obtain operator authorization for these steps.

Enable **Settings → Labs → Custom plugin UI** if needed. Coordinate one normal
gateway restart after backend installation or lab-setting changes; do not
interrupt active runs without the operator's agreement. Reload the browser and
select **Math & Files** in the customization controls. Merely enabling the
public package does not replace the built-in transcript automatically.

The plugin's own actions remember a `math` or `builtin` browser preference under
`openclaw-dashboard-extras.transcript.v1`. Its backend setting `defaultView`
defaults to `"builtin"`; an operator can explicitly set it to `"math"` for a
managed migration. A remembered Built-in choice overrides that configured
default. Because the public API has no current-replacement getter, configured
or remembered math can win activation order over another plugin's transcript.
Leave the default unchanged when another replacement should take precedence.

## Routine core upgrades

Use the official managed updater in an agreed maintenance window:

```sh
openclaw update --channel stable
```

Do not add an exact `--tag`, manually stop the gateway first, use an old wrapper,
or copy an earlier release's UI over the new installation. The official updater
coordinates the core/package and service lifecycle. This external plugin remains
separate; a core update is not proof that its features passed on the new host.

After upgrading, inspect the plugin and run the smoke test below. If a host API
has changed, use Built-in and disable the plugin while a reviewed fix is prepared;
do not downgrade or pin the core to conceal incompatibility.

## Plugin upgrades

Use the source recorded by the official installer. For a tracked registry or
Git install, review its new release and run:

```sh
openclaw plugins update dashboard-extras --dry-run
openclaw plugins update dashboard-extras
```

An archive or local checkout has no automatic release feed. Fetch/review the new
checkout, repeat the build and archive review, then explicitly reinstall that
new archive with `openclaw plugins install ./reviewed-plugin-archive.tgz --force`.
`--force` acknowledges an intended overwrite; it still does not bypass install
policy or capability consent. Linked development installs use the official
`--link` workflow and the operator maintains their checkout/build.

If this package is published to npm, prefer its unversioned package name or
`@latest` selector, never `--pin` or an exact version. Do not assume publication
merely because a package name exists in this repository. Likewise, use a
reviewed Git source without a tag/commit selector if choosing a floating Git
install. Resolved archive hashes, Git commits, lockfile versions, and build
hashes record what was tested; they are not requests to freeze the host.

Changing a previously exact npm selector requires an explicit new floating
package spec through `plugins update`; updating by plugin ID preserves the
previous selector. Inspect the managed record afterward. Never hand-edit the
plugin index or shared state database to remove pins.

Browser-only changes can use the host's **Reload plugin UI** action after a
successful build. Backend changes still need the normal gateway restart.

## Verification after every upgrade

1. Record `openclaw --version` and run `openclaw plugins inspect dashboard-extras
   --runtime --json`. Confirm the expected plugin and RPCs; do not publish the
   whole operator configuration or transcript.
2. Reload the browser, select **Math & Files**, and check inline, block, and
   matrix formulas in a synthetic session. Confirm the built-in composer still
   sends normally and Built-in remains available.
3. Preview a harmless regular file inside that session's approved workspace.
   On a gateway Mac, an administrator's explicit default-app click should open
   it on that Mac. Verify this where the gateway runs, not on a remote client.
4. Check a disallowed path, a stale session/root, and an unavailable native
   capability. These must produce a visible refusal or unavailable state, never
   launch an application. Non-admin users must not acquire native-open access.
5. Check gateway/plugin diagnostics for new errors. A passing asset load alone
   is not proof that math and native opening work.

The repository workflow runs tests, strict public-SDK type checking, and builds
against a freshly installed `openclaw@latest` on pull requests, main-branch
changes, manual dispatch, and a
daily schedule. It has no operator credentials, does not deploy, and does not
open user documents. CI is a compatibility signal, not an unattended live
upgrader. Check the actual workflow result; the presence of a workflow file is
not evidence that a hosted run has passed.

## Recovery and rollback

For a UI issue, select **Built-in**. To remove backend capability as well:

```sh
openclaw plugins disable dashboard-extras
```

Coordinate a gateway restart and reload the browser. Disabling the Custom plugin
UI lab alone does not disable backend methods. Keep the disabled package and
reviewed archive for investigation; do not delete user files or reset config.

For removal, first inspect the official preview:

```sh
openclaw plugins uninstall dashboard-extras --dry-run
openclaw plugins uninstall dashboard-extras --keep-files
```

Uninstall changes plugin records/settings; `--keep-files` preserves installed
artifacts. Confirm the preview before proceeding. A temporary reinstall of a
previous reviewed plugin artifact is an explicit rollback, not a reason to pin
OpenClaw or silently change a floating update selector. No core asset restoration
is needed because the plugin never overwrites core assets.

If migrating from an older whole-UI overlay, treat removal of that operator's
custom asset root/wrapper as a separate, authorized change. This plugin neither
detects nor rewrites unrelated installation customizations.

Command references: [Plugin CLI](https://docs.openclaw.ai/cli/plugins),
[managed core update](https://docs.openclaw.ai/cli/update),
[native UI lifecycle](https://docs.openclaw.ai/plugins/feature-plugins).
