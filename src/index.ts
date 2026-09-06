import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/plugin-entry';
import { toolPluginMetadataSymbol, type ToolPluginMetadata } from 'openclaw/plugin-sdk/tool-plugin';
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

const configSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const plugin = {
  id: 'dashboard-extras',
  name: 'Dashboard Extras',
  description: 'Seamless native conversation math and safe default-application file actions',
  configSchema: { jsonSchema: configSchema },
  register: registerDashboardExtras,
};

// The official builder consumes this public metadata contract for both tool and
// feature plugins. An empty tools list accurately describes our RPC-only backend.
const metadata: ToolPluginMetadata = {
  id: plugin.id,
  name: plugin.name,
  description: plugin.description,
  activation: { onStartup: true },
  configSchema,
  tools: [],
};
Object.defineProperty(plugin, toolPluginMetadataSymbol, { value: metadata, enumerable: false });

export default plugin;
