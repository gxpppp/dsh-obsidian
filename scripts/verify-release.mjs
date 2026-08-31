import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const manifest = readJson('companion/manifest.json')
const versionSource = readFileSync(join(root, 'src', 'version.ts'), 'utf8')
const companionSource = readFileSync(join(root, 'companion', 'src', 'main.ts'), 'utf8')
const smokeSource = readFileSync(join(root, 'scripts', 'smoke-companion.mjs'), 'utf8')
const protocolSource = readFileSync(join(root, 'src', 'bridge', 'protocol.ts'), 'utf8')

const version = packageJson.version
const dshVersion = '0.1.2-alpha.2'
assert.match(version, /^\d+\.\d+\.\d+$/, 'release version must be a stable semantic version')
assert.equal(packageLock.version, version, 'package-lock root version must match package.json')
assert.equal(packageLock.packages?.['']?.version, version, 'package-lock package version must match package.json')
assert.equal(manifest.version, version, 'companion manifest version must match package.json')
assert.match(versionSource, new RegExp(`PLUGIN_VERSION = ['"]${escapeRegExp(version)}['"]`), 'shared runtime version must match package.json')
assert.match(companionSource, /import \{ PLUGIN_VERSION \} from ['"]\.\.\/\.\.\/src\/version\.ts['"]/, 'companion must use the shared runtime version')
assert.match(smokeSource, new RegExp(`pluginVersion, ['"]${escapeRegExp(version)}['"]`), 'smoke expected version must match package.json')
assert.match(protocolSource, /BRIDGE_PROTOCOL_VERSION = 1 as const/, 'companion protocol version must remain 1')
assert.equal(packageJson.engines?.node, '^22.19.0 || >=24.0.0', 'Node engine must match DSH alpha.2')
assert.notEqual(packageJson.private, true, 'release package cannot be private')
assert.equal(packageJson.publishConfig?.access, 'public', 'release package must declare public access')
assert.equal(packageJson.publishConfig?.registry, 'https://registry.npmjs.org/', 'release package must use the official npm registry')
assert.ok(packageJson.repository?.url, 'repository metadata is required')
assert.ok(packageJson.homepage, 'homepage metadata is required')
assert.ok(packageJson.bugs?.url, 'bugs metadata is required')
assert.ok(packageJson.keywords?.includes('dsh-plugin'), 'dsh-plugin keyword is required')
assert.equal(packageJson.dsh?.bundle?.patch, './cordis.patch.yml', 'DSH bundle patch metadata must be preserved')
assert.equal(packageJson.peerDependencies?.['@deepseek-ai/cordis'], '4.0.2', 'Cordis peer must match DSH alpha.2')
assert.equal(packageJson.devDependencies?.['@deepseek-ai/cordis'], '4.0.2', 'Cordis dev dependency must match DSH alpha.2')
assert.equal(packageJson.devDependencies?.['@deepseek-ai/schemastery'], '3.18.2', 'Schemastery must match DSH alpha.2')

const directDshPackages = [
  '@deepseek-ai/dsh-agent',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-settings',
  '@deepseek-ai/dsh-skill',
  '@deepseek-ai/dsh-system-prompt',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-util-values',
]
for (const dependency of directDshPackages) {
  assert.equal(packageJson.peerDependencies?.[dependency], dshVersion, `${dependency} peer version must be alpha.2`)
  assert.equal(packageJson.devDependencies?.[dependency], dshVersion, `${dependency} dev version must be alpha.2`)
}

const lockedDshPackages = Object.entries(packageLock.packages ?? {})
  .filter(([path]) => path.startsWith('node_modules/@deepseek-ai/dsh-'))
assert.ok(lockedDshPackages.length >= directDshPackages.length, 'lockfile must contain the DSH package closure')
for (const [path, entry] of lockedDshPackages) {
  assert.equal(entry.version, dshVersion, `${path} must use the coherent alpha.2 package line`)
  assert.match(entry.resolved ?? '', /^https:\/\/registry\.npmjs\.org\//, `${path} must resolve from the official npm registry`)
}
for (const [path, entry] of Object.entries(packageLock.packages ?? {})) {
  if (path === '' || entry.resolved === undefined) continue
  assert.match(entry.resolved, /^https:\/\/registry\.npmjs\.org\//, `${path} must resolve from the official npm registry`)
}

const requiredFiles = [
  'lib/index.js',
  'lib/types/index.d.ts',
  'companion/dist/main.js',
  'companion/manifest.json',
  'scripts/install-companion.mjs',
  'scripts/smoke-companion.mjs',
  'scripts/smoke-dsh-profile.mjs',
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

const pack = JSON.parse(runNpm(['pack', '--dry-run', '--ignore-scripts', '--json']))[0]
const packedPaths = new Set(pack.files.map((file) => file.path.replaceAll('\\', '/')))
for (const relative of requiredFiles) {
  assert.ok(packedPaths.has(relative), `required file is missing from npm package: ${relative}`)
}
const forbiddenPackagePath = /(^|\/)(?:node_modules|\.git|\.obsidian|\.test-build|release|companion-release)(?:\/|$)|(^|\/)(?:data\.json|activation\.log|npm-pack\.json|settings[^/]*\.ya?ml|\.env(?:\..*)?)$/i
for (const relative of packedPaths) {
  assert.equal(forbiddenPackagePath.test(relative), false, `forbidden file is present in npm package: ${relative}`)
}

console.error(JSON.stringify({
  ok: true,
  version,
  dsh: dshVersion,
  protocol: 1,
  lockedDshPackages: lockedDshPackages.length,
  packedFiles: packedPaths.size,
}, null, 2))

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function runNpm(args) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    return execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_loglevel: 'silent' },
    })
  }
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(npmCli)) {
    return execFileSync(process.execPath, [npmCli, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, npm_config_loglevel: 'silent' },
    })
  }
  return execFileSync('npm', args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'silent' },
  })
}
