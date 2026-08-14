// Build the companion Obsidian plugin (companion/dist/main.js).
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const esbuildExe = process.platform === 'win32'
  ? join(root, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
  : join(root, 'node_modules', '.bin', 'esbuild')

rmSync(join(root, 'companion', 'dist'), { recursive: true, force: true })
mkdirSync(join(root, 'companion', 'dist'), { recursive: true })

execFileSync(esbuildExe, [
  join(root, 'companion', 'src', 'main.ts'),
  '--bundle',
  '--format=cjs',
  '--platform=node',
  '--target=es2018',
  '--outfile=' + join(root, 'companion', 'dist', 'main.js'),
  '--external:obsidian',
  '--external:electron',
], { cwd: root, stdio: 'inherit' })

console.log('[companion] built: companion/dist/main.js')
