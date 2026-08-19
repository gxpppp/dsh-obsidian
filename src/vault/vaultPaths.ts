/**
 * Security boundary for every agent-facing vault path.
 *
 * Agent paths are always vault-relative and use forward slashes. Hidden path
 * segments are intentionally unavailable: internal paths such as .obsidian and
 * .trash are owned by the host, not by the agent.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

export type VaultErrorCode =
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'CONFLICT'
  | 'PROTECTED_PATH'
  | 'TOO_LARGE'
  | 'IO'

export class VaultError extends Error {
  readonly code: VaultErrorCode
  readonly path?: string

  constructor(code: VaultErrorCode, message: string, options: { path?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'VaultError'
    this.code = code
    this.path = options.path
  }
}

/** Kept as a distinct class for callers that already catch path failures. */
export class VaultPathError extends VaultError {
  constructor(message: string, code: 'INVALID_PATH' | 'PROTECTED_PATH' = 'INVALID_PATH', vaultPath?: string) {
    super(code, message, { path: vaultPath })
    this.name = 'VaultPathError'
  }
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/

/** Normalize and validate a non-root vault-relative path. */
export function normalizeVaultPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new VaultPathError('Path must be a non-empty vault-relative path', 'INVALID_PATH', value)
  }
  if (CONTROL_CHARACTERS.test(value)) {
    throw new VaultPathError('Path contains a control character', 'INVALID_PATH', value)
  }
  if (
    value.includes('\\')
    || value.startsWith('/')
    || /^[A-Za-z]:/.test(value)
    || value.includes(':')
  ) {
    throw new VaultPathError(
      'Path must be vault-relative and use forward slashes',
      'INVALID_PATH',
      value,
    )
  }

  const parts = value.split('/')
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new VaultPathError('Path contains an empty or dot segment', 'INVALID_PATH', value)
  }
  const protectedPart = parts.find((part) => part.startsWith('.'))
  if (protectedPart !== undefined) {
    throw new VaultPathError(`Dot path segment is protected: ${protectedPart}`, 'PROTECTED_PATH', value)
  }
  return parts.join('/')
}

/** Normalize a folder path. The empty string is the only root spelling. */
export function normalizeVaultFolder(value: string): string {
  if (value === '') return ''
  return normalizeVaultPath(value)
}

/** Case-insensitive comparison helper for Windows; exact elsewhere. */
export function pathEquals(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isWithin(root: string, candidate: string, allowRoot: boolean): boolean {
  if (pathEquals(root, candidate)) return allowRoot
  const rootComparable = process.platform === 'win32' ? root.toLowerCase() : root
  const candidateComparable = process.platform === 'win32' ? candidate.toLowerCase() : candidate
  const relative = path.relative(rootComparable, candidateComparable)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Resolve a validated non-root agent path lexically against the vault root. */
export function resolveVaultPath(vaultRoot: string, relative: string): string {
  const normalized = normalizeVaultPath(relative)
  const root = path.resolve(vaultRoot)
  const resolved = path.resolve(root, ...normalized.split('/'))
  if (!isWithin(root, resolved, false)) {
    throw new VaultPathError('Path escapes the vault root', 'INVALID_PATH', relative)
  }
  return resolved
}

/** Return the canonical vault root. */
export function canonicalVaultRoot(vaultRoot: string): string {
  try {
    return fs.realpathSync.native(path.resolve(vaultRoot))
  } catch (error) {
    throw new VaultError('IO', `Cannot resolve vault root: ${vaultRoot}`, { path: vaultRoot, cause: error })
  }
}

/**
 * Follow symlinks/junctions and prove containment in the canonical vault.
 *
 * If the target does not exist, the nearest existing ancestor is realpathed
 * and the missing suffix is projected from that canonical ancestor. This is
 * what makes deep create targets safe before mkdir/write begins.
 */
export function assertWithinVault(vaultRoot: string, absolute: string): string {
  const lexicalRoot = path.resolve(vaultRoot)
  const lexicalTarget = path.resolve(absolute)
  if (!isWithin(lexicalRoot, lexicalTarget, true)) {
    throw new VaultPathError('Absolute path is outside the vault root')
  }

  const rootReal = canonicalVaultRoot(lexicalRoot)
  let ancestor = lexicalTarget
  const missingParts: string[] = []
  let ancestorReal: string | undefined

  while (ancestorReal === undefined) {
    try {
      ancestorReal = fs.realpathSync.native(ancestor)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new VaultError('IO', `Cannot resolve vault path: ${absolute}`, { path: absolute, cause: error })
      }
      if (pathEquals(ancestor, lexicalRoot)) {
        throw new VaultError('IO', `Cannot resolve vault path: ${absolute}`, { path: absolute, cause: error })
      }
      missingParts.unshift(path.basename(ancestor))
      ancestor = path.dirname(ancestor)
    }
  }

  if (!isWithin(rootReal, ancestorReal, true)) {
    throw new VaultPathError(
      'Path resolves outside the canonical vault (symlink/junction escape rejected)',
      'PROTECTED_PATH',
      absolute,
    )
  }
  const targetReal = path.resolve(ancestorReal, ...missingParts)
  if (!isWithin(rootReal, targetReal, true)) {
    throw new VaultPathError(
      'Path resolves outside the canonical vault (symlink/junction escape rejected)',
      'PROTECTED_PATH',
      absolute,
    )
  }
  return targetReal
}

/** Readable error for missing configuration. */
export function vaultNotConfiguredError(): VaultPathError {
  return new VaultPathError('Obsidian vault is not configured: set vaultPath in the plugin settings (or run "detect vault")')
}
