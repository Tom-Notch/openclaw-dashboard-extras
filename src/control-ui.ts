import type { ControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { mountFilePanel, mountTranscript } from "./transcript.ts";

export default {
  id: "dashboard-extras",
  activate(host) {
    if (host.apiVersion !== 1) {
      throw new Error("This Control UI plugin API is unsupported. The built-in views remain available.");
    }
    const disposeTranscript = host.ui.registerReplacement({
      id: "math-files", label: "Math & Files", surface: "transcript", mount: mountTranscript,
    });
    const disposePanel = host.ui.registerPanel({ id: "math-files", label: "Math & Files", mount: mountFilePanel });
    return () => { disposePanel(); disposeTranscript(); };
  },
} satisfies ControlUiPlugin;
