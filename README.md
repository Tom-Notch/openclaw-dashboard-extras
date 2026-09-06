# OpenClaw Dashboard Extras

Independent OpenClaw plugin for mathematical Markdown and explicit, authorized
opening of local files in the Gateway host's default application.

Work in progress: not published or installed yet. The implementation uses the
public native Control UI plugin contract instead of replacing OpenClaw's
Dashboard assets. It does not pin or install an OpenClaw host version.

The plugin owns a selectable transcript view and its own file preview. The
built-in composer, session ownership, and default transcript remain OpenClaw's.

## Development rules

- Never read or publish local credentials, transcripts, or user configuration.
- No host-internal imports, minified bundle patches, or DOM surgery on built-in
  views. Use the public plugin SDK and authenticated host requests.
- Keep native file opening explicit, administrator/profile protected, scoped
  to server-owned roots, and bound to the verified file object.
- Add and execute tests before changing production behavior.
- Keep host upgrades unrestricted; compatibility evidence is not a version pin.
