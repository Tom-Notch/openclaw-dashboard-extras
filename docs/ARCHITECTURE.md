# Architecture: native composition, not another chat UI

## Ownership

| Owner | Responsibilities |
| --- | --- |
| OpenClaw | Native transcript, message grouping, tools, history, composer, sessions, authentication, file link routing, preview/editor, plugin asset serving |
| Browser plugin | Mount native transcript; insert sanitized MathML at matched formula text; delegate explicit local-file clicks to the OS default application |
| Backend plugin | `operator.read` capabilities and `operator.admin` file opening with required profile access and independent filesystem authorization |

`control-ui.ts` registers a transcript contribution and immediately selects it.
Its mount function calls the **public `context.mountDefault`** exactly once.
A layout-neutral `display: contents` node is the mount point. The plugin does
not iterate messages into cards, render tool results, replace a composer, load
history itself, or maintain session state.

The backend build externalizes public SDK imports. The official
`openclaw plugins build` command builds content-addressed browser assets owned
by this package. There are no imports of core `src`/`dist` modules, fixed hashed
core chunks, custom core roots, wrappers, or startup compilers.

## Explicit DOM compatibility seams

The SDK currently lacks Markdown decorators and native file-link action hooks.
These parts are therefore **DOM adapters**, not promises of public-API stability:

| Seam | Use | When absent/changed |
| --- | --- | --- |
| `[data-message-text]` and descendant `.chat-text` | Source-backed formula location inside mounted native messages | Leave native content readable |
| `.chat-text a` / native `data-file-path` | Explicit local-file clicks, independent of file extension | Keep web/session/fragment navigation native; no global interception |
| `--chat-text-size` | One formula base size across prose, headings and tables, following live user font-size changes | Fall back to inherited `1em` |
| Native `br` / `p` inside matched math ranges | Suppress line breaks and empty paragraph remnants already consumed by math | Leave unrelated/unknown markup and prose spacing alone |

The observer is restricted to its own mounted transcript.
It never changes core methods, stylesheets, global renderer functions, document
prototypes, or persistent messages. It retains native element and Lit boundary
comment identities. The test suite specifically guards those boundaries.

### Math

1. Read the displayed native message's original Markdown, with work limits.
2. Extract closed TeX fragments outside code/fences; do not consume prices.
3. Project each fragment through ordinary Markdown solely to locate its text
   in the native DOM, accounting for consumed TeX escapes/emphasis.
4. Render the **original TeX** using bounded, untrusted KaTeX with fresh macros;
   sanitize to a narrow MathML allowlist.
5. Replace only matching text ranges with MathML. Do not delete native elements,
   links, code blocks, or Lit markers. Unknown markup remains native text.

Completed formulas appear on native streaming updates. Formula count, source
length, expansion and cache limits cap work; oversized/unmatched expressions
remain readable, without truncating the host message.

Formula wrappers use the conversation's base-size token rather than inheriting
incidental heading/table font sizes. This does not override MathML script depth,
inline/display fraction layout, or explicit TeX sizing. Native text styles are
untouched, and an existing formula follows chat-size changes without rerendering.

Before replacing text, the adapter records only line breaks and paragraphs
intersecting that formula's source range. Consumed breaks and now-empty
paragraphs are hidden, not removed; their original inline display styles are
restored when the host changes/reuses the source or detaches the nodes. Display
math also replaces its immediate delimiter line boundaries. Small collapsible
margins share native paragraph spacing instead of adding padding on top of it.
Unrelated prose breaks, native elements and Lit markers retain their owners.

### Direct file actions and lifetime

The click handler runs only inside this mounted native transcript. It uses the
native file target when available, otherwise classifies scheme-less Markdown
paths or local `file:` URLs. It never tests extensions, sniffs MIME types, checks
preview kinds, or reads a file through `sessions.files.get` first. Explicit
clicks query scoped capability/identity, then pass the target to the authorized
backend; LaunchServices chooses the application for that actual file.

HTTP(S), email, fragment and native session links keep their original owner.
Alt/modified clicks keep OpenClaw's existing navigation/side-panel behavior.
There is no content auto-open, wildcard expansion, username substitution or
silent fallback to another path. Non-local file URL authorities are rejected.

The native transcript context supplies the session/agent identity, including
split panes. Async work is retired on session/agent changes, unpresentation,
disconnection or disposal. Repeated clicks during one pending open coalesce.
Failures appear beside the clicked link; success adds no alternate view or panel.

## Backend security boundary

The browser sends `{sessionKey, agentId, path, expectedSessionId, expectedRoot}`.
These are assertions, not permissions. The backend resolves the live session
and approved roots, rejects remote/stale sessions, safely opens a regular file,
checks containment and root identities, obtains an inode-bound macOS file
reference, and rechecks session/config authority before `/usr/bin/open`.
The user path is never evaluated as a command or passed as a LaunchServices URL.
Unsupported safety APIs disable the operation, not Gateway startup.

## Compatibility evidence

The package has an audited minimum SDK floor, no host-version equality test,
no future ceiling, and no runtime installer. The SDK is experimental and DOM
structure can change even without an API-version bump.

Unit tests exercise native ownership, math, stale lifetimes, permissions,
filesystem races, and resource limits. The browser test serves the **installed
production Dashboard** with fully synthetic Gateway responses, then exercises
the complete native render and direct-link paths. CI installs `openclaw@latest`
on disposable Linux and macOS runners. A passed run proves that tested host,
not all future versions.

Upstream: [Feature plugins](https://docs.openclaw.ai/plugins/feature-plugins).
