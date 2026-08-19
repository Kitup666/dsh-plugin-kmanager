/**
 * Browser HTTP carrier for the plugin manager. Registers a `/api/kmanager`
 * prefix route on the Host `webServer` service when it exists, answering list,
 * enable/disable, add, remove, manual-category, and display-label JSON calls so
 * a UI half can drive the service without a Typert Remote.
 *
 * Route seats are composition-level contracts: registration is refused when the
 * seat is already claimed, so a second manager copy fails loudly instead of
 * hijacking the grid. Every response is strict JSON: `{ ok: true, data }` or
 * `{ ok: false, code, message }`.
 * @module @deepseek-ai/dsh-plugin-kmanager/http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { PluginManagerError, type PluginManagerService } from './service.ts'
import type { PluginAddSource, PluginCategory } from './types.ts'

/** Route prefix claimed by this package on the Host web server. */
export const KMGR_API_PREFIX = '/api/kmanager'

/** Exact route serving the tile-grid manager page. */
export const KMGR_PAGE_PATH = '/kmanager'

/** One result or error carrying the operation's stable code. */
type HandlerResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string }

const ALL_CATEGORIES: readonly PluginCategory[] = [
  'core',
  'ui',
  'host',
  'gateway',
  'llm',
  'session',
  'exec',
  'task',
  'interaction',
  'untagged',
]

/** Parse a JSON request body defensively; null when empty or malformed. */
function readJsonBody(req: IncomingMessage, limit = 1_000_000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total > limit) reject(new Error('request body too large'))
    })
    req.on('end', () => {
      if (total === 0) { resolve(null); return }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        resolve(parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : null)
      } catch { resolve(null) }
    })
    req.on('error', reject)
  })
}

/** Write one strict-JSON response with the given status. */
function sendJson(res: ServerResponse, status: number, body: HandlerResult): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Normalize an entry-id value from a JSON body. */
function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginManagerError('PLUGIN_NOT_FOUND', `${field} must be a non-empty string`)
  }
  return value
}

/** Validate a category tag against the closed union. */
function asCategory(value: unknown): PluginCategory {
  if (typeof value !== 'string' || !ALL_CATEGORIES.includes(value as PluginCategory)) {
    throw new PluginManagerError('PLUGIN_NOT_FOUND', 'category must be one of the known tags')
  }
  return value as PluginCategory
}

/** Extract a plugin-add source object from a JSON body. */
function presetSource(body: Record<string, unknown> | null): PluginAddSource {
  const gitUrl = body?.gitUrl
  const zipPath = body?.zipPath
  const folderPath = body?.folderPath
  if (gitUrl !== undefined) return { gitUrl: asString(gitUrl, 'gitUrl') }
  if (zipPath !== undefined) return { zipPath: asString(zipPath, 'zipPath') }
  if (folderPath !== undefined) return { folderPath: asString(folderPath, 'folderPath') }
  throw new PluginManagerError('UNSUPPORTED_SOURCE', 'exactly one of gitUrl / zipPath / folderPath must be set')
}

/**
 * Create the `/api/kmanager` route bound to the given service.
 * @param service - the manager service answering the calls.
 * @returns the route to register on the Host web server.
 */
export function createKManagerRoute(service: PluginManagerService): WebRoute {
  return {
    kind: 'prefix',
    path: KMGR_API_PREFIX,
    handler: async (req, res): Promise<void> => {
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      const method = req.method ?? 'GET'
      const segment = pathname.length > KMGR_API_PREFIX.length
        ? pathname.slice(KMGR_API_PREFIX.length + 1)
        : ''
      const result = await dispatch(service, method, segment, req)
      sendJson(res, result.ok ? 200 : 400, result)
    },
  }
}

