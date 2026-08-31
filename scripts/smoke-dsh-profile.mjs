import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-obsidian-profile-'))
const runner = join(temporaryRoot, 'runner')
const dshHome = join(temporaryRoot, 'home')
const packageOutput = join(temporaryRoot, 'package')
const dshVersion = '0.1.2-alpha.2'
const pnpmVersion = '11.7.0'

try {
  mkdirSync(packageOutput, { recursive: true })
  runNpm(['install', '--prefix', runner, '--ignore-scripts', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${dshVersion}`, `pnpm@${pnpmVersion}`], root)
  runNpm(['pack', '--ignore-scripts', '--pack-destination', packageOutput], root)
  const tarballs = readdirSync(packageOutput).filter((name) => name.endsWith('.tgz'))
  assert.equal(tarballs.length, 1, 'profile smoke requires exactly one packed host tarball')

  const bin = join(runner, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const binPath = join(runner, 'node_modules', '.bin')
  const env = {
    ...process.env,
    DSH_HOME: dshHome,
    PATH: `${binPath}${delimiter}${process.env.PATH ?? ''}`,
    npm_config_registry: 'https://registry.npmjs.org/',
  }
  execFileSync(process.execPath, [bin, 'plugin', '--profile', 'headless', 'add', join(packageOutput, tarballs[0])], {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  const dump = execFileSync(process.execPath, [bin, '--profile', 'headless', '--dump-config'], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  assert.match(dump, /id:\s*ui-obsidian(?:\r?\n|\s)/, 'profile dump must contain the ui-obsidian row')
  assert.match(dump, /name:\s*['"]?@deepseek-ai\/dsh-client-ui-obsidian['"]?/, 'profile dump must resolve the Obsidian host package')
  console.error(JSON.stringify({ ok: true, dsh: dshVersion, profile: 'headless', bundle: 'ui-obsidian' }, null, 2))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath
  if (npmExecPath) {
    execFileSync(process.execPath, [npmExecPath, ...args], { cwd, stdio: 'inherit' })
    return
  }
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(npmCli)) {
    execFileSync(process.execPath, [npmCli, ...args], { cwd, stdio: 'inherit' })
    return
  }
  execFileSync('npm', args, { cwd, stdio: 'inherit' })
}
