import { execFileSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const out = join(root, '.test-build')
rmSync(out, { recursive: true, force: true })

execFileSync(process.execPath, [
  join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  '-p',
  join(root, 'tsconfig.tests.json'),
], { cwd: root, stdio: 'inherit' })

const testDir = join(out, 'tests')
const tests = readdirSync(testDir)
  .filter((name) => name.endsWith('.spec.js'))
  .sort()
  .map((name) => join(testDir, name))

execFileSync(process.execPath, [
  '--test',
  ...tests,
], { cwd: root, stdio: 'inherit' })
