# Security and permission review

Install only code you trust. Dashboard Extras is not a sandbox: its native UI
shares the authenticated Control UI origin, and its backend runs inside the
gateway process. The gateway's plugin permissions do not make arbitrary plugin
code harmless. Review dependencies and new releases before installation.

## What the plugin is allowed to do

The browser decorates native messages and routes local-file links through authorized
gateway APIs after an explicit administrator click. The backend reads only the session/configuration and file
metadata needed to validate that request, and holds a read-only descriptor to
the selected file during native-open validation or bounded download reads.

The native action opens the default application **on the gateway host**, not the
browser client. It is supported only on macOS with the required local runtime
APIs and the Gateway's server-attested local-client flag. Remote browsers never
request a native launch; they download the file to their own device. Non-Mac
Gateways can serve downloads but do not gain native launching. The flag is a
transport attestation: an indistinguishable loopback tunnel is not a physical
location detector. Unknown/proxy routes without the flag download conservatively.
Sessions delegated to a remote execution node are rejected: remote browser
location and remote file/execution location are separate concerns.

This plugin does not install packages, change gateway configuration, edit files,
write transcripts, repair historical messages, run shell commands, or restart
services. It has no browser-persisted view preference and does not copy
credentials or write host preference keys. Operator-invoked build/install/update commands are separate workflows
that do write package and managed installation state.

## Native-open authority

`dashboardExtras.capabilities` requires `operator.read` and required profile
access. `dashboardExtras.openLocalFile` requires `operator.admin` and required
profile access, plus attested local-client admission. `dashboardExtras.readLocalFile`
also requires `operator.admin` and required profile access; downloads do not
broaden file access for read-only profiles. Browser-side click guards are only usability checks; the backend enforces
authorization independently.

The privileged request must pass every check:

1. Valid bounded arguments, session key, and matching agent identity.
2. A fresh server-resolved local session; the current session ID and root must
   match the click's fresh capability snapshot.
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

## Download authority

The download RPC reuses session incarnation, configured roots, safe regular-file
descriptor, containment and live-policy checks. Each response contains at most
512 KiB of file bytes, base64-encoded for the existing authenticated connection.
No credentials are copied and no unauthenticated endpoint or capability URL is
created. The browser rejects inconsistent offsets, lengths or revisions and
never saves a partial download. A replaced/modified file is rejected based on
descriptor identity and nanosecond modification/change timestamps. This is
change detection, not a snapshot against a privileged writer able to manipulate
filesystem metadata. Empty and arbitrary binary files remain valid.

The completed Blob uses `application/octet-stream` with an explicit download
attribute. HTML/SVG and other active content are downloaded, never executed or
navigated to by the plugin. Temporary object URLs are revoked after use. The
browser buffers the entire completed file; available client memory limits very
large transfers. Existing RPC authentication/transport limits remain in force.

## Browser content and races

Messages, Markdown, and file links are untrusted. Rendered output is sanitized;
mathematical rendering must not enable trusted HTML or arbitrary URL commands.
The plugin mounts the real built-in transcript. Its documented, transcript-scoped
DOM adapter changes only matched formula text and explicit local-link events;
it preserves native message elements, Lit boundary comments, code/link nodes,
and composer behavior. It intercepts only local-file clicks inside its transcript; ordinary web and
native session links are unchanged. It never guesses a missing target.
DOM shape and caller-provided paths never constitute file authorization.

On session changes, agent changes, disconnection, or view disposal, late work
must not dispatch an old native-open request.
The click handler checks current connection/admin capability and fresh
matching session metadata. It never requires a preview, extension match or
MIME sniff; the system default application or browser download handles the validated regular file. Missing capability, malformed replies, stale state,
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

If an upgrade breaks the feature, disable the plugin while
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
