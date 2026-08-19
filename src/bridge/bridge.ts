import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import type { BridgeMode } from '../settings/schema.ts'
import {
  BRIDGE_PROTOCOL_VERSION,
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  canonicalVaultIdentity,
  companionEndpoint,
  vaultIdentityMatches,
  type BridgeErrorPayload,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope,
  type VaultIdentity,
} from './protocol.ts'

export type BridgeErrorCode =
  | 'UNAUTHORIZED' | 'VAULT_MISMATCH' | 'NOT_FOUND' | 'CONFLICT'
  | 'INVALID_PATH' | 'UNSUPPORTED' | 'TIMEOUT' | 'ABORTED'
  | 'PROTOCOL_MISMATCH' | 'TOO_LARGE' | 'UNREACHABLE' | 'INTERNAL'

export class BridgeError extends Error {
  constructor(readonly code: BridgeErrorCode, message: string, readonly details?: unknown) {
    super(message)
    this.name = 'BridgeError'
  }
}

export interface BridgeOptions {
  mode: BridgeMode
  vaultPath?: string
  companionEndpoint?: string
  companionToken?: string
  timeoutMs?: number
}

export interface BridgeHello {
  protocolVersion: number
  pluginVersion: string
  obsidianVersion: string
  vault: VaultIdentity
  capabilities: string[]
}

export interface BridgeStatus {
  ok: boolean
  channel: 'companion' | 'fs' | 'none'
  protocolVersion?: number
  pluginVersion?: string
  obsidianVersion?: string
  capabilities: string[]
  vaultMatch: boolean
  detail?: string
}

export interface ActiveNoteState {
  channel: 'companion'
  path: string
  mode: 'source' | 'preview' | 'other'
  content?: string
  revision: string
  selection: { from: number; to: number; text: string } | null
  cursor: { line: number; ch: number; offset: number } | null
  openTabs: string[]
}

export interface SearchRequest {
  query: string
  limit?: number
  mode?: 'literal' | 'regex' | 'path'
  folder?: string
  extensions?: string[]
  tags?: string[]
  properties?: Record<string, string | number | boolean>
  cursor?: string
}

export interface LinkInfo {
  path: string
  outgoing: Array<{ link: string; target?: string; display?: string; embed?: boolean }>
  backlinks: string[]
  unresolved: string[]
}

export interface AttachmentPayload {
  path: string
  sourcePath?: string
}

export class ObsidianBridge {
  constructor(private readonly options: () => BridgeOptions) {}

  async status(signal?: AbortSignal): Promise<BridgeStatus> {
    const options = this.options()
    if (options.mode === 'fs') {
      return { ok: Boolean(options.vaultPath), channel: 'fs', capabilities: [], vaultMatch: Boolean(options.vaultPath), detail: 'Companion disabled by fs mode.' }
    }
    try {
      const hello = await this.hello(signal)
      return {
        ok: true,
        channel: 'companion',
        protocolVersion: hello.protocolVersion,
        pluginVersion: hello.pluginVersion,
        obsidianVersion: hello.obsidianVersion,
        capabilities: hello.capabilities,
        vaultMatch: true,
      }
    } catch (error) {
      const bridgeError = asBridgeError(error)
      return {
        ok: false,
        channel: 'none',
        capabilities: [],
        vaultMatch: bridgeError.code !== 'VAULT_MISMATCH',
        detail: bridgeError.message,
      }
    }
  }

  async health(signal?: AbortSignal): Promise<BridgeStatus> { return this.status(signal) }

  async hello(signal?: AbortSignal): Promise<BridgeHello> {
    const hello = await this.requestRaw<BridgeHello>('hello', {}, signal)
    if (hello.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new BridgeError('PROTOCOL_MISMATCH', `Companion protocol ${hello.protocolVersion} is not supported; expected ${BRIDGE_PROTOCOL_VERSION}`)
    }
    const vaultPath = this.options().vaultPath
    if (!vaultPath) throw new BridgeError('VAULT_MISMATCH', 'vaultPath is required for companion identity verification')
    const expected = canonicalVaultIdentity(vaultPath)
    if (!vaultIdentityMatches(expected, hello.vault)) {
      throw new BridgeError('VAULT_MISMATCH', 'The companion is serving a different Obsidian vault')
    }
    return hello
  }

