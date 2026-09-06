import type { ControlUiPlugin } from "openclaw/plugin-sdk/control-ui";
import { mountFilePanel, mountTranscript } from "./transcript.ts";
import { chooseTranscript, readTranscriptPreference } from "./ui-preference.ts";

export default {
  id: "dashboard-extras",
  async activate(host) {
    if (host.apiVersion !== 1) {
      throw new Error("This Control UI plugin API is unsupported. The built-in views remain available.");
    }
    const disposeTranscript = host.ui.registerReplacement({
      id: "math-files", label: "Math & Files", surface: "transcript", mount: mountTranscript,
    });
    const disposePanel = host.ui.registerPanel({ id: "math-files", label: "Math & Files", mount: mountFilePanel });
    let explicitSelections = 0;
    const disposeMathAction = host.ui.registerAction({
      id: "use-math-files", label: "Use Math & Files", placement: "header",
      run(context) {
        if (context.signal.aborted) return;
        explicitSelections += 1;
        chooseTranscript(context.host, "math");
      },
    });
    const disposeBuiltinAction = host.ui.registerAction({
      id: "use-builtin-transcript", label: "Use built-in transcript", placement: "header",
      run(context) {
        if (context.signal.aborted) return;
        explicitSelections += 1;
        chooseTranscript(context.host, "builtin");
      },
    });
    const preference = readTranscriptPreference();
    if (preference === "math") host.ui.selectReplacement("transcript", "math-files");
    else if (preference === null) {
      try {
        const availability = await host.request<{ defaultView?: unknown }>("dashboardExtras.capabilities");
        if (!host.signal.aborted && explicitSelections === 0 && readTranscriptPreference() === null && availability?.defaultView === "math") {
          host.ui.selectReplacement("transcript", "math-files");
        }
      } catch {
        // Without a configured default, the registered views remain explicitly selectable.
      }
    }
    return () => { disposeBuiltinAction(); disposeMathAction(); disposePanel(); disposeTranscript(); };
  },
} satisfies ControlUiPlugin;
