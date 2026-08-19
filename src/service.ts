/**
 * Host-side plugin manager service. Writes live to the harness home so UI and
 * CLI share one truth: the home-layer patch (`$DSH_HOME/cordis.patch.yml`)
 * and the mypackages folder beside the source checkout.
 *
 * The home patch is the manager's mount table: every row is written inside a
 * single `insert:` block (the Loader's include dialect adds entries only under
 * `insert:`; bare `- id:` rows merely override existing entries), so the
 * manager's own row carries its `config` (repoRoot) and every custom plugin
 * row can toggle `disabled` in place. The Loader already watches the home
 * patch through config HMR, so enable / disable take effect without a restart.
 * Adding a plugin is a folder op (clone / unzip / copy into mypackages) plus a
 * patch row; removal is the inverse.
 *
 * This package ships no typert-generated Remote: the UI half (later) talks to
 * this service through a plain client-side seam.
 * @module @deepseek-ai/dsh-plugin-kmanager
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { execFileSync, spawnSync } from 'node:child_process'
import * as yaml from 'js-yaml'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { classifyDirectory } from './classify.ts'
import { createKManagerRoute } from './http.ts'
import { createManagerPageRoute } from './page.ts'
import type {
  CustomPluginView,
  OfficialPluginView,
  PluginAddSource,
  PluginCategory,
  PluginEntryId,
  PluginLayout,
  PluginManagerErrorCode,
  PluginManagerSnapshot,
  PresetCandidate,
  PresetView,
} from './types.ts'

/** One loader entry node. `id` / `disabled` are getters; the module name
 * lives in `options`, while group entries carry `options.group`. */
type LoaderEntry = {
  readonly id: string
  readonly options: {
    readonly id?: string
    readonly name?: string
    readonly group?: boolean
  }
  readonly disabled: boolean
}

/** One mount row of the home-layer patch. */
interface PatchRow {
  readonly id: string
  name?: string
  /** Optional config below the row (own entry and custom mounts). */
  config?: Record<string, string>
  /** True when the row is written as an `insert:` block entry. */
  inserted: boolean
  /** True when the manager wrote an explicit disable for the row. */
  disabled?: boolean
}

/**
 * Errors surfaced by manager operations carry a stable machine code for the UI.
 */
export class PluginManagerError extends Error {
  constructor(
    readonly code: PluginManagerErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PluginManagerError'
  }
}

/** Client-visible failure carrying the operation's stable code. */
function fail(code: PluginManagerErrorCode, message: string): never {
  throw new PluginManagerError(code, message)
}

/** The declared entry point of an installed package, if any. */
function resolveEntry(manifest: { main?: string; exports?: Record<string, unknown> }): string | undefined {
  const dot = manifest.exports?.['.']
  if (typeof dot === 'string') return dot
  if (typeof dot === 'object' && dot !== null) {
    const record = dot as Record<string, unknown>
    for (const candidate of [record['default'], record['import'], record['require']]) {
      if (typeof candidate === 'string') return candidate
    }
  }
  return manifest.main
}

/** The declared client bundle path of an installed package, defaulting to `lib/client.js`. */
function resolveClient(manifest: { exports?: Record<string, unknown> }): string {
  const client = manifest.exports?.['./client']
  if (typeof client === 'string') return client
  if (typeof client === 'object' && client !== null) {
    const record = client as Record<string, unknown>
    for (const candidate of [record['default'], record['import'], record['require']]) {
      if (typeof candidate === 'string') return candidate
    }
  }
  return 'lib/client.js'
}