  private async call<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    if (this.options().mode === 'fs') throw new BridgeError('UNSUPPORTED', `${method} requires the Obsidian companion`)
    await this.hello(signal)
    return this.requestRaw<T>(method, params, signal)
  }

  private async requestRaw<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    const options = this.options()
    const token = await this.resolveToken()
    if (!token) throw new BridgeError('UNAUTHORIZED', 'Companion token is not configured')
    if (signal?.aborted) throw new BridgeError('ABORTED', 'Companion request aborted')
    const requestId = randomUUID()
    const request: BridgeRequestEnvelope = {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      requestId,
      token,
      method,
      params,
    }
    const encoded = `${JSON.stringify(request)}\n`
    if (Buffer.byteLength(encoded) > MAX_MESSAGE_BYTES) throw new BridgeError('TOO_LARGE', 'Companion request exceeds the 1 MiB protocol limit')
    const endpoint = options.companionEndpoint?.trim() || companionEndpoint(options.vaultPath)
    const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

    return new Promise<T>((resolve, reject) => {
      let settled = false
      let received = Buffer.alloc(0)
      const socket = createConnection(endpoint)
      const finish = (error?: unknown, value?: T): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        socket.destroy()
        if (error !== undefined) reject(error)
        else resolve(value as T)
      }
      const onAbort = (): void => finish(new BridgeError('ABORTED', 'Companion request aborted'))
      const timer = setTimeout(() => finish(new BridgeError('TIMEOUT', `Companion request timed out after ${timeoutMs} ms`)), timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })
      socket.once('connect', () => socket.write(encoded))
      socket.on('data', (chunk: Buffer) => {
        received = Buffer.concat([received, chunk])
        if (received.byteLength > MAX_MESSAGE_BYTES) {
          finish(new BridgeError('TOO_LARGE', 'Companion response exceeds the 1 MiB protocol limit'))
          return
        }
        const newline = received.indexOf(0x0a)
        if (newline < 0) return
        let response: BridgeResponseEnvelope
        try { response = JSON.parse(received.subarray(0, newline).toString('utf8')) as BridgeResponseEnvelope } catch {
          finish(new BridgeError('PROTOCOL_MISMATCH', 'Companion returned invalid JSON'))
          return
        }
        if (response.protocolVersion !== BRIDGE_PROTOCOL_VERSION || response.requestId !== requestId) {
          finish(new BridgeError('PROTOCOL_MISMATCH', 'Companion response identity or protocol version is invalid'))
          return
        }
        if (!response.ok) {
          finish(fromPayload(response.error))
          return
        }
        finish(undefined, response.data as T)
      })
      socket.once('error', (error) => finish(new BridgeError('UNREACHABLE', `Companion IPC is unreachable: ${error.message}`)))
      socket.once('end', () => {
        if (!settled) finish(new BridgeError('PROTOCOL_MISMATCH', 'Companion closed the connection before a complete response'))
      })
    })
  }

  private async resolveToken(): Promise<string | undefined> {
    const configured = this.options().companionToken?.trim()
    if (configured) return configured
    const vaultPath = this.options().vaultPath
    if (!vaultPath) return undefined
    try {
      const raw = await readFile(join(vaultPath, '.obsidian', 'plugins', 'dsh-obsidian-bridge', 'data.json'), 'utf8')
      const data = JSON.parse(raw) as { token?: unknown }
      return typeof data.token === 'string' && data.token.trim() ? data.token.trim() : undefined
    } catch { return undefined }
  }

  async activeState(signal?: AbortSignal, includeContent = false): Promise<ActiveNoteState | null> {
    try { return await this.call<ActiveNoteState>('editor.state', { includeContent }, signal) } catch (error) {
      if (this.options().mode === 'auto' && asBridgeError(error).code === 'UNREACHABLE') return null
      throw error
    }
  }

  async applyEdit(request: { path: string; from: number; to: number; text: string; revision: string; expectedText: string }, signal?: AbortSignal): Promise<{ revision: string }> {
    return this.call('editor.edit', request, signal)
  }
  async openNote(request: { path: string; line?: number }, signal?: AbortSignal): Promise<void> { await this.call('editor.open', request, signal) }
  async searchIndexed(request: SearchRequest, signal?: AbortSignal): Promise<{ results: Array<{ path: string; lineNumber?: number; snippet?: string }>; nextCursor?: string }> { return this.call('search', request, signal) }
  async metadata(path: string, signal?: AbortSignal): Promise<Record<string, unknown>> { return this.call('metadata.get', { path }, signal) }
  async updateFrontmatter(request: { path: string; patch: Record<string, unknown>; remove?: string[]; ifMatch?: string }, signal?: AbortSignal): Promise<Record<string, unknown>> { return this.call('frontmatter.update', request, signal) }
  async resolveLink(request: { link: string; sourcePath?: string }, signal?: AbortSignal): Promise<{ path?: string; exists: boolean }> { return this.call('links.resolve', request, signal) }
  async links(path: string, signal?: AbortSignal): Promise<LinkInfo> { return this.call('links.list', { path }, signal) }
  async insertLink(request: { path: string; target: string; display?: string; embed?: boolean; position?: number; ifMatch?: string }, signal?: AbortSignal): Promise<{ link: string; revision: string }> { return this.call('links.insert', request, signal) }
  async addAttachment(request: AttachmentPayload, signal?: AbortSignal): Promise<{ path: string; mediaType?: string; bytes: number; link: string }> { return this.call('attachments.add', request, signal) }
  async listCommands(signal?: AbortSignal): Promise<Array<{ id: string; name: string }>> { return (await this.call<{ commands: Array<{ id: string; name: string }> }>('commands.list', {}, signal)).commands }
  async executeCommand(id: string, signal?: AbortSignal): Promise<void> { await this.call('commands.execute', { id }, signal) }
  async notice(message: string, signal?: AbortSignal): Promise<void> { await this.call('notice', { message }, signal) }
}

function fromPayload(payload: BridgeErrorPayload): BridgeError {
  return new BridgeError(normalizeCode(payload.code), payload.message, payload.details)
}
function normalizeCode(code: string): BridgeErrorCode {
  return ['UNAUTHORIZED', 'VAULT_MISMATCH', 'NOT_FOUND', 'CONFLICT', 'INVALID_PATH', 'UNSUPPORTED', 'TIMEOUT', 'ABORTED', 'PROTOCOL_MISMATCH', 'TOO_LARGE', 'UNREACHABLE', 'INTERNAL'].includes(code)
    ? code as BridgeErrorCode
    : 'INTERNAL'
}
function asBridgeError(error: unknown): BridgeError {
  return error instanceof BridgeError ? error : new BridgeError('INTERNAL', error instanceof Error ? error.message : String(error))
}
