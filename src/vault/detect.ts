/**
 * Detect Obsidian vaults from the app's config file (obsidian.json), same
 * locations the app itself uses per platform.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'

function candidatePaths(): string[] {
  const home = homedir()
  if (process.platform === 'win32') {
    return [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json')]
  }
  if (process.platform === 'darwin') {
    return [join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json')]
  }
  return [
    join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), 'obsidian', 'obsidian.json'),
    join(home, '.var', 'app', 'md.obsidian.Obsidian', 'config', 'obsidian', 'obsidian.json'),
  ]
}

export interface DetectedVault {
  name: string
  path: string
}

/** All vaults registered in obsidian.json (may include deleted ones). */
export function detectVaults(): DetectedVault[] {
  for (const candidate of candidatePaths()) {
    if (!existsSync(candidate)) continue
    try {
      const raw = JSON.parse(readFileSync(candidate, 'utf8')) as { vaults?: Record<string, { path?: string }> }
      const vaults: DetectedVault[] = []
      for (const [name, entry] of Object.entries(raw.vaults ?? {})) {
        if (entry.path && existsSync(entry.path)) vaults.push({ name, path: entry.path })
      }
      return vaults
    } catch {
      return []
    }
  }
  return []
}

/** First existing vault, or undefined. */
export function detectVaultPath(): string | undefined {
  return detectVaults()[0]?.path
}
