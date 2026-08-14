// Install the companion plugin into an Obsidian vault:
//   node scripts/install-companion.mjs --vault <vault-path>
// Builds companion/dist/main.js, copies manifest + main.js into
// <vault>/.obsidian/plugins/dsh-obsidian-bridge/, and enables the plugin in
// community-plugins.json.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const vaultFlag = args.indexOf('--vault')
const vault = vaultFlag >= 0 ? args[vaultFlag + 1] : process.env.DSH_OBSIDIAN_VAULT

if (!vault) {
  console.error('Usage: node scripts/install-companion.mjs --vault <vault-path>')
  console.error('  (or set DSH_OBSIDIAN_VAULT)')
  process.exit(2)
}

// Build the companion bundle first.
execFileSync(process.execPath, [join(root, 'companion', 'build.mjs')], { cwd: root, stdio: 'inherit' })

const target = join(vault, '.obsidian', 'plugins', 'dsh-obsidian-bridge')
mkdirSync(target, { recursive: true })
copyFileSync(join(root, 'companion', 'dist', 'main.js'), join(target, 'main.js'))
copyFileSync(join(root, 'companion', 'manifest.json'), join(target, 'manifest.json'))

// Enable the plugin in community-plugins.json.
const listPath = join(vault, '.obsidian', 'community-plugins.json')
let list = []
if (existsSync(listPath)) {
  try {
    list = JSON.parse(readFileSync(listPath, 'utf8'))
    if (!Array.isArray(list)) list = []
  } catch {
    list = []
  }
}
if (!list.includes('dsh-obsidian-bridge')) {
  list.push('dsh-obsidian-bridge')
  writeFileSync(listPath, JSON.stringify(list, null, 2))
}

console.log(`[install-companion] installed into ${target}`)
console.log('[install-companion] enabled in community-plugins.json')
console.log('[install-companion] restart Obsidian (or reload the plugin), then copy the bridge token from')
console.log('[install-companion] Obsidian settings -> DSH Obsidian Bridge into the dsh-obsidian plugin settings.')
