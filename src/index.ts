/**
 * Host-side plugin manager for the DeepSeek Harness.
 *
 * Registers a Cordis {@link PluginManagerService} as `ctx.pluginKManager` that
 * lists, enables, disables, adds, and removes plugins by writing two durable
 * locations: the harness-home patch (`$DSH_HOME/cordis.patch.yml`) for Loader
 * rows and the mypackages folder beside the source checkout for custom plugin
 * sources. The Loader already applies home-layer patch changes through config
 * HMR, so enable/disable take effect without a restart.
 *
 * This package deliberately ships no Typert Remote: the built-in
 * plugin-inventory gateway already exposes entry state to the UI, and this
 * service's mutations happen entirely inside the host process. A future UI
 * half reads the snapshot types through its own client seam.
 * @module @deepseek-ai/dsh-plugin-kmanager
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { PluginManagerService, PluginManagerError, type Config } from './service.ts'
import { createKManagerRoute } from './http.ts'

export { PluginManagerService, PluginManagerError } from './service.ts'
export type { Config } from './service.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginKManager: PluginManagerService
  }
}

/** Registration effect label for the route, for the effect tracer. */
const ROUTE_EFFECT = 'pluginKManager: /api/kmanager route'

/** Plugin entry: default-export the service class so the Loader mounts it. */
export default PluginManagerService