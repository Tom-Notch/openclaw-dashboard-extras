# Security and permission review

Install only code you trust. Dashboard Extras is not a sandbox: its native UI
shares the authenticated Control UI origin, and its backend runs inside the
gateway process. The gateway's plugin permissions do not make arbitrary plugin
code harmless. Review dependencies and new releases before installation.

## What the plugin is allowed to do

The browser renders the selected session's messages, previews selected files
through authorized gateway APIs, and requests native opening after an explicit
administrator click. The backend reads only the session/configuration and file
metadata needed to validate that request, and holds a read-only descriptor to
the selected file during native-open validation.

The native action opens the default application **on the gateway host**, not the
browser client. It is supported only on macOS with the required local runtime
APIs. A remote browser connected to a Mac opens the document on that Mac; a Mac
browser connected to a Linux gateway does not gain local launching. Sessions
delegated to a remote execution node are rejected.

This plugin does not install packages, change gateway configuration, edit files,
write transcripts, repair historical messages, run shell commands, or restart
services. Its only browser persistence is an operator's view choice under the
plugin-owned `openclaw-dashboard-extras.transcript.v1` key; it does not copy
credentials or write host preference keys. Operator-invoked build/install/update commands are separate workflows
that do write package and managed installation state.

## Native-open authority

`dashboardExtras.capabilities` requires `operator.read` and required profile
access. `dashboardExtras.openLocalFile` requires `operator.admin` and required
profile access. A browser's disabled button is only a usability check; the
backend enforces authorization independently.

The privileged request must pass every check:

1. Valid bounded arguments, session key, and matching agent identity.
2. A fresh server-resolved local session; the current session ID and root must
   match the preview's expected values.
3. A path inside roots derived from server configuration and session state.
   A caller-supplied `expectedRoot` cannot widen those roots.
4. A safely opened regular file whose resolved identity stays within those
   roots. Traversal, unsafe symlink targets, missing files, and directories do
   not become launch targets.
5. A validated macOS file-reference URL tied to the held descriptor's inode,
   followed by a second fresh session/configuration/roots check immediately
   before launch.

Only that validated file reference reaches `/usr/bin/open`, as an argument after
`--`, without a shell. The client path is never passed to the operating system
as a command, web URL, or application selector. Foundation runs a fixed script
over an inherited descriptor; it does not evaluate document contents or client
text as code.

Keeping a file identity stable does not make its contents trusted. Another
writer can change content, and the selected application may execute macros,
load external resources, or alter the file. Use a harmless document for testing
and never automatically open untrusted attachments. The plugin reports whether
LaunchServices accepted the request, not whether a window appeared or an
application safely processed the file.

## Browser content and races

Messages, Markdown, and file links are untrusted. Rendered output is sanitized;
mathematical rendering must not enable trusted HTML or arbitrary URL commands.
The plugin owns its own view tree and does not modify core DOM or composer
behavior. A local-looking link is only a candidate for a scoped preview.

On session changes, agent changes, disconnection, or view disposal, late work
must not restore old preview authority or dispatch an old native-open request.
The open button depends on current connection/admin capability and fresh
matching session metadata. Missing capability, malformed replies, stale state,
or backend refusal must remain visibly unavailable or show a safe error.

Literal redacted or masked paths remain literal. Do not guess a username,
expand asterisks, substitute another user's home, or loosen roots to recover a
broken link. Ordinary `http:`/`https:` links are not native-open targets.

## Unsupported hosts and upgrades

The declared minimum host is the earliest audited routing/SDK contract. There
is no exact host pin or future-version ceiling. Unsupported API versions,
missing safety helpers, older unaudited hosts, and unsupported platforms must
disable or reject the relevant operation rather than call an older internal API
or weaken checks. A future release can still break this experimental interface;
CI and manual verification cannot promise otherwise.

If an upgrade breaks the feature, use Built-in and disable the plugin while
investigating. Do not install an older core, bypass a scanner, or grant a broader
filesystem root merely to make a test pass. See [Upgrading](UPGRADING.md).

## Reporting an issue

For ordinary bugs, share a minimal synthetic reproduction, plugin version, host
version, platform, and sanitized error code. Never attach gateway tokens,
cookies, full configuration, real transcripts, environment dumps, or private
absolute paths. Review screenshots and logs before posting to a public issue.

Do not publish an exploit or sensitive reproduction in a public issue. Use the
repository's private vulnerability-reporting channel if one is enabled; if none
is available, ask the maintainer for a private channel without disclosing the
details. This document does not imply that a reporting channel or response SLA
has already been configured.
