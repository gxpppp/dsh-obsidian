/**
 * Obsidian bridge clients: the companion plugin channel (selection-fidelity
 * editor ops over 127.0.0.1 HTTP + bearer token) and the Local REST API
 * plugin channel (vault/search/command/open over HTTP + API key).
 */
import type { BridgeMode } from '../settings/schema.ts'

/** Timeout for one bridge call. */
const REQUEST_TIMEOUT_MS = 5000

export interface ActiveNoteState {
  /** Which channel produced the state. */
  channel: 'companion' | 'rest'
  /** Vault-relative path of the active note. */
  path: string
  /** Editor mode reported by Obsidian. */
  mode: 'source' | 'preview' | 'other'
  /** Full current content of the active note (may be absent on errors). */
  content?: string
  /** Character offsets of the current selection (companion only). */
  selection?: { from: number; to: number; text?: string }
  /** Cursor position when there is no selection (companion only). */
  cursor?: { line: number; ch: number }
  /** Open tabs, vault-relative (companion only). */
  openTabs?: string[]
}

export interface BridgeHealth {
  ok: boolean
  channel: 'companion' | 'rest' | 'none'
  detail?: string
}

export interface BridgeOptions {
  mode: BridgeMode
  restUrl: string
  restToken?: string
  companionPort: number
  companionToken?: string
}

