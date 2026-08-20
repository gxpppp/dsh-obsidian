import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outputs = [join(root, 'lib', 'index.js'), join(root, 'companion', 'dist', 'main.js')]
const inputs = [
  join(root, 'package.json'),
  join(root, 'tsconfig.json'),
  join(root, 'tsconfig.build.json'),
  join(root, 'tsconfig.companion.json'),
  join(root, 'scripts', 'build.mjs'),
  join(root, 'companion', 'build.mjs'),
  join(root, 'src'),
  join(root, 'companion', 'src'),
]

function newestMtime(target) {
  const stat = statSync(target)
  if (!stat.isDirectory()) return stat.mtimeMs
  let newest = stat.mtimeMs
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    newest = Math.max(newest, newestMtime(join(target, entry.name)))
  }
  return newest
}

const shouldBuild = outputs.some((output) => !existsSync(output))
  || Math.max(...inputs.map(newestMtime)) > Math.min(...outputs.map((output) => statSync(output).mtimeMs))

if (!shouldBuild) {
  console.error('[dsh-obsidian] prepare: build outputs are current')
  process.exit(0)
}

const npmExecPath = process.env.npm_execpath
if (npmExecPath) {
  execFileSync(process.execPath, [npmExecPath, 'run', 'build'], { cwd: root, stdio: 'inherit' })
} else {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  execFileSync(npm, ['run', 'build'], { cwd: root, stdio: 'inherit' })
}
