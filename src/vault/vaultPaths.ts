/**
 * Vault path safety layer (port of Claudian's pathContainment.ts + the
 * normalizeManagedPath rules from VaultFileAdapter.ts).
 *
 * All agent-facing paths are vault-relative, forward-slash, no leading slash,
 * no drive letters, no backslashes, no `..` or `.` segments. Resolved absolute
 * paths are re-checked against the vault root via realpath containment so a
 * symlink escape cannot reach outside the vault.
 */
import * as path from 'node:path'
import * as fs from 'node:fs'

/** Thrown for any vault-relative path that violates the normalization rules. */
export class VaultPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultPathError'
  }
}

/** Normalize + validate a vault-relative path. Returns the normalized form. */
export function normalizeVaultPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VaultPathError('Path must be a non-empty vault-relative path')
  }
  if (
    value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.includes(':')
  ) {
    throw new VaultPathError('Path must be a normalized vault-relative path (forward slashes only, no drive/absolute)')
  }
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new VaultPathError('Path must be a normalized vault-relative path (no empty, "." or ".." segments)')
  }
  if (parts.length > 1 && !/^[^\u0000-\u001f]+$/.test(parts[parts.length - 1])) {
    throw new VaultPathError('Path contains control characters')
  }
  return parts.join('/')
}

/** Normalize a vault-relative folder path; trailing slash optional. */
export function normalizeVaultFolder(value: string): string {
  const normalized = normalizeVaultPath(value.replace(/^[/]+/, '').replace(/[/]+$/, ''))
  return normalized
}

/** Case-insensitive comparison helper for win32; exact elsewhere. */
export function pathEquals(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Resolve a vault-relative path against the vault root and verify containment. */
export function resolveVaultPath(vaultRoot: string, relative: string): string {
  const normalized = normalizeVaultPath(relative)
  const root = path.resolve(vaultRoot)
  const resolved = path.resolve(root, normalized.split('/').join(path.sep))
  if (!pathEquals(root, resolved) && !resolved.startsWith(root + path.sep) && !resolved.startsWith(root + '/')) {
    throw new VaultPathError('Path escapes the vault root')
  }
  return resolved
}

/**
 * Verify that an absolute path stays inside the vault, following symlinks via
 * realpath when the path exists. The vault root itself is realpathed once and
 * cached per call.
 */
export function assertWithinVault(vaultRoot: string, absolute: string): string {
  const rootReal = fs.realpathSync.native(vaultRoot)
  let targetReal: string
  try {
    targetReal = fs.realpathSync.native(absolute)
  } catch {
    // The file may not exist yet (create flows): realpath the parent instead.
    const parent = path.dirname(absolute)
    const parentReal = fs.realpathSync.native(parent)
    targetReal = path.join(parentReal, path.basename(absolute))
  }
  const rootNorm = process.platform === 'win32' ? rootReal.toLowerCase() : rootReal
  const targetNorm = process.platform === 'win32' ? targetReal.toLowerCase() : targetReal
  if (!targetNorm.startsWith(rootNorm + path.sep)) {
    throw new VaultPathError('Path resolves outside the vault root (symlink escape rejected)')
  }
  return targetReal
}

/** Readable error for missing configuration. */
export function vaultNotConfiguredError(): VaultPathError {
  return new VaultPathError('Obsidian vault is not configured: set vaultPath in the plugin settings (or run "detect vault")')
}
