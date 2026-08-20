import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const manifest = readJson('companion/manifest.json')
const companionSource = readFileSync(join(root, 'companion', 'src', 'main.ts'), 'utf8')
const smokeSource = readFileSync(join(root, 'scripts', 'smoke-companion.mjs'), 'utf8')
const protocolSource = readFileSync(join(root, 'src', 'bridge', 'protocol.ts'), 'utf8')

const version = packageJson.version
assert.match(version, /^\d+\.\d+\.\d+$/, 'release version must be a stable semantic version')
assert.equal(packageLock.version, version, 'package-lock root version must match package.json')
assert.equal(packageLock.packages?.['']?.version, version, 'package-lock package version must match package.json')
assert.equal(manifest.version, version, 'companion manifest version must match package.json')
assert.match(companionSource, new RegExp(`const PLUGIN_VERSION = ['"]${version.replaceAll('.', '\\.')}['"]`), 'companion runtime version must match package.json')
assert.match(smokeSource, new RegExp(`pluginVersion, ['"]${version.replaceAll('.', '\\.')}['"]`), 'smoke expected version must match package.json')
assert.match(protocolSource, /BRIDGE_PROTOCOL_VERSION = 1 as const/, 'companion protocol version must remain 1')
assert.notEqual(packageJson.private, true, 'release package cannot be private')
assert.equal(packageJson.publishConfig?.access, 'public', 'release package must declare public access')
assert.ok(packageJson.repository?.url, 'repository metadata is required')
assert.ok(packageJson.homepage, 'homepage metadata is required')
assert.ok(packageJson.bugs?.url, 'bugs metadata is required')
assert.ok(packageJson.keywords?.includes('dsh-plugin'), 'dsh-plugin keyword is required')
assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml', 'DSH bundle patch metadata must be preserved')

const dshPackages = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
]
for (const dependency of dshPackages) {
  assert.equal(packageJson.peerDependencies?.[dependency], '0.1.0-rc.8', `${dependency} peer version must be rc.8`)
  assert.equal(packageJson.devDependencies?.[dependency], '0.1.0-rc.8', `${dependency} dev version must be rc.8`)
}

const requiredFiles = [
  'lib/index.js',
  'lib/types/index.d.ts',
  'companion/dist/main.js',
  'companion/manifest.json',
  'scripts/install-companion.mjs',
  'scripts/smoke-companion.mjs',
  'cordis.patch.yml',
  'README.md',
  'MIGRATION.md',
  'SECURITY.md',
  'ARCHITECTURE.md',
  'CHANGELOG.md',
  'LICENSE',
]
for (const relative of requiredFiles) {
  assert.equal(existsSync(join(root, relative)), true, `required release file is missing: ${relative}`)
}

console.error(JSON.stringify({ ok: true, version, dsh: '0.1.0-rc.8', protocol: 1, files: requiredFiles.length }, null, 2))
