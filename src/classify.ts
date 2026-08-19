/**
 * Category mapping for the plugin grid. Official plugins are grouped by the
 * harness `packages/<group>/<pkg>` directory recorded in each installed
 * package's `repository.directory`; coarse categories keep the grid to one
 * color per meaningful kind instead of one per harness group.
 * @module @deepseek-ai/dsh-plugin-kmanager/classify
 */

import type { PluginCategory } from './types.ts'

/** Display metadata driving the grid tile accent per category. */
export interface PluginCategoryMeta {
  readonly label: string
  readonly color: string
}

/** Coarse grouping of harness groups; everything unlisted falls back to `untagged`. */
const GROUP_TO_CATEGORY: Readonly<Record<string, PluginCategory>> = {
  core: 'core',
  boot: 'core',
  loader: 'core',
  cordis: 'core',
  cosmokit: 'core',
  schemastery: 'core',
  include: 'core',
  timer: 'core',
  group: 'core',
  'runtime-diagnostics': 'core',
  cli: 'core',
  util: 'core',
  client: 'ui',
  host: 'host',
  bundle: 'host',
  apps: 'host',
  api: 'gateway',
  typert: 'gateway',
  mcp: 'gateway',
  web: 'gateway',
  settings: 'gateway',
  credentials: 'gateway',
  identity: 'gateway',
  llm: 'llm',
  session: 'session',
  'session-query': 'session',
  subagent: 'session',
  context: 'session',
  compaction: 'session',
  spill: 'session',
  shell: 'exec',
  fs: 'exec',
  subprocess: 'exec',
  sandbox: 'exec',
  terminal: 'exec',
  'code-runtime': 'exec',
  native: 'exec',
  todo: 'task',
  plan: 'task',
  goal: 'task',
  workflow: 'task',
  schedule: 'task',
  preset: 'task',
  storage: 'task',
  attachment: 'task',
  workspace: 'task',
  jobs: 'task',
  interaction: 'interaction',
  guard: 'interaction',
  feedback: 'interaction',
  skill: 'interaction',
  extensions: 'interaction',
  landlock: 'exec',
}

/** Display metadata for every category, keyed by the category tag. */
export const PLUGIN_CATEGORIES: Readonly<Record<PluginCategory, PluginCategoryMeta>> = {
  core: { label: '核心框架', color: '#64748b' },
  ui: { label: '前端UI', color: '#3b82f6' },
  host: { label: 'Host运行', color: '#06b6d4' },
  gateway: { label: '网关与API', color: '#8b5cf6' },
  llm: { label: '模型', color: '#22c55e' },
  session: { label: '会话与Agent', color: '#f59e0b' },
  exec: { label: '工具执行', color: '#ef4444' },
  task: { label: '记忆与任务', color: '#14b8a6' },
  interaction: { label: '交互与安全', color: '#ec4899' },
  untagged: { label: '未分类', color: '#9ca3af' },
}

/**
 * Map a `repository.directory` value (e.g. `packages/shell/tool-bash`,
 * `vendor/cordis`, `apps/dsh`) to its coarse category.
 * @param directory - the package's `repository.directory` field, if present.
 * @returns the category; empty or unparseable values fall back to `untagged`.
 */
export function classifyDirectory(directory: string | undefined): PluginCategory {
  if (directory === undefined) return 'untagged'
  const segment = directory.includes('/') ? directory.split('/') : [directory]
  const isPackages = segment[0] === 'packages'
  const group = isPackages ? segment[1] : segment[0]
  if (group === undefined) return 'untagged'
  return GROUP_TO_CATEGORY[group] ?? 'untagged'
}