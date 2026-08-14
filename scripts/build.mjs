// Build script for dsh-obsidian (host-only since the v2 on-demand rework
// removed the browser half).
// - host half:   src/index.ts        -> lib/index.js   (ESM, node)
// - types:       tsc -p tsconfig.build.json -> lib/types/**
//
// Uses the esbuild CLI binary (not the JS API): the JS API spawns a service
// worker over pipes, which sandboxed environments reject (EPERM on spawn with
// piped stdio); stdio inherit works everywhere.
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const esbuildExe = process.platform === 'win32'
  ? join(root, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
  : join(root, 'node_modules', '.bin', 'esbuild')

rmSync(join(root, 'lib'), { recursive: true, force: true })
mkdirSync(join(root, 'lib'), { recursive: true })

function runEsbuild(args) {
  execFileSync(esbuildExe, args, { cwd: root, stdio: 'inherit' })
}

// Host half
runEsbuild([
  'src/index.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=es2024',
  '--sourcemap',
  '--outfile=lib/index.js',
  '--external:@deepseek-ai/cordis',
])

// Companion plugin bundle (Obsidian bridge).
try {
  execFileSync(process.execPath, [join(root, 'companion', 'build.mjs')], { cwd: root, stdio: 'inherit' })
} catch {
  // Companion build is optional for the dsh plugin itself; report but continue.
  console.warn('[dsh-obsidian] companion build failed (see above); the dsh plugin still works without it')
}

// Types via tsc declaration emit (in-process, no spawn).
execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit',
})

console.log('[dsh-obsidian] build done: lib/index.js, lib/types')
