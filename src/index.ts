import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import {
  getDashboardCapabilities,
  isSupportedHost,
  openLocalFileFromDashboard,
  supportsNativeOpenRuntime,
  type NativeOpenDeps,
} from './open-local-file.js';

export { openLocalFileFromDashboard, createMacOSFileReference } from './open-local-file.js';

/** Exported separately so registration can be tested without launching a Gateway. */
export function registerDashboardExtras(api: OpenClawPluginApi, deps: NativeOpenDeps = {}): void {
  try {
    if (typeof api?.registerGatewayMethod !== 'function' || !isSupportedHost(api)) return;
    api.registerGatewayMethod('dashboardExtras.capabilities', async ({ params, respond }) => {
      try {
        respond(true, await getDashboardCapabilities(api, params, deps));
      } catch {
        respond(true, { nativeOpen: false });
      }
    }, { scope: 'operator.read', profileAccess: 'required' });

    // Metadata/discovery must not touch runtime state or start child processes.
    if (!supportsNativeOpenRuntime(api) || (deps.platform ?? process.platform) !== 'darwin') return;
    api.registerGatewayMethod('dashboardExtras.openLocalFile', async ({ params, respond }) => {
      try {
        respond(true, await openLocalFileFromDashboard(api, params, deps));
      } catch {
        respond(true, { opened: false, code: 'open-failed', reason: 'The file could not be opened safely.' });
      }
    }, { scope: 'operator.admin', profileAccess: 'required' });
  } catch {
    // Missing/retired host capabilities disable this optional feature, never Gateway startup.
    // Deliberately do not log exceptions: they can contain local paths.
  }
}

export default {
  id: 'dashboard-extras',
  name: 'Dashboard Extras',
  description: 'Independent mathematical Markdown and safe native file actions',
  register: registerDashboardExtras,
};
