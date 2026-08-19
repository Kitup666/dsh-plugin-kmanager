// Plain-Node smoke test for the built lib: list / enable / disable / add /
// remove against a throwaway harness home, so the file-writing logic is
// exercised without a booted Harness. Run `node tests/smoke.mjs` after build.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { Context } = require('@deepseek-ai/cordis')
const lib = require(`../lib/index.js` /* @vite-ignore */)
const { PluginManagerService } = lib

const home = mkdtempSync(join(tmpdir(), 'kmgr-'))
const repo = join(home, 'repo')
mkdirSync(join(repo, 'packages'), { recursive: true })
const mypackages = join(home, 'repo', '..', 'mypackages')

const ctx = new Context()
const service = new PluginManagerService(ctx, { repoRoot: repo, home })

// empty state listing
const empty = service.list()
assert.deepEqual(empty.official, [])
assert.deepEqual(empty.custom, [])

// add from an existing folder
const pluginDir = mkdtempSync(join(tmpdir(), 'src-'))
writeFileSync(join(pluginDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-fake' }))
const added = service.add({ folderPath: pluginDir })
assert.equal(added.enabled, true)
assert.equal(added.packageName, '@deepseek-ai/dsh-fake')
assert.ok(existsSync(join(mypackages, added.folderName)))

const listed = service.list()
assert.equal(listed.custom.length, 1)
assert.equal(listed.custom[0].enabled, true)
assert.equal(listed.custom[0].category, 'untagged', 'no repository.directory -> untagged')
assert.ok(existsSync(join(mypackages, 'node_modules')), 'shared dependency layer junction created')

// manual category override is persisted and read back
service.setCustomCategory(added.folderName, 'llm')
assert.equal(service.list().custom[0].category, 'llm')
assert.ok(existsSync(join(home, 'kmanager.overrides.json')))

// disable then re-enable; the home patch row carries the flag
service.setEnabled(added.entryId, false)
assert.equal(service.list().custom[0].enabled, false)
const patch = readFileSync(join(home, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /disabled: true/)

service.setEnabled(added.entryId, true)
assert.equal(service.list().custom[0].enabled, true)

// removing cleans the folder and the patch row
service.remove(added.entryId)
assert.ok(!existsSync(join(mypackages, added.folderName)))
assert.equal(service.list().custom.length, 0)

// grid layout persists per page and survives a second service instance
service.setLayout('custom', ['alpha', 'beta'])
service.setLayout('official', ['zzz'])
const layout = service.list().layout
assert.deepEqual([...layout.custom], ['alpha', 'beta'])
assert.deepEqual([...layout.official], ['zzz'])
assert.ok(existsSync(join(home, 'kmanager.layout.json')))
const second = new PluginManagerService(new Context(), { repoRoot: repo, home })
assert.deepEqual([...second.list().layout.custom], ['alpha', 'beta'])
service.setLayout('custom', [])
assert.deepEqual([...service.list().layout.custom], [])

// malformed layout file degrades to empty
writeFileSync(join(home, 'kmanager.layout.json'), 'not json')
assert.deepEqual(service.list().layout, { official: [], custom: [] })

// ---- presets ----
const srcDir = mkdtempSync(join(tmpdir(), 'pkg-src-'))
mkdirSync(join(srcDir, 'preset', 'router-standard'), { recursive: true })
mkdirSync(join(srcDir, 'preset', 'router-spec'), { recursive: true })
writeFileSync(join(srcDir, 'preset', 'router-standard', 'agent.cordis.yml'), 'rows: []\n')
writeFileSync(join(srcDir, 'preset', 'router-standard', 'preset.yml'), 'name: Router Standard\n')
writeFileSync(join(srcDir, 'preset', 'router-spec', 'agent.cordis.yml'), 'rows: []\n')

// empty preset list before anything is installed
assert.deepEqual(service.listPresets(), [])

// a zip source with the same layout also scans
const zipSrc = join(home, 'presets.zip')
const { execFileSync } = require('node:child_process')
execFileSync('powershell', ['-NoProfile', '-NoLogo', '-Command',
  `Compress-Archive -LiteralPath '${srcDir.replaceAll("'", "''") }\\preset' -DestinationPath '${zipSrc.replaceAll("'", "''")}' -Force`],
  { encoding: 'utf8' })

// scan a folder source -> candidates from preset/* directories
const folderCands = service.scanPresetSource({ folderPath: srcDir })
assert.equal(folderCands.length, 2)
assert.ok(folderCands.some(c => c.name === 'Router Standard' && c.id.endsWith('router-standard')))
assert.ok(folderCands.some(c => c.id.endsWith('router-spec')))

// install one candidate -> listed as a preset
const installed = service.installPreset(folderCands.find(c => c.id.endsWith('router-standard')).id)
assert.equal(installed.folderName, 'router-standard')
assert.equal(installed.name, 'Router Standard')
assert.ok(existsSync(join(home, '.agent-presets', 'router-standard', 'agent.cordis.yml')))
const presets = service.listPresets()
assert.equal(presets.length, 1)
assert.equal(presets[0].name, 'Router Standard')

// scan via zip lands the same candidate ids
const zipCands = service.scanPresetSource({ zipPath: zipSrc })
assert.equal(zipCands.length, 2)
assert.ok(zipCands.some(c => c.id.endsWith('router-spec')))

// installing an already-installed name is refused
const dup = service.scanPresetSource({ folderPath: srcDir })
assert.equal(dup.length, 2)
assert.throws(() => service.installPreset(dup.find(c => c.id.endsWith('router-standard')).id), /already has a preset/)
assert.throws(() => service.installPreset('nope'), /candidate not found/)
assert.throws(() => service.installPreset(''), /candidate not found/)

// no source -> refused; bad zip -> refused
assert.throws(() => service.scanPresetSource({}), /exactly one of/)
assert.throws(() => service.scanPresetSource({ zipPath: join(home, 'missing.zip') }), /zip not found/)

// a plain folder without agent.cordis.yml scans empty
const plain = mkdtempSync(join(tmpdir(), 'plain-'))
writeFileSync(join(plain, 'package.json'), '{}')
assert.throws(() => service.scanPresetSource({ folderPath: plain }), /no agent.cordis.yml/)

console.log('smoke ok')