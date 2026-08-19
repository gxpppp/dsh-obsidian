import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

export const BRIDGE_PROTOCOL_VERSION = 1 as const
export const MAX_MESSAGE_BYTES = 1024 * 1024
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000
export const DEFAULT_IPC_NAME = 'dsh-obsidian-bridge'

export interface BridgeRequestEnvelope {
  protocolVersion: number
  requestId: string
  token: string
  method: string
  params: unknown
}

export interface BridgeErrorPayload {
  code: string
  message: string
  details?: unknown
}

export type BridgeResponseEnvelope =
  | { protocolVersion: number; requestId: string; ok: true; data: unknown }
  | { protocolVersion: number; requestId: string; ok: false; error: BridgeErrorPayload }

export interface VaultIdentity {
  canonicalPath: string
  hash: string
}

function normalizedCanonicalPath(value: string): string {
  const absolute = resolve(value)
  let canonical: string
  try {
    canonical = realpathSync.native(absolute)
  } catch {
    canonical = absolute
  }
  const normalized = canonical.replace(/[\\/]+$/, '') || canonical
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function canonicalVaultIdentity(vaultPath: string): VaultIdentity {
  const canonicalPath = normalizedCanonicalPath(vaultPath)
  return {
    canonicalPath,
    hash: createHash('sha256').update(canonicalPath, 'utf8').digest('hex'),
  }
}

export function vaultIdentityMatches(expected: VaultIdentity, actual: VaultIdentity): boolean {
  return expected.hash === actual.hash && expected.canonicalPath === actual.canonicalPath
}

function safeIpcName(ipcName: string): string {
  const trimmed = ipcName.trim()
  if (trimmed !== '' && /^[A-Za-z0-9._-]{1,80}$/.test(trimmed)) return trimmed
  return `${DEFAULT_IPC_NAME}-${createHash('sha256').update(trimmed, 'utf8').digest('hex').slice(0, 16)}`
}

/** Deterministic local IPC endpoint for a vault identity or explicit IPC name. */
export function companionEndpoint(vaultPath?: string, ipcName?: string): string {
  const identitySuffix = vaultPath === undefined || vaultPath === ''
    ? ''
    : `-${canonicalVaultIdentity(vaultPath).hash.slice(0, 16)}`
  const name = safeIpcName(ipcName ?? `${DEFAULT_IPC_NAME}${identitySuffix}`)
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\${name}`
    : `${tmpdir().replace(/[\\/]+$/, '')}/${name}.sock`
}
