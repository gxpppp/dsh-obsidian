// Install the companion plugin into an Obsidian vault:
//   node scripts/install-companion.mjs --vault <vault-path>
// Builds companion/dist/main.js, copies manifest + main.js into
// <vault>/.obsidian/plugins/dsh-obsidian-bridge/, and enables the plugin in
// community-plugins.json. The companion communicates through a local named
// pipe or Unix socket; it never opens a network URL.
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

const bundle = join(root, 'companion', 'dist', 'main.js')
const manifest = join(root, 'companion', 'manifest.json')
if (!existsSync(bundle) || !existsSync(manifest)) {
  console.error('Companion build is missing. Run `npm run build` or `npm run build:companion` before installing.')
  process.exit(2)
}

const target = join(vault, '.obsidian', 'plugins', 'dsh-obsidian-bridge')
mkdirSync(target, { recursive: true })
copyFileSync(bundle, join(target, 'main.js'))
copyFileSync(manifest, join(target, 'manifest.json'))

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
console.log('[install-companion] restart Obsidian (or reload the plugin).')
console.log('[install-companion] The host reads the companion token automatically from the vault plugin data when vaultPath matches.')
