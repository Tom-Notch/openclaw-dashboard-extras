import type { ControlUiHost } from "openclaw/plugin-sdk/control-ui";

const preferenceKey = "openclaw-dashboard-extras.transcript.v1";
type TranscriptPreference = "math" | "builtin";

export function readTranscriptPreference(): TranscriptPreference | null {
  try {
    const value = globalThis.localStorage.getItem(preferenceKey);
    return value === "math" || value === "builtin" ? value : null;
  } catch {
    return null;
  }
}

export function chooseTranscript(host: ControlUiHost, preference: TranscriptPreference): void {
  if (host.signal.aborted) return;
  try {
    globalThis.localStorage.setItem(preferenceKey, preference);
  } catch {
    // Storage may be disabled. The explicit selection still works for this runtime.
  }
  if (preference === "math") host.ui.selectReplacement("transcript", "math-files");
  else host.ui.selectReplacement("transcript", null);
}
