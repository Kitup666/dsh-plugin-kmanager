#!/usr/bin/env node
/**
 * Standalone build driver for `@deepseek-ai/dsh-plugin-kmanager`.
 *
 * The package is developed outside the dsh monorepo (installer-held), so this
 * driver performs the two steps the repo's own build pipeline performs — `tsc`
 * emitting `lib/types` and `tsdown` bundling the runtime entries into
 * `lib/index.js`/`lib/invariant.js` — while linking the checkout's packages
 * into this folder's `node_modules` so both the compiler and the running Loader
 * can resolve the `@deepseek-ai/*` seam.
 *
 * Pure Node (no dependencies): plain ESM, `node:fs` junction links on Windows,
 * `node:child_process` spawns with inherited stdio.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKOUT_CANDIDATES = [
  process.env.DSH_CHECKOUT,
  'D:/DeepseekH/deepseek-harness-master',
  'D:/DeepseekH/deepseek-harness',
  join(process.env.USERPROFILE ?? 'C:', 'deepseek-harness-master'),
].filter(Boolean)

function locateCheckout() {
  for (const candidate of CHECKOUT_CANDIDATES) {
    if (candidate && existsSync(join(candidate, 'packages'))) return candidate
  }
  console.error(`build: cannot locate the dsh checkout (set DSH_CHECKOUT); tried:\n  ${CHECKOUT_CANDIDATES.join('\n  ')}`)
  process.exit(1)
}

const CHECKOUT = locateCheckout()

/** Create or refresh one junction under this package's node_modules. */
function link(rel, target) {
  const linkPath = join(ROOT, 'node_modules', rel)
  rmSync(linkPath, { recursive: true, force: true })
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(target, linkPath, 'junction')
  console.log(`  link ${rel} -> ${target}`)
}

function linkAll() {
  console.log(`=== Linking build/runtime dependencies (checkout: ${CHECKOUT}) ===`)
  const links = [
    ['@deepseek-ai/cordis', 'vendor/cordis'],
    ['@deepseek-ai/dsh-home-paths', 'packages/util/home-paths'],
    ['@deepseek-ai/dsh-invariants', 'packages/runtime-diagnostics/invariants'],
    ['@deepseek-ai/dsh-brand', 'packages/util/brand'],
    ['@deepseek-ai/dsh-host-webserver', 'packages/host/webserver'],
  ]
  for (const [rel, relTarget] of links) {
    const target = join(CHECKOUT, relTarget)
    if (!existsSync(target)) {
      console.error(`build: dependency target missing: ${target}`)
      process.exit(1)
    }
    link(rel, target)
  }

  // @types/node for the compiler ("types": ["node"]).
  const nodeTypes = join(CHECKOUT, 'node_modules', '@types', 'node')
  if (existsSync(nodeTypes)) link('@types/node', nodeTypes)

  // @types/js-yaml for the compiler (js-yaml ships no types of its own).
  const jsYamlTypes = join(CHECKOUT, 'node_modules', '@types', 'js-yaml')
  if (existsSync(jsYamlTypes)) link('@types/js-yaml', jsYamlTypes)

  // js-yaml from the checkout's pnpm store (same version the harness's own
  // dsh-agent-presets metadata parser uses), so preset.yml parsing matches the
  // system exactly instead of a hand-rolled regex.
  const jsYaml = join(CHECKOUT, 'node_modules', 'js-yaml')
  if (existsSync(jsYaml)) link('js-yaml', jsYaml)

  // tsdown itself, so `node_modules/tsdown` resolves for anyone running the
  // CLI from this folder.
  const tsdown = join(CHECKOUT, 'node_modules', 'tsdown')
  if (existsSync(tsdown)) link('tsdown', tsdown)
}

function run(label, command, args) {
  console.log(`\n=== ${label} ===`)
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error(`build: ${label} failed (exit ${result.status})`)
    process.exit(result.status ?? 1)
  }
}

linkAll()

const node = process.execPath
const tsc = join(CHECKOUT, 'node_modules', 'typescript', 'lib', 'tsc.js')
if (!existsSync(tsc)) {
  console.error(`build: tsc not found at ${tsc}`)
  process.exit(1)
}
run('Compiling src → lib/types (tsc)', node, [tsc, '-p', join(ROOT, 'tsconfig.json')])

const tsdown = join(CHECKOUT, 'node_modules', 'tsdown', 'dist', 'run.mjs')
if (!existsSync(tsdown)) {
  console.error(`build: tsdown not found at ${tsdown}`)
  process.exit(1)
}
run('Bundling lib/types → lib (tsdown)', node, [tsdown, '-c', join(ROOT, 'tsdown.config.ts')])

console.log('\n=== Build complete ===')