export class BridgeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeError'
  }
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new BridgeError(`Obsidian bridge unreachable (${url}): ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new BridgeError(`Obsidian bridge HTTP ${response.status}: ${body.slice(0, 300)}`)
  }
  return response.json().catch(() => undefined)
}

export class ObsidianBridge {
  constructor(private readonly options: () => BridgeOptions) {}

  private companionBase(): string {
    return `http://127.0.0.1:${this.options().companionPort}/api`
  }

  private companionHeaders(): Record<string, string> {
    const token = this.options().companionToken
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  private restBase(): string {
    return this.options().restUrl.replace(/\/+$/, '')
  }

  private restHeaders(): Record<string, string> {
    const token = this.options().restToken
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  private companionEnabled(): boolean {
    const mode = this.options().mode
    return mode === 'auto' || mode === 'companion'
  }

  private restEnabled(): boolean {
    const mode = this.options().mode
    return mode === 'auto' || mode === 'rest'
  }

  /** Probe channels and report what is reachable. */
  async health(): Promise<BridgeHealth> {
    if (this.companionEnabled()) {
      try {
        const data = await fetchJson(`${this.companionBase()}/health`, { headers: this.companionHeaders() }) as { ok?: boolean; detail?: string } | undefined
        if (data?.ok) return { ok: true, channel: 'companion', detail: data.detail }
        return { ok: true, channel: 'companion', detail: undefined }
      } catch {
        // fall through to rest
      }
    }
    if (this.restEnabled()) {
      try {
        await fetchJson(`${this.restBase()}/`, { headers: this.restHeaders() })
        return { ok: true, channel: 'rest' }
      } catch {
        // unreachable
      }
    }
    return { ok: false, channel: 'none', detail: 'Neither the companion bridge nor the Local REST API is reachable. Install the companion plugin into the vault (see settings) or enable the Local REST API plugin.' }
  }

  /** Current active note state: companion first (selection fidelity), rest fallback. */
  async activeState(): Promise<ActiveNoteState | null> {
    if (this.companionEnabled()) {
      try {
        const data = await fetchJson(`${this.companionBase()}/state`, { headers: this.companionHeaders() }) as ActiveNoteState & { ok?: boolean } | undefined
        // Companion reachable means its state is authoritative — even when no
        // note is open (path === ''). Requiring `data.path` here made a
        // reachable-but-empty Obsidian report as "bridge unreachable".
        if (data && data.ok !== false) return { ...data, channel: 'companion' }
      } catch (error) {
        if (this.options().mode === 'companion') throw error
        // auto mode: fall through to rest
      }
    }
    if (this.restEnabled()) {
      try {
        const data = await fetchJson(`${this.restBase()}/active/`, { headers: this.restHeaders() }) as { path?: string; content?: string } | undefined
        if (data?.path) {
          return {
            channel: 'rest',
            path: data.path,
            mode: 'source',
            content: data.content,
          }
        }
      } catch {
        // unreachable
      }
    }
    return null
  }

  /** Apply a replacement to the active editor's selection (companion only). */
  async applyEdit(request: { path: string; from: number; to: number; text: string }): Promise<void> {
    if (!this.companionEnabled()) {
      throw new BridgeError('Inline edit requires the companion bridge (mode companion/auto)')
    }
    const data = await fetchJson(`${this.companionBase()}/edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.companionHeaders() },
      body: JSON.stringify(request),
    }) as { ok?: boolean; error?: string } | undefined
    if (data?.ok === false) {
      throw new BridgeError(data.error ?? 'Companion rejected the edit')
    }
  }

  /** Open a note in Obsidian (companion or rest). */
  async openNote(request: { path: string; line?: number }): Promise<void> {
    if (this.companionEnabled()) {
      try {
        await fetchJson(`${this.companionBase()}/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.companionHeaders() },
          body: JSON.stringify(request),
        })
        return
      } catch (error) {
        if (this.options().mode === 'companion') throw error
      }
    }
    if (this.restEnabled()) {
      await fetchJson(`${this.restBase()}/open/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.restHeaders() },
        body: JSON.stringify({ file: request.path, line: request.line }),
      })
      return
    }
    throw new BridgeError('Open note requires the companion bridge or the Local REST API plugin')
  }

  /** Execute an Obsidian command by id (companion or rest). */
  async executeCommand(id: string): Promise<void> {
    if (this.companionEnabled()) {
      try {
        await fetchJson(`${this.companionBase()}/command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.companionHeaders() },
          body: JSON.stringify({ id }),
        })
        return
      } catch (error) {
        if (this.options().mode === 'companion') throw error
      }
    }
    if (this.restEnabled()) {
      await fetchJson(`${this.restBase()}/commands/${encodeURIComponent(id)}/`, {
        method: 'POST',
        headers: this.restHeaders(),
      })
      return
    }
    throw new BridgeError('Execute command requires the companion bridge or the Local REST API plugin')
  }

  /** List available Obsidian commands (companion or rest). */
  async listCommands(): Promise<{ id: string; name: string }[]> {
    if (this.companionEnabled()) {
      try {
        const data = await fetchJson(`${this.companionBase()}/commands`, { headers: this.companionHeaders() }) as { commands?: { id: string; name: string }[] } | undefined
        if (data?.commands) return data.commands
      } catch (error) {
        if (this.options().mode === 'companion') throw error
      }
    }
    if (this.restEnabled()) {
      const data = await fetchJson(`${this.restBase()}/commands/`, { headers: this.restHeaders() }) as Array<{ id?: string; name?: string }> | undefined
      if (Array.isArray(data)) {
        return data
          .filter((c) => typeof c.id === 'string')
          .map((c) => ({ id: c.id as string, name: c.name ?? c.id as string }))
      }
    }
    throw new BridgeError('List commands requires the companion bridge or the Local REST API plugin')
  }

  /** Show a transient Notice inside Obsidian (companion only). */
  async notice(message: string): Promise<void> {
    if (!this.companionEnabled()) {
      throw new BridgeError('Notice requires the companion bridge (mode companion/auto)')
    }
    await fetchJson(`${this.companionBase()}/notice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.companionHeaders() },
      body: JSON.stringify({ message }),
    })
  }

  /** Indexed full-text search via Obsidian (companion or rest). */
  async searchIndexed(query: string, limit = 20): Promise<{ path: string; snippet?: string }[]> {
    if (this.companionEnabled()) {
      try {
        const data = await fetchJson(`${this.companionBase()}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.companionHeaders() },
          body: JSON.stringify({ query, limit }),
        }) as { results?: { path: string; snippet?: string }[] } | undefined
        if (data?.results) return data.results
      } catch (error) {
        if (this.options().mode === 'companion') throw error
      }
    }
    if (this.restEnabled()) {
      const data = await fetchJson(`${this.restBase()}/search/simple/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.restHeaders() },
        body: JSON.stringify({ query, contextLength: 120 }),
      }) as { code?: number; message?: string; results?: Array<{ path?: string; matches?: Array<{ context?: string }> }> } | undefined
      if (Array.isArray(data?.results)) {
        return data.results
          .filter((r) => typeof r.path === 'string')
          .slice(0, limit)
          .map((r) => ({
            path: r.path as string,
            snippet: r.matches?.[0]?.context,
          }))
      }
      throw new BridgeError(data?.message ?? 'Local REST search failed')
    }
    throw new BridgeError('Indexed search requires the companion bridge or the Local REST API plugin')
  }
}
