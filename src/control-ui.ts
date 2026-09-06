import type { ControlUiPlugin } from 'openclaw/plugin-sdk/control-ui';
import { mountNativeTranscript } from './native-transcript.ts';

export default {
  id: 'dashboard-extras',
  activate(host) {
    if (host.apiVersion !== 1) {
      throw new Error('Unsupported Control UI plugin API. The built-in conversation remains available.');
    }
    const unregister = host.ui.registerReplacement({
      id: 'math-files', label: 'Conversation enhancements', surface: 'transcript', mount: mountNativeTranscript,
    });
    // Enabling the plugin enables decoration of the REAL transcript. No mode
    // buttons, alternate view, or plugin-owned chat/composer/session state.
    host.ui.selectReplacement('transcript', 'math-files');
    return unregister;
  },
} satisfies ControlUiPlugin;
