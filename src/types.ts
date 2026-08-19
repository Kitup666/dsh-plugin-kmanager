/** Plugin-manager contract: the shapes Host and UI exchange. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of a plugin entry within the manager's view. */
export type PluginEntryId = Branded<'PluginEntryId'>

/** Where a plugin comes from: the shipped source bundles, or user mypackages. */
export type PluginOrigin = 'official' | 'custom'

/** Lifecycle phase of a plugin entry's root Fiber, mirroring the Loader view. */
export type PluginFiberPhase =
  | 'pending'
  | 'loading'
  | 'active'
  | 'failed'
  | 'unloading'
  | null

/**
 * Coarse grouping of a plugin for grid coloring. Official plugins are derived
 * from their harness package group; custom plugins fall back to a manual
 * override or `untagged`.
 */
export type PluginCategory =
  | 'core'
  | 'ui'
  | 'host'
  | 'gateway'
  | 'llm'
  | 'session'
  | 'exec'
  | 'task'
  | 'interaction'
  | 'untagged'

/** One official plugin: everything the source tree ships (any @deepseek-ai/dsh-*). */
export interface OfficialPluginView {
  readonly entryId: PluginEntryId
  /** Exact module specifier imported by the Loader entry. */
  readonly moduleName: string
  /** Effective Loader enablement, including disabled ancestors. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  readonly category: PluginCategory
  /** Optional user-facing display label; does not rename any file or entry. */
  readonly label?: string
}

/** One custom plugin installed from mypackages. */
export interface CustomPluginView {
  readonly entryId: PluginEntryId
  /** Package name (e.g. `@deepseek-ai/dsh-plugin-kmanager`). */
  readonly packageName: string
  /** Directory basename inside mypackages (e.g. `dsh-plugin-kmanager`). */
  readonly folderName: string
  /** Whether the Loader row mounts it. */
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  readonly category: PluginCategory
  /** Optional user-facing display label; does not rename any file or entry. */
  readonly label?: string
}

/** Grid ordering per page, persisted across restarts. */
export interface PluginLayout {
  /** Official page: entry ids in display order (absent ids append at the end). */
  readonly official: readonly string[]
  /** Custom page: entry ids in display order (absent ids append at the end). */
  readonly custom: readonly string[]
}

/** One custom preset installed in the harness home's `.agent-presets`. */
export interface PresetView {
  readonly entryId: string
  /** Directory basename in `.agent-presets` (e.g. `router-standard`). */
  readonly folderName: string
  /** `preset.yml` display name when present, else the folder name. */
  readonly name: string
  readonly description: string
}

/** One preset candidate discovered in a scanned source (repo root or `preset/`). */
export interface PresetCandidate {
  /** Identifier used to install it (the candidate's path inside the scan). */
  readonly id: string
  /** Directory basename (defaults the install folder name). */
  readonly name: string
  readonly description: string
}

/** Full snapshot returned by the plugin-manager list. */
export interface PluginManagerSnapshot {
  readonly official: readonly OfficialPluginView[]
  readonly custom: readonly CustomPluginView[]
  readonly layout: PluginLayout
}

/** Where one custom plugin comes from when adding. Exactly one field is set. */
export type PluginAddSource =
  | { readonly gitUrl: string }
  | { readonly zipPath: string }
  | { readonly folderPath: string }

/** Stable error codes thrown by manager operations. */
export type PluginManagerErrorCode =
  | 'PLUGIN_NOT_FOUND'
  | 'PLUGIN_ALREADY_EXISTS'
  | 'UNSUPPORTED_SOURCE'
  | 'INVALID_PACKAGE'
  | 'SOURCE_UNREACHABLE'
  | 'IMMUTABLE_ENTRY'
  | 'REGISTRATION_FAILED'
  | 'BUILD_FAILED'
  | 'PRESET_NOT_FOUND'
  | 'PRESET_ALREADY_EXISTS'