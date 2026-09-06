# Architecture

Dashboard Extras is an external OpenClaw plugin. It contributes an optional
**Math & Files** transcript and session panel through the public native Control
UI API. It does not replace the installed Control UI, intercept its composer,
or take ownership of sessions.

## Ownership

| Component | Owns | Does not own |
| --- | --- | --- |
| OpenClaw | Authentication, profiles, session lifecycle, composer, built-in transcript, plugin asset serving | This plugin's Markdown renderer |
| Plugin browser entry | Selectable transcript, mathematical Markdown, file preview, explicit open button | Core DOM, browser credentials, host configuration |
| Plugin backend | Read-only capability checks and one scoped native-open operation | Session creation, file editing, plugin/core updates |

The package uses `src/index.ts` for the backend and `src/control-ui.ts` for the
browser. The build bundles the backend with OpenClaw SDK imports external,
then calls the official `openclaw plugins build` command to produce the plugin's
content-addressed browser assets. Assets belong to this package's
`dist/control-ui/`; they are not the gateway's core asset directory.

There is no gateway wrapper, custom core asset root, host source checkout,
startup compiler, binary patch, or automatic updater in the runtime.

## Browser lifecycle

The browser entry uses `apiVersion: 1`. It registers its own `math-files`
transcript replacement and session panel. The public package defaults to the
built-in transcript. Choose **Math & Files** to opt in, or **Use built-in
transcript** to opt out. The built-in composer remains in place.

The plugin remembers only that choice in its own browser-local
`openclaw-dashboard-extras.transcript.v1` key. It does not read or modify host
preference keys. A stored `math` choice restores this view on activation; a stored
`builtin` choice prevents it. Without a stored choice, the operator-controlled
plugin setting `defaultView: "math"` can request this view; the default setting
is `"builtin"`. An explicit browser choice takes precedence over that setting.

The public host API does not expose the currently selected replacement. A
configured math default or remembered math choice can therefore win activation
order against another plugin's transcript. Do not configure that default if
another replacement should take precedence. Choosing Built-in remains an
explicit recovery action. The host's transient selection may clear on reconnect;
the plugin's own opt-in preference is applied again on activation.

Transcript content is untrusted input. The plugin renders mathematical Markdown
inside its own DOM, sanitizes output, and treats file-link parsing as UI routing,
not authorization. It does not inspect or mutate the built-in transcript's DOM.
Each view must retire asynchronous work on disposal or a session/agent change.
Stale preview responses must never authorize a native open in a different view.

Native plugin UI is an explicit, default-off OpenClaw lab. Enable **Settings →
Labs → Custom plugin UI**, then schedule the required gateway restart and reload
the browser. Use trusted localhost or HTTPS. This is trusted same-origin code,
not a sandbox. See [Security](SECURITY.md).

## Native-open boundary

The two backend methods have separate authority requirements. A global
capability query also reports the non-sensitive `defaultView` preference, even
where native opening is unavailable:

| Method | Gateway scope | Purpose |
| --- | --- | --- |
| `dashboardExtras.capabilities` | `operator.read`, required profile access | Report native-open availability; scoped calls provide current session identity/root |
| `dashboardExtras.openLocalFile` | `operator.admin`, required profile access | Open an explicitly selected regular file in its default application on the gateway Mac |

The open request supplies a session key, optional agent ID, file path, and the
session identity/root expected by the current preview. These are assertions to
validate, never grants of authority. The backend resolves the current session
and allowed roots from the gateway's public runtime APIs, validates the agent,
and rejects remote execution targets and stale state.

On macOS the backend safely opens a descriptor, checks the resolved regular
file against server-approved roots, obtains an inode-bound native file reference,
then rechecks current session/configuration authority before calling
`/usr/bin/open`. The path supplied by the browser is not a shell command or a
LaunchServices URL. The descriptor is closed on success and failure. Other
platforms and unavailable safety APIs reject native opening; math remains an
independent browser feature.

## Compatibility and tests

The minimum host release in package metadata is the earliest SDK and routing
contract audited for this plugin, not a claim that the API was introduced in
that release. It has no upper bound and does not install or pin OpenClaw.
`apiVersion: 1` identifies a protocol, not a host release.

OpenClaw labels all plugin APIs experimental. This project follows a floating
host-upgrade policy instead of the upstream recommendation to pin a tested host.
That permits normal upgrades but cannot guarantee every future release works.
Missing/incompatible APIs must fail closed, and scheduled latest-host CI gives
early evidence of drift. A passing run describes the host tested by that run;
it is not a future-compatibility guarantee.

`test/architecture.test.mjs` guards reviewed import boundaries, package ownership,
open-ended compatibility metadata, and absence of runtime broad writes, shell
execution, or core-UI replacement. These are static tripwires, not a security
proof. Behavioral tests cover rendering, request authority, stale work, and the
native file boundary; the operator smoke test in [Upgrading](UPGRADING.md)
checks the actual installed integration.

Upstream references: [Feature plugins](https://docs.openclaw.ai/plugins/feature-plugins),
[SDK stability](https://docs.openclaw.ai/plugins/sdk-overview#api-stability),
[compatibility policy](https://docs.openclaw.ai/plugins/compatibility).