/** Locate a real bash (Git for Windows), not the WSL stub in System32. */
function locateGitBash(): string | undefined {
  const candidates = [
    process.env.GIT_BASH,
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return undefined
}

/** Config for the manager service. */
export interface Config {
  /** Absolute path of the source checkout (the folder containing `packages/`). */
  readonly repoRoot: string
  /** Absolute path of the mypackages folder; defaults to `<repoRoot>/../mypackages`. */
  readonly mypackages?: string
  /** Absolute path of `$DSH_HOME`; defaults to `resolveDshHome()`. */
  readonly home?: string
}

const PATCH_HEADER = '# dsh home patch layer — applied after every profile\'s own layer.\n'
  + '# Auto-managed by @deepseek-ai/dsh-plugin-kmanager. Edit manually with care.\n'

/**
 * The plugin manager service. One instance per hosting root context.
 */
export class PluginManagerService extends Service {
  static inject = ['loader']

  /**
   * Register the browser HTTP seat. Runs through `ctx.inject`, so the route
   * lands whenever a Host `webServer` service is available; headless contexts
   * never have one and the route is simply never registered.
   */
  async [Service.init](): Promise<void> {
    this.ctx.inject(['webServer'], (shared) => {
      shared.effect(
        () => shared.webServer.register(createKManagerRoute(this)),
        'pluginKManager: /api/kmanager route',
      )
      shared.effect(
        () => shared.webServer.register(createManagerPageRoute()),
        'pluginKManager: /kmanager page',
      )
    })
  }

  private readonly repoRoot: string
  private readonly mypackagesDir: string
  private readonly homeDir: string
  private readonly homePatchPath: string
  private readonly sharedLinkPath: string
  private readonly overridesPath: string
  private readonly layoutPath: string
  private readonly labelsPath: string
  private readonly presetsDir: string

  /**
   * Create the manager service.
   * @param ctx - Cordis context that owns the service.
   * @param config - repo checkout, mypackages, and harness-home paths.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'pluginKManager')
    if (!existsSync(config.repoRoot)) {
      throw new PluginManagerError('INVALID_PACKAGE', `repo root not found: ${config.repoRoot}`)
    }
    this.repoRoot = config.repoRoot
    this.mypackagesDir = config.mypackages ?? join(config.repoRoot, '..', 'mypackages')
    this.homeDir = config.home ?? resolveDshHome()
    this.homePatchPath = join(this.homeDir, 'cordis.patch.yml')
    this.sharedLinkPath = join(this.mypackagesDir, 'node_modules')
    this.overridesPath = join(this.homeDir, 'kmanager.overrides.json')
    this.layoutPath = join(this.homeDir, 'kmanager.layout.json')
    this.labelsPath = join(this.homeDir, 'kmanager.labels.json')
    this.presetsDir = join(this.homeDir, '.agent-presets')
  }

  /**
   * List the full plugin landscape: official entries from the loading tree,
   * custom plugins from the mypackages folder, and the persisted grid order.
   * @returns snapshot of official and custom plugins plus layout.
   */
  list(): PluginManagerSnapshot {
    return {
      official: this.readOfficialEntries(),
      custom: this.readCustomPlugins(),
      layout: this.readLayout(),
    }
  }

  /** Read the persisted grid ordering for both pages. */
  private readLayout(): PluginLayout {
    if (!existsSync(this.layoutPath)) return { official: [], custom: [] }
    try {
      const raw = JSON.parse(readFileSync(this.layoutPath, 'utf8')) as Partial<PluginLayout>
      return {
        official: Array.isArray(raw.official) ? raw.official.map(String) : [],
        custom: Array.isArray(raw.custom) ? raw.custom.map(String) : [],
      }
    } catch {
      return { official: [], custom: [] }
    }
  }

  /**
   * Persist the grid order for one page. Entries not listed keep their current
   * relative position; the UI sends the full order so this replaces it whole.
   * @param page - which page's grid order to replace.
   * @param order - entry ids in display order.
   */
  setLayout(page: 'official' | 'custom', order: readonly string[]): void {
    const layout = this.readLayout()
    writeFileSync(
      this.layoutPath,
      JSON.stringify({ ...layout, [page]: [...order] }, null, 2) + '\n',
      'utf8',
    )
  }

  /** Read user-facing display labels keyed by entry id. */
  private readLabels(): Record<string, string> {
    if (!existsSync(this.labelsPath)) return {}
    try {
      const raw = JSON.parse(readFileSync(this.labelsPath, 'utf8')) as unknown
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
      const labels: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim().length > 0) labels[key] = value.trim()
      }
      return labels
    } catch {
      return {}
    }
  }

  /**
   * Set a plugin's display label (a UI-only alias). The label is persisted in
   * the harness home and never touches the plugin's folder, package name, or
   * Loader entry. Pass an empty string to clear the label back to the default.
   * @param entryId - the plugin entry id shown by the manager.
   * @param label - the new display label, or '' to remove it.
   */
  setLabel(entryId: string, label: string): void {
    const labels = this.readLabels()
    const trimmed = label.trim()
    if (trimmed.length === 0) {
      delete labels[entryId]
    } else {
      labels[entryId] = trimmed
    }
    writeFileSync(this.labelsPath, JSON.stringify(labels, null, 2) + '\n', 'utf8')
  }

/** Read Loader rows sourced from the composed tree (official plugins). */
  private readOfficialEntries(): OfficialPluginView[] {
    const loader = this.ctx.get('loader') as
      | { entries(): Iterable<LoaderEntry> }
      | undefined
    const customNames = this.customFolderNames()
    const entries: OfficialPluginView[] = []
    const labels = this.readLabels()
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        const bareId = entry.options.id ?? entry.id
        if (entry.options.group || customNames.has(bareId)) continue
        const moduleName = entry.options.name ?? entry.id
        const label = labels[entry.id]
        entries.push({
          entryId: entry.id as PluginEntryId,
          moduleName,
          enabled: !entry.disabled,
          fiberPhase: null,
          category: this.officialCategory(entry.id, moduleName),
          ...(label !== undefined ? { label } : {}),
        })
      }
    } else {
      // No live Loader (standalone contexts): the patch rows that are not
      // custom mounts are, by elimination, official entries.
      for (const row of this.loadRows()) {
        if (!row.inserted || customNames.has(row.id)) continue
        const label = labels[row.id]
        entries.push({
          entryId: row.id as PluginEntryId,
          moduleName: row.name ?? row.id,
          enabled: !row.disabled,
          fiberPhase: null,
          category: this.officialCategory(row.id, row.name ?? row.id),
          ...(label !== undefined ? { label } : {}),
        })
      }
    }
    return entries
  }

  /** Names of mypackages subfolders holding a plugin-shaped package.json. */
  private customFolderNames(): Set<string> {
    const names = new Set<string>()
    if (!existsSync(this.mypackagesDir)) return names
    for (const dirent of readdirSync(this.mypackagesDir, { withFileTypes: true })) {
      if (dirent.isDirectory() && dirent.name !== 'node_modules') names.add(dirent.name)
    }
    return names
  }

  /** Read custom plugins: mypackages subfolders with a plugin-shaped package.json. */
  private readCustomPlugins(): CustomPluginView[] {
    if (!existsSync(this.mypackagesDir)) return []
    const custom: CustomPluginView[] = []
    const labels = this.readLabels()
    for (const dirent of readdirSync(this.mypackagesDir, { withFileTypes: true })) {
      if (!dirent.isDirectory() || dirent.name === 'node_modules') continue
      const packageJsonPath = join(this.mypackagesDir, dirent.name, 'package.json')
      let packageName = `@deepseek-ai/${dirent.name}`
      if (existsSync(packageJsonPath)) {
        try {
          packageName = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }).name ?? packageName
        } catch { /* keep the folder-derived default */ }
      }
      const label = labels[dirent.name]
      custom.push({
        entryId: dirent.name as PluginEntryId,
        packageName,
        folderName: dirent.name,
        enabled: this.isRegistered(dirent.name),
        fiberPhase: null,
        category: this.customCategory(dirent.name, packageJsonPath),
        ...(label !== undefined ? { label } : {}),
      })
    }
    return custom
  }

  /** Whether the given plugin id is a loaded, non-disabled entry. */
  private isRegistered(id: string): boolean {
    const loader = this.ctx.get('loader') as { entries(): Iterable<LoaderEntry> } | undefined
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        if (entry.id === id || entry.options.id === id) {
          return !entry.disabled
        }
      }
      return false
    }
    const row = this.findRow(id)
    return row !== undefined && row.inserted && row.disabled !== true
  }

  /** The current patch row with the given id, if any. */
  private findRow(id: string): PatchRow | undefined {
    return this.loadRows().find(row => row.id === id)
  }

  /**
   * Enable or disable one plugin by entry id. Writes the home-layer patch;
   * the Loader's config HMR applies it without a restart.
   *
   * Patch rows address entries by their base id (`entry.options.id`, e.g.
   * `agent`), while the UI surfaces composed ids (`include:agent`), so the
   * entry id is normalized to its base id before matching or creating a row.
   * An official entry without a row runs at its composed default; toggling it
   * materializes an override row (`disabled: true` / `disabled: false`).
   * @param entryId - plugin entry id (official or custom).
   * @param enabled - target enablement.
   */
  setEnabled(entryId: string, enabled: boolean): void {
    const baseId = this.resolveBaseId(entryId)
    if (baseId === undefined) fail('PLUGIN_NOT_FOUND', `plugin not registered: ${entryId}`)
    // The hmr service hosts the live home-patch reload: disabling it tears
    // down the config watcher, so re-enabling it (or toggling anything else
    // afterward) would never take effect. Guard the row the way the web
    // bundle does — it is not a runtime toggle.
    if (baseId === 'hmr') fail('IMMUTABLE_ENTRY', 'hmr hosts the live patch reload and cannot be toggled')
    // This plugin hosts the manager page and route: disabling it locks the
    // user out of the very UI that could re-enable it. Not a runtime toggle.
    if (baseId === 'dsh-plugin-kmanager') {
      fail('IMMUTABLE_ENTRY', 'dsh-plugin-kmanager hosts the manager and cannot be toggled')
    }
    const rows = this.loadRows()
    const index = rows.findIndex(row => row.id === baseId)
    if (index < 0) {
      // No override row: the entry already runs at its composed default.
      if (this.isRegistered(entryId) === enabled) return
      this.writeRows([...rows, { id: baseId, inserted: false, disabled: !enabled }])
      return
    }
    const row = rows[index]!
    if (row.disabled === !enabled) return
    row.disabled = !enabled
    this.writeRows(rows)
  }

  /** Whether the id is a loaded entry or a mypackages custom folder. */
  private isKnownEntry(id: string): boolean {
    if (this.customFolderNames().has(id)) return true
    const loader = this.ctx.get('loader') as { entries(): Iterable<LoaderEntry> } | undefined
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        if (entry.id === id || entry.options.id === id) return true
      }
    }
    return false
  }

  /** Normalize a composed entry id to the base id patch rows address. */
  private resolveBaseId(entryId: string): string | undefined {
    const loader = this.ctx.get('loader') as { entries(): Iterable<LoaderEntry> } | undefined
    if (loader !== undefined) {
      for (const entry of loader.entries()) {
        if (entry.id === entryId || entry.options.id === entryId) {
          return entry.options.id ?? entry.id
        }
      }
    }
    return this.isKnownEntry(entryId) ? entryId : undefined
  }

  /**
   * Add a custom plugin from a git URL, ZIP archive, or existing folder.
   * Fed to the source checkout's official CLI enough for the pnpm pipeline to
   * build a vite-shaped plugin; zipPath / folderPath use the mypackages flow.
   * @param source - exactly one of gitUrl / zipPath / folderPath.
   * @returns the installed custom plugin view.
   */
  add(source: PluginAddSource): CustomPluginView {
    if ('gitUrl' in source) {
      return this.addFromGit(source.gitUrl)
    }
    const folderName = this.materialize(source)
    this.ensureSharedLink()
    this.ensureBuilt(folderName)
    const packageJsonPath = join(this.mypackagesDir, folderName, 'package.json')
    let packageName = `@deepseek-ai/${folderName}`
    if (existsSync(packageJsonPath)) {
      try {
        packageName = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }).name ?? packageName
      } catch { /* keep the folder-derived default */ }
    }
    this.writeRow(folderName, packageName)
    this.mount(folderName, packageName)
    return {
      entryId: folderName as PluginEntryId,
      packageName,
      folderName,
      enabled: true,
      fiberPhase: null,
      category: this.customCategory(folderName, packageJsonPath),
    }
  }

  /**
   * Install a package from a git URL / npm spec into mypackages directly.
   *
   * Registry-hosted plugins (npm spec or the npm package behind a github
   * repo) are fetched as their prebuilt tarball and extracted into
   * mypackages — no source clone, no build step, and the installed files
   * really live under mypackages (unlike `dsh plugin add`, which installs
   * into the profile's own node_modules). This keeps vite-shaped packages
   * (e.g. @liustack/modlens) working the same way the official CLI does.
   * @param url - an npm package spec, or a git URL.
   * @returns the installed custom plugin view.
   */
  private addFromGit(url: string): CustomPluginView {
    const spec = url.trim()
    if (!/^[^\s]+$/u.test(spec) || spec.length === 0) {
      fail('SOURCE_UNREACHABLE', 'plugin spec must be a single token')
    }
    const folderName = this.folderNameFromGit(spec)
    const pkgPath = join(this.mypackagesDir, folderName)
    if (existsSync(pkgPath)) fail('PLUGIN_ALREADY_EXISTS', `mypackages/${folderName} already exists`)
    mkdirSync(pkgPath, { recursive: true })
    const resolved = this.npmSpec(spec)
    const result = spawnSync('npm', ['pack', resolved, '--silent', '--pack-destination', pkgPath], {
      cwd: this.mypackagesDir, encoding: 'utf8', stdio: 'pipe',
    })
    if (result.error !== undefined || result.status !== 0) {
      rmSync(pkgPath, { recursive: true, force: true })
      fail('SOURCE_UNREACHABLE', `npm pack failed for ${resolved}: ${(result.stderr ?? String(result.error)).trim().slice(-300)}`)
    }
    const tarball = this.firstTarball(pkgPath)
    if (tarball === undefined) {
      rmSync(pkgPath, { recursive: true, force: true })
      fail('SOURCE_UNREACHABLE', `npm pack produced no tarball for ${resolved}`)
    }
    // npm tarballs root at `package/`; flatten it into the folder and drop the
    // downloaded archive so only the plugin's own files remain in mypackages.
    this.extractTarball(tarball, pkgPath)
    rmSync(tarball, { force: true })
    this.ensureSharedLink()
    this.ensureBuilt(folderName)
    const packageJsonPath = join(pkgPath, 'package.json')
    let packageName = `@deepseek-ai/${folderName}`
    if (existsSync(packageJsonPath)) {
      try {
        packageName = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }).name ?? packageName
      } catch { /* keep the folder-derived default */ }
    }
    this.writeRow(folderName, packageName)
    this.mount(folderName, packageName)
    return {
      entryId: folderName as PluginEntryId,
      packageName,
      folderName,
      enabled: true,
      fiberPhase: null,
      category: this.customCategory(folderName, packageJsonPath),
    }
  }

  /** Normalize a git/URL-style spec to a registry package name. */
  private npmSpec(spec: string): string {
    // npm / github scoped names pass through; host URLs map to owner/repo.
    const github = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#]+)/u.exec(spec)
    if (github !== null && spec.includes('github.com')) {
      return `${github[1]!}/${github[2]!.replace(/\.git$/u, '')}`
    }
    return spec.replace(/^github:/u, '')
  }

  /** The newest `*.tgz` produced in a directory, if any. */
  private firstTarball(dir: string): string | undefined {
    const found = readdirSync(dir).filter(name => /\.tgz$/iu.test(name)).sort()
    return found.length > 0 ? join(dir, found[found.length - 1]!) : undefined
  }

  /** Expand a npm tarball, flattening its `package/` root into the folder. */
  private extractTarball(tarball: string, dir: string): void {
    const staging = join(dir, '__pkg')
    mkdirSync(staging, { recursive: true })
    try {
      execFileSync('tar', ['-xzf', tarball, '-C', staging], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
      const root = join(staging, 'package')
      if (existsSync(root)) {
        for (const name of readdirSync(root)) {
          const from = join(root, name)
          const to = join(dir, name)
          if (existsSync(to)) rmSync(to, { recursive: true, force: true })
          cpSync(from, to, { recursive: true })
        }
      }
    } catch (error) {
      fail('SOURCE_UNREACHABLE', `tarball extraction failed: ${String(error)}`)
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }

  /** The last path segment of a git spec, sans `.git`. */
  private folderNameFromGit(spec: string): string {
    const clean = spec.replace(/\.git$/u, '')
    return clean.split('/').pop() ?? 'plugin'
  }

  /** Bring a plugin into mypackages from the requested source kind. */
  private materialize(source: PluginAddSource): string {
    const entries = Object.entries(source).filter(([, value]) => value !== undefined)
    if (entries.length !== 1) {
      fail('UNSUPPORTED_SOURCE', 'exactly one of gitUrl / zipPath / folderPath must be set')
    }
    const [kind, value] = entries[0] as [string, string]
    mkdirSync(this.mypackagesDir, { recursive: true })
    if (kind === 'zipPath') return this.unzip(value.trim())
    return this.copyFrom(value.trim())
  }

  /**
   * Install a plugin from an uploaded ZIP payload. The bytes are written to a
   * temporary archive, expanded into mypackages, and mounted like any zipPath
   * add. Shared-link and patch row land here through `add({ zipPath })`.
   * @param filename - the uploaded file name (used for the temp archive name).
   * @param data - the ZIP file bytes.
   * @returns the installed custom plugin view.
   */
  addZip(filename: string, data: Uint8Array): CustomPluginView {
    const safeName = basename(filename).replace(/[^a-zA-Z0-9._-]/gu, '_') || 'plugin'
    const tmpZip = join(this.mypackagesDir, `__upload-${Date.now()}-${safeName}`)
    try {
      writeFileSync(tmpZip, data)
      const folderName = this.unzip(tmpZip)
      this.ensureSharedLink()
      this.ensureBuilt(folderName)
      const packageJsonPath = join(this.mypackagesDir, folderName, 'package.json')
      let packageName = `@deepseek-ai/${folderName}`
      if (existsSync(packageJsonPath)) {
        try {
          packageName = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string }).name ?? packageName
        } catch { /* keep the folder-derived default */ }
      }
      this.writeRow(folderName, packageName)
      this.mount(folderName, packageName)
      return {
        entryId: folderName as PluginEntryId,
        packageName,
        folderName,
        enabled: true,
        fiberPhase: null,
        category: this.customCategory(folderName, packageJsonPath),
      }
    } finally {
      /* v8 ignore next -- the temp archive is best-effort cleanup */
      if (existsSync(tmpZip)) rmSync(tmpZip, { force: true })
    }
  }

  /** Expand a ZIP into mypackages; returns the extracted folder name. */
  private unzip(zipPath: string): string {
    if (!existsSync(zipPath)) fail('SOURCE_UNREACHABLE', `zip not found: ${zipPath}`)
    const base = basename(zipPath).replace(/\.zip$/iu, '') || 'plugin'
    const dest = join(this.mypackagesDir, base)
    if (existsSync(dest)) fail('PLUGIN_ALREADY_EXISTS', `mypackages/${base} already exists`)
    const quoted = {
      src: zipPath.replaceAll("'", "''"),
      dst: dest.replaceAll("'", "''"),
    }
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-NoLogo', '-Command',
          `Expand-Archive -LiteralPath '${quoted.src}' -DestinationPath '${quoted.dst}' -Force`],
        { cwd: this.mypackagesDir, encoding: 'utf8', stdio: 'pipe' },
      )
    } catch (error) {
      if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
      fail('SOURCE_UNREACHABLE', `zip extraction failed: ${String(error)}`)
    }
    return base
  }

  /** Copy an existing plugin folder into mypackages. */
  private copyFrom(folderPath: string): string {
    if (!existsSync(folderPath)) fail('SOURCE_UNREACHABLE', `folder not found: ${folderPath}`)
    const base = basename(folderPath) || 'plugin'
    const dest = join(this.mypackagesDir, base)
    if (existsSync(dest)) fail('PLUGIN_ALREADY_EXISTS', `mypackages/${base} already exists`)
    cpSync(folderPath, dest, { recursive: true })
    return base
  }

  /** Ensure the shared dependency layer junction exists. */
  private ensureSharedLink(): void {
    const profileModules = join(this.homeDir, 'profiles', 'node_modules')
    mkdirSync(profileModules, { recursive: true })
    mkdirSync(this.mypackagesDir, { recursive: true })
    if (!existsSync(this.sharedLinkPath)) {
      symlinkSync(profileModules, this.sharedLinkPath, 'junction')
    }
  }

  /**
   * Detect whether a freshly installed plugin is built (its declared entry
   * point exists) and, if not, build it in place from the checkout. A plugin
   * checked out straight from source has `src/` but no `lib/`: this makes the
   * manager's git-source installs usable without a manual build step.
   * @param folderName - the custom plugin's mypackages folder name.
   */
  private ensureBuilt(folderName: string): void {
    const dir = join(this.mypackagesDir, folderName)
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return
    let manifest: {
      main?: string
      exports?: Record<string, unknown>
      scripts?: Record<string, string>
      dsh?: { client?: unknown }
    }
    try {
      manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as typeof manifest
    } catch {
      fail('INVALID_PACKAGE', `mypackages/${folderName}/package.json is not valid JSON`)
    }
    const env = { ...process.env, DSH_CHECKOUT: this.repoRoot } as NodeJS.ProcessEnv
    const cwd = join(this.mypackagesDir, folderName)
    const runBash = (script: string): void => {
      const bashPath = locateGitBash()
      if (!bashPath) {
        fail('BUILD_FAILED', `${folderName}: build needs Git Bash (C:\\Program Files\\Git\\bin\\bash.exe)`)
      }
      try {
        execFileSync(bashPath, ['-lc', script, 'bash'], { cwd, env, encoding: 'utf8', stdio: 'pipe' })
      } catch (error) {
        fail('BUILD_FAILED', `${folderName}: build failed: ${String(error)}`)
      }
    }
    const runNpm = (script: string): void => {
      try {
        if (process.platform === 'win32') {
          execFileSync('npm', ['--prefix', cwd, 'run', script], {
            cwd, env, encoding: 'utf8', stdio: 'pipe', shell: true,
          })
          return
        }
        execFileSync('npm', ['--prefix', cwd, 'run', script], { env, encoding: 'utf8', stdio: 'pipe' })
      } catch (error) {
        fail('BUILD_FAILED', `${folderName}: build failed: ${String(error)}`)
      }
    }
    const runTsdown = (): void => {
      const tsdown = join(this.repoRoot, 'node_modules', '.bin', 'tsdown')
      if (!existsSync(tsdown) && !existsSync(`${tsdown}.cmd`)) {
        fail('BUILD_FAILED', `${folderName}: tsdown not found for client bundle`)
      }
      try {
        if (process.platform === 'win32') {
          execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `${tsdown}.cmd`], {
            cwd, env, encoding: 'utf8', stdio: 'pipe',
          })
        } else {
          execFileSync(tsdown, [], { cwd, env, encoding: 'utf8', stdio: 'pipe' })
        }
      } catch (error) {
        fail('BUILD_FAILED', `${folderName}: client bundle failed: ${String(error)}`)
      }
    }
    /** Source checkouts ship no node_modules; link the checkout's @types/node
     * so tsc-based builds can resolve the `node` type library. */
    const linkBuildTypes = (): void => {
      const typesDir = join(cwd, 'node_modules', '@types')
      const checkoutTypes = join(this.repoRoot, 'node_modules', '@types', 'node')
      if (existsSync(join(typesDir, 'node')) || !existsSync(checkoutTypes)) return
      mkdirSync(typesDir, { recursive: true })
      symlinkSync(checkoutTypes, join(typesDir, 'node'), 'junction')
    }
    const entry = resolveEntry(manifest)
    const clientEntry = resolveClient(manifest)
    const stripBash = (value: string): string => value.trim().replace(/^bash\s+/u, '')
    const mainMissing = !!entry && !existsSync(join(dir, entry))
    const build = manifest.scripts?.build
    const buildClient = manifest.scripts?.['build:client']
    const hasClient = manifest.dsh?.client !== undefined
    const clientMissing = hasClient && !existsSync(join(dir, clientEntry))
    if (!mainMissing && !clientMissing) return
    if (mainMissing || clientMissing) linkBuildTypes()
    if (mainMissing) {
      if (!build) fail('BUILD_FAILED', `${folderName}: entry ${entry} missing and no build script`)
      if (build.trim().startsWith('bash ')) runBash(stripBash(build))
      else runNpm('build')
    }
    if (clientMissing) {
      if (buildClient?.trim().startsWith('bash ')) runBash(stripBash(buildClient))
      else if (buildClient !== undefined && buildClient.trim() !== 'tsdown') runNpm('build:client')
      else runTsdown()
    }
    if (mainMissing && !existsSync(join(dir, entry))) {
      fail('BUILD_FAILED', `${folderName}: build finished but ${entry} is still missing`)
    }
    if (clientMissing && !existsSync(join(dir, clientEntry))) {
      fail('BUILD_FAILED', `${folderName}: client build finished but ${clientEntry} is still missing`)
    }
  }

  /**
   * Classify an official plugin: manual override wins (keyed by entry id),
   * else its installed package manifest's `repository.directory`.
   * @param entryId - the loader entry id (also the override key).
   * @param moduleName - the Loader entry's module specifier.
   */
  private officialCategory(entryId: string, moduleName: string | undefined): PluginCategory {
    const override = this.readCategoryOverrides()[entryId]
    if (override !== undefined) return override
    if (moduleName === undefined || moduleName.length === 0) return 'untagged'
    const packageName = moduleName.startsWith('@') ? moduleName.split('/').slice(0, 2).join('/') : moduleName
    if (!packageName.startsWith('@')) return 'untagged'
    const packageJsonPath = join(
      this.homeDir,
      'profiles',
      'node_modules',
      ...packageName.split('/'),
      'package.json',
    )
    if (!existsSync(packageJsonPath)) return 'untagged'
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { repository?: { directory?: string } }
      return classifyDirectory(manifest.repository?.directory)
    } catch {
      return 'untagged'
    }
  }

  /** Manual category overrides, keyed by entry id (folder name for custom). */
  private readCategoryOverrides(): Record<string, PluginCategory> {
    if (!existsSync(this.overridesPath)) return {}
    try {
      return JSON.parse(readFileSync(this.overridesPath, 'utf8')) as Record<string, PluginCategory>
    } catch {
      return {}
    }
  }

  /** Classify a custom plugin: manual override wins, else its package folder. */
  private customCategory(folderName: string, packageJsonPath: string): PluginCategory {
    const override = this.readCategoryOverrides()[folderName]
    if (override !== undefined) return override
    if (!existsSync(packageJsonPath)) return 'untagged'
    try {
      const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { repository?: { directory?: string } }
      return classifyDirectory(manifest.repository?.directory)
    } catch {
      return 'untagged'
    }
  }

  /**
   * Assign a manual category to a plugin entry (custom or official), persisted
   * next to the home patch so the grid survives restarts.
   * @param entryId - the plugin entry id (folder name for custom plugins).
   * @param category - the category to assign.
   */
  setCustomCategory(entryId: string, category: PluginCategory): void {
    const overrides = this.readCategoryOverrides()
    overrides[entryId] = category
    writeFileSync(this.overridesPath, JSON.stringify(overrides, null, 2) + '\n', 'utf8')
  }

  /**
   * Remove a custom plugin: delete its mypackages folder and its Loader row.
   * Official plugins cannot be removed.
   * @param entryId - the plugin's entry id.
   */
  remove(entryId: string): void {
    if (entryId === 'dsh-plugin-kmanager') {
      fail('IMMUTABLE_ENTRY', 'dsh-plugin-kmanager hosts the manager and cannot be removed')
    }
    const row = this.findRow(entryId)
    if (!row?.inserted) {
      fail('PLUGIN_NOT_FOUND', `official plugins cannot be removed, disable instead: ${entryId}`)
    }
    const target = join(this.mypackagesDir, entryId)
    /* v8 ignore next -- the folder may already be gone for a partially uninstalled plugin */
    if (existsSync(target)) rmSync(target, { recursive: true, force: true })
    this.writeRows(this.loadRows().filter(row => row.id !== entryId))
    this.unmount(entryId, row.name)
  }

  /** One scan session: the temp folder and its candidate presets. */
  private scanned: { readonly tempDir: string; readonly candidates: PresetCandidate[] } | undefined

  /**
   * Read `preset.yml` display metadata the same way the harness does
   * (dsh-agent-presets parses with js-yaml), then normalize the file in place.
   *
   * Real-world presets (e.g. dsh-router-standard) ship `description:` values
   * containing a bare `: `, which js-yaml rejects as a nested mapping — so
   * without a repair step the harness's own preset picker shows those presets
   * with no description. `yaml.dump` quotes such values, so reading with the
   * system parser and rewriting only when the file failed to parse heals the
   * file once and every later reader (this page, the harness picker) sees it.
   */
  private presetMeta(dir: string): { readonly name?: string; readonly description?: string } {
    const file = join(dir, 'preset.yml')
    if (!existsSync(file)) return {}
    const raw = readFileSync(file, 'utf8')
    let parsed: unknown
    try {
      parsed = yaml.load(raw)
    } catch {
      // Malformed metadata: extract the two display fields leniently, then
      // rewrite the file as valid YAML so the harness picker can read it too.
      const meta = this.lenientPresetMeta(raw)
      const normalized = yaml.dump(
        {
          ...(meta.name !== undefined ? { name: meta.name } : {}),
          ...(meta.description !== undefined ? { description: meta.description } : {}),
        },
        { lineWidth: -1 },
      )
      try {
        writeFileSync(file, normalized)
      } catch {
        /* v8 ignore next -- best-effort repair; the read still returns what it found */
      }
      return meta
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    const text = (value: unknown): string | undefined => {
      if (typeof value !== 'string') return undefined
      const trimmed = value.trim()
      return trimmed === '' ? undefined : trimmed
    }
    const name = text(record.name)
    const description = text(record.description)
    return {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    }
  }

  /** Lenient fallback for a `preset.yml` that fails strict YAML parsing. */
  private lenientPresetMeta(raw: string): { readonly name?: string; readonly description?: string } {
    let name: string | undefined
    let description: string | undefined
    for (const line of raw.split(/\r?\n/u)) {
      const m = /^name:\s*(.*)$/.exec(line)
      if (m !== null) name = m[1]!.trim().replace(/^['"]|['"]$/gu, '')
      const d = /^description:\s*(.*)$/.exec(line)
      if (d !== null) description = d[1]!.trim().replace(/^['"]|['"]$/gu, '')
    }
    return {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    }
  }

  /** List user presets installed under `$DSH_HOME/.agent-presets` (a dir is a
   * preset when it holds `agent.cordis.yml`). System presets are shipped inside
   * the checkout and are not listed here. */
  listPresets(): PresetView[] {
    if (!existsSync(this.presetsDir)) return []
    const views: PresetView[] = []
    for (const dirent of readdirSync(this.presetsDir, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue
      const dir = join(this.presetsDir, dirent.name)
      if (!existsSync(join(dir, 'agent.cordis.yml'))) continue
      const meta = this.presetMeta(dir)
      views.push({
        entryId: dirent.name as PluginEntryId,
        folderName: dirent.name,
        name: meta.name ?? dirent.name,
        description: meta.description ?? '',
      })
    }
    return views
  }

  /**
   * Fetch a preset source and enumerate the presets it contains. The source
   * (git URL / ZIP / existing folder) lands in a temp dir, then every directory
   * holding `agent.cordis.yml` is a candidate — the checkout root itself, or
   * any `preset/*` directory (the convention dsh-router-standard uses). The
   * temp dir is kept until `installPreset` (or the next scan) replaces it.
   * @param source - exactly one of gitUrl / zipPath / folderPath.
   * @returns discovered presets to choose from.
   */
  scanPresetSource(source: PluginAddSource): PresetCandidate[] {
    const tempDir = join(tmpdir(), `dsh-preset-${process.pid}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    const entries = Object.entries(source).filter(([, value]) => value !== undefined)
    if (entries.length !== 1) {
      rmSync(tempDir, { recursive: true, force: true })
      fail('UNSUPPORTED_SOURCE', 'exactly one of gitUrl / zipPath / folderPath must be set')
    }
    const [kind, value] = entries[0] as [string, string]
    try {
      if (kind === 'gitUrl') this.cloneInto(value.trim(), tempDir)
      else if (kind === 'zipPath') this.unzipInto(value.trim(), tempDir)
      else this.copyInto(value.trim(), tempDir)
    } catch (error) {
      rmSync(tempDir, { recursive: true, force: true })
      throw error
    }
    const candidates: PresetCandidate[] = []
    for (const dir of this.findPresetDirs(tempDir)) {
      const meta = this.presetMeta(dir)
      const rel = dir === tempDir ? '' : dir.slice(tempDir.length + 1).replaceAll('\\', '/')
      const name = meta.name ?? (rel === '' ? 'preset' : basename(dir))
      candidates.push({
        id: rel,
        name,
        description: meta.description ?? '',
      })
    }
    if (candidates.length === 0) {
      rmSync(tempDir, { recursive: true, force: true })
      fail('PRESET_NOT_FOUND', 'no agent.cordis.yml found in the scanned source')
    }
    if (this.scanned !== undefined) {
      /* v8 ignore next -- temp dirs are best-effort cleanup between scans */
      rmSync(this.scanned.tempDir, { recursive: true, force: true })
    }
    this.scanned = { tempDir, candidates }
    return candidates
  }

  /** Clone a git repo into an existing directory. */
  private cloneInto(url: string, dest: string): void {
    const trimmed = url.trim()
    if (!/^[^\s]+$/u.test(trimmed) || trimmed.length === 0) {
      fail('SOURCE_UNREACHABLE', 'git URL must be a single token')
    }
    try {
      execFileSync('git', ['clone', '--depth', '1', trimmed, '.'], { cwd: dest, encoding: 'utf8', stdio: 'pipe' })
    } catch (error) {
      fail('SOURCE_UNREACHABLE', `git clone failed: ${String(error)}`)
    }
  }

  /** Expand a ZIP into an existing directory. */
  private unzipInto(zipPath: string, dest: string): void {
    if (!existsSync(zipPath)) fail('SOURCE_UNREACHABLE', `zip not found: ${zipPath}`)
    const quoted = { src: zipPath.replaceAll("'", "''"), dst: dest.replaceAll("'", "''") }
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-NoLogo', '-Command',
          `Expand-Archive -LiteralPath '${quoted.src}' -DestinationPath '${quoted.dst}' -Force`],
        { cwd: dest, encoding: 'utf8', stdio: 'pipe' },
      )
    } catch (error) {
      fail('SOURCE_UNREACHABLE', `zip extraction failed: ${String(error)}`)
    }
  }

  /** Copy an existing folder's contents into an existing directory. */
  private copyInto(folderPath: string, dest: string): void {
    if (!existsSync(folderPath)) fail('SOURCE_UNREACHABLE', `folder not found: ${folderPath}`)
    cpSync(folderPath, dest, { recursive: true })
  }

  /** Every directory under `root` (2 levels) holding `agent.cordis.yml`. */
  private findPresetDirs(root: string): string[] {
    const found: string[] = []
    if (existsSync(join(root, 'agent.cordis.yml'))) found.push(root)
    for (const dirent of readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory() || dirent.name === '.git') continue
      const child = join(root, dirent.name)
      if (existsSync(join(child, 'agent.cordis.yml'))) {
        found.push(child)
        continue
      }
      for (const sub of readdirSync(child, { withFileTypes: true })) {
        if (!sub.isDirectory() || sub.name === '.git') continue
        const deep = join(child, sub.name)
        if (existsSync(join(deep, 'agent.cordis.yml'))) found.push(deep)
      }
    }
    return found
  }

  /**
   * Install a preset from the last `scanPresetSource` into
   * `$DSH_HOME/.agent-presets/<folderName>`. The target folder must not
   * already hold `agent.cordis.yml`; an existing empty folder is reused.
   * @param id - the candidate id returned by the scan.
   * @returns the installed preset view.
   */
  installPreset(id: string): PresetView {
    if (this.scanned === undefined) fail('PRESET_NOT_FOUND', 'run a preset scan first')
    const candidate = this.scanned.candidates.find(c => c.id === id)
    if (candidate === undefined) fail('PRESET_NOT_FOUND', `preset candidate not found: ${id}`)
    const sourceDir = candidate.id === '' ? this.scanned.tempDir : join(this.scanned.tempDir, ...candidate.id.split('/'))
    const folderName = candidate.name.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '') || 'preset'
    if (existsSync(join(this.presetsDir, folderName, 'agent.cordis.yml'))) {
      fail('PRESET_ALREADY_EXISTS', `.agent-presets/${folderName} already has a preset`)
    }
    const target = join(this.presetsDir, folderName)
    mkdirSync(target, { recursive: true })
    cpSync(sourceDir, target, { recursive: true })
    rmSync(this.scanned.tempDir, { recursive: true, force: true })
    this.scanned = undefined
    const meta = this.presetMeta(target)
    return {
      entryId: folderName as PluginEntryId,
      folderName,
      name: meta.name ?? folderName,
      description: meta.description ?? '',
    }
  }

  /**
   * Junction a custom plugin into the shared dependency layer
   * (`$DSH_HOME/profiles/node_modules`) so the Loader can resolve it by its
   * package name on the next boot. Without this an added plugin starts a
   * failing import (`ERR_MODULE_NOT_FOUND`) that takes the profile down.
   * @param folderName - the mypackages folder name (patch row id).
   * @param packageName - the plugin's package name from its manifest.
   */
  private mount(folderName: string, packageName: string): void {
    const profileModules = join(this.homeDir, 'profiles', 'node_modules')
    const parts = packageName.split('/')
    const scope = parts.length > 1 ? parts.slice(0, -1) : []
    const name = parts.reduce((acc, part) => part || acc, packageName)
    const linkPath = join(profileModules, ...scope, name)
    const source = join(this.mypackagesDir, folderName)
    if (existsSync(linkPath) || existsSync(source) === false) return
    mkdirSync(join(profileModules, ...scope), { recursive: true })
    this.unmount(folderName)
    symlinkSync(source, linkPath, 'junction')
  }

  /**
   * Remove the shared-layer junction of a custom plugin. Resolves by the
   * plugin's package name, falling back to scanning for any junction that
   * points back at the mypackages folder.
   */
  private unmount(folderName: string, packageName?: string): void {
    const profileModules = join(this.homeDir, 'profiles', 'node_modules')
    const candidates: string[] = []
    if (packageName !== undefined) {
      const parts = packageName.split('/')
      const scope = parts.length > 1 ? parts.slice(0, -1) : []
      const name = parts.reduce((acc, part) => part || acc, packageName)
      candidates.push(join(profileModules, ...scope, name))
    } else {
      candidates.push(join(profileModules, folderName))
      candidates.push(join(profileModules, '@deepseek-ai', folderName))
    }
    for (const linkPath of candidates) {
      // rmSync removes the symlink itself even when its target is already gone
      // (dangling junction), and `force` makes a missing path a no-op.
      rmSync(linkPath, { recursive: true, force: true })
    }
  }

  /** Read current home patch rows as a mutable list. */
  private loadRows(): PatchRow[] {
    if (!existsSync(this.homePatchPath)) return []
    const lines = readFileSync(this.homePatchPath, 'utf8').split(/\r?\n/u)
    const rows: PatchRow[] = []
    let inInsert = false
    let current: PatchRow | undefined
    let inConfig = false
    const push = (): void => {
      if (current !== undefined) { rows.push(current); current = undefined }
      inConfig = false
    }
    for (const line of lines) {
      const trimmed = line.trim()
      if (/^-\s*insert:/u.test(trimmed)) { inInsert = true; continue }
      // Insert-block entries are indented; a top-level line leaves the block.
      if (!/^\s/u.test(line)) inInsert = false
      const idMatch = /^(-\s*)?id:\s*(\S+)/u.exec(trimmed)
      if (idMatch !== null) {
        push()
        current = { id: idMatch[2]!, inserted: inInsert }
        continue
      }
      if (current === undefined) continue
      const nameMatch = /name:\s*(['"]?)([^'"\n]+)\1/u.exec(trimmed)
      if (nameMatch !== null) { current.name = nameMatch[2]!.trim(); continue }
      const configMatch = /^config:\s*$/u.exec(trimmed)
      if (configMatch !== null) {
        current.config = {}
        inConfig = true
        continue
      }
      if (inConfig) {
        const configKey = /^([\w.]+):\s*(.*)$/u.exec(trimmed)
        if (configKey !== null) current.config![configKey[1]!] = configKey[2]!.trim().replace(/^['"]|['"]$/gu, '')
        continue
      }
      const disabledMatch = /^disabled:\s*(true|false)\b/u.exec(trimmed)
      if (disabledMatch !== null) {
        current.disabled = disabledMatch[1] === 'true'
      }
    }
    push()
    void inInsert
    return rows
  }

  /** Rewrite the entire home patch with the given rows. */
  private writeRows(rows: readonly PatchRow[]): void {
    const body: string[] = []
    // `insert:` mounts are one YAML block: each entry line is immediately
    // followed by its own sub-keys, so a later `- id:` override of an official
    // entry still forms valid YAML after the block closes.
    const inserts = rows.filter(row => row.inserted)
    if (inserts.length > 0) {
      body.push('- insert:')
      for (const row of inserts) {
        body.push(`    - id: ${row.id}`)
        if (row.name !== undefined && row.name !== row.id) body.push(`      name: '${row.name}'`)
        if (row.config !== undefined) {
          body.push('      config:')
          for (const [key, value] of Object.entries(row.config)) body.push(`        ${key}: '${value}'`)
        }
        if (row.disabled !== undefined) body.push(`      disabled: ${row.disabled}`)
      }
    }
    // Non-insert rows are overrides targeting entries from lower layers.
    for (const row of rows) {
      if (row.inserted) continue
      body.push(`- id: ${row.id}`)
      if (row.disabled !== undefined) body.push(`  disabled: ${row.disabled}`)
    }
    writeFileSync(this.homePatchPath, PATCH_HEADER + body.join('\n') + '\n', 'utf8')
  }

  /** Append a single insert-enabled row unless the id already exists. */
  private writeRow(id: string, name: string): void {
    const rows = this.loadRows()
    const existing = this.findRow(id)
    if (existing !== undefined) {
      if (existing.disabled) for (const row of rows) if (row.id === id) delete row.disabled
      this.writeRows(rows)
      return
    }
    rows.push({ id, name, inserted: true })
    this.writeRows(rows)
  }
}

export default PluginManagerService