/** Dispatch one request to the manager; errors map to error-shaped results. */
async function dispatch(
  service: PluginManagerService,
  method: string,
  segment: string,
  req: IncomingMessage,
): Promise<HandlerResult> {
  try {
    if (method === 'GET' && segment === 'list') {
      return { ok: true, data: service.list() }
    }
    if (method === 'GET' && segment === 'preset-list') {
      return { ok: true, data: service.listPresets() }
    }
    if (method !== 'POST') {
      throw new PluginManagerError('UNSUPPORTED_SOURCE', `unsupported method ${method}`)
    }
    // Uploaded ZIP payloads ride JSON as a byte array; allow up to 150MB there.
    const body = await readJsonBody(req, segment === 'add-zip' ? 150_000_000 : 1_000_000)
    if (segment === 'preset-scan') {
      const source = presetSource(body)
      return { ok: true, data: { candidates: service.scanPresetSource(source) } }
    }
    if (segment === 'preset-install') {
      const id = asString(body?.id, 'id')
      return { ok: true, data: service.installPreset(id) }
    }
    if (segment === 'set-enabled') {
      const entryId = asString(body?.entryId, 'entryId')
      const enabled = body?.enabled
      if (typeof enabled !== 'boolean') {
        throw new PluginManagerError('PLUGIN_NOT_FOUND', 'enabled must be a boolean')
      }
      service.setEnabled(entryId, enabled)
      return { ok: true, data: { entryId, enabled } }
    }
    if (segment === 'set-category') {
      const folderName = asString(body?.folderName, 'folderName')
      const category = asCategory(body?.category)
      service.setCustomCategory(folderName, category)
      return { ok: true, data: { folderName, category } }
    }
    if (segment === 'set-label') {
      const entryId = asString(body?.entryId, 'entryId')
      const label = body?.label
      if (typeof label !== 'string') {
        throw new PluginManagerError('PLUGIN_NOT_FOUND', 'label must be a string')
      }
      service.setLabel(entryId, label)
      return { ok: true, data: { entryId, label } }
    }
    if (segment === 'remove') {
      const entryId = asString(body?.entryId, 'entryId')
      service.remove(entryId)
      return { ok: true, data: { entryId } }
    }
    if (segment === 'set-layout') {
      const page = body?.page
      const order = body?.order
      if (page !== 'official' && page !== 'custom') {
        throw new PluginManagerError('PLUGIN_NOT_FOUND', 'page must be "official" or "custom"')
      }
      if (!Array.isArray(order) || order.some(i => typeof i !== 'string')) {
        throw new PluginManagerError('PLUGIN_NOT_FOUND', 'order must be a string array')
      }
      service.setLayout(page, order as string[])
      return { ok: true, data: { page, order } }
    }
    if (segment === 'add-zip') {
      const filename = body?.filename
      const data = body?.data
      if (typeof filename !== 'string' || filename.length === 0) {
        throw new PluginManagerError('UNSUPPORTED_SOURCE', 'filename must be a non-empty string')
      }
      if (!Array.isArray(data) || data.length === 0 || data.length > 100_000_000) {
        throw new PluginManagerError('UNSUPPORTED_SOURCE', 'data must be a ZIP byte array (max 100MB)')
      }
      const bytes = Uint8Array.from(data as number[])
      return { ok: true, data: service.addZip(filename, bytes) }
    }
    if (segment === 'add') {
      const gitUrl = body?.gitUrl
      const zipPath = body?.zipPath
      const folderPath = body?.folderPath
      if (gitUrl !== undefined) {
        return { ok: true, data: service.add({ gitUrl: asString(gitUrl, 'gitUrl') }) }
      }
      if (zipPath !== undefined) {
        return { ok: true, data: service.add({ zipPath: asString(zipPath, 'zipPath') }) }
      }
      if (folderPath !== undefined) {
        return { ok: true, data: service.add({ folderPath: asString(folderPath, 'folderPath') }) }
      }
      throw new PluginManagerError('UNSUPPORTED_SOURCE', 'exactly one of gitUrl / zipPath / folderPath must be set')
    }
    throw new PluginManagerError('UNSUPPORTED_SOURCE', `unknown kmanager route: ${segment}`)
  } catch (error) {
    if (error instanceof PluginManagerError) {
      return { ok: false, code: error.code, message: error.message }
    }
    return { ok: false, code: 'REGISTRATION_FAILED', message: String(error) }
  }